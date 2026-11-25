/** Τεστ: τα μαθήματα στρατηγικής (σχολιασμένες παρτίδες) — σωστά δεδομένα, ίδιες κινήσεις στις δύο γλώσσες, ερωτήσεις σε σωστές θέσεις, διαδρομές του server. */
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameNode } from '../../src/core/game.ts';
import { parseGames } from '../../src/core/pgn.ts';
import { Router } from '../../src/server/http.ts';
import type { Library } from '../../src/server/library.ts';
import { readGameLessons } from '../../src/server/tactics/collections.ts';
import { registerTactics } from '../../src/server/tactics/index.ts';
import { canReviewLesson } from '../../src/core/strategy.ts';
import { apiJson, tempTactics } from './helpers.ts';

function tree(pgn: string): { error: string | null; root: GameNode; shape: string[] } {
  const r = parseGames(`[Event "?"]\n\n${pgn}\n`)[0];
  const shape: string[] = [];
  const walk = (n: GameNode, d: number) =>
    n.children.forEach((c, i) => {
      shape.push(`${d}.${i}:${c.san}`);
      walk(c, d + 1);
    });
  walk(r.game.root, 0);
  return { error: r.error, root: r.game.root, shape };
}

describe('μαθήματα στρατηγικής: δεδομένα', () => {
  const items = readGameLessons();

  it('μοναδικά ids και αύξοντες, σχολιαστής και πηγή σε κοινό κτήμα', () => {
    expect(items.length).toBeGreaterThanOrEqual(40);
    expect(new Set(items.map((x) => x.id)).size).toBe(items.length);
    expect(new Set(items.map((x) => x.seq)).size).toBe(items.length);
    for (const g of items) {
      // κοινό κτήμα: έκδοση πριν από το 1931 (ΗΠΑ) και ο συγγραφέας πέθανε πριν από 70+ χρόνια (ΕΕ)
      expect(g.source.year).toBeLessThan(1931);
      expect(['José Raúl Capablanca', 'Siegbert Tarrasch']).toContain(g.source.author);
      expect(g.source.lang ?? 'en').toMatch(/^(en|de)$/);
      expect(g.annotator).toBe(g.source.author);
      for (const k of ['title', 'theme', 'intro', 'summary', 'opening'] as const) expect(Boolean(g[k].el && g[k].en), `${g.id} ${k}`).toBe(true);
    }
  });

  for (const g of items) {
    it(`${g.id}: έγκυρο PGN, ίδιο δέντρο el/en, ερωτήσεις στην κύρια γραμμή`, () => {
      const el = tree(g.pgn.el);
      const en = tree(g.pgn.en);
      expect(el.error).toBeNull();
      expect(en.error).toBeNull();
      expect(en.shape).toEqual(el.shape);
      const main: GameNode[] = [];
      for (let n = el.root.children[0]; n; n = n.children[0]) main.push(n);
      expect(main.length).toBeGreaterThan(40);
      expect(g.questions.length).toBeGreaterThanOrEqual(3);
      expect(g.questions.length).toBeLessThanOrEqual(4);
      for (const q of g.questions) {
        const node = main[q.ply - 1];
        expect(node, `${g.id} ερώτηση ${q.ply}`).toBeTruthy();
        expect(Boolean(q.ask.el && q.ask.en)).toBe(true);
        // όσες προτείνει ο σχολιαστής είναι η κίνηση της παρτίδας ή μια από τις βαριάντες του σε εκείνη τη θέση
        const there = node.parent!.children.map((c) => c.san);
        for (const b of q.best) expect(there, `${g.id} ${q.ply}: ${b}`).toContain(b);
        // ο σχολιαστής λέει κάτι σε κάθε κρίσιμο σημείο (σχόλιο, βαριάντα ή σύμβολο όπως το !)
        expect(node.comment.length + node.nags.length + (node.parent!.children.length - 1), `${g.id} ${q.ply}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('μαθήματα στρατηγικής: διαδρομές', () => {
  let env: ReturnType<typeof tempTactics>;
  let server: http.Server;
  let port: number;
  let close: () => void;

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

  it('λίστα χωρίς τις κινήσεις, ένα μάθημα με όλα, 404 για άγνωστο', async () => {
    const list = await apiJson(port, 'GET', '/api/tactics/games');
    expect(list.status).toBe(200);
    expect(list.json.items[0].id).toBe('capablanca-teichmann-1913');
    expect(list.json.items[0].pgn).toBeUndefined();
    expect(list.json.items[0].questions).toBe(4);
    const one = await apiJson(port, 'GET', '/api/tactics/games/capablanca-teichmann-1913');
    expect(one.json.pgn.el).toMatch(/^1\. d4 d5 2\. Nf3/);
    expect(one.json.questions[2]).toMatchObject({ ply: 39, best: ['Nf5'] });
    expect((await apiJson(port, 'GET', '/api/tactics/games/xyz')).status).toBe(404);
  });

  it('το Περιήγηση (Review) εμφανίζεται μόνο όταν έχουν απαντηθεί όλες οι ασκήσεις', () => {
    expect(canReviewLesson(undefined, 4)).toBe(false);
    expect(canReviewLesson({ revealed: 20, answers: { '15': 'Nf3', '25': '' } }, 4)).toBe(false);
    expect(canReviewLesson({ revealed: 80, answers: { '15': 'Nf3', '25': '' }, done: true }, 4)).toBe(false);
    // σωστές ή λάθος / «δείξε μου» — αρκεί να έχουν απαντηθεί όλες
    expect(canReviewLesson({ revealed: 60, answers: { '15': 'Nf3', '25': '', '39': 'h3', '51': 'Qd2' } }, 4)).toBe(true);
    expect(canReviewLesson({ revealed: 0, answers: {}, done: true, allAnswered: true }, 4)).toBe(true);
    expect(canReviewLesson({ revealed: 40, answers: {}, done: true }, 0)).toBe(true);
  });
});
