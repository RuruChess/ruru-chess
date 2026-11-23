/** Τεστ: τα μαθήματα της εφαρμογής — σωστά δεδομένα (ίδιες κινήσεις στις δύο γλώσσες, νόμιμες γραμμές, πηγή) και εισαγωγή μόνη της, χωρίς λήψη. */
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameNode } from '../../src/core/game.ts';
import { parseGames } from '../../src/core/pgn.ts';
import { validateLine } from '../../src/core/puzzle.ts';
import { Router } from '../../src/server/http.ts';
import type { Library } from '../../src/server/library.ts';
import { mainLine, readLessons } from '../../src/server/tactics/collections.ts';
import { registerTactics } from '../../src/server/tactics/index.ts';
import { SOURCE_BY_KEY, SOURCES } from '../../src/server/tactics/sources.ts';
import { keepsLessonGoal, lessonSide } from '../../src/web/tactics/lesson.ts';
import { lineNotes, subLines } from '../../src/web/tactics/variations.ts';
import { apiJson, tempTactics } from './helpers.ts';

/** Το δέντρο των κινήσεων (χωρίς σχόλια), για σύγκριση των δύο γλωσσών. */
function shape(fen: string, text: string): { error: string | null; moves: string[] } {
  const r = parseGames(`[Event "?"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n${text}\n`)[0];
  const moves: string[] = [];
  const walk = (n: GameNode, d: number) =>
    n.children.forEach((c, i) => {
      moves.push(`${d}.${i}:${c.san}`);
      walk(c, d + 1);
    });
  walk(r.game.root, 0);
  return { error: r.error, moves };
}

// ίδιο μοτίβο με τους επιτρεπτούς συνδέσμους του server (about.ts)
const WIKI = /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?title=[\w%().,'-]+&oldid=\d+$/;
// τα δικά μας μαθήματα (ματ με δύο πύργους, πατ με βασίλισσα)
const OWN = [31, 33];

describe('μαθήματα: δεδομένα', () => {
  for (const def of SOURCES.filter((s) => s.kind === 'bundled')) {
    it(`${def.key}: έγκυρες γραμμές, ίδιες κινήσεις στις δύο γλώσσες, πηγή`, () => {
      const items = readLessons(def.data!);
      expect(items.length).toBeGreaterThanOrEqual(def.approx);
      expect(new Set(items.map((x) => x.seq)).size).toBe(items.length);
      for (const x of items) {
        const el = shape(x.fen, x.solution.el);
        const en = shape(x.fen, x.solution.en);
        expect(el.error, `#${x.seq} el`).toBeNull();
        expect(en.error, `#${x.seq} en`).toBeNull();
        expect(en.moves, `#${x.seq}: ίδιες κινήσεις`).toEqual(el.moves);
        const v = validateLine(x.fen, mainLine(x.fen, x.solution.el).uci, { pre: x.pre });
        expect(v.ok, `#${x.seq}: ${v.error} ${v.detail ?? ''}`).toBe(true);
        for (const k of ['title', 'intro', 'summary', 'part'] as const) expect(Boolean(x[k]?.el && x[k]?.en), `#${x.seq} ${k}`).toBe(true);
        expect(['win', 'draw']).toContain(x.goal);
        // πηγή: άρθρο της Wikipedia με την έκδοσή του, βιβλίο κοινού κτήματος (πριν από το 1931), ή μάθημα της KnightBase
        if (x.source && 'article' in x.source) {
          expect(x.source.url, `#${x.seq}`).toMatch(WIKI);
          expect(x.source.url).toContain(`oldid=${x.source.oldid}`);
        } else if (x.source) {
          expect(x.source.year, `#${x.seq}`).toBeLessThan(1931);
          expect(x.source.author).toBeTruthy();
        } else expect(OWN, `#${x.seq}: χωρίς πηγή`).toContain(x.seq);
        // κάθε κίνηση της κύριας γραμμής του λύτη έχει σχόλιο ή ανήκει σε γραμμή με σχόλια
        expect(lineNotes(x.fen, x.solution.el).some(Boolean), `#${x.seq}: σχόλια`).toBe(true);
      }
    });
  }
});

describe('μαθήματα φινάλε: σειρά δυσκολίας και επίπεδα', () => {
  const items = readLessons('endgame.json');
  it('30–40 μαθήματα, με σειρά 1…n, κάθε επίπεδο σε συνεχόμενες θέσεις', () => {
    expect(items.length).toBeGreaterThanOrEqual(30);
    expect(items.length).toBeLessThanOrEqual(40);
    const sorted = [...items].sort((a, b) => a.order! - b.order!);
    expect(sorted.map((x) => x.order)).toEqual(items.map((_, i) => i + 1));
    const parts = sorted.map((x) => x.part.el).filter((p, i, a) => i === 0 || a[i - 1] !== p);
    expect(new Set(parts).size).toBe(parts.length);
  });
  it('ξεκινά από τα βασικά ματ (δύο πύργοι, βασίλισσα, πύργος) και η δυσκολία ανεβαίνει', () => {
    const sorted = [...items].sort((a, b) => a.order! - b.order!);
    expect(sorted[0].part.el).toBe('Βασικά ματ');
    expect(sorted.slice(0, 5).map((x) => x.title.en)).toEqual(['Mate with two rooks: the ladder', 'Mate with the queen', 'Mate with the queen: beware of stalemate', 'Mate with the rook: the king on the edge', 'Mate with the rook: the king in the centre']);
    // το πρώτο τρίτο του μαθήματος είναι πιο εύκολο από το τελευταίο
    const avg = (xs: typeof items) => xs.reduce((a, x) => a + x.rating, 0) / xs.length;
    const third = Math.floor(sorted.length / 3);
    expect(avg(sorted.slice(0, third))).toBeLessThan(avg(sorted.slice(-third)) - 400);
  });
  it('τα βασικά ματ τελειώνουν με ματ', () => {
    for (const x of items.filter((l) => l.part.el === 'Βασικά ματ')) {
      const r = parseGames(`[Event "?"]
[SetUp "1"]
[FEN "${x.fen}"]

${x.solution.el}
`)[0];
      let n = r.game.root;
      while (n.children[0]) n = n.children[0];
      expect(n.san, `#${x.seq}`).toMatch(/#$/);
    }
  });
});

describe('μαθήματα: σχόλια και υποβαριάντες στον λύτη', () => {
  const [lucena] = readLessons('endgame.json').filter((x) => x.seq === 16);
  it('τα σχόλια της κύριας γραμμής, ένα ανά ημικίνηση', () => {
    const notes = lineNotes(lucena.fen, lucena.solution.el);
    expect(notes).toHaveLength(mainLine(lucena.fen, lucena.solution.el).uci.length);
    expect(notes[0]).toMatch(/διώχνεται/);
    expect(notes[1]).toBe('');
  });
  it('η υποβαριάντα κρατά τα δικά της σχόλια', () => {
    const subs = subLines(lucena.fen, lucena.solution.el, 'white');
    expect(subs).toHaveLength(1);
    expect(subs[0].label).toBe('5…Ke6');
    expect(subs[0].notes[0]).toMatch(/παγίδα/);
    expect(subs[0].notes).toHaveLength(subs[0].moves.length);
  });
  it('άλλη κίνηση που κρατά το αποτέλεσμα (από τη σκοπιά του λύτη)', () => {
    expect(keepsLessonGoal('win', 450)).toBe(true);
    expect(keepsLessonGoal('win', 120)).toBe(false);
    expect(keepsLessonGoal('draw', -30)).toBe(true);
    expect(keepsLessonGoal('draw', -250)).toBe(false);
    expect(keepsLessonGoal('draw', null)).toBe(false);
  });
});

describe('μαθήματα: μπαίνουν μόνα τους', () => {
  let env: ReturnType<typeof tempTactics>;
  let server: http.Server;
  let port: number;
  let close: () => void;
  const def = SOURCE_BY_KEY.get('wiki-endgame')!;
  const n = readLessons(def.data!).length;

  beforeAll(async () => {
    env = tempTactics();
    const lib = { settings: { databasesDir: env.dir, engines: [], defaultEngine: null }, jobs: new Map() } as unknown as Library;
    const router = new Router();
    const { tactics } = registerTactics(router, lib);
    close = () => tactics.close();
    server = await router.listen(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
    close();
    env.cleanup();
  });

  it('η πρώτη ματιά στις πηγές τα βάζει στη βάση, μία φορά', async () => {
    const a = await apiJson(port, 'GET', '/api/tactics/sources');
    const s = a.json.sources.find((x: { key: string }) => x.key === 'wiki-endgame');
    expect(s.kind).toBe('bundled');
    expect(s.count).toBe(n);
    expect(s.state).toBe('imported');
    const b = await apiJson(port, 'GET', '/api/tactics/sources');
    expect(b.json.sources.find((x: { key: string }) => x.key === 'wiki-endgame').importedAt).toBe(s.importedAt);
  });

  it('τα μαθήματα φινάλε για προβολή: όλα, με τη σειρά του μαθήματος, με λύση και επίπεδο', async () => {
    const r = await apiJson(port, 'GET', '/api/tactics/endgame-lessons');
    expect(r.json.items).toHaveLength(n);
    expect(r.json.items.map((x: { order: number }) => x.order)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(r.json.items[0]).toMatchObject({ seq: 31, fen: '8/8/8/5k2/8/8/R7/1R4K1 w - - 0 1', goal: 'win', part: { el: 'Βασικά ματ', en: 'Basic mates' } });
    expect(r.json.items[0].solution.el).toMatch(/^1\. Ra4 \{/);
    expect(lessonSide(r.json.items[0].fen, r.json.items[0].pre)).toBe('white');
    // το 8ο: τα μαύρα παίζουν πρώτα, το μάθημα είναι για τα λευκά
    expect(r.json.items[7].pre).toBe(true);
    expect(lessonSide(r.json.items[7].fen, r.json.items[7].pre)).toBe('white');
  });

  it('η συλλογή με τη σειρά: τίτλοι στις δύο γλώσσες, ενότητες, μάθημα με τα στοιχεία του', async () => {
    const r = await apiJson(port, 'GET', '/api/tactics/collection/wiki-endgame');
    expect(r.json.total).toBe(n);
    // με τη σειρά του μαθήματος, όχι με τον αύξοντα
    expect(r.json.items[0].title).toBe('Ματ με δύο πύργους: η «σκάλα»');
    expect(r.json.items[0].titleEn).toBe('Mate with two rooks: the ladder');
    expect(r.json.items[0]).toMatchObject({ fen: '8/8/8/5k2/8/8/R7/1R4K1 w - - 0 1', goal: 'win', part: 'Βασικά ματ', partEn: 'Basic mates' });
    expect(r.json.items[7].title).toBe('Ο κανόνας του τετραγώνου και ο «ώμος»');
    expect(r.json.parts.map((x: { name: string }) => x.name)).toEqual([
      'Βασικά ματ',
      'Βασιλιάς και πιόνια: τα βασικά',
      'Πύργος και πιόνι: Lucena και Philidor',
      'Βασιλιάς και πιόνια: για προχωρημένους',
      'Πύργος και πιόνι: για προχωρημένους',
      'Βασίλισσα',
      'Μελέτες',
    ]);
    const at = await apiJson(port, 'GET', '/api/tactics/collection/wiki-endgame/at?i=0');
    const p = at.json.puzzle;
    expect(p.pre).toBe(false);
    expect(p.color).toBe('white');
    expect(p.meta.lesson).toBe(true);
    expect(p.meta.goal).toBe('win');
    expect(p.meta.solution).toMatch(/^1\. Ra4 \{/);
    expect(p.meta.url).toBeUndefined();
    // το 8ο μάθημα: άρθρο της Wikipedia· το 2ο: Capablanca
    const w = (await apiJson(port, 'GET', '/api/tactics/collection/wiki-endgame/at?i=7')).json.puzzle;
    expect(w.pre).toBe(true);
    expect(w.meta.solution).toMatch(/^1\.\.\. Ke4 \{/);
    expect(w.meta.url).toMatch(WIKI);
    const c = (await apiJson(port, 'GET', '/api/tactics/collection/wiki-endgame/at?i=1')).json.puzzle;
    expect(c.meta).toMatchObject({ book: 'Chess Fundamentals', author: 'J. R. Capablanca', year: 1921 });
  });
});
