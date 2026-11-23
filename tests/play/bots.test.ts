/** Παιχνίδι με bots: επιλογή κίνησης ανά στυλ, βιβλίο, ισοπαλία, αποτελέσματα, επανάληψη (μερικά από το RealChessBase). */
import { describe, expect, it } from 'vitest';
import { Position, START_FEN } from '../../src/core/chess.ts';
import { ENGINE_BOTS, acceptsDraw, addOutcome, avoidRepetition, chooseBotMove, lineScore, outcomeFor, pickBookMove, repetitions, thinkMs, thinkStyle, weighted } from '../../src/web/play/bots.ts';
import { clockMovetime, threatFen } from '../../src/web/play/session.ts';

describe('bots', () => {
  it('lineScore: από την πλευρά που παίζει, το ματ μετρά πάνω από κάθε αξιολόγηση', () => {
    expect(lineScore({ cp: 50, mate: null }, true)).toBe(50);
    expect(lineScore({ cp: 50, mate: null }, false)).toBe(-50);
    expect(lineScore({ cp: null, mate: 3 }, true)).toBe(9997);
    expect(lineScore({ cp: null, mate: -2 }, true)).toBe(-9998);
    expect(lineScore({ cp: null, mate: -2 }, false)).toBe(9998);
  });

  it('chooseBotMove: μόνο κινήσεις μέσα στο παράθυρο, και το ματ πάντα', () => {
    const lines = [
      { cp: 40, mate: null, uci: ['e2e4'], san: ['e4'] },
      { cp: 20, mate: null, uci: ['d2d4'], san: ['d4'] },
      { cp: -300, mate: null, uci: ['g2g4'], san: ['g4'] },
    ];
    for (let i = 0; i < 20; i++) expect(['e2e4', 'd2d4']).toContain(chooseBotMove(lines, { style: 'balanced', window: 60 }, true, Math.random));
    expect(chooseBotMove(lines, { style: 'balanced', window: 0 }, true)).toBe('e2e4');
    const mate = [
      { cp: 10, mate: null, uci: ['a2a3'], san: ['a3'] },
      { cp: null, mate: 1, uci: ['h5f7'], san: ['Qxf7#'] },
    ];
    expect(chooseBotMove(mate, { style: 'beginner', window: 500 }, true, () => 0.99)).toBe('h5f7');
    expect(chooseBotMove([], { style: 'balanced', window: 50 }, true)).toBeNull();
  });

  it('ο επιθετικός προτιμά σαχ και αιχμαλωσίες ανάμεσα σε ισοδύναμες κινήσεις, ο σταθερός το ροκέ', () => {
    const lines = [
      { cp: 30, mate: null, uci: ['b1c3'], san: ['Nc3'] },
      { cp: 20, mate: null, uci: ['f3e5'], san: ['Nxe5'] },
      { cp: 15, mate: null, uci: ['e1g1'], san: ['O-O'] },
    ];
    expect(chooseBotMove(lines, { style: 'aggressive', window: 70 }, true, () => 0)).toBe('f3e5');
    expect(chooseBotMove(lines, { style: 'solid', window: 35 }, true, () => 0)).toBe('e1g1');
  });

  it('weighted: πιθανότητες ανάλογες των βαρών', () => {
    expect(weighted([1, 1, 2], () => 0)).toBe(0);
    expect(weighted([1, 1, 2], () => 0.99)).toBe(2);
    expect(weighted([0, 0], () => 0.5)).toBe(0);
  });

  it('pickBookMove: μόνο κινήσεις με αρκετές παρτίδες και όχι κακό σκορ', () => {
    const tree = [
      { uci: 'e2e4', games: 500, score: 0.55 },
      { uci: 'd2d4', games: 400, score: 0.56 },
      { uci: 'g2g4', games: 2, score: 0.2 },
      { uci: 'b2b4', games: 30, score: 0.3 },
    ];
    for (let i = 0; i < 30; i++) expect(['e2e4', 'd2d4']).toContain(pickBookMove(tree, 'balanced', Math.random));
    expect(pickBookMove([{ uci: 'e2e4', games: 3, score: 0.5 }], 'balanced')).toBeNull();
    // παράνομη κίνηση στο δέντρο (uci κενό): αγνοείται
    expect(pickBookMove([{ uci: '', games: 900, score: 0.6 }], 'balanced')).toBeNull();
  });

  it('ισοπαλία, αποτέλεσμα και ρεκόρ ανά bot', () => {
    expect(acceptsDraw(-20, 40)).toBe(true);
    expect(acceptsDraw(80, 40)).toBe(false);
    expect(acceptsDraw(20, 10)).toBe(false);
    expect(acceptsDraw(null, 40)).toBe(false);
    expect(acceptsDraw(5, 40, true)).toBe(true);
    expect(outcomeFor('1-0', 'white')).toBe('win');
    expect(outcomeFor('1-0', 'black')).toBe('loss');
    expect(outcomeFor('1/2-1/2', 'black')).toBe('draw');
    expect(outcomeFor('*', 'black')).toBeNull();
    expect(addOutcome(undefined, 'win')).toEqual({ w: 1, d: 0, l: 0 });
    expect(addOutcome({ w: 1, d: 2, l: 3 }, 'loss')).toEqual({ w: 1, d: 2, l: 4 });
  });

  it('οι ορισμοί: μοναδικά id, Elo της Stockfish από 1320, σκάλα με αύξουσα δύναμη, φράσεις σε δύο γλώσσες', () => {
    expect(new Set(ENGINE_BOTS.map((b) => b.id)).size).toBe(ENGINE_BOTS.length);
    expect(ENGINE_BOTS.length).toBe(10);
    expect(ENGINE_BOTS[0].name[0]).toBe('Mark ο αρχάριος');
    // διεθνή ονόματα (λατινικά) και στα ελληνικά
    for (const b of ENGINE_BOTS.filter((x) => x.id !== 'full')) expect(b.name[0].split(' ')[0]).toBe(b.name[1].split(' ')[0]);
    for (let i = 1; i < ENGINE_BOTS.length; i++) expect(ENGINE_BOTS[i].elo).toBeGreaterThan(ENGINE_BOTS[i - 1].elo);
    for (const b of ENGINE_BOTS) {
      if (b.strength.elo !== undefined) expect(b.strength.elo).toBeGreaterThanOrEqual(1320);
      expect(b.multipv).toBeGreaterThanOrEqual(1);
      expect(b.multipv).toBeLessThanOrEqual(5);
      expect(b.blunder).toBeGreaterThanOrEqual(0);
      expect(b.blunder).toBeLessThan(0.2);
      for (const p of [b.name, b.blurb, b.says.hi, b.says.won, b.says.lost, b.says.draw]) expect(p[0] && p[1]).toBeTruthy();
    }
  });
});

describe('αποφυγή επανάληψης', () => {
  it('όταν δεν είναι χειρότερα, αφήνει την κίνηση που ξαναφέρνει θέση για ισοδύναμη καινούργια', () => {
    const c = [
      { uci: 'a1a2', score: 0, seen: 2 },
      { uci: 'a1a3', score: -5, seen: 0 },
      { uci: 'h2h4', score: -150, seen: 0 },
    ];
    for (let i = 0; i < 20; i++) expect(avoidRepetition(c, 12, Math.random)).toBe('a1a3');
  });
  it('ανάμεσα σε ίσες καινούργιες κινήσεις δεν διαλέγει πάντα την πρώτη', () => {
    const c = [
      { uci: 'a1a2', score: 0, seen: 0 },
      { uci: 'a1a3', score: 0, seen: 0 },
      { uci: 'a1a4', score: 0, seen: 0 },
    ];
    const got = new Set<string | null>();
    for (let i = 0; i < 60; i++) got.add(avoidRepetition(c, 12, Math.random));
    expect(got.size).toBeGreaterThan(1);
  });
  it('όταν είναι χειρότερα ή βλέπει ματ, κρατά τη δική του επιλογή', () => {
    expect(avoidRepetition([{ uci: 'a1a2', score: -80, seen: 2 }, { uci: 'a1a3', score: -85, seen: 0 }], 12)).toBeNull();
    expect(avoidRepetition([{ uci: 'h5f7', score: 9990, seen: 0 }], 12)).toBeNull();
    expect(avoidRepetition([], 12)).toBeNull();
  });
});

describe('παιχνίδι', () => {
  it('τριπλή επανάληψη: μετρά τη θέση χωρίς τους μετρητές κινήσεων', () => {
    const p = Position.fromFen(START_FEN);
    const fens = [p.fen()];
    for (const u of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) {
      p.makeMove(p.parseUci(u));
      fens.push(p.fen());
    }
    expect(repetitions(fens)).toBe(3);
    expect(repetitions(fens.slice(0, 5))).toBe(2);
    expect(repetitions([])).toBe(0);
  });

  it('απειλή: η ίδια θέση με τον αντίπαλο στη σειρά, όχι όταν υπάρχει σαχ', () => {
    expect(threatFen(START_FEN)?.split(' ')[1]).toBe('b');
    expect(threatFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBeNull();
  });

  it('χρόνος σκέψης με ρολόι: λίγος όταν μένει λίγος, ποτέ κάτω από 100 ms', () => {
    expect(clockMovetime(300_000, 0, 500)).toBeLessThanOrEqual(750);
    expect(clockMovetime(5_000, 0, 500)).toBeLessThan(500);
    expect(clockMovetime(100, 0, 500)).toBe(100);
  });
});

describe('ρυθμός σκέψης', () => {
  const mid = () => 0.5; // χωρίς τυχαιότητα
  const bot = (id: string) => ENGINE_BOTS.find((b) => b.id === id)!;
  const base = { legal: 30, ply: 24 };

  it('κάθε χαρακτήρας έχει τον δικό του ρυθμό: ο Jack γρήγορα, η Sophie πιο αργά', () => {
    expect(thinkMs(thinkStyle(bot('cafe')), base, mid)).toBeLessThan(thinkMs(thinkStyle(bot('solid')), base, mid));
    for (const b of ENGINE_BOTS) {
      const s = thinkStyle(b);
      const t = thinkMs(s, base, mid);
      expect(t).toBeGreaterThanOrEqual(s.min);
      expect(t).toBeLessThanOrEqual(s.max);
    }
  });

  it('γρήγορα στη θεωρία, στη μόνη κίνηση και όταν ξαναπαίρνει κομμάτι· αργότερα στις δύσκολες θέσεις', () => {
    const s = thinkStyle(bot('expert'));
    const normal = thinkMs(s, { ...base, scores: [20, -60] }, mid);
    expect(thinkMs(s, { ...base, book: true }, mid)).toBeLessThan(normal);
    expect(thinkMs(s, { ...base, legal: 1 }, mid)).toBeLessThan(normal);
    expect(thinkMs(s, { ...base, scores: [20, -60], recapture: true }, mid)).toBeLessThan(normal);
    // πολλές ισάξιες επιλογές ή μία μόνο κίνηση που κρατά: σκέφτεται περισσότερο
    expect(thinkMs(s, { ...base, scores: [20, 10, 0, -5] }, mid)).toBeGreaterThan(normal);
    expect(thinkMs(s, { ...base, scores: [20, -250] }, mid)).toBeGreaterThan(normal);
    expect(thinkMs(s, { ...base, scores: [20, -60], prevScore: 250 }, mid)).toBeGreaterThan(normal);
  });

  it('με ρολόι δεν κινδυνεύει η σημαία', () => {
    const s = thinkStyle(bot('master'));
    expect(thinkMs(s, { ...base, scores: [20, 10, 0, -5], clock: { left: 10_000, inc: 0 } }, mid)).toBeLessThanOrEqual(400);
    expect(thinkMs(s, { ...base, clock: { left: 1000, inc: 0 } }, mid)).toBe(150);
  });
});
