/** Τεστ: πλήρης εισαγωγή Lichess σε μικρό συνθετικό αρχείο pzstd (frames που κόβουν γραμμές, workers, επικύρωση, επανεισαγωγή). */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repairIndexes } from '../../src/server/tactics/catalog.ts';
import { Tactics } from '../../src/server/tactics/context.ts';
import { puzzleJson } from '../../src/server/tactics/format.ts';
import { importLichess, interruptedLichess } from '../../src/server/tactics/lichess.ts';
import { decodeLichessId } from '../../src/server/tactics/pack.ts';
import { F_INACTIVE, F_WHITE } from '../../src/server/tactics/store.ts';
import { addPuzzles, fakeContext, tempTactics } from './helpers.ts';

const HEADER = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate';
// πραγματικές γραμμές του lichess_db_puzzle.csv (CC0)
const GOOD = [
  '00008,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1 b3c1 b1c1 h6c1,1811,76,95,10282,crushing hangingPiece long middlegame,https://lichess.org/787zsVup/black#48,,',
  '0000H,r4rk1/pp3ppp/8/2bqp2b/3N4/P2Bn2P/1PPN1P2/R1BQ1RK1 w - - 1 15,d1h5 d5g2,1554,223,100,11,mate mateIn1 middlegame oneMove,https://lichess.org/EwHRkfas#29,French_Defense French_Defense_Tarrasch_Variation,',
  '000Zo,4r3/1k6/pp3r2/1b2P2p/3R1p2/P1R2P2/1P4PP/6K1 w - - 0 35,e5f6 e8e1 g1f2 e1f1,1363,76,86,657,endgame mate mateIn2 operaMate short,https://lichess.org/n8Ff742v#69,,',
  '000h0,5rk1/p5p1/3bpr1p/1Pp4q/3pR3/1P1Q1N2/P4PPP/4R1K1 w - - 4 22,e4e6 f6f3 g2f3 h5h2 g1f1 h2h3 f1e2 h3e6,2048,78,89,202,advantage interference kingsideAttack middlegame veryLong,https://lichess.org/OWe6M5dF#43,,',
  '005gP,8/8/3p4/2kP4/1p4P1/2pK4/P7/8 w - - 1 42,g4g5 c5d5 g5g6 d5e6 g6g7 e6f7 a2a4 b4a3 g7g8r f7g8,1723,74,100,1269,crushing enPassant endgame pawnEndgame veryLong,https://lichess.org/I76OvKQT#83,,',
  '00sBK,3r2k1/p4p1p/1p3qp1/3B1b2/8/1Qr1PP1P/P2R1KP1/7R w - - 0 23,d5f7 g8g7 b3c3 f6c3,1829,75,85,83,advantage defensiveMove middlegame short,https://lichess.org/nMNDAjGq#45,,1608386149791',
  '01xdm,r3k2r/4bppp/p2p4/2pPp3/4P1n1/2N2P1q/PP1BQP1P/R3K2R b KQkq - 6 15,g4h2 e1c1 h3f3 h1h2 f3e2 c3e2,1874,80,73,312,advantage castling long middlegame,https://lichess.org/kaULwkrz/black#30,Sicilian_Defense Sicilian_Defense_Alapin_Variation,',
  '03kqY,8/2Q2ppk/4b2p/8/4P3/2p3P1/4KP1P/2r5 w - - 4 49,f2f4 e6b3 e4e5 c3c2 e5e6 f7e6 c7c3 c1d1 c3b3 c2c1n e2d1 c1b3,2800,116,91,3281,advancedPawn crushing endgame exposedKing fork promotion quietMove underPromotion veryLong,https://lichess.org/W9OcpQ5I#97,,',
];
const BAD = [
  // παράνομη κίνηση
  '0aaa1,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1 a1a2,1500,76,95,1000,crushing,https://lichess.org/787zsVup/black#48,,',
  // δηλώνει ματ αλλά δεν είναι
  '0aaa2,5rk1/p5p1/3bpr1p/1Pp4q/3pR3/1P1Q1N2/P4PPP/4R1K1 w - - 4 22,e4e6 f6f3 g2f3 h5h2,2048,78,89,202,mate mateIn2 short,https://lichess.org/OWe6M5dF#43,,',
  // δύο λευκοί βασιλιάδες
  '0aaa3,K6k/8/8/8/8/8/8/K7 w - - 0 1,a1a2 h8h7,1500,76,95,1000,crushing,https://lichess.org/abcdefgh#1,,',
  // μονός αριθμός κινήσεων
  '0aaa4,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1,1500,76,95,1000,crushing,https://lichess.org/787zsVup/black#48,,',
  // άκυρο id
  '0aa5,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7,1500,76,95,1000,crushing,https://lichess.org/787zsVup/black#48,,',
];

function skippable(next: number): Buffer {
  const b = Buffer.alloc(12);
  b.writeUInt32LE(0x184d2a50, 0);
  b.writeUInt32LE(4, 4);
  b.writeUInt32LE(next, 8);
  return b;
}

/** Γράφει CSV σε αρχείο pzstd με `parts` frames, κομμένα σε τυχαία σημεία (και μέσα σε γραμμές). */
function writePzstd(file: string, csv: string, parts: number, firstCut = 0): void {
  const data = Buffer.from(csv);
  const cuts = [0];
  if (firstCut) cuts.push(firstCut);
  for (let k = 1; k < parts; k++) cuts.push(Math.max(firstCut, Math.min(data.length, Math.floor((data.length * k) / parts) + 7)));
  cuts.push(data.length);
  const out: Buffer[] = [];
  for (let k = 0; k < parts; k++) {
    const f = zlib.zstdCompressSync(data.subarray(cuts[k], cuts[k + 1]));
    out.push(skippable(f.length), f);
  }
  fs.writeFileSync(file, Buffer.concat(out));
}

describe('εισαγωγή Lichess (συνθετικό pzstd)', () => {
  let env: ReturnType<typeof tempTactics>;
  beforeEach(() => (env = tempTactics()));
  afterEach(() => env.cleanup());

  // δύο εισαγωγές με workers: ~1″ μόνο του, πάνω από το όριο των 5″ όταν τρέχει μαζί με όλη τη σουίτα
  it('frames, επικύρωση, πακετάρισμα, ανοίγματα, daily, επανεισαγωγή', { timeout: 30_000 }, async () => {
    const file = path.join(env.dir, 'puzzles.csv.zst');
    writePzstd(file, [HEADER, ...GOOD, ...BAD].join('\n') + '\n', 3);
    const rep = await importLichess(env.t, fakeContext('lichess'), { file, quality: 'all', workers: 2 });
    expect(rep.lines).toBe(GOOD.length + BAD.length);
    expect(rep.imported).toBe(GOOD.length);
    expect(rep.rejected).toEqual({ illegal: 1, notMate: 1, fen: 1, length: 1, id: 1 });
    expect(rep.filtered).toBe(0);
    expect(rep.frames).toBe(3);

    const db = env.t.puzzles;
    const row = db.get(decodeLichessId('00008'))!;
    const j = puzzleJson(env.t, row, { san: true });
    expect(j.fen).toBe('r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24');
    expect(j.moves).toEqual(['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1']);
    expect(j.color).toBe('white');
    expect(j.solverMoves).toBe(3);
    expect(j.gameUrl).toBe('https://lichess.org/787zsVup/black#48');
    expect(j.themes.map((x) => x.key)).toEqual(expect.arrayContaining(['crushing', 'hangingPiece', 'long', 'middlegame']));
    expect(j.themes.find((x) => x.key === 'crushing')!.el).toBe('Συντριπτικό πλεονέκτημα');
    expect(j.san).toEqual(['Bxg3', 'Rxe7', 'Qb1+', 'Nc1', 'Qxc1+', 'Qxc1']);
    // ροκέ του λύτη (e1c1) και ο λύτης με τα λευκά ενώ στο FEN παίζουν τα μαύρα
    const c = puzzleJson(env.t, db.get(decodeLichessId('01xdm'))!);
    expect(c.moves[1]).toBe('e1c1');
    expect(c.opening).toMatchObject({ family: 'Sicilian Defense', variation: 'Sicilian Defense Alapin Variation' });
    expect(db.get(decodeLichessId('0000H'))!.flags & F_WHITE).toBe(0);
    expect(db.prep('SELECT puzzle_id FROM daily WHERE day = ?').get('2020-12-19')).toEqual({ puzzle_id: decodeLichessId('00sBK') });
    expect((db.prep("SELECT n FROM theme WHERE key = 'veryLong'").get() as { n: number }).n).toBe(3);
    expect((db.prep("SELECT n FROM source WHERE key = 'lichess'").get() as { n: number }).n).toBe(GOOD.length);

    // επανεισαγωγή με το προεπιλεγμένο φίλτρο: το 0000H (11 προσπάθειες) φεύγει, αλλά έχει προσπάθεια → ανενεργό
    env.t.user.db.exec(`INSERT INTO attempt(puzzle_id, ts, mode, win, first_try) VALUES (${decodeLichessId('0000H')}, 1, 'rated', 1, 1)`);
    const changed = GOOD.map((l) => (l.startsWith('000Zo') ? l.replace(',1363,', ',1400,') : l));
    writePzstd(file, [HEADER, ...changed].join('\r\n') + '\r\n', 2);
    const rep2 = await importLichess(env.t, fakeContext('lichess'), { file, quality: 'default', workers: 2 });
    expect(rep2.filtered).toBe(3);
    expect(rep2.imported).toBe(GOOD.length - 3);
    expect(rep2.deactivated).toBe(1);
    expect(rep2.removed).toBe(2);
    expect(db.get(decodeLichessId('0000H'))!.flags & F_INACTIVE).toBeTruthy();
    expect(db.get(decodeLichessId('00sBK'))).toBeUndefined();
    expect(db.get(decodeLichessId('000Zo'))!.rating).toBe(1400);
    // τα ευρετήρια ξαναφτιάχτηκαν
    expect(indexNames(env.t)).toEqual(expect.arrayContaining(['ix_puzzle_rating', 'ix_puzzle_opening', 'ix_puzzle_source']));
  });

  it('frames χωρίς αλλαγή γραμμής (γραμμή σε πολλά frames) διαβάζονται σωστά', async () => {
    const file = path.join(env.dir, 'tiny.csv.zst');
    const csv = [HEADER, ...GOOD, ...BAD].join('\n') + '\n';
    // η κεφαλίδα στο πρώτο frame, μετά ~40 bytes ανά frame: οι γραμμές (~150 bytes) απλώνονται σε
    // 3–4 frames, πολλά χωρίς καμία αλλαγή γραμμής
    writePzstd(file, csv, Math.floor(csv.length / 40), HEADER.length + 20);
    const rep = await importLichess(env.t, fakeContext('lichess'), { file, quality: 'all', workers: 3 });
    expect(rep.lines).toBe(GOOD.length + BAD.length);
    expect(rep.imported).toBe(GOOD.length);
    expect(rep.rejected).toEqual({ illegal: 1, notMate: 1, fen: 1, length: 1, id: 1 });
  });

  it('ακύρωση στη μέση: συνεπής βάση με ευρετήρια, συνέχεια από το ίδιο frame, ίδιο αποτέλεσμα', async () => {
    const file = path.join(env.dir, 'resume.csv.zst');
    writePzstd(file, [HEADER, ...GOOD, ...BAD].join('\n') + '\n', 6);
    const abort = new AbortController();
    const base = fakeContext('lichess');
    const ctx = {
      ...base,
      signal: abort.signal,
      progress: (p: Parameters<typeof base.progress>[0]) => {
        base.progress(p);
        if (p.phase === 'import' && (p.done ?? 0) >= 2) abort.abort();
      },
    };
    await expect(importLichess(env.t, ctx, { file, quality: 'all', workers: 2 })).rejects.toThrow('Ακυρώθηκε');
    // η κατάσταση γράφτηκε μαζί με τα δύο πρώτα frames· τα ευρετήρια ξαναφτιάχτηκαν (η επιλογή δεν σαρώνει όλο τον πίνακα)
    const st = interruptedLichess(env.t);
    expect(st?.frames).toBe(2);
    expect(indexNames(env.t)).toEqual(expect.arrayContaining(['ix_puzzle_rating', 'ix_puzzle_opening', 'ix_puzzle_source']));
    const partial = (env.t.puzzles.prep('SELECT count(*) AS n FROM puzzle').get() as { n: number }).n;
    expect(partial).toBe(st!.imported);
    expect(partial).toBeLessThan(GOOD.length);

    const rep = await importLichess(env.t, fakeContext('lichess'), { file, quality: 'all', workers: 2 });
    expect(rep.resumedAtFrame).toBe(2);
    expect(rep.lines).toBe(GOOD.length + BAD.length);
    expect(rep.imported).toBe(GOOD.length);
    expect(rep.rejected).toEqual({ illegal: 1, notMate: 1, fen: 1, length: 1, id: 1 });
    expect(interruptedLichess(env.t)).toBeNull();
    expect((env.t.puzzles.prep('SELECT count(*) AS n FROM puzzle').get() as { n: number }).n).toBe(GOOD.length);
    expect(env.t.puzzles.get(decodeLichessId('03kqY'))).toBeDefined();
  });

  it('γεμάτη βάση χωρίς ευρετήρια (server που έκλεισε στη μέση): ξαναφτιάχνονται σε worker, όχι στο κύριο νήμα', async () => {
    addPuzzles(env.t, [
      { id: 1, rating: 1500 },
      { id: 2, rating: 1600 },
    ]);
    env.t.puzzles.db.exec('DROP INDEX ix_puzzle_rating; DROP INDEX ix_puzzle_opening; DROP INDEX ix_puzzle_source;');
    env.t.puzzles.setJson('lichess.import', { frames: 3 });
    env.t.close();
    const t2 = new Tactics(env.dir);
    try {
      // ο constructor δεν τα φτιάχνει (σε 4,4 εκατ. puzzles θα «πάγωνε» ~10 s)
      expect(t2.puzzles.missingIndexes()).toBe(true);
      const job = repairIndexes(t2)!;
      expect(job).not.toBeNull();
      for (let k = 0; k < 200 && t2.jobs.get(job.id)!.status !== 'done'; k++) await new Promise((r) => setTimeout(r, 25));
      expect(t2.jobs.get(job.id)!.status).toBe('done');
      expect(indexNames(t2)).toEqual(expect.arrayContaining(['ix_puzzle_rating', 'ix_puzzle_opening', 'ix_puzzle_source']));
      expect(repairIndexes(t2)).toBeNull();
    } finally {
      t2.close();
    }
  });
});

function indexNames(t: Tactics): string[] {
  return (t.puzzles.prep("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'puzzle'").all() as Array<{ name: string }>).map((x) => x.name);
}
