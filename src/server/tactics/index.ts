// SPDX-License-Identifier: AGPL-3.0-or-later AND GPL-3.0-or-later
// Copyright (c) 2012-2026 the lila authors (AGPL-3.0-or-later), https://github.com/lichess-org/lila
//   from lila: Puzzle Storm settings (ui/storm/src/config.ts)
// Adapted through RealChessBase by Lazaros Batsis (GPL-3.0-or-later).
// Translated to TypeScript and modified for Ruru Chess: 2026-10-27 to 2026-11-22.
// License texts: LICENSE, licenses/AGPL-3.0.txt, licenses/NOTICES.txt
/** Διαδρομές /api/tactics/*: πηγές και εισαγωγές, επιλογή, προσπάθειες, πίνακας επιδόσεων, τράπουλες, Woodpecker, γρήγοροι τρόποι. */
import crypto from 'node:crypto';
import { Position } from '../../core/chess.ts';
import { parseGame } from '../../core/pgn.ts';
import { checkAnswer, hint, parsePracticeGoal, positionAt, practiceOutcome, scoreTestAnswer, type PracticeGoal, type PracticeState, type TestGoal } from '../../core/puzzle.ts';
import type { AnalysisManager } from '../analysis.ts';
import type { Router } from '../http.ts';
import { HttpError, type Job, type Library } from '../library.ts';
import { repairIndexes, sourceRows } from './catalog.ts';
import { bundledVersion, finishImports, importBundled, importCollection, readGameLessons, readLessons } from './collections.ts';
import { Tactics } from './context.ts';
import { QUALITY_PRESETS } from './csv.ts';
import { dashboard, themePerformance } from './dashboard.ts';
import { compactJson, puzzleJson } from './format.ts';
import { freeBytes, MIN_FREE_BYTES, type TacticsJob } from './jobs.ts';
import { importLichess, interruptedLichess } from './lichess.ts';
import { RUSH_BUCKETS, STORM_BUCKETS, STREAK_BUCKETS } from './select.ts';
import { localDay, TacticsService } from './service.ts';
import { resolveSources, SOURCE_BY_KEY, SOURCES } from './sources.ts';
import { F_PRE } from './store.ts';
import { DIFFICULTIES, THEME_CATEGORIES, THEME_GROUPS, THEMES, themeNames } from './themes.ts';
import { parsePuzzleKey, puzzleKey, unpackFen, unpackLine } from './pack.ts';

/** Ρυθμίσεις του Puzzle Storm (ui/storm/src/config.ts του Lichess). */
export const STORM_CONFIG = {
  timeSeconds: 180,
  penaltySeconds: 10,
  /** combo → δευτερόλεπτα που προστίθενται */
  combo: [
    [5, 3],
    [12, 5],
    [20, 7],
    [30, 10],
  ],
  /** η πρώτη κίνηση μετρά μόνο μετά από 400 ms (για να φανεί η κίνηση του αντιπάλου) */
  firstMoveDelayMs: 400,
};

const RUSH_VARIANTS: Record<string, { timeSeconds: number | null; strikes: number }> = {
  '3': { timeSeconds: 180, strikes: 3 },
  '5': { timeSeconds: 300, strikes: 3 },
  survival: { timeSeconds: null, strikes: 3 },
};

const num = (v: string | null | undefined, d: number): number => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};
const list = (v: string | null | undefined): string[] => (v ? v.split(/[,\s]+/).filter(Boolean) : []);
const color = (v: unknown): 'white' | 'black' | undefined => (v === 'white' || v === 'black' ? v : undefined);

// ---------------------------------------------------------------------------
// Έλεγχος εισόδου: άκυρη τιμή → 400 (όχι σφάλμα της SQLite ή TypeError → 500)

/** Το σώμα JSON ως αντικείμενο· `null`, πίνακας ή αριθμός → 400. */
function bodyOf(req: { body: unknown }): Record<string, unknown> {
  const b = req.body;
  if (b === undefined) return {};
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Το σώμα του αιτήματος πρέπει να είναι αντικείμενο JSON');
  return b as Record<string, unknown>;
}

/** Προαιρετικός πεπερασμένος αριθμός (αριθμός ή αριθμητικό κείμενο). */
function optNum(v: unknown, name: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new HttpError(400, `Άκυρη τιμή για «${name}»`);
  return n;
}

/** Προαιρετικό κείμενο. */
function optStr(v: unknown, name: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new HttpError(400, `Το «${name}» πρέπει να είναι κείμενο`);
  return v;
}

/** Προαιρετική λίστα κειμένων (πίνακας κειμένων). */
function optStrings(v: unknown, name: string): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new HttpError(400, `Το «${name}» πρέπει να είναι λίστα κειμένων`);
  return v as string[];
}

/** Μη αρνητικός ακέραιος από το query (LIMIT/OFFSET: η SQLite δεν δέχεται δεκαδικούς). */
function count(v: string | null, d: number, name: string): number {
  if (v === null || v === '') return d;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `Το «${name}» πρέπει να είναι μη αρνητικός ακέραιος`);
  return n;
}

const KINDS = ['solve', 'practice', 'test', 'any'] as const;

/**
 * Ημικίνηση της γραμμής όπου παίζει ο λύτης: ακέραιος μέσα στη γραμμή και κίνηση του λύτη (όχι του
 * αντιπάλου· στη μορφή Lichess οι μονές). Χωρίς τιμή: η πρώτη κίνηση του λύτη.
 */
function solverPly(v: unknown, pre: boolean, lineLength: number): number {
  const first = pre ? 1 : 0;
  if (v === undefined || v === null || v === '') return first;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < first || n >= lineLength || (n - first) % 2 !== 0) throw new HttpError(400, `Άκυρη ημικίνηση ${String(v)}: δεν είναι κίνηση του λύτη σε αυτή τη λύση`);
  return n;
}

const PRACTICE_STATUS = ['ongoing', 'checkmate', 'stalemate', 'draw'];

/** Δυσκολία: όνομα του Lichess (easiest…hardest) ή αριθμητική μετατόπιση. */
function diffOf(v: string | null): number {
  if (!v) return 0;
  if (DIFFICULTIES[v]) return DIFFICULTIES[v].delta;
  return Math.max(-1000, Math.min(1000, num(v, 0)));
}

/** Σύντομος τίτλος μιας θέσης συλλογής από ό,τι λέει η πηγή: παίκτες και τουρνουά, ετικέτα ή κωδικός του τεστ. */
export function itemTitle(metaJson: string | null, lang: 'el' | 'en' = 'el'): string {
  let meta: Record<string, unknown>;
  try {
    meta = metaJson ? (JSON.parse(metaJson) as Record<string, unknown>) : {};
  } catch {
    return '';
  }
  // μάθημα: ο τίτλος του στις δύο γλώσσες
  const lesson = meta.title && typeof meta.title === 'object' ? (meta.title as Record<string, unknown>)[lang] : undefined;
  if (typeof lesson === 'string') return lesson;
  const s = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string).trim() : '');
  const year = s('date').slice(0, 4).replace(/\?/g, '');
  if (s('white') && s('black')) return [`${s('white')} – ${s('black')}`, s('event'), year].filter((x) => x && x !== '?').join(', ');
  const label = Array.isArray(meta.label) ? (meta.label as unknown[]).filter((x): x is string => typeof x === 'string' && Boolean(x.trim()) && !/^difficulty\b/i.test(x)) : [];
  if (label.length) return label.slice(0, 2).join(' · ');
  return s('id').replace(/^STS\([^)]*\)\s*/, '') || s('comment');
}

/**
 * Καταχωρεί τις διαδρομές της Τακτικής. Τα δεδομένα ζουν στο <φάκελος βάσεων>/Τακτική
 * (puzzles.sqlite που ξαναχτίζεται, tactics-user.sqlite με την πρόοδο).
 */
export function registerTactics(r: Router, lib: Library, analysis?: AnalysisManager): { tactics: Tactics; service: TacticsService } {
  const t = new Tactics(lib.settings.databasesDir);
  const svc = new TacticsService(t);
  const mirrors = new Map<string, Job>();

  t.jobs.onUpdate = (job) => {
    r.broadcast('tactics', { type: 'job', job });
    const m = mirrors.get(job.id);
    if (m) m.progress = { phase: 'reading', games: job.imported, bytes: job.phase === 'download' ? job.bytes : job.done, totalBytes: job.phase === 'download' ? job.totalBytes : job.total, errors: job.rejected, skipped: job.filtered, message: job.message };
  };
  // όσο τρέχει εισαγωγή ο server δεν κλείνει (main.ts: έλεγχος των lib.jobs)
  t.jobs.onActive = (job, active) => {
    if (active) {
      const abort = new AbortController();
      abort.signal.addEventListener('abort', () => {
        try {
          t.jobs.cancel(job.id);
        } catch {
          // ήδη τελείωσε
        }
      });
      const m: Job = { id: `tactics-${job.id}`, dbId: 'tactics', kind: 'edit', title: `Τακτική: ${job.title}`, progress: { phase: 'reading', games: 0, bytes: 0, totalBytes: 0, errors: 0, skipped: 0 }, status: 'running', started: job.started, abort };
      mirrors.set(job.id, m);
      lib.jobs.set(m.id, m);
    } else {
      const m = mirrors.get(job.id);
      mirrors.delete(job.id);
      if (m) lib.jobs.delete(m.id);
    }
  };

  // ---------------------------------------------------------------------------
  // Πηγές και εισαγωγές

  // Οι ενσωματωμένες συλλογές (μαθήματα) μπαίνουν μόνες τους, μία φορά ανά έκδοση των δεδομένων τους·
  // όχι όσο τρέχει άλλη εισαγωγή (οι εισαγωγές γράφουν μία μία)
  let bundled: Promise<void> | null = null;
  const ensureBundled = (): Promise<void> => {
    if (bundled) return bundled;
    if (t.jobs.list().some((j) => j.status === 'running' || j.status === 'queued')) return Promise.resolve();
    bundled = (async () => {
      const rows = sourceRows(t.puzzles);
      const stale = SOURCES.filter((s) => s.kind === 'bundled' && rows.get(s.key)?.version !== bundledVersion(s));
      for (const def of stale) await importBundled(t, def);
      if (stale.length) await finishImports(t);
    })().catch((e) => {
      bundled = null;
      console.error('Μαθήματα:', e);
    });
    return bundled;
  };

  // Μαθήματα στρατηγικής: σχολιασμένες παρτίδες (src/data/lessons/games.json), χωρίς βάση
  /** η θέση πριν από την πρώτη ερώτηση: το μικρό διάγραμμα της λίστας */
  const lessonFen = (pgn: string, ply: number): string => {
    let n = parseGame(pgn).game.root;
    for (let i = 1; i < ply && n.children[0]; i++) n = n.children[0];
    return n.fen;
  };
  r.get('/api/tactics/games', () => ({
    items: readGameLessons().map(({ pgn, questions, ...meta }) => ({
      ...meta,
      questions: questions.length,
      fen: lessonFen(pgn.en, questions.length ? Math.min(...questions.map((q) => q.ply)) : 1),
    })),
  }));
  r.get('/api/tactics/games/:id', (req) => {
    const g = readGameLessons().find((x) => x.id === req.params.id);
    if (!g) throw new HttpError(404, 'Δεν βρέθηκε το μάθημα');
    return g;
  });
  /** Τα μαθήματα φινάλε για προβολή (σαν σχολιασμένες παρτίδες), με τη σειρά του μαθήματος· χωρίς τη βάση της Τακτικής. */
  r.get('/api/tactics/endgame-lessons', () => ({
    items: readLessons('endgame.json')
      .map((x) => ({ ...x, order: x.order ?? x.seq }))
      .sort((a, b) => a.order - b.order),
  }));

  r.get('/api/tactics/sources', async () => {
    await ensureBundled();
    const rows = sourceRows(t.puzzles);
    const interrupted = interruptedLichess(t);
    const dbBytes = t.puzzles.size();
    // από τις εγγραφές των πηγών (το count(*) σε όλο τον πίνακα θέλει ~0,7 s)
    let total = 0;
    for (const row of rows.values()) total += row.n;
    const jobs = t.jobs.list();
    return {
      dir: t.dir,
      sources: SOURCES.map((s) => {
        const row = rows.get(s.key);
        const job = jobs.find((j) => (j.source === s.key || resolveSources(j.source).some((x) => x.key === s.key)) && (j.status === 'running' || j.status === 'queued'));
        const info = row?.info ? (JSON.parse(row.info) as Record<string, unknown>) : null;
        const state = job ? job.status : s.key === 'lichess' && interrupted ? 'interrupted' : row?.imported_at ? 'imported' : 'none';
        return {
          key: s.key,
          kind: s.kind,
          group: s.group,
          section: s.section,
          cat: s.cat,
          about: s.about,
          solution: s.solution,
          name: s.name,
          license: s.license,
          url: s.url,
          optional: !!s.optional,
          mode: s.mode ?? 'solve',
          approx: s.approx,
          count: row?.n ?? 0,
          version: row?.version ?? null,
          importedAt: row?.imported_at ?? null,
          // μέγεθος στη βάση: το Lichess κυριαρχεί· οι άλλες ~60 bytes/θέση
          bytes: row?.n ? (s.key === 'lichess' ? Math.round((dbBytes * row.n) / Math.max(1, total)) : row.n * 60) : 0,
          state,
          job: job ?? null,
          interrupted: s.key === 'lichess' ? interrupted : null,
          info,
        };
      }),
      totals: { puzzles: total, dbBytes, userDbBytes: t.user.size(), freeBytes: freeBytes(t.dir), minFreeBytes: MIN_FREE_BYTES },
      qualityPresets: QUALITY_PRESETS,
      jobs,
    };
  });

  r.get('/api/tactics/jobs', () => t.jobs.list());

  r.post('/api/tactics/import', (req) => {
    const b = bodyOf(req) as { source?: unknown; quality?: unknown; force?: boolean; optional?: boolean; keepArchive?: boolean };
    const key = optStr(b.source, 'source') ?? 'lichess';
    if (key === 'lichess') {
      // keepArchive: το .csv.zst μένει στο downloads (νέα εισαγωγή με άλλο φίλτρο χωρίς δεύτερη λήψη)
      const job = t.jobs.enqueue('lichess', 'Εισαγωγή puzzles', (ctx) => importLichess(t, ctx, { quality: b.quality, force: !!b.force, keepArchive: !!b.keepArchive }));
      return { job };
    }
    if (SOURCE_BY_KEY.get(key)?.kind === 'mine') throw new HttpError(400, 'Η πηγή «Τα λάθη μου» γεμίζει μόνη της από την ανάλυση των παρτίδων σου');
    const defs = resolveSources(key, !!b.optional).filter((s) => s.kind !== 'lichess');
    if (!defs.length) throw new HttpError(404, `Άγνωστη πηγή «${key}»`);
    const title = defs.length === 1 ? `Εισαγωγή: ${defs[0].name.el}` : `Εισαγωγή ${defs.length} συλλογών`;
    const job = t.jobs.enqueue(key, title, async (ctx) => {
      const reports: Record<string, unknown> = {};
      let imported = 0;
      let rejected = 0;
      for (let i = 0; i < defs.length; i++) {
        if (ctx.signal.aborted) break;
        ctx.progress({ message: `${defs[i].name.el} (${i + 1}/${defs.length})` });
        try {
          const rep = await importCollection(t, defs[i], ctx);
          reports[defs[i].key] = rep;
          imported += rep.imported;
          rejected += Object.values(rep.rejected).reduce((a, x) => a + x, 0);
          ctx.progress({ imported, rejected });
        } catch (e) {
          if (ctx.signal.aborted) throw e;
          reports[defs[i].key] = { error: (e as Error).message };
        }
      }
      ctx.progress({ phase: 'finish', message: 'Μετρήσεις θεμάτων' });
      const fin = await finishImports(t);
      return { sources: reports, imported, rejected, finishMs: fin.ms };
    });
    return { job };
  });

  r.post('/api/tactics/import/:job/cancel', (req) => ({ job: t.jobs.cancel(req.params.job) }));
  r.post('/api/tactics/import/cancel', (req) => {
    const src = optStr(bodyOf(req).source, 'source');
    const out: TacticsJob[] = [];
    for (const j of t.jobs.list()) if ((j.status === 'running' || j.status === 'queued') && (!src || j.source === src)) out.push(t.jobs.cancel(j.id));
    return { cancelled: out };
  });

  // ---------------------------------------------------------------------------
  // Θέματα, ανοίγματα, βαθμοί

  r.get('/api/tactics/themes', (req) => {
    const counts = new Map((t.puzzles.prep('SELECT key, n FROM theme').all() as Array<{ key: string; n: number }>).map((x) => [x.key, x.n]));
    const perf = themePerformance(svc, num(req.query.get('days'), 30));
    return {
      groups: THEME_GROUPS,
      categories: THEME_CATEGORIES,
      difficulties: DIFFICULTIES,
      themes: THEMES.map((th) => ({ ...th, count: th.bit === null ? null : (counts.get(th.key) ?? 0), performance: perf.get(th.key)?.results ?? null, verdict: perf.get(th.key)?.verdict ?? null })),
    };
  });

  r.get('/api/tactics/openings', (req) => {
    const q = (req.query.get('q') ?? '').toLowerCase();
    const rows = t.puzzles.prep('SELECT id, family, tags, n FROM opening WHERE n > 0 ORDER BY family, n DESC').all() as Array<{ id: number; family: string; tags: string; n: number }>;
    const fam = new Map<string, { family: string; count: number; variations: Array<{ id: number; name: string; tags: string; count: number }> }>();
    for (const o of rows) {
      if (q && !o.tags.toLowerCase().replace(/_/g, ' ').includes(q)) continue;
      const f = fam.get(o.family) ?? { family: o.family, count: 0, variations: [] };
      f.count += o.n;
      const v = o.tags.split(' ')[1];
      f.variations.push({ id: o.id, name: v ? v.replace(/_/g, ' ') : o.family, tags: o.tags, count: o.n });
      fam.set(o.family, f);
    }
    return { families: [...fam.values()].sort((a, b) => b.count - a.count) };
  });

  r.get('/api/tactics/rating', () => svc.ratings());
  r.post('/api/tactics/rating', (req) => {
    const b = bodyOf(req);
    const mode = b.mode === 'blitz' ? 'blitz' : 'standard';
    const rating = optNum(b.rating, 'rating');
    if (rating === undefined || rating < 400 || rating > 3500) throw new HttpError(400, 'Άκυρος βαθμός');
    return svc.setRating(mode, rating, optNum(b.deviation, 'deviation'));
  });

  // ---------------------------------------------------------------------------
  // Επιλογή και λύση

  r.get('/api/tactics/next', (req) => {
    const q = req.query;
    const mode = q.get('mode') ?? 'rated';
    const srcKey = q.get('source');
    const src = srcKey ? SOURCE_BY_KEY.get(srcKey) : undefined;
    if (srcKey && !src) throw new HttpError(404, `Άγνωστη πηγή «${srcKey}»`);
    if (mode === 'review') {
      const deck = q.get('deck') ? num(q.get('deck'), 0) : undefined;
      const d = svc.nextDue(deck);
      return { mode, puzzle: d ? puzzleJson(t, d.row) : null, deck: d?.deck ?? deck ?? null, due: d?.due ?? null, remaining: (svc.due(deck, 1) as { total: number }).total };
    }
    if (mode === 'woodpecker') {
      const deck = num(q.get('deck'), 0);
      const cycle = svc.cycleOf(deck);
      if (cycle === null) throw new HttpError(404, 'Δεν βρέθηκε το σετ κύκλων');
      const id = svc.woodpeckerNextId(deck, cycle);
      const row = id !== null ? t.puzzles.get(id) : undefined;
      return { mode, puzzle: row ? puzzleJson(t, row) : null, deck, cycle, finished: id === null };
    }
    if (mode === 'replay') {
      const theme = q.get('theme') ?? '';
      const days = num(q.get('days'), 30);
      const d = dashboard(svc, days) as { themes: Array<{ key: string; replay: string[] }> };
      const pool = theme ? (d.themes.find((x) => x.key === theme)?.replay ?? []) : d.themes.flatMap((x) => x.replay);
      const exclude = new Set(list(q.get('exclude')));
      const left = [...new Set(pool)].filter((k) => !exclude.has(k));
      const row = left.length ? svc.puzzle(left[0]) : undefined;
      return { mode, puzzle: row ? puzzleJson(t, row) : null, remaining: left.length };
    }
    const kindParam = q.get('kind');
    if (kindParam !== null && !(KINDS as readonly string[]).includes(kindParam)) throw new HttpError(400, `Άγνωστο είδος «${kindParam}» (solve, practice, test, any)`);
    const kind = (kindParam as (typeof KINDS)[number] | null) ?? (src?.mode === 'practice' ? 'practice' : src?.mode === 'test' ? 'test' : 'solve');
    const res = svc.nextPuzzle({
      mode,
      diff: diffOf(q.get('diff')),
      themes: list(q.get('themes')),
      match: q.get('match') === 'all' ? 'all' : 'any',
      opening: q.get('opening') ?? undefined,
      color: color(q.get('color')),
      sourceId: src?.id,
      kind,
      min: q.get('min') ? num(q.get('min'), 0) : undefined,
      max: q.get('max') ? num(q.get('max'), 4000) : undefined,
      // κλειδιά puzzles («00008» ή αριθμοί των άλλων πηγών)
      exclude: list(q.get('exclude')).map(parsePuzzleKey).filter(Number.isFinite),
    });
    const rating = svc.rating('standard');
    return {
      mode,
      puzzle: res ? puzzleJson(t, res.row) : null,
      window: res?.window ?? null,
      compromise: res?.compromise ?? null,
      rating: { rating: rating.rating, deviation: rating.deviation, provisional: rating.provisional },
    };
  });

  r.get('/api/tactics/puzzle/:id', (req) => {
    const row = svc.puzzle(req.params.id);
    const attempts = svc.history({ puzzle: row.id, limit: 50 });
    const cards = t.user.prep('SELECT c.deck_id AS deck, d.name, c.due, c.state FROM card c JOIN deck d ON d.id = c.deck_id WHERE c.puzzle_id = ?').all(row.id);
    const flag = t.user.prep('SELECT bad, note, ts FROM flag WHERE puzzle_id = ?').get(row.id) ?? null;
    return { puzzle: puzzleJson(t, row, { san: true }), attempts, cards, flag };
  });

  // ---------------------------------------------------------------------------
  // Μια συλλογή μόνη της: οι θέσεις της με τη σειρά, ανά ενότητα (αρχείο ή θέμα), με την κατάστασή τους

  /** Το εύρος αναγνωριστικών μιας συλλογής (1e9 + id·1e7 + αύξων). */
  const rangeOf = (key: string) => {
    const src = SOURCE_BY_KEY.get(key);
    if (!src || src.kind === 'lichess' || src.kind === 'mine') throw new HttpError(404, `Άγνωστη συλλογή «${key}»`);
    const lo = 1_000_000_000 + src.id * 10_000_000;
    return { src, lo, hi: lo + 9_999_999 };
  };
  /** Η ενότητα μιας θέσης: το αρχείο της πηγής (π.χ. «Decoy») ή το θέμα του STS. */
  const PART = "coalesce(json_extract(meta, '$.file'), json_extract(meta, '$.category'), '')";
  const partWhere = (file: string) => (file ? `id BETWEEN ? AND ? AND ${PART} = ?` : 'id BETWEEN ? AND ?');
  /** Η σειρά των θέσεων: τα μαθήματα της εφαρμογής με τη σειρά του μαθήματος (meta.order), οι άλλες συλλογές με τον αύξοντα. */
  const orderKey = (src: { kind: string }) => (src.kind === 'bundled' ? "coalesce(json_extract(meta, '$.order'), id - 1000000000)" : 'id');

  r.get('/api/tactics/collection/:key', (req) => {
    const { src, lo, hi } = rangeOf(req.params.key);
    const file = req.query.get('file') ?? '';
    const offset = count(req.query.get('offset'), 0, 'offset');
    const limit = Math.min(200, count(req.query.get('limit'), 100, 'limit'));
    const args = file ? [lo, hi, file] : [lo, hi];
    // τα μαθήματα έχουν και αγγλικό όνομα ενότητας (meta.fileEn)
    const ord = orderKey(src);
    const lessons = src.kind === 'bundled';
    const parts = t.puzzles.prep(`SELECT ${PART} AS part, max(json_extract(meta, '$.fileEn')) AS en, count(*) AS n, min(${ord}) AS first FROM puzzle WHERE id BETWEEN ? AND ? GROUP BY part ORDER BY first`).all(lo, hi) as Array<{ part: string; en: string | null; n: number }>;
    const total = (t.puzzles.prep(`SELECT count(*) AS n FROM puzzle WHERE ${partWhere(file)}`).get(...args) as { n: number }).n;
    const rows = t.puzzles.prep(`SELECT id, rating, meta${lessons ? ', pos' : ''} FROM puzzle WHERE ${partWhere(file)} ORDER BY ${ord} LIMIT ? OFFSET ?`).all(...args, limit, offset) as Array<{ id: number; rating: number; meta: string | null; pos?: Uint8Array }>;
    // η κατάσταση κάθε θέσης από τις προσπάθειες: λύθηκε, λάθος ή όχι ακόμη
    const status = new Map<number, number>();
    if (rows.length) {
      const ids = rows.map((x) => x.id);
      for (const a of t.user.prep('SELECT puzzle_id AS id, max(win) AS win FROM attempt WHERE puzzle_id BETWEEN ? AND ? GROUP BY puzzle_id').all(Math.min(...ids), Math.max(...ids)) as Array<{ id: number; win: number }>) status.set(a.id, a.win);
    }
    // τα μαθήματα: και η θέση, ο στόχος και το επίπεδο (για τη λίστα του μαθήματος με μικρές σκακιέρες)
    const lessonInfo = (x: (typeof rows)[number]) => {
      if (!lessons || !x.pos) return {};
      const m = x.meta ? (JSON.parse(x.meta) as { goal?: string; file?: string; fileEn?: string }) : {};
      return { fen: unpackFen(x.pos), goal: m.goal === 'draw' ? 'draw' : 'win', part: m.file ?? '', partEn: m.fileEn ?? '' };
    };
    const progress = t.user.prep('SELECT count(DISTINCT puzzle_id) AS tried, count(DISTINCT CASE WHEN win = 1 THEN puzzle_id END) AS solved FROM attempt WHERE puzzle_id BETWEEN ? AND ?').get(lo, hi) as { tried: number; solved: number };
    return {
      key: src.key,
      name: src.name,
      about: src.about,
      section: src.section,
      mode: src.mode ?? 'solve',
      solution: src.solution,
      parts: parts.map((x) => ({ name: x.part, ...(x.en ? { en: x.en } : {}), n: x.n })),
      file,
      total,
      offset,
      progress,
      items: rows.map((x, i) => {
        const st = status.get(x.id);
        return { index: offset + i, id: puzzleKey(x.id), seq: x.id - lo, title: itemTitle(x.meta), titleEn: itemTitle(x.meta, 'en'), rating: x.rating, status: st === undefined ? null : st ? 'win' : 'loss', ...lessonInfo(x) };
      }),
    };
  });

  /** Η θέση `i` (από 0) μιας συλλογής ή μιας ενότητάς της, για λύση με τη σειρά. */
  r.get('/api/tactics/collection/:key/at', (req) => {
    const { src, lo, hi } = rangeOf(req.params.key);
    const file = req.query.get('file') ?? '';
    const i = count(req.query.get('i'), 0, 'i');
    const args = file ? [lo, hi, file] : [lo, hi];
    const total = (t.puzzles.prep(`SELECT count(*) AS n FROM puzzle WHERE ${partWhere(file)}`).get(...args) as { n: number }).n;
    const row = t.puzzles.prep(`SELECT id FROM puzzle WHERE ${partWhere(file)} ORDER BY ${orderKey(src)} LIMIT 1 OFFSET ?`).get(...args, i) as { id: number } | undefined;
    const full = row ? t.puzzles.get(row.id) : undefined;
    return { total, index: i, puzzle: full ? puzzleJson(t, full) : null };
  });

  r.post('/api/tactics/puzzle/:id/flag', (req) => {
    const b = bodyOf(req);
    return svc.flagPuzzle(req.params.id, b.bad !== false, optStr(b.note, 'note'));
  });

  /** Έλεγχος κίνησης του λύτη (κάθε ματ γίνεται δεκτό, ροκέ και ως «βασιλιάς παίρνει πύργο»). */
  r.post('/api/tactics/check', (req) => {
    const b = bodyOf(req);
    const uci = optStr(b.uci, 'uci');
    if (!uci) throw new HttpError(400, 'Χρειάζεται κίνηση (uci)');
    const row = svc.puzzle(String(b.id ?? ''));
    const fen = unpackFen(row.pos);
    const line = unpackLine(row.line);
    if (row.goal && JSON.parse(row.goal).kind === 'test') return { test: scoreTestAnswer(fen, JSON.parse(row.goal) as TestGoal, uci) };
    return checkAnswer(fen, line, solverPly(b.ply, (row.flags & F_PRE) !== 0, line.length), uci);
  });

  /** Υπόδειξη σε τρία βήματα: 1 κομμάτι, 2 τετράγωνο, 3 κίνηση. */
  r.get('/api/tactics/hint', (req) => {
    const row = svc.puzzle(req.query.get('id') ?? '');
    const level = Math.min(3, Math.max(1, Math.floor(num(req.query.get('level'), 1)))) as 1 | 2 | 3;
    const line = unpackLine(row.line);
    const h = hint(unpackFen(row.pos), line, solverPly(req.query.get('ply'), (row.flags & F_PRE) !== 0, line.length), level);
    if (!h) throw new HttpError(404, 'Δεν υπάρχει υπόδειξη σε αυτό το σημείο');
    return h;
  });

  /**
   * Αντίκρουση λάθος κίνησης: η απάντηση της μηχανής στη θέση μετά την κίνηση του λύτη (σύντομη
   * ανάλυση)· χωρίς μηχανή, μόνο η σωστή κίνηση της λύσης.
   */
  r.post('/api/tactics/refute', async (req) => {
    const b = bodyOf(req);
    const uci = optStr(b.uci, 'uci');
    if (!uci) throw new HttpError(400, 'Χρειάζεται κίνηση (uci)');
    const movetime = optNum(b.movetime, 'movetime') ?? 800;
    const row = svc.puzzle(String(b.id ?? ''));
    const fen = unpackFen(row.pos);
    const line = unpackLine(row.line);
    const ply = solverPly(b.ply, (row.flags & F_PRE) !== 0, line.length);
    const check = checkAnswer(fen, line, ply, uci);
    const out: Record<string, unknown> = { played: check.san, expected: check.expected ?? null, expectedSan: check.expectedSan ?? null, fen: check.fen };
    if (check.illegal) throw new HttpError(400, 'Παράνομη κίνηση');
    const engineId = lib.settings.defaultEngine ?? lib.settings.engines[0]?.id;
    if (!analysis || !engineId) return { ...out, engine: false };
    try {
      const u = await analysis.evaluate(engineId, check.fen, Math.min(5000, Math.max(200, movetime)));
      const best = u.lines[0];
      // αξιολόγηση από τη σκοπιά του λύτη (οι γραμμές της μηχανής είναι από τη σκοπιά των λευκών)
      const solverWhite = positionAt(fen, line, ply).turn === 0;
      const sign = solverWhite ? 1 : -1;
      return {
        ...out,
        engine: true,
        reply: best?.uci[0] ?? null,
        replySan: best?.san[0] ?? null,
        line: best?.san.slice(0, 8) ?? [],
        lineUci: best?.uci.slice(0, 8) ?? [],
        cp: best?.cp != null ? best.cp * sign : null,
        mate: best?.mate != null ? best.mate * sign : null,
        depth: best?.depth ?? null,
      };
    } catch (e) {
      return { ...out, engine: false, error: (e as Error).message };
    }
  });

  /** Εξάσκηση με στόχο: ο στόχος του κεφαλαίου και αν πέτυχε (με την αξιολόγηση της μηχανής από τον client). */
  /**
   * Ανάλυση μιας θέσης για τον λύτη: οι καλύτερες γραμμές της μηχανής (MultiPV), για τις θέσεις χωρίς
   * λύση (παιχνίδι με τη μηχανή) και για τις «Βαριάντες» μετά από κάθε άσκηση. Αξιολόγηση από τη σκοπιά των λευκών.
   */
  r.post('/api/tactics/engine', async (req) => {
    const b = bodyOf(req);
    const fen = optStr(b.fen, 'fen');
    if (!fen) throw new HttpError(400, 'Χρειάζεται θέση (fen)');
    try {
      Position.fromFen(fen);
    } catch {
      throw new HttpError(400, 'Άκυρη θέση (fen)');
    }
    const multipv = Math.min(4, Math.max(1, Math.round(optNum(b.multipv, 'multipv') ?? 1)));
    const movetime = Math.min(5000, Math.max(150, optNum(b.movetime, 'movetime') ?? 800));
    const engineId = lib.settings.defaultEngine ?? lib.settings.engines[0]?.id;
    if (!analysis || !engineId) return { engine: false, lines: [] };
    const u = await analysis.evaluate(engineId, fen, movetime, {}, false, multipv);
    const lines = u.lines
      .filter((l) => l.uci.length)
      .sort((a, c) => a.multipv - c.multipv)
      .slice(0, multipv)
      .map((l) => ({ uci: l.uci.slice(0, 16), san: l.san.slice(0, 16), cp: l.cp, mate: l.mate, depth: l.depth }));
    return { engine: true, lines };
  });

  r.post('/api/tactics/practice/check', (req) => {
    const b = bodyOf(req);
    const s = b.state as PracticeState | undefined;
    if (!s || typeof s !== 'object' || !PRACTICE_STATUS.includes(s.status) || !Number.isFinite(s.solverMoves)) {
      throw new HttpError(400, 'Χρειάζεται κατάσταση (state: status, solverMoves)');
    }
    let goal: PracticeGoal;
    if (b.id) {
      const row = svc.puzzle(String(b.id));
      goal = (row.goal ? JSON.parse(row.goal) : { kind: 'play' }) as PracticeGoal;
    } else if (typeof b.goal === 'string') goal = parsePracticeGoal(b.goal);
    else if (b.goal === undefined || b.goal === null) goal = { kind: 'mate' };
    else if (typeof b.goal === 'object' && typeof (b.goal as PracticeGoal).kind === 'string') goal = b.goal as PracticeGoal;
    else throw new HttpError(400, 'Άκυρος στόχος (goal)');
    return { goal, outcome: practiceOutcome(goal, s) };
  });

  r.post('/api/tactics/attempt', (req) => {
    const b = bodyOf(req);
    if (typeof b.id !== 'string') throw new HttpError(400, 'Χρειάζεται id puzzle');
    const angle = typeof b.angle === 'string' ? list(b.angle) : (optStrings(b.angle, 'angle') ?? optStrings(b.themes, 'themes') ?? []);
    const res = svc.attempt({
      id: b.id,
      mode: optStr(b.mode, 'mode') ?? 'rated',
      win: !!b.win,
      ms: optNum(b.ms, 'ms') ?? 0,
      hints: optNum(b.hints, 'hints') ?? 0,
      wrong: optStr(b.wrong, 'wrong') ?? null,
      angle,
      deck: optNum(b.deck, 'deck'),
      cycle: optNum(b.cycle, 'cycle'),
      run: optNum(b.run, 'run'),
      movesOk: optNum(b.movesOk, 'movesOk'),
      score: optNum(b.score, 'score'),
    });
    r.broadcast('tactics', { type: 'attempt', id: b.id, win: !!b.win });
    return { ...res, ratings: svc.ratings() };
  });

  r.get('/api/tactics/history', (req) =>
    svc.history({ limit: count(req.query.get('limit'), 50, 'limit'), offset: count(req.query.get('offset'), 0, 'offset'), mode: req.query.get('mode') ?? undefined, failed: req.query.get('failed') === '1' || req.query.get('failed') === 'true' }),
  );

  r.get('/api/tactics/dashboard', (req) => dashboard(svc, num(req.query.get('days'), 30)));

  // ---------------------------------------------------------------------------
  // Τράπουλες και επανάληψη

  r.get('/api/tactics/decks', () => ({ decks: svc.decks() }));
  r.post('/api/tactics/decks', (req) => {
    const b = bodyOf(req);
    return svc.createDeck(optStr(b.name, 'name') ?? '', b.kind === 'mine' ? 'mine' : 'custom', b.params ?? null, optStrings(b.ids, 'ids') ?? []);
  });
  r.get('/api/tactics/decks/:id', (req) => svc.deck(num(req.params.id, 0), { limit: count(req.query.get('limit'), 200, 'limit'), offset: count(req.query.get('offset'), 0, 'offset') }));
  r.post('/api/tactics/decks/:id/cards', (req) => {
    const b = bodyOf(req);
    return svc.editCards(num(req.params.id, 0), optStrings(b.add, 'add') ?? [], optStrings(b.remove, 'remove') ?? []);
  });
  r.del('/api/tactics/decks/:id', (req) => {
    svc.deleteDeck(num(req.params.id, 0));
    return { ok: true };
  });
  r.post('/api/tactics/decks/:id/delete', (req) => {
    svc.deleteDeck(num(req.params.id, 0));
    return { ok: true };
  });
  r.get('/api/tactics/review/due', (req) => svc.due(req.query.get('deck') ? num(req.query.get('deck'), 0) : undefined, count(req.query.get('limit'), 50, 'limit')));

  // ---------------------------------------------------------------------------
  // Woodpecker

  r.get('/api/tactics/woodpecker', () => ({ sets: svc.woodpeckers() }));
  r.post('/api/tactics/woodpecker', (req) => {
    const b = bodyOf(req);
    const source = optStr(b.source, 'source');
    const src = source ? SOURCE_BY_KEY.get(source) : undefined;
    if (source && !src) throw new HttpError(404, `Άγνωστη πηγή «${source}»`);
    const targetDays = optNum(b.targetDays, 'targetDays');
    if (targetDays !== undefined && targetDays < 1) throw new HttpError(400, 'Ο στόχος ημερών πρέπει να είναι ≥ 1');
    return svc.createWoodpecker({
      name: optStr(b.name, 'name'),
      size: optNum(b.size, 'size'),
      min: optNum(b.min, 'min'),
      max: optNum(b.max, 'max'),
      themes: typeof b.themes === 'string' ? list(b.themes) : optStrings(b.themes, 'themes'),
      match: b.match === 'all' ? 'all' : 'any',
      sourceId: src?.id,
      color: color(b.color),
      targetDays,
    });
  });
  r.get('/api/tactics/woodpecker/:id', (req) => svc.woodpecker(num(req.params.id, 0)));
  r.post('/api/tactics/woodpecker/:id/cycle', (req) => {
    const targetDays = optNum(bodyOf(req).targetDays, 'targetDays');
    if (targetDays !== undefined && targetDays < 1) throw new HttpError(400, 'Ο στόχος ημερών πρέπει να είναι ≥ 1');
    return svc.startCycle(num(req.params.id, 0), targetDays);
  });

  // ---------------------------------------------------------------------------
  // Γρήγοροι τρόποι

  const exclusion = () => {
    const f = svc.flaggedSet();
    return (id: number) => f.has(id);
  };

  r.get('/api/tactics/run/storm', (req) => {
    const c = color(req.query.get('color')) ?? (crypto.randomInt(2) ? 'white' : 'black');
    const set = svc.selector.bucketSet(STORM_BUCKETS, { color: c, maxRd: () => 85, exclude: exclusion() });
    return { mode: 'storm', color: c, config: STORM_CONFIG, buckets: STORM_BUCKETS, puzzles: set.map(compactJson), stats: svc.runStats('storm') };
  });

  r.get('/api/tactics/run/streak', () => {
    const set = svc.selector.bucketSet(STREAK_BUCKETS, { maxRd: (rating) => (rating > 2300 ? 110 : 85), exclude: exclusion() });
    return { mode: 'streak', config: { skips: 1, timeSeconds: null }, buckets: STREAK_BUCKETS, puzzles: set.map(compactJson), stats: svc.runStats('streak') };
  });

  r.get('/api/tactics/run/rush', (req) => {
    const variant = req.query.get('variant') ?? '3';
    const cfg = RUSH_VARIANTS[variant];
    if (!cfg) throw new HttpError(400, 'Παραλλαγή «3 λάθη»: 3, 5 ή survival');
    const set = svc.selector.bucketSet(RUSH_BUCKETS, { maxRd: () => 100, ranges: 'centered', exclude: exclusion() });
    return { mode: 'rush', variant, config: cfg, buckets: RUSH_BUCKETS, puzzles: set.map(compactJson), stats: svc.runStats(`rush:${variant}`) };
  });

  r.post('/api/tactics/run', (req) => {
    const b = bodyOf(req);
    const score = optNum(b.score, 'score');
    if (score === undefined) throw new HttpError(400, 'Χρειάζεται σκορ (score)');
    let puzzles: Array<{ id: string; win: boolean; ms?: number }> | undefined;
    if (b.puzzles !== undefined && b.puzzles !== null) {
      if (!Array.isArray(b.puzzles)) throw new HttpError(400, 'Το «puzzles» πρέπει να είναι λίστα');
      puzzles = b.puzzles.map((p: unknown) => {
        const x = (p ?? {}) as Record<string, unknown>;
        if (typeof x !== 'object' || typeof x.id !== 'string') throw new HttpError(400, 'Κάθε puzzle του γύρου χρειάζεται id');
        return { id: x.id, win: !!x.win, ms: optNum(x.ms, 'ms') };
      });
    }
    // όλα ελέγχονται πριν από την εγγραφή: ένας άκυρος γύρος δεν αφήνει μισή εγγραφή
    return svc.saveRun({
      mode: optStr(b.mode, 'mode') ?? '',
      variant: optStr(b.variant, 'variant'),
      score,
      bestCombo: optNum(b.bestCombo, 'bestCombo'),
      errors: optNum(b.errors, 'errors'),
      topRating: optNum(b.topRating, 'topRating'),
      ms: optNum(b.ms, 'ms'),
      puzzles,
    });
  });
  r.get('/api/tactics/runs', (req) => svc.runStats(req.query.get('mode') ?? 'storm'));

  r.get('/api/tactics/daily', (req) => {
    const day = req.query.get('day') ?? localDay(Date.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Ημερομηνία ΕΕΕΕ-ΜΜ-ΗΗ');
    const d = svc.daily(day);
    return { day, puzzle: d ? puzzleJson(t, d.row) : null, origin: d?.origin ?? null, solved: svc.dailyDone(day) };
  });

  // λήψη όλων των θεμάτων με ονόματα (μικρό, για το UI)
  r.get('/api/tactics/theme-names', () => themeNames(THEMES.map((x) => x.key)));

  // εισαγωγή που κόπηκε με κλείσιμο του server: τα ευρετήρια ξαναφτιάχνονται σε worker
  try {
    repairIndexes(t);
  } catch (e) {
    console.error('Τακτική: έλεγχος ευρετηρίων', e);
  }

  return { tactics: t, service: svc };
}
