import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Position } from '../src/core/chess.ts';
import { encodeGame } from '../src/core/codec.ts';
import { parseGame } from '../src/core/pgn.ts';
import { PAWNS_DEAD, PAWNS_MATCH, PAWNS_NO, describePawns, gameHasPawns, parsePawns, pawnMasks, pawnMatcher, type PawnMode } from '../src/core/pawns.ts';
import { GameDatabase } from '../src/server/db/store.ts';
import { scanGames } from '../src/server/db/scan.ts';

// δομή Carlsbad (μετά το 4.cxd5 exd5 της ανταλλαγής του Γυναικείου Γκάμπιτ), με μόνο τους βασιλιάδες
const CARLSBAD = '4k3/ppp2ppp/8/3p4/3P4/8/PP2PPPP/4K3 w - - 0 1';
const QGD_EX = '1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5 5. Bg5 Be7 6. Qc2 O-O *';

const has = (pgn: string, target: string, mode: PawnMode = 'exact') => {
  const { game } = parseGame(pgn);
  return gameHasPawns(encodeGame(game).tokens, null, pawnMatcher(parsePawns(target, mode)!), new Position(), new Uint8Array(8), new Uint8Array(8));
};

/** Τι λέει ο έλεγχος για μια μεμονωμένη θέση. */
const state = (target: string, fen: string, mode: PawnMode = 'exact') => {
  const w = new Uint8Array(8);
  const b = new Uint8Array(8);
  pawnMasks(Position.fromFen(fen), w, b);
  return pawnMatcher(parsePawns(target, mode)!)(w, b);
};

describe('δομή πιονιών: ανάγνωση', () => {
  it('από FEN ή μόνο από το πρώτο του πεδίο', () => {
    const p = parsePawns('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')!;
    expect(p.white).toEqual([0, 255, 0, 0, 0, 0, 0, 0]);
    expect(p.black).toEqual([0, 0, 0, 0, 0, 0, 255, 0]);
    expect(parsePawns('4k3/ppp2ppp/8/3p4/3P4/8/PP2PPPP/4K3')).toEqual(parsePawns(CARLSBAD));
    expect(describePawns(parsePawns(CARLSBAD)!)).toBe('a2 b2 d4 e2 f2 g2 h2 – a7 b7 c7 d5 f7 g7 h7');
  });

  it('άκυρα', () => {
    expect(parsePawns('8/8/8/8/8/8/8')).toBeNull();
    expect(parsePawns('P7/8/8/8/8/8/8/8')).toBeNull();
    expect(parsePawns('8/8/8/8/8/8/8/p7')).toBeNull();
    expect(parsePawns('9/8/8/8/8/8/8/8')).toBeNull();
    expect(parsePawns('8/8/8/8/8/8/8/7x')).toBeNull();
    expect(parsePawns(CARLSBAD, 'any' as PawnMode)).toBeNull();
  });
});

describe('δομή πιονιών: ταίριασμα', () => {
  it('ακριβής δομή, όπου κι αν είναι τα κομμάτια', () => {
    expect(has(QGD_EX, CARLSBAD)).toBe(true);
    expect(has('1. e4 e5 2. Nf3 Nc6 *', CARLSBAD)).toBe(false);
    // ίδια λευκά, άλλα μαύρα (…c6 αντί για …c7)
    expect(has(QGD_EX, '4k3/pp3ppp/2p5/3p4/3P4/8/PP2PPPP/4K3')).toBe(false);
  });

  it('μόνο λευκά ή μόνο μαύρα', () => {
    const otherBlack = '4k3/pp3ppp/2p5/3p4/3P4/8/PP2PPPP/4K3';
    expect(has(QGD_EX, otherBlack, 'white')).toBe(true);
    expect(has(QGD_EX, otherBlack, 'black')).toBe(false);
    const otherWhite = '4k3/ppp2ppp/8/3p4/3P4/4P3/PP3PPP/4K3';
    expect(has(QGD_EX, otherWhite, 'black')).toBe(true);
    expect(has(QGD_EX, otherWhite, 'white')).toBe(false);
  });

  it('μόνο οι στήλες: η e-στήλη με το πιόνι στο e3 αντί για e2', () => {
    const e3 = '4k3/ppp2ppp/8/3p4/3P4/4P3/PP3PPP/4K3';
    expect(has(QGD_EX, e3)).toBe(false);
    expect(has(QGD_EX, e3, 'files')).toBe(true);
    // άλλη στήλη (c αντί για d για τα λευκά): όχι
    expect(has(QGD_EX, '4k3/ppp2ppp/8/3p4/2P5/8/PP2PPPP/4K3', 'files')).toBe(false);
  });

  it('η αρχική δομή ταιριάζει στην αρχή', () => {
    expect(has('1. e4 *', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(true);
  });
});

describe('δομή πιονιών: κλάδεμα', () => {
  it('πιόνι που έφυγε από τη 2η / 7η δεν γυρίζει', () => {
    // μετά το 1.e4 το e2 της Carlsbad δεν μπορεί πια να γεμίσει
    expect(state(CARLSBAD, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe(PAWNS_DEAD);
    expect(state(CARLSBAD, 'rnbqkbnr/pp1ppppp/8/2p5/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(PAWNS_DEAD);
    // …c5: το c7 της Carlsbad χάθηκε· μόνο για τα λευκά δεν μετρά
    expect(state(CARLSBAD, 'rnbqkbnr/pp1ppppp/8/2p5/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'white')).toBe(PAWNS_NO);
    expect(state(CARLSBAD, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(PAWNS_NO);
  });

  it('πιόνι που πέρασε τη γραμμή του στόχου (λευκά προς τα πάνω, μαύρα προς τα κάτω)', () => {
    const d4 = '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1';
    expect(state(d4, '4k3/8/8/3P4/8/8/8/4K3 w - - 0 1')).toBe(PAWNS_DEAD);
    expect(state(d4, '4k3/8/8/8/8/3P4/8/4K3 w - - 0 1')).toBe(PAWNS_NO);
    expect(state(d4, d4)).toBe(PAWNS_MATCH);
    const d5 = '4k3/8/8/3p4/8/8/8/4K3 w - - 0 1';
    expect(state(d5, '4k3/8/8/8/3p4/8/8/4K3 w - - 0 1')).toBe(PAWNS_DEAD);
    expect(state(d5, '4k3/8/3p4/8/8/8/8/4K3 w - - 0 1')).toBe(PAWNS_NO);
    expect(state(d5, '4k3/8/8/8/3p4/8/8/4K3 w - - 0 1', 'white')).toBe(PAWNS_MATCH);
  });

  it('λιγότερα πιόνια από τον στόχο', () => {
    expect(state('4k3/8/8/8/2PP4/8/8/4K3 w - - 0 1', '4k3/8/8/8/3P4/8/8/4K3 w - - 0 1', 'files')).toBe(PAWNS_DEAD);
    expect(state('4k3/8/8/8/2PP4/8/8/4K3 w - - 0 1', '4k3/8/8/8/2P5/3P4/8/4K3 w - - 0 1', 'files')).toBe(PAWNS_MATCH);
  });
});

describe('δομή πιονιών: σάρωση βάσης', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-pawns-'));
  const file = path.join(dir, 'p.skdb');
  // οι workers της σάρωσης κλείνουν λίγο μετά το αποτέλεσμα και ως τότε τα Windows κρατούν το αρχείο
  afterAll(() => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));

  it('scanGames με τύπο pawns', async () => {
    const db = new GameDatabase(file, { create: true });
    const toNew = (pgn: string) => {
      const { game } = parseGame(pgn);
      const enc = encodeGame(game);
      return { headers: game.headers, tokens: enc.tokens, comments: null, fen: null, flags: enc.flags, plies: game.plyCount() };
    };
    db.insertBatch([toNew(QGD_EX), toNew('1. e4 e5 2. Nf3 Nc6 *'), toNew('1. d4 d5 2. c4 e6 3. Nf3 Nf6 4. cxd5 exd5 5. Nc3 c6 *')], 1);
    const range = { minId: db.minId(), maxId: db.maxId() };
    db.close();
    const ids = await scanGames(file, { kind: 'pawns', pawns: parsePawns(CARLSBAD)! }, range);
    expect([...ids]).toEqual([1, 3]);
    const c6 = await scanGames(file, { kind: 'pawns', pawns: parsePawns('4k3/pp3ppp/2p5/3p4/3P4/8/PP2PPPP/4K3', 'black')! }, range);
    expect([...c6]).toEqual([3]);
  });
});
