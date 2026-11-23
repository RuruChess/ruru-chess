/** Υπηρεσίες της Τακτικής: βαθμοί (Standard/Blitz), προσπάθειες, τράπουλες FSRS, κύκλοι Woodpecker, γρήγοροι γύροι, puzzle της ημέρας. */
import { blitzScore, capGlicko, isProvisional, newGlicko, ratePuzzleAttempt, type Glicko } from '../../core/glicko2.ts';
import { reviewGrade, solverMoveCount } from '../../core/puzzle.ts';
import { HttpError } from '../library.ts';
import type { Tactics } from './context.ts';
import { retrievability, scheduleCard, STATE_NAMES, type CardRow } from './fsrs.ts';
import { LICHESS_ID_LIMIT, parsePuzzleKey, puzzleKey } from './pack.ts';
import { type SelectParams, Selector } from './select.ts';
import { F_INACTIVE, F_OWN, F_PRACTICE, F_PRE, F_TEST, F_UNRATED, type PuzzleRow } from './store.ts';
import { weightClassOf } from './themes.ts';

const DAY = 86_400_000;

export type RatingMode = 'standard' | 'blitz';

/** Τρόποι που μετρούν ως «λύση puzzle» στα στατιστικά (όχι οι γρήγοροι γύροι). */
export const SOLVE_MODES = ['rated', 'casual', 'themes', 'review', 'woodpecker', 'daily', 'replay'];
export const RUN_MODES = ['storm', 'rush', 'streak'];
export const ALL_MODES = [...SOLVE_MODES, ...RUN_MODES, 'practice', 'test'];

export interface RatingState extends Glicko {
  mode: RatingMode;
  n: number;
  updated: number | null;
  provisional: boolean;
}

export interface AttemptInput {
  id: string;
  mode: string;
  win: boolean;
  ms: number;
  hints?: number;
  wrong?: string | null;
  /** θέματα της συνεδρίας (Lichess angle) για το βάρος του βαθμού */
  angle?: string[];
  deck?: number;
  cycle?: number;
  run?: number;
  movesOk?: number;
  /** σκορ τεστ (βαθμοί STS) */
  score?: number;
  ts?: number;
}

export class TacticsService {
  readonly t: Tactics;
  readonly selector: Selector;
  private attempted: Set<number> | null = null;
  private flagged: Set<number> | null = null;

  constructor(t: Tactics) {
    this.t = t;
    this.selector = new Selector(t);
  }

  // -------------------------------------------------------------------------
  // Βαθμοί

  rating(mode: RatingMode): RatingState {
    const r = this.t.user.prep('SELECT r, rd, vol, n, updated FROM rating WHERE mode = ?').get(mode) as { r: number; rd: number; vol: number; n: number; updated: number } | undefined;
    const g = r ? { rating: r.r, deviation: r.rd, volatility: r.vol } : newGlicko();
    return { mode, ...g, n: r?.n ?? 0, updated: r?.updated ?? null, provisional: isProvisional(g) };
  }

  private saveRating(mode: RatingMode, g: Glicko, n: number, now: number): void {
    this.t.user.prep('INSERT INTO rating(mode, r, rd, vol, n, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(mode) DO UPDATE SET r = excluded.r, rd = excluded.rd, vol = excluded.vol, n = excluded.n, updated = excluded.updated').run(mode, g.rating, g.deviation, g.volatility, n, now);
  }

  /** Διάμεσος χρόνος λύσης (ms) για puzzles με ίδιο μήκος και κοντινό βαθμό (για Blitz και FSRS). */
  medianMs(solverMoves: number, rating: number): number | null {
    const u = this.t.user;
    const pick = (sql: string, ...args: number[]) => (u.prep(sql).all(...args) as Array<{ ms: number }>).map((r) => r.ms);
    let xs = pick('SELECT ms FROM attempt WHERE win = 1 AND hints = 0 AND ms > 0 AND p_moves = ? AND p_rating BETWEEN ? AND ? ORDER BY ts DESC LIMIT 300', solverMoves, rating - 250, rating + 250);
    if (xs.length < 8) xs = pick('SELECT ms FROM attempt WHERE win = 1 AND hints = 0 AND ms > 0 AND p_moves = ? ORDER BY ts DESC LIMIT 300', solverMoves);
    if (xs.length < 8) return null;
    xs.sort((a, b) => a - b);
    return xs[xs.length >> 1];
  }

  // -------------------------------------------------------------------------
  // Puzzles

  puzzle(key: string): PuzzleRow {
    const id = parsePuzzleKey(key);
    const row = Number.isFinite(id) ? this.t.puzzles.get(id) : undefined;
    if (!row) throw new HttpError(404, `Δεν βρέθηκε το puzzle ${key}`);
    return row;
  }

  /** Puzzles που έχει ήδη δει ο χρήστης (δεν ξαναδίνονται στον βαθμολογημένο τρόπο). */
  attemptedSet(): Set<number> {
    if (!this.attempted) {
      this.attempted = new Set();
      for (const r of this.t.user.prep('SELECT DISTINCT puzzle_id AS id FROM attempt').iterate() as Iterable<{ id: number }>) this.attempted.add(r.id);
    }
    return this.attempted;
  }

  flaggedSet(): Set<number> {
    if (!this.flagged) {
      this.flagged = new Set();
      for (const r of this.t.user.prep('SELECT puzzle_id AS id FROM flag WHERE bad = 1').iterate() as Iterable<{ id: number }>) this.flagged.add(r.id);
    }
    return this.flagged;
  }

  /** Πρόσφατα puzzles (για να μην επαναλαμβάνονται στους μη βαθμολογημένους τρόπους). */
  recentSet(limit = 2000): Set<number> {
    return new Set((this.t.user.prep('SELECT puzzle_id AS id FROM attempt ORDER BY id DESC LIMIT ?').all(limit) as Array<{ id: number }>).map((r) => r.id));
  }

  flagPuzzle(key: string, bad: boolean, note?: string): { id: string; bad: boolean } {
    const row = this.puzzle(key);
    if (bad) this.t.user.prep('INSERT INTO flag(puzzle_id, bad, note, ts) VALUES (?, 1, ?, ?) ON CONFLICT(puzzle_id) DO UPDATE SET bad = 1, note = excluded.note, ts = excluded.ts').run(row.id, note ?? null, Date.now());
    else this.t.user.prep('DELETE FROM flag WHERE puzzle_id = ?').run(row.id);
    this.flagged = null;
    return { id: puzzleKey(row.id), bad };
  }

  /** Επόμενο puzzle για βαθμολογημένο/ελεύθερο τρόπο με τα φίλτρα. */
  nextPuzzle(p: Omit<SelectParams, 'target' | 'exclude'> & { mode: string; diff: number; exclude?: number[] }): ReturnType<Selector['next']> {
    const rated = p.mode === 'rated';
    const rating = this.rating('standard').rating;
    const attempted = rated ? this.attemptedSet() : this.recentSet();
    const flagged = this.flaggedSet();
    const extra = new Set(p.exclude ?? []);
    return this.selector.next({ ...p, target: rating + p.diff, exclude: (id) => attempted.has(id) || flagged.has(id) || extra.has(id) });
  }

  // -------------------------------------------------------------------------
  // Προσπάθειες

  /**
   * Καταγραφή προσπάθειας. Στον βαθμολογημένο τρόπο μετρά μόνο η πρώτη προσπάθεια (όπως στο Lichess):
   * νέος βαθμός Standard (Glicko-2 με τα βάρη θεμάτων) και Blitz (σκορ από τον χρόνο). Αποτυχία →
   * τράπουλα «Αποτυχημένα». Σε επανάληψη τράπουλας ενημερώνεται η κάρτα (FSRS), σε Woodpecker ο κύκλος.
   */
  attempt(a: AttemptInput): Record<string, unknown> {
    if (!ALL_MODES.includes(a.mode)) throw new HttpError(400, `Άγνωστος τρόπος «${a.mode}»`);
    const row = this.puzzle(a.id);
    const u = this.t.user;
    const now = a.ts ?? Date.now();
    const hints = Math.max(0, Math.floor(a.hints ?? 0));
    const ms = Math.max(0, Math.round(a.ms || 0));
    const pre = (row.flags & F_PRE) !== 0;
    const lineLen = row.line.length / 2;
    const solverMoves = solverMoveCount(lineLen, pre);
    const prev = (u.prep('SELECT count(*) AS n FROM attempt WHERE puzzle_id = ?').get(row.id) as { n: number }).n;
    const firstTry = prev === 0;
    // λύση με υπόδειξη: για τον βαθμό μετρά ως ήττα (όπως στο Chess Tempo)
    const ratedWin = a.win && hints === 0;
    const out: Record<string, unknown> = { firstTry };
    let rBefore: number | null = null;
    let rAfter: number | null = null;
    let bBefore: number | null = null;
    let bAfter: number | null = null;
    const rateable = a.mode === 'rated' && firstTry && !(row.flags & (F_UNRATED | F_TEST | F_PRACTICE));
    const angle = a.angle?.length ? a.angle : [];
    const median = this.medianMs(solverMoves, row.rating);
    // Woodpecker με μόνο την τράπουλα: ο τρέχων κύκλος της
    const cycle = a.mode === 'woodpecker' ? (a.cycle ?? (a.deck !== undefined ? (this.cycleOf(a.deck) ?? undefined) : undefined)) : a.cycle;
    u.tx(() => {
      if (rateable) {
        const cls = weightClassOf(angle);
        const puzzle = { rating: row.rating, deviation: row.rd ?? 80 };
        const std = this.rating('standard');
        const nextStd = ratePuzzleAttempt(std, puzzle, ratedWin, cls);
        this.saveRating('standard', nextStd, std.n + 1, now);
        rBefore = std.rating;
        rAfter = nextStd.rating;
        const bl = this.rating('blitz');
        const t0 = median ?? 10_000 * solverMoves;
        const score = blitzScore(ratedWin, ms, t0);
        const nextBl = ratePuzzleAttempt(bl, puzzle, ratedWin, cls, score);
        this.saveRating('blitz', nextBl, bl.n + 1, now);
        bBefore = bl.rating;
        bAfter = nextBl.rating;
        out.rating = {
          standard: { before: std.rating, after: nextStd.rating, delta: Math.round(nextStd.rating) - Math.round(std.rating), rd: nextStd.deviation, provisional: isProvisional(nextStd) },
          blitz: { before: bl.rating, after: nextBl.rating, delta: Math.round(nextBl.rating) - Math.round(bl.rating), rd: nextBl.deviation, provisional: isProvisional(nextBl), score, t0 },
          weight: cls,
        };
      }
      // πλαίσιο της προσπάθειας ανά τρόπο: στο Woodpecker ο κύκλος (με αυτόν μετρά η πρόοδος του
      // κύκλου, ακόμη κι αν ο client στείλει και την τράπουλα), στην επανάληψη η τράπουλα, στους γύρους ο γύρος
      const ctx = a.mode === 'woodpecker' ? (cycle ?? null) : a.mode === 'review' ? (a.deck ?? null) : RUN_MODES.includes(a.mode) ? (a.run ?? null) : (a.deck ?? a.cycle ?? a.run ?? null);
      const res = u
        .prep(
          `INSERT INTO attempt(puzzle_id, ts, mode, win, first_try, ms, hints, wrong_uci, r_before, r_after, b_before, b_after, p_rating, p_moves, theme_angle, ctx, moves_ok, score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(row.id, now, a.mode, a.win ? 1 : 0, firstTry ? 1 : 0, ms, hints, a.wrong ?? null, rBefore, rAfter, bBefore, bAfter, row.rating, solverMoves, angle.length ? angle.join(' ') : null, ctx, a.movesOk ?? null, a.score ?? null);
      out.attemptId = Number(res.lastInsertRowid);
      // αποτυχία → τράπουλα «Αποτυχημένα» (μία κάρτα ανά puzzle, πρώτη επανάληψη αύριο)· τα λάθη του χρήστη έχουν ήδη τη δική τους
      if (!ratedWin && !(row.flags & (F_TEST | F_PRACTICE | F_OWN))) {
        const failed = this.failedDeck();
        const has = u.prep('SELECT 1 FROM card WHERE deck_id = ? AND puzzle_id = ?').get(failed, row.id);
        if (!has) {
          const s = scheduleCard(null, 1, now);
          this.insertCard(failed, row.id, s, now);
          out.addedToFailed = true;
        }
      }
      if (a.deck !== undefined && a.mode === 'review') out.card = this.reviewCard(a.deck, row.id, reviewGrade({ win: a.win, hints, ms, medianMs: median }), now);
      if (cycle !== undefined && a.mode === 'woodpecker') out.cycle = this.cycleAttempt(cycle, row.id, a.win, ms, a.win ? solverMoves : (a.movesOk ?? 0), out.attemptId as number);
    });
    this.attemptedSet().add(row.id);
    out.median = median;
    return out;
  }

  // -------------------------------------------------------------------------
  // Τράπουλες και FSRS

  /** Η αυτόματη τράπουλα «Αποτυχημένα» (φτιάχνεται την πρώτη φορά). */
  failedDeck(): number {
    const r = this.t.user.prep("SELECT id FROM deck WHERE kind = 'failed' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (r) return r.id;
    return Number(this.t.user.prep("INSERT INTO deck(name, kind, params, created) VALUES ('Αποτυχημένα', 'failed', NULL, ?)").run(Date.now()).lastInsertRowid);
  }

  /** Η τράπουλα «Τα λάθη μου» της Τράπεζας λαθών (φτιάχνεται την πρώτη φορά· δεν σβήνεται). */
  mistakesDeck(): number {
    const r = this.t.user.prep("SELECT id FROM deck WHERE kind = 'mistakes' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (r) return r.id;
    return Number(this.t.user.prep("INSERT INTO deck(name, kind, params, created) VALUES ('Τα λάθη μου', 'mistakes', NULL, ?)").run(Date.now()).lastInsertRowid);
  }

  /**
   * Οι κάρτες μιας τράπουλας γίνονται ακριβώς αυτά τα puzzles: όσα λείπουν μπαίνουν ως νέες κάρτες
   * (για σήμερα, με τη σειρά που δόθηκαν) και όσα δεν υπάρχουν πια φεύγουν. Οι υπάρχουσες κάρτες
   * κρατούν την κατάσταση FSRS τους· οι προσπάθειες μένουν στο ιστορικό.
   */
  setDeckPuzzles(deck: number, ids: readonly number[]): { added: number; removed: number } {
    if (!this.t.user.prep('SELECT 1 FROM deck WHERE id = ?').get(deck)) throw new HttpError(404, 'Δεν βρέθηκε η τράπουλα');
    const now = Date.now();
    const want = new Set(ids);
    const have = new Set((this.t.user.prep('SELECT puzzle_id AS id FROM card WHERE deck_id = ?').all(deck) as Array<{ id: number }>).map((r) => r.id));
    let added = 0;
    let removed = 0;
    this.t.user.tx(() => {
      let ord = (this.t.user.prep('SELECT ifnull(max(ord), 0) AS m FROM card WHERE deck_id = ?').get(deck) as { m: number }).m;
      for (const id of ids) {
        if (have.has(id)) continue;
        this.insertCard(deck, id, null, now, ++ord);
        added++;
      }
      for (const id of have) {
        if (want.has(id)) continue;
        removed += Number(this.t.user.prep('DELETE FROM card WHERE deck_id = ? AND puzzle_id = ?').run(deck, id).changes);
      }
    });
    return { added, removed };
  }

  /** Η κατάσταση FSRS κάθε κάρτας μιας τράπουλας (για τις λίστες, π.χ. της Τράπεζας λαθών). */
  deckCardStates(deck: number): Map<number, { due: number; state: string; reps: number; lapses: number; last: number | null }> {
    const rows = this.t.user.prep('SELECT puzzle_id, due, state, reps, lapses, last FROM card WHERE deck_id = ?').all(deck) as Array<{ puzzle_id: number; due: number; state: number; reps: number; lapses: number; last: number | null }>;
    return new Map(rows.map((c) => [c.puzzle_id, { due: c.due, state: STATE_NAMES[c.state] ?? 'new', reps: c.reps, lapses: c.lapses, last: c.last }]));
  }

  private insertCard(deck: number, puzzle: number, s: ReturnType<typeof scheduleCard> | null, now: number, ord = 0): void {
    this.t.user
      .prep(
        `INSERT OR IGNORE INTO card(deck_id, puzzle_id, due, stability, difficulty, scheduled, learning_steps, reps, lapses, state, last, added, ord)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(deck, puzzle, s?.due ?? now, s?.stability ?? 0, s?.difficulty ?? 0, s?.scheduled ?? 0, s?.learning_steps ?? 0, s?.reps ?? 0, s?.lapses ?? 0, s?.state ?? 0, s?.last ?? null, now, ord);
  }

  private card(deck: number, puzzle: number): CardRow | undefined {
    return this.t.user.prep('SELECT * FROM card WHERE deck_id = ? AND puzzle_id = ?').get(deck, puzzle) as CardRow | undefined;
  }

  /** Επανάληψη κάρτας: νέα κατάσταση FSRS από τον βαθμό. */
  reviewCard(deck: number, puzzle: number, grade: 1 | 2 | 3 | 4, now: number): Record<string, unknown> {
    const c = this.card(deck, puzzle) ?? null;
    if (!c) throw new HttpError(404, 'Το puzzle δεν είναι σε αυτή την τράπουλα');
    const s = scheduleCard(c, grade, now);
    this.t.user
      .prep('UPDATE card SET due = ?, stability = ?, difficulty = ?, scheduled = ?, learning_steps = ?, reps = ?, lapses = ?, state = ?, last = ? WHERE deck_id = ? AND puzzle_id = ?')
      .run(s.due, s.stability, s.difficulty, s.scheduled, s.learning_steps, s.reps, s.lapses, s.state, s.last, deck, puzzle);
    return { deck, grade, due: s.due, state: STATE_NAMES[s.state], scheduledDays: s.scheduled, stability: s.stability, difficulty: s.difficulty };
  }

  decks(): Array<Record<string, unknown>> {
    this.failedDeck();
    const now = Date.now();
    const rows = this.t.user
      .prep(
        `SELECT d.id, d.name, d.kind, d.params, d.created, count(c.puzzle_id) AS cards,
           sum(CASE WHEN c.due <= ? THEN 1 ELSE 0 END) AS due, sum(CASE WHEN c.state = 0 THEN 1 ELSE 0 END) AS new,
           sum(CASE WHEN c.state IN (1, 3) THEN 1 ELSE 0 END) AS learning, sum(CASE WHEN c.state = 2 THEN 1 ELSE 0 END) AS review
         FROM deck d LEFT JOIN card c ON c.deck_id = d.id GROUP BY d.id ORDER BY d.kind = 'failed' DESC, d.id`,
      )
      .all(now) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ ...r, params: r.params ? JSON.parse(r.params as string) : null, due: r.due ?? 0, new: r.new ?? 0, learning: r.learning ?? 0, review: r.review ?? 0 }));
  }

  createDeck(name: string, kind: 'custom' | 'mine' = 'custom', params: unknown = null, ids: string[] = []): Record<string, unknown> {
    const nm = String(name ?? '').trim();
    if (!nm) throw new HttpError(400, 'Χρειάζεται όνομα τράπουλας');
    const id = Number(this.t.user.prep('INSERT INTO deck(name, kind, params, created) VALUES (?, ?, ?, ?)').run(nm, kind, params ? JSON.stringify(params) : null, Date.now()).lastInsertRowid);
    if (ids.length) this.editCards(id, ids, []);
    return this.deck(id);
  }

  deck(id: number, opts: { limit?: number; offset?: number } = {}): Record<string, unknown> {
    const d = this.t.user.prep('SELECT * FROM deck WHERE id = ?').get(id) as { id: number; name: string; kind: string; params: string | null; created: number } | undefined;
    if (!d) throw new HttpError(404, 'Δεν βρέθηκε η τράπουλα');
    const now = Date.now();
    const cards = this.t.user.prep('SELECT * FROM card WHERE deck_id = ? ORDER BY ord, due LIMIT ? OFFSET ?').all(id, opts.limit ?? 200, opts.offset ?? 0) as unknown as CardRow[];
    const total = (this.t.user.prep('SELECT count(*) AS n FROM card WHERE deck_id = ?').get(id) as { n: number }).n;
    const due = (this.t.user.prep('SELECT count(*) AS n FROM card WHERE deck_id = ? AND due <= ?').get(id, now) as { n: number }).n;
    const rows = this.t.puzzles.getMany(cards.map((c) => c.puzzle_id));
    return {
      ...d,
      params: d.params ? JSON.parse(d.params) : null,
      total,
      due,
      cards: cards.map((c) => ({
        id: puzzleKey(c.puzzle_id),
        rating: rows.get(c.puzzle_id)?.rating ?? null,
        due: c.due,
        state: STATE_NAMES[c.state] ?? 'new',
        reps: c.reps,
        lapses: c.lapses,
        stability: c.stability,
        difficulty: c.difficulty,
        retrievability: retrievability(c, now),
        last: c.last,
        ord: c.ord,
      })),
    };
  }

  editCards(deck: number, add: string[], remove: string[]): { added: number; removed: number } {
    if (!this.t.user.prep('SELECT 1 FROM deck WHERE id = ?').get(deck)) throw new HttpError(404, 'Δεν βρέθηκε η τράπουλα');
    const now = Date.now();
    let added = 0;
    let removed = 0;
    this.t.user.tx(() => {
      let ord = (this.t.user.prep('SELECT ifnull(max(ord), 0) AS m FROM card WHERE deck_id = ?').get(deck) as { m: number }).m;
      for (const k of add) {
        const row = this.puzzle(k);
        if (this.card(deck, row.id)) continue;
        this.insertCard(deck, row.id, null, now, ++ord);
        added++;
      }
      for (const k of remove) {
        const id = parsePuzzleKey(k);
        removed += Number(this.t.user.prep('DELETE FROM card WHERE deck_id = ? AND puzzle_id = ?').run(deck, id).changes);
      }
    });
    return { added, removed };
  }

  deleteDeck(id: number): void {
    const d = this.t.user.prep('SELECT kind FROM deck WHERE id = ?').get(id) as { kind: string } | undefined;
    if (!d) throw new HttpError(404, 'Δεν βρέθηκε η τράπουλα');
    if (d.kind === 'failed') throw new HttpError(400, 'Η τράπουλα «Αποτυχημένα» δεν σβήνεται');
    if (d.kind === 'mistakes') throw new HttpError(400, 'Η τράπουλα «Τα λάθη μου» δεν σβήνεται· τη γεμίζει η Τράπεζα λαθών');
    this.t.user.tx(() => {
      this.t.user.prep('DELETE FROM card WHERE deck_id = ?').run(id);
      this.t.user.prep('DELETE FROM cycle WHERE deck_id = ?').run(id);
      this.t.user.prep('DELETE FROM deck WHERE id = ?').run(id);
    });
  }

  /** Κάρτες προς επανάληψη τώρα (όλες οι τράπουλες ή μία), οι πιο καθυστερημένες πρώτα. */
  due(deck?: number, limit = 50): Record<string, unknown> {
    const now = Date.now();
    const where = deck !== undefined ? 'WHERE c.deck_id = ? AND c.due <= ?' : "WHERE c.due <= ? AND d.kind <> 'woodpecker'";
    const args = deck !== undefined ? [deck, now] : [now];
    const items = this.t.user.prep(`SELECT c.deck_id, c.puzzle_id, c.due, c.state FROM card c JOIN deck d ON d.id = c.deck_id ${where} ORDER BY c.due LIMIT ?`).all(...args, limit) as Array<{ deck_id: number; puzzle_id: number; due: number; state: number }>;
    const byDeck = this.t.user.prep("SELECT c.deck_id AS deck, d.name, count(*) AS due FROM card c JOIN deck d ON d.id = c.deck_id WHERE c.due <= ? AND d.kind <> 'woodpecker' GROUP BY c.deck_id").all(now);
    const tomorrow = (this.t.user.prep("SELECT count(*) AS n FROM card c JOIN deck d ON d.id = c.deck_id WHERE c.due > ? AND c.due <= ? AND d.kind <> 'woodpecker'").get(now, now + DAY) as { n: number }).n;
    const total = (byDeck as Array<{ due: number }>).reduce((s, r) => s + r.due, 0);
    return { now, total, tomorrow, byDeck, items: items.map((x) => ({ deck: x.deck_id, id: puzzleKey(x.puzzle_id), due: x.due, state: STATE_NAMES[x.state] })) };
  }

  /** Το πιο καθυστερημένο puzzle μιας τράπουλας (ή όλων). */
  nextDue(deck?: number): { row: PuzzleRow; deck: number; due: number } | null {
    const now = Date.now();
    const r = (
      deck !== undefined
        ? this.t.user.prep('SELECT deck_id, puzzle_id, due FROM card WHERE deck_id = ? AND due <= ? ORDER BY due LIMIT 1').get(deck, now)
        : this.t.user.prep("SELECT c.deck_id, c.puzzle_id, c.due FROM card c JOIN deck d ON d.id = c.deck_id WHERE c.due <= ? AND d.kind <> 'woodpecker' ORDER BY c.due LIMIT 1").get(now)
    ) as { deck_id: number; puzzle_id: number; due: number } | undefined;
    if (!r) return null;
    const row = this.t.puzzles.get(r.puzzle_id);
    return row ? { row, deck: r.deck_id, due: r.due } : null;
  }

  // -------------------------------------------------------------------------
  // Woodpecker

  /**
   * Νέο σετ Woodpecker: `size` puzzles μέσα σε ζώνη βαθμού (θέματα/πηγή/χρώμα προαιρετικά), σε
   * σταθερή σειρά, και ο πρώτος κύκλος (προεπιλογή 28 ημέρες).
   */
  createWoodpecker(o: { name?: string; size?: number; min?: number; max?: number; themes?: string[]; match?: 'any' | 'all'; sourceId?: number; color?: 'white' | 'black'; targetDays?: number }): Record<string, unknown> {
    const size = Math.min(2000, Math.max(5, Math.floor(o.size ?? 250)));
    const rating = this.rating('standard').rating;
    const min = o.min ?? Math.round(rating - 300);
    const max = o.max ?? Math.round(rating + 100);
    if (min >= max) throw new HttpError(400, 'Άκυρη ζώνη βαθμού');
    const flagged = this.flaggedSet();
    const ids = this.selector.sample({ target: (min + max) / 2, min, max, themes: o.themes, match: o.match, sourceId: o.sourceId, color: o.color, exclude: (id) => flagged.has(id) }, size);
    if (!ids.length) throw new HttpError(404, 'Δεν βρέθηκαν puzzles με αυτά τα κριτήρια');
    const now = Date.now();
    const params = { size, min, max, themes: o.themes ?? [], match: o.match ?? 'any', source: o.sourceId ?? 1, color: o.color ?? null, targetDays: o.targetDays ?? 28 };
    let deck = 0;
    this.t.user.tx(() => {
      deck = Number(this.t.user.prep("INSERT INTO deck(name, kind, params, created) VALUES (?, 'woodpecker', ?, ?)").run(o.name?.trim() || `${min}–${max}`, JSON.stringify(params), now).lastInsertRowid);
      ids.forEach((id, i) => this.insertCard(deck, id, null, now, i + 1));
      this.t.user.prep('INSERT INTO cycle(deck_id, n, started, target_days) VALUES (?, 1, ?, ?)').run(deck, now, params.targetDays);
    });
    return this.woodpecker(deck);
  }

  private currentCycle(deck: number): { id: number; n: number; started: number; finished: number | null; target_days: number } | undefined {
    return this.t.user.prep('SELECT id, n, started, finished, target_days FROM cycle WHERE deck_id = ? ORDER BY n DESC LIMIT 1').get(deck) as { id: number; n: number; started: number; finished: number | null; target_days: number } | undefined;
  }

  /** Μία προσπάθεια μέσα σε κύκλο: μετρά μόνο η πρώτη ανά puzzle· ο κύκλος κλείνει όταν λυθούν όλα. */
  private cycleAttempt(cycleId: number, puzzle: number, win: boolean, ms: number, points: number, attemptId: number): Record<string, unknown> {
    const c = this.t.user.prep('SELECT * FROM cycle WHERE id = ?').get(cycleId) as { id: number; deck_id: number; finished: number | null } | undefined;
    if (!c) throw new HttpError(404, 'Δεν βρέθηκε ο κύκλος');
    if (!this.card(c.deck_id, puzzle)) throw new HttpError(400, 'Το puzzle δεν ανήκει στο σετ');
    const before = (this.t.user.prep("SELECT count(*) AS n FROM attempt WHERE ctx = ? AND mode = 'woodpecker' AND puzzle_id = ? AND id <> ?").get(cycleId, puzzle, attemptId) as { n: number }).n;
    if (!before) {
      this.t.user.prep('UPDATE cycle SET solved = solved + 1, correct = correct + ?, total_ms = total_ms + ?, points = points + ? WHERE id = ?').run(win ? 1 : 0, ms, points, cycleId);
    }
    const total = (this.t.user.prep('SELECT count(*) AS n FROM card WHERE deck_id = ?').get(c.deck_id) as { n: number }).n;
    const done = (this.t.user.prep('SELECT solved FROM cycle WHERE id = ?').get(cycleId) as { solved: number }).solved;
    if (done >= total && !c.finished) this.t.user.prep('UPDATE cycle SET finished = ? WHERE id = ?').run(Date.now(), cycleId);
    return { cycle: cycleId, solved: done, total, finished: done >= total };
  }

  /** Σετ Woodpecker: κύκλοι με στατιστικά, πρόοδος του τρέχοντος και πρόταση για τον επόμενο. */
  woodpecker(deck: number): Record<string, unknown> {
    const d = this.t.user.prep("SELECT * FROM deck WHERE id = ? AND kind = 'woodpecker'").get(deck) as { id: number; name: string; params: string; created: number } | undefined;
    if (!d) throw new HttpError(404, 'Δεν βρέθηκε το σετ κύκλων');
    const total = (this.t.user.prep('SELECT count(*) AS n FROM card WHERE deck_id = ?').get(deck) as { n: number }).n;
    const cycles = (this.t.user.prep('SELECT * FROM cycle WHERE deck_id = ? ORDER BY n').all(deck) as Array<{ id: number; n: number; started: number; finished: number | null; target_days: number; solved: number; correct: number; total_ms: number; points: number }>).map((c) => {
      const end = c.finished ?? Date.now();
      return {
        ...c,
        days: Math.max(1, Math.ceil((end - c.started) / DAY)),
        accuracy: c.solved ? c.correct / c.solved : null,
        avgMs: c.solved ? Math.round(c.total_ms / c.solved) : null,
        deadline: c.started + c.target_days * DAY,
        onTime: c.finished ? c.finished <= c.started + c.target_days * DAY : null,
      };
    });
    const cur = cycles[cycles.length - 1];
    const next = cur && !cur.finished ? this.woodpeckerNextId(deck, cur.id) : null;
    const last = cycles[cycles.length - 1];
    // μέθοδος Smith & Tikkanen: κάθε κύκλος στο μισό χρόνο του προηγούμενου, ως 7 κύκλους ή ένα σετ σε μία μέρα
    const nextTarget = last ? Math.max(1, Math.ceil((last.finished ? last.days : last.target_days) / 2)) : 28;
    const complete = !!last?.finished && (cycles.length >= 7 || last.days <= 1);
    return {
      id: d.id,
      name: d.name,
      params: JSON.parse(d.params),
      created: d.created,
      total,
      cycles,
      current: cur ? { id: cur.id, n: cur.n, solved: cur.solved, total, finished: cur.finished, next: next !== null ? puzzleKey(next) : null } : null,
      recommendation: { nextTargetDays: nextTarget, restUntil: last?.finished ? last.finished + DAY : null, complete },
    };
  }

  woodpeckers(): Array<Record<string, unknown>> {
    const ids = (this.t.user.prep("SELECT id FROM deck WHERE kind = 'woodpecker' ORDER BY id DESC").all() as Array<{ id: number }>).map((r) => r.id);
    return ids.map((id) => this.woodpecker(id));
  }

  /** Επόμενο puzzle του τρέχοντος κύκλου (με τη σειρά του σετ). */
  woodpeckerNextId(deck: number, cycle: number): number | null {
    const r = this.t.user
      .prep("SELECT c.puzzle_id AS id FROM card c WHERE c.deck_id = ? AND NOT EXISTS (SELECT 1 FROM attempt a WHERE a.ctx = ? AND a.mode = 'woodpecker' AND a.puzzle_id = c.puzzle_id) ORDER BY c.ord LIMIT 1")
      .get(deck, cycle) as { id: number } | undefined;
    return r ? r.id : null;
  }

  /** Νέος κύκλος: στόχος ceil(προηγούμενες ημέρες / 2). Ο προηγούμενος κλείνει αν δεν είχε τελειώσει. */
  startCycle(deck: number, targetDays?: number): Record<string, unknown> {
    const w = this.woodpecker(deck) as { recommendation: { nextTargetDays: number } };
    const cur = this.currentCycle(deck);
    const now = Date.now();
    this.t.user.tx(() => {
      if (cur && !cur.finished) this.t.user.prep('UPDATE cycle SET finished = ? WHERE id = ?').run(now, cur.id);
      this.t.user.prep('INSERT INTO cycle(deck_id, n, started, target_days) VALUES (?, ?, ?, ?)').run(deck, (cur?.n ?? 0) + 1, now, Math.max(1, Math.floor(targetDays ?? w.recommendation.nextTargetDays)));
    });
    return this.woodpecker(deck);
  }

  /** Τρέχων κύκλος ενός σετ (για τις προσπάθειες). */
  cycleOf(deck: number): number | null {
    return this.currentCycle(deck)?.id ?? null;
  }

  // -------------------------------------------------------------------------
  // Γρήγοροι γύροι (Storm, Rush, Streak)

  saveRun(o: { mode: string; score: number; bestCombo?: number; errors?: number; topRating?: number; ms?: number; variant?: string; puzzles?: Array<{ id: string; win: boolean; ms?: number }> }): Record<string, unknown> {
    if (!RUN_MODES.includes(o.mode)) throw new HttpError(400, `Άγνωστος γρήγορος τρόπος «${o.mode}»`);
    const now = Date.now();
    const mode = o.variant ? `${o.mode}:${o.variant}` : o.mode;
    let id = 0;
    const failed: string[] = [];
    this.t.user.tx(() => {
      id = Number(
        this.t.user
          .prep('INSERT INTO run(mode, ts, score, best_combo, errors, top_rating, ms, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(mode, now, Math.round(o.score || 0), o.bestCombo ?? null, o.errors ?? null, o.topRating ?? null, o.ms ?? null, o.puzzles ? JSON.stringify({ n: o.puzzles.length }) : null).lastInsertRowid,
      );
    });
    for (const p of o.puzzles ?? []) {
      try {
        this.attempt({ id: p.id, mode: o.mode, win: !!p.win, ms: p.ms ?? 0, run: id, ts: now });
        if (!p.win) failed.push(p.id);
      } catch {
        // άγνωστο puzzle: αγνοείται
      }
    }
    return { id, mode, ...this.runStats(mode), failed };
  }

  runStats(mode: string): Record<string, unknown> {
    const best = this.t.user.prep('SELECT * FROM run WHERE mode = ? ORDER BY score DESC, ts LIMIT 1').get(mode) ?? null;
    const recent = this.t.user.prep('SELECT * FROM run WHERE mode = ? ORDER BY ts DESC LIMIT 30').all(mode);
    const n = (this.t.user.prep('SELECT count(*) AS n, avg(score) AS avg FROM run WHERE mode = ?').get(mode) as { n: number; avg: number | null }) ?? { n: 0, avg: null };
    const today = this.t.user.prep('SELECT max(score) AS s FROM run WHERE mode = ? AND ts >= ?').get(mode, startOfDay(Date.now())) as { s: number | null };
    return { best, recent, count: n.n, average: n.avg, todayBest: today.s };
  }

  // -------------------------------------------------------------------------
  // Puzzle της ημέρας

  /**
   * Puzzle της ημέρας: ένα παλιό «daily» του Lichess της ίδιας ημερομηνίας (άλλη χρονιά) αν υπάρχει,
   * αλλιώς ντετερμινιστικό puzzle από τον σπόρο της ημέρας (1500–2000, Lichess).
   */
  daily(day = localDay(Date.now())): { day: string; row: PuzzleRow; origin: string } | null {
    const md = day.slice(5);
    const past = this.t.puzzles.prep('SELECT day, puzzle_id FROM daily WHERE substr(day, 6) = ? AND day < ? ORDER BY day DESC').all(md, day) as Array<{ day: string; puzzle_id: number }>;
    for (const p of past) {
      const row = this.t.puzzles.get(p.puzzle_id);
      if (row) return { day, row, origin: `lichess-daily:${p.day}` };
    }
    let seed = 0;
    for (const ch of day) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
    const rnd = mulberry32(seed);
    // Το πρώτο κατάλληλο puzzle από ένα αναγνωριστικό του σπόρου, στη σειρά του κύριου κλειδιού: ίδιο
    // αποτέλεσμα με ή χωρίς ευρετήρια (π.χ. στη διάρκεια μιας εισαγωγής) και σε κάθε σχέδιο εκτέλεσης
    // (το «+rating» κρατά τη σάρωση στο κύριο κλειδί). Αλλάζει μόνο αν αλλάξουν τα puzzles γύρω από το σημείο.
    // Ο σπόρος πέφτει μέσα στα αναγνωριστικά του Lichess (δύο αναζητήσεις στο κύριο κλειδί· min/max μαζί θα σάρωνε).
    const lo = (this.t.puzzles.prep('SELECT id FROM puzzle ORDER BY id LIMIT 1').get() as { id: number } | undefined)?.id;
    const hi = (this.t.puzzles.prep('SELECT id FROM puzzle WHERE id < ? ORDER BY id DESC LIMIT 1').get(LICHESS_ID_LIMIT) as { id: number } | undefined)?.id;
    if (lo === undefined || hi === undefined || hi < lo) return null;
    const st = this.t.puzzles.prep(`SELECT id FROM puzzle WHERE id >= ? AND +rating >= 1500 AND +rating < 2000 AND (flags & ${F_UNRATED | F_TEST | F_PRACTICE | F_INACTIVE}) = 0 ORDER BY id LIMIT 1`);
    const x = (st.get(lo + Math.floor(rnd() * (hi - lo + 1))) ?? st.get(0)) as { id: number } | undefined;
    const row = x ? this.t.puzzles.get(x.id) : undefined;
    return row ? { day, row, origin: 'seed' } : null;
  }

  dailyDone(day: string): boolean {
    const start = new Date(`${day}T00:00:00`).getTime();
    return !!this.t.user.prep("SELECT 1 FROM attempt WHERE mode = 'daily' AND ts >= ? AND ts < ? LIMIT 1").get(start, start + DAY);
  }

  // -------------------------------------------------------------------------
  // Ιστορικό

  history(o: { limit?: number; offset?: number; mode?: string; failed?: boolean; puzzle?: number }): Record<string, unknown> {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (o.mode) {
      where.push('mode = ?');
      args.push(o.mode);
    }
    if (o.failed) where.push('win = 0');
    if (o.puzzle !== undefined) {
      where.push('puzzle_id = ?');
      args.push(o.puzzle);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.t.user.prep(`SELECT * FROM attempt ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, Math.min(500, o.limit ?? 50), o.offset ?? 0) as Array<Record<string, unknown> & { puzzle_id: number }>;
    const total = (this.t.user.prep(`SELECT count(*) AS n FROM attempt ${w}`).get(...args) as { n: number }).n;
    return { total, items: rows.map((r) => ({ ...r, id: r.id, puzzle: puzzleKey(r.puzzle_id), win: !!r.win, firstTry: !!r.first_try })) };
  }

  /** Βαθμοί μαζί (Standard/Blitz). */
  ratings(): Record<RatingMode, RatingState> {
    return { standard: this.rating('standard'), blitz: this.rating('blitz') };
  }

  /** Χειροκίνητη αρχικοποίηση βαθμού (π.χ. από Lichess/Chess.com). Τα ήδη παιγμένα δεν αλλάζουν. */
  setRating(mode: RatingMode, rating: number, deviation = 350): RatingState {
    const cur = this.rating(mode);
    this.saveRating(mode, capGlicko({ rating, deviation, volatility: cur.volatility }), cur.n, Date.now());
    return this.rating(mode);
  }
}

export function localDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
