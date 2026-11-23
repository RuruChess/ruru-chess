/**
 * Τεστ: η μηχανή «με κίνητρο» του «Παίξε τη θέση». Σε Πύργο εναντίον Ίππου, όπου όλα δείχνουν 0,00, δεν δίνει τον
 * πύργο για τον ίππο (νεκρή ισοπαλία) αλλά κρατά υλικό και διαλέγει την κίνηση που αφήνει στον αντίπαλο τις
 * περισσότερες ευκαιρίες για λάθος· όταν είναι χειρότερα, η απλούστευση που τη σώζει μένει. Με πραγματική μηχανή
 * μόνο αν δοθεί `KNIGHTBASE_TEST_ENGINE` (διαδρομή μιας Stockfish).
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Position } from '../../src/core/chess.ts';
import { deadLine, practicalValue, pressureAcceptsDraw, pressurePick, type PressureCand } from '../../src/core/pressure.ts';
import { AnalysisManager } from '../../src/server/analysis.ts';
import type { AnalysisUpdate, PvLine } from '../../src/server/engine.ts';
import { pressureMove } from '../../src/server/pressure.ts';
import { avoidRepetition, keepAlive } from '../../src/web/play/bots.ts';

// Πύργος εναντίον Ίππου: ο ίππος δίπλα στον βασιλιά του, ισοπαλία· το Rxd6 Kxd6 αφήνει δύο γυμνούς βασιλιάδες
const RN = '8/4k3/R2n4/8/8/4K3/8/8 w - - 0 1';
const SAC = 'a6d6';

const cand = (uci: string, score: number, replies: number[], o: Partial<PressureCand> = {}): PressureCand => ({ uci, score, replies, legal: replies.length, dead: false, seen: 0, material: 8, ...o });

describe('με κίνητρο: η επιλογή', () => {
  it('Πύργος εναντίον Ίππου στο 0,00: όχι ο πύργος για τον ίππο, αλλά η κίνηση με τις περισσότερες παγίδες', () => {
    const pick = pressurePick([
      cand(SAC, 0, [0], { dead: true, material: 0, legal: 1 }),
      cand('a6a7', 0, [0, 0, 0, 0, 0], { legal: 5 }),
      cand('a6b6', 0, [0, 0, 60, 220, 400, 900], { legal: 9 }),
      cand('e3d4', 0, [0, 0, 0, 0, 0, 30], { legal: 7 }),
    ]);
    expect(pick?.uci).toBe('a6b6');
    expect(pick?.ranked.at(-1)?.uci).toBe(SAC);
  });

  it('η θέση γίνεται πιο δύσκολη όταν υπάρχουν πολλές και «κοντινές» κακές απαντήσεις', () => {
    const easy = practicalValue({ score: 0, replies: [0, 0, 0, 0], legal: 4 });
    const tricky = practicalValue({ score: 0, replies: [0, 120, 150, 300], legal: 12 });
    expect(easy).toBeCloseTo(0.5, 5);
    expect(tricky).toBeGreaterThan(easy + 0.05);
  });

  it('όταν είναι χειρότερα, η απλούστευση που σώζει την ισοπαλία μένει', () => {
    const pick = pressurePick([cand('x', 0, [0], { dead: true, material: 0 }), cand('y', -420, [-420, -380, -300])]);
    expect(pick?.uci).toBe('x');
  });

  it('ματ: το συντομότερο, χωρίς άλλους υπολογισμούς', () => {
    expect(pressurePick([cand('a', 9995, [9995]), cand('b', 9990, [9990]), cand('c', 300, [300, 900])])?.uci).toBe('a');
  });

  it('δεν ξαναφέρνει θέση όσο έχει κάτι να παίξει', () => {
    expect(pressurePick([cand('a', 10, [10, 10, 40], { seen: 2 }), cand('b', 0, [0, 0, 40])])?.uci).toBe('b');
  });

  it('ισοπαλία με συμφωνία: όχι όσο έχει υλικό ή αξιολόγηση υπέρ της', () => {
    expect(pressureAcceptsDraw(0, 60, RN, true)).toBe(false); // πύργος εναντίον ίππου: έχει υλικό παραπάνω
    expect(pressureAcceptsDraw(0, 60, '8/4k3/3r4/8/8/4K3/3R4/8 w - - 0 1', true)).toBe(true); // ίσο υλικό, 0,00, 30 κινήσεις
    expect(pressureAcceptsDraw(0, 10, '8/4k3/3r4/8/8/4K3/3R4/8 w - - 0 1', true)).toBe(false); // πολύ νωρίς
    expect(pressureAcceptsDraw(-150, 2, RN, true)).toBe(true); // είναι χειρότερα
    expect(pressureAcceptsDraw(0, 2, '8/4k3/8/8/4K3/8/8/8 w - - 0 1', true)).toBe(true); // νεκρή θέση
  });
});

describe('με κίνητρο: και τα bots δεν απλουστεύουν σε νεκρή ισοπαλία', () => {
  const line = (uci: string[], cp: number) => ({ cp, mate: null, uci, san: uci });
  it('deadLine: πύργος για ίππο και ο βασιλιάς ξαναπαίρνει', () => {
    expect(deadLine(RN, [SAC, 'e7d6'])).toBe(true);
    expect(deadLine(RN, ['a6a7', 'e7e6'])).toBe(false);
  });
  it('keepAlive: βγαίνει η γραμμή της νεκρής ισοπαλίας, όχι όταν είναι η μόνη λογική', () => {
    const lines = [line([SAC, 'e7d6'], 0), line(['a6a7', 'e7e6'], 0), line(['e3d4', 'd6f5'], -10)];
    expect(keepAlive(RN, lines, true).map((l) => l.uci[0])).toEqual(['a6a7', 'e3d4']);
    expect(keepAlive(RN, [line([SAC, 'e7d6'], 0), line(['a6a7', 'e7e6'], -300)], true).map((l) => l.uci[0])).toEqual([SAC, 'a6a7']);
  });
  it('avoidRepetition: ανάμεσα σε ισάξιες, ποτέ η νεκρή', () => {
    for (let i = 0; i < 20; i++) {
      const r = i / 20;
      expect(avoidRepetition([{ uci: SAC, score: 0, seen: 0, dead: true }, { uci: 'a6a7', score: 0, seen: 0 }, { uci: 'e3d4', score: -5, seen: 0 }], 12, () => r)).not.toBe(SAC);
    }
  });
});

/** Ψεύτικη μηχανή: για κάθε θέση οι γραμμές που θα έδινε (από τη σκοπιά των λευκών), η πρώτη = «bestmove». */
function fakeAnalysis(table: Record<string, Array<[string, number]>>) {
  const calls: string[] = [];
  return {
    calls,
    evaluate: async (_e: string, fen: string, _l: unknown, _x: unknown, _p: unknown, multipv = 1): Promise<AnalysisUpdate> => {
      calls.push(fen);
      const key = fen.split(' ').slice(0, 2).join(' ');
      const rows = (table[key] ?? []).slice(0, multipv);
      const lines: PvLine[] = rows.map(([uci, cp], i) => ({ multipv: i + 1, depth: 20, seldepth: 20, cp, mate: null, bound: '', nodes: 1, nps: 1, time: 1, tbhits: 0, uci: uci.split(' '), san: uci.split(' ') }));
      return { fen, lines, depth: 20, nodes: 1, nps: 1, hashfull: 0, done: true, bestmove: lines[0]?.uci[0] };
    },
  };
}

const after = (fen: string, uci: string) => {
  const p = Position.fromFen(fen);
  p.makeMove(p.parseUci(uci));
  return p.fen().split(' ').slice(0, 2).join(' ');
};

describe('με κίνητρο: η κίνηση από τον server', () => {
  it('η μηχανή βλέπει 0,00 παντού και θα έπαιζε πρώτο το Rxd6· με κίνητρο κρατά τον πύργο', async () => {
    const root = RN.split(' ').slice(0, 2).join(' ');
    const fake = fakeAnalysis({
      [root]: [
        [`${SAC} e7d6`, 0],
        ['a6a7 e7e6', 0],
        ['e3d4 d6f5', 0],
        ['a6b6 e7d7', 0],
      ],
      [after(RN, SAC)]: [['e7d6', 0]],
      [after(RN, 'a6a7')]: [
        ['e7e6', 0],
        ['e7d8', 0],
        ['e7e8', 0],
      ],
      [after(RN, 'e3d4')]: [
        ['d6f5', 0],
        ['d6b5', 0],
        ['e7d7', 0],
      ],
      // μετά το Rb6 ο ίππος πρέπει να μείνει κοντά στον βασιλιά: οι άλλες απαντήσεις χάνουν
      [after(RN, 'a6b6')]: [
        ['e7d7', 0],
        ['d6f7', 0],
        ['d6c4', 180],
        ['d6b5', 260],
        ['d6e8', 320],
        ['d6c8', 450],
      ],
    });
    const r = await pressureMove(fake, 'sf', RN, undefined, 2000);
    expect(fake.calls.length).toBe(5);
    expect(r.bestmove).toBe('a6b6');
    expect(r.ranked.find((x) => x.uci === SAC)?.value).toBeLessThan(r.ranked[0].value);
  });

  it('με μία μόνο λογική κίνηση: χωρίς τις αναζητήσεις των απαντήσεων', async () => {
    const fake = fakeAnalysis({ [RN.split(' ').slice(0, 2).join(' ')]: [['a6a7 e7e6', 0], [`${SAC} e7d6`, -200]] });
    const r = await pressureMove(fake, 'sf', RN, undefined, 2000);
    expect(r.bestmove).toBe('a6a7');
    expect(fake.calls.length).toBe(1);
  });
});

const ENGINE = process.env.KNIGHTBASE_TEST_ENGINE;
describe.skipIf(!ENGINE || !fs.existsSync(ENGINE))('με κίνητρο: με πραγματική Stockfish', () => {
  it('Πύργος εναντίον Ίππου: κρατά τον πύργο σε κάθε δοκιμή', async () => {
    const am = new AnalysisManager(() => [{ id: 'sf', name: 'Stockfish', path: ENGINE!, options: {} }]);
    try {
      for (let i = 0; i < 3; i++) {
        const r = await pressureMove(am, 'sf', RN, undefined, 1500);
        expect(r.bestmove).not.toBe(SAC);
        expect(r.bestmove).not.toBeNull();
      }
    } finally {
      am.closeAll();
    }
  }, 30_000);
});
