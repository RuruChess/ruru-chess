/** Τεστ: ανάγνωση συλλογών (Lucas .fns, EPD/STS, FEN χωρίς πεδία, λύσεις SAN με σύμβολα) και εγγραφή με επικύρωση. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { labelLines, normalizeFen, parseEpdLine, parseFnsLine, sanLineToUci, sanTokens, storeCollection, underPromote } from '../../src/server/tactics/collections.ts';
import { otherId } from '../../src/server/tactics/pack.ts';
import { SOURCE_BY_KEY } from '../../src/server/tactics/sources.ts';
import { F_INACTIVE, F_MATE, F_TEST, F_UNRATED } from '../../src/server/tactics/store.ts';
import { keysOf } from '../../src/server/tactics/themes.ts';
import { tempTactics } from './helpers.ts';

describe('ανάγνωση', () => {
  it('FEN συλλογών σε πλήρη μορφή', () => {
    expect(normalizeFen('r6k/p6p/3q2p1/4b3/8/8/P1QBR1PP/7K w  - 0 1')).toBe('r6k/p6p/3q2p1/4b3/8/8/P1QBR1PP/7K w - - 0 1');
    expect(normalizeFen('8/8/8/8/8/8/8/K6k')).toBe('8/8/8/8/8/8/8/K6k w - - 0 1');
    expect(normalizeFen('r3k2r/8/8/8/8/8/8/R3K2R b KQkq e3 5 20')).toBe('r3k2r/8/8/8/8/8/8/R3K2R b KQkq e3 5 20');
  });
  it('κινήσεις SAN: αριθμοί, NAG, βαριάντες, αποτελέσματα, σύμβολα αξιολόγησης', () => {
    expect(sanTokens('1. Bh7+ $1 Kxh7 2. Qxe6 $18 1-0')).toEqual(['Bh7+', 'Kxh7', 'Qxe6']);
    expect(sanTokens('38... Qf2++ 39.Kh1 Qf1#')).toEqual(['Qf2++', 'Kh1', 'Qf1#']);
    expect(sanTokens('1. Nxe4 Bg2 2. Nxd2# (2. Nf2#) (2. Nec3# (2. Ng5#))')).toEqual(['Nxe4', 'Bg2', 'Nxd2#']);
    expect(sanTokens('1.Rxd6 cxd6 2.Qxe7+- {comment}')).toEqual(['Rxd6', 'cxd6', 'Qxe7']);
    expect(sanTokens('1...Qa5! 2.Be3 2...Qxa3-+')).toEqual(['Qa5', 'Be3', 'Qxa3']);
    expect(sanTokens('1. e8=Q+ Kd7 2. O-O-O+ =')).toEqual(['e8=Q+', 'Kd7', 'O-O-O+']);
  });
  it('SAN → UCI και αποτυχία σε άκυρη κίνηση', () => {
    expect(sanLineToUci('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['O-O', 'O-O-O'])).toEqual({ uci: ['e1g1', 'e8c8'] });
    expect(sanLineToUci('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['O-O', 'Qd4']).failed).toBe('Qd4');
  });
  it('γραμμή .fns με ετικέτα HTML και PGN', () => {
    const p = parseFnsLine('6k1/p4p2/2b3pQ/5q2/2p5/P1P3R1/4r1PP/3Rn1K1 b - - 7 38|Southampton (1986)<br><b>Watson, William N-Adams, Michael</b>|38... Qf2++ 39.Kh1 Qf1#|[Site "Southampton"][White "Watson, William N"][Black "Adams, Michael"][Result "0-1"] 1.e4 e6')!;
    expect(p.label).toEqual(['Southampton (1986)', 'Watson, William N-Adams, Michael']);
    expect(p.headers.White).toBe('Watson, William N');
    expect(p.result).toBe('0-1');
    expect(sanLineToUci(p.fen, sanTokens(p.solution)).failed).toBeUndefined();
    const q = parseFnsLine('1r5k/3q2pp/4bp2/2pBp3/p1P1P3/PnBP3P/5QP1/5RK1 w - - 0 1|Partievariante (1980)<br>Knott-Cafferty<br>Difficulty ***|1. Bxe5 1-0')!;
    expect(q.stars).toBe(3);
    const pe = parseFnsLine('3k4/8/4KP2/8/8/8/8/8 w - - 1 132|Event·Andorra Open, Site·Andorra, Result·1-0')!;
    expect(pe.result).toBe('1-0');
    expect(pe.solution).toBe('');
    expect(labelLines('a<br/>b &amp; c<br>')).toEqual(['a', 'b & c']);
  });
  it('EPD: bm/am/id και βαθμοί STS (c8/c9)', () => {
    const e = parseEpdLine('1kr5/3n4/q3p2p/p2n2p1/PppB1P2/5BP1/1P2Q2P/3R2K1 w - - bm f5; id "STS(v1.0) Undermine.001"; c0 "f5=10, Be5+=2, Bf2=3, Bg4=2"; c7 "f5 Be5+ Bf2 Bg4"; c8 "10 2 3 2"; c9 "f4f5 d4e5 d4f2 f3g4";')!;
    expect(e.fen).toBe('1kr5/3n4/q3p2p/p2n2p1/PppB1P2/5BP1/1P2Q2P/3R2K1 w - - 0 1');
    expect(e.ops).toMatchObject({ bm: 'f5', id: 'STS(v1.0) Undermine.001', c8: '10 2 3 2', c9: 'f4f5 d4e5 d4f2 f3g4' });
    const w = parseEpdLine('r1bqk2r/ppp1nppp/4p3/n5N1/2BPp3/P1P5/2P2PPP/R1BQK2R w KQkq - bm Ba2 Nxf7; id "WAC.022";')!;
    expect(w.ops.bm).toBe('Ba2 Nxf7');
    expect(parseEpdLine('# σχόλιο')).toBeNull();
  });
  it('υποπροαγωγή όταν η προαγωγή γράφτηκε χωρίς κομμάτι', () => {
    expect(underPromote('8/5P1k/8/8/8/8/8/K7 w - - 0 1', ['f7f8', 'h7g6', 'a1a2'], 'n')).toEqual(['f7f8n', 'h7g6', 'a1a2']);
  });
});

describe('εγγραφή συλλογής', () => {
  let env: ReturnType<typeof tempTactics>;
  beforeEach(() => (env = tempTactics()));
  afterEach(() => env.cleanup());

  it('επικύρωση, σταθερά ids, θέματα από τη γραμμή, απορρίψεις', async () => {
    const def = SOURCE_BY_KEY.get('lucas-sadier-m2')!;
    const rep = await storeCollection(env.t, def, [
      { seq: 1, fen: '8/8/8/8/1Q6/1K6/8/2Nk4 w - - 0 1', line: ['b4a5', 'd1c1', 'a5e1'], themes: ['mate', 'mateIn2'], rating: 1500, requireMate: true },
      { seq: 2, fen: '8/8/8/8/1Q6/1K6/8/2Nk4 w - - 0 1', line: ['b4a5', 'd1c1', 'a5a1'], themes: ['mate'], rating: 1500, requireMate: true },
      { seq: 3, fen: '8/8/8/8/8/8/8/Kk6 w - - 0 1', line: ['a1a2'], themes: [], rating: 1500 },
      // ματ με υποπροαγωγή, γραμμένο «f7f8»
      { seq: 4, fen: '6bn/5Ppk/6pp/8/8/8/8/K7 w - - 0 1', line: ['f7f8'], themes: ['mate'], rating: 1000, requireMate: true },
      { seq: 5, fen: 'k7/8/8/8/8/8/8/K7 w - - 0 1', line: [], themes: [], rating: 1500, invalid: 'x' },
    ]);
    expect(rep.imported).toBe(2);
    expect(rep.rejected).toEqual({ notMate: 1, fen: 1, solution: 1 });
    const row = env.t.puzzles.get(otherId(def.id, 1))!;
    expect(row.flags & F_MATE).toBeTruthy();
    expect(row.flags & F_UNRATED).toBeTruthy();
    expect(keysOf(row.th1, row.th2)).toEqual(expect.arrayContaining(['mate', 'mateIn2', 'short', 'endgame']));
    expect(env.t.puzzles.get(otherId(def.id, 4))).toBeDefined();
  });

  it('επανεισαγωγή: όσα χάθηκαν σβήνονται, εκτός αν έχουν προσπάθειες (τότε ανενεργά)', async () => {
    const def = SOURCE_BY_KEY.get('epd-bk')!;
    const item = (seq: number) => ({ seq, fen: '8/8/8/8/8/8/8/K6k w - - 0 1', line: ['a1a2'], themes: [], rating: 2300, allowEmpty: true, goal: { kind: 'test' as const, bm: ['a1a2'] }, flags: F_TEST });
    await storeCollection(env.t, def, [item(1), item(2), item(3)]);
    env.t.user.db.exec(`INSERT INTO attempt(puzzle_id, ts, mode, win, first_try) VALUES (${otherId(def.id, 2)}, 1, 'test', 1, 1)`);
    const rep = await storeCollection(env.t, def, [item(1)]);
    expect(rep.removed).toBe(1);
    expect(rep.deactivated).toBe(1);
    expect(env.t.puzzles.get(otherId(def.id, 3))).toBeUndefined();
    expect(env.t.puzzles.get(otherId(def.id, 2))!.flags & F_INACTIVE).toBeTruthy();
    expect(JSON.parse(env.t.puzzles.get(otherId(def.id, 1))!.goal!)).toEqual({ kind: 'test', bm: ['a1a2'] });
  });
});
