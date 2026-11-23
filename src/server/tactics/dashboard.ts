// SPDX-License-Identifier: AGPL-3.0-or-later AND GPL-3.0-or-later
// Copyright (c) 2012-2026 the lila authors (AGPL-3.0-or-later), https://github.com/lichess-org/lila
//   from lila: PuzzleDashboard
// Adapted through RealChessBase by Lazaros Batsis (GPL-3.0-or-later).
// Translated to TypeScript and modified for Ruru Chess: 2026-10-27.
// License texts: LICENSE, licenses/AGPL-3.0.txt, licenses/NOTICES.txt
/** Πίνακας επιδόσεων (μαθηματικά του PuzzleDashboard του Lichess): επίδοση ανά θέμα, αδύναμα/δυνατά, ιστορικό βαθμού, χρόνοι, ημερολόγιο. */
import type { TacticsService } from './service.ts';
import { localDay, RUN_MODES, SOLVE_MODES } from './service.ts';
import { puzzleKey } from './pack.ts';
import { F_WHITE } from './store.ts';
import { BY_KEY, keysOf, themeName } from './themes.ts';

const DAY = 86_400_000;
/** Επιλογές ημερών του Lichess (PuzzleDashboard.dayChoices). */
export const DAY_CHOICES = [1, 2, 3, 7, 10, 14, 21, 30, 60, 90];
const TOP_THEMES = 8;
/** Όρια ιστογράμματος χρόνου λύσης (δευτερόλεπτα). */
const TIME_BUCKETS = [5, 10, 20, 30, 60, 120, 300];

export const closestDays = (n: number): number => DAY_CHOICES.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 30);

export interface Results {
  nb: number;
  firstWins: number;
  fixed: number;
  unfixed: number;
  failed: number;
  puzzleRatingAvg: number;
  performance: number;
  firstWinPercent: number;
  /** αρκετά δεδομένα για συμπέρασμα (Lichess `clear`: nb ≥ 6, firstWins ≥ 2, failed ≥ 2) */
  clear: boolean;
}

/** Επίδοση = μέσος βαθμός puzzles − 500 + 1000 × (νίκες με την πρώτη / πλήθος). */
export function results(nb: number, firstWins: number, fixed: number, ratingSum: number): Results {
  const avg = nb ? Math.round(ratingSum / nb) : 0;
  const failed = nb - firstWins;
  return {
    nb,
    firstWins,
    fixed,
    unfixed: failed - fixed,
    failed,
    puzzleRatingAvg: avg,
    performance: nb ? avg - 500 + Math.round((1000 * firstWins) / nb) : 0,
    firstWinPercent: nb ? Math.round((firstWins * 100) / nb) : 0,
    clear: nb >= 6 && firstWins >= 2 && failed >= 2,
  };
}

interface Round {
  puzzle: number;
  firstWin: boolean;
  fixed: boolean;
  rating: number;
  last: number;
}

/** Αδύναμα και δυνατά θέματα όπως στο Lichess: θέμα με nb > global.nb/40· αδύναμο: failed ≥ 3 και επίδοση < συνολική· δυνατό: firstWins ≥ 3 και επίδοση > συνολική. */
export function weakStrong<T extends { key: string; results: Results }>(themes: T[], global: Results): { weak: T[]; strong: T[] } {
  const all = themes.filter((x) => x.results.nb > global.nb / 40).sort((a, b) => a.results.performance - b.results.performance || b.results.nb - a.results.nb);
  const weak = all.filter((x) => x.results.failed >= 3 && x.results.performance < global.performance).slice(0, TOP_THEMES);
  const strong = all
    .filter((x) => x.results.firstWins >= 3 && x.results.performance > global.performance)
    .slice(-TOP_THEMES)
    .reverse();
  return { weak, strong };
}

export function dashboard(svc: TacticsService, daysIn: number): Record<string, unknown> {
  const days = closestDays(daysIn);
  const now = Date.now();
  const since = now - days * DAY;
  const u = svc.t.user;
  const modes = SOLVE_MODES.map((m) => `'${m}'`).join(',');
  // όλα τα puzzles που παίχτηκαν στο διάστημα, με την πρώτη προσπάθεια όπου κι αν έγινε
  const rows = u
    .prep(
      `SELECT a.puzzle_id AS p, a.win AS win, a.ts AS ts, a.p_rating AS r, a.ms AS ms, a.hints AS hints FROM attempt a
       WHERE a.mode IN (${modes}) AND a.puzzle_id IN (SELECT puzzle_id FROM attempt WHERE ts >= ? AND mode IN (${modes}))
       ORDER BY a.puzzle_id, a.id`,
    )
    .all(since) as Array<{ p: number; win: number; ts: number; r: number; ms: number; hints: number }>;
  const rounds: Round[] = [];
  for (let i = 0; i < rows.length; ) {
    const p = rows[i].p;
    const first = rows[i];
    let fixed = false;
    let last = first.ts;
    let j = i;
    for (; j < rows.length && rows[j].p === p; j++) {
      if (j > i && rows[j].win && !first.win) fixed = true;
      last = rows[j].ts;
    }
    if (last >= since) rounds.push({ puzzle: p, firstWin: !!first.win && !first.hints, fixed, rating: first.r ?? 0, last });
    i = j;
  }
  const sum = (xs: Round[]) => results(xs.length, xs.filter((x) => x.firstWin).length, xs.filter((x) => x.fixed).length, xs.reduce((s, x) => s + x.rating, 0));
  const global = sum(rounds);

  // ανά θέμα (μόνο τα «σχετικά» θέματα του Lichess)
  const puzzles = svc.t.puzzles.getMany(rounds.map((r) => r.puzzle));
  const byTheme = new Map<string, Round[]>();
  const byPhase = new Map<string, Round[]>();
  const byColor = new Map<string, Round[]>();
  const byLength = new Map<string, Round[]>();
  const byOpening = new Map<string, Round[]>();
  const add = (m: Map<string, Round[]>, k: string, r: Round) => {
    const a = m.get(k);
    if (a) a.push(r);
    else m.set(k, [r]);
  };
  for (const r of rounds) {
    const row = puzzles.get(r.puzzle);
    if (!row) continue;
    const keys = keysOf(row.th1, row.th2);
    for (const k of keys) {
      if (BY_KEY.get(k)?.dashboard) add(byTheme, k, r);
      if (k === 'opening' || k === 'middlegame' || k === 'endgame') add(byPhase, k, r);
      if (k === 'oneMove' || k === 'short' || k === 'long' || k === 'veryLong') add(byLength, k, r);
    }
    add(byColor, row.flags & F_WHITE ? 'white' : 'black', r);
    if (row.opening_id !== null) {
      const fam = (svc.t.puzzles.prep('SELECT family FROM opening WHERE id = ?').get(row.opening_id) as { family: string } | undefined)?.family;
      if (fam) add(byOpening, fam, r);
    }
  }
  const themes = [...byTheme].map(([key, xs]) => ({
    ...themeName(key),
    results: sum(xs),
    replay: xs.filter((x) => !x.firstWin && !x.fixed).map((x) => puzzleKey(x.puzzle)),
  }));
  const { weak, strong } = weakStrong(themes, global);
  const mostPlayed = [...themes].sort((a, b) => b.results.nb - a.results.nb).slice(0, 9);
  const group = (m: Map<string, Round[]>, named = false) => [...m].map(([key, xs]) => ({ key, ...(named ? themeName(key) : {}), results: sum(xs) })).sort((a, b) => b.results.nb - a.results.nb);

  // ιστορικό βαθμού: η τελευταία τιμή κάθε ημέρας
  const hist = u.prep("SELECT ts, r_after AS r, b_after AS b FROM attempt WHERE mode = 'rated' AND r_after IS NOT NULL AND ts >= ? ORDER BY id").all(since) as Array<{ ts: number; r: number; b: number | null }>;
  const perDay = new Map<string, { day: string; standard: number; blitz: number | null; n: number }>();
  for (const h of hist) {
    const day = localDay(h.ts);
    const cur = perDay.get(day);
    perDay.set(day, { day, standard: Math.round(h.r), blitz: h.b === null ? null : Math.round(h.b), n: (cur?.n ?? 0) + 1 });
  }

  // χρόνοι λύσης (μόνο νίκες)
  const times = u.prep(`SELECT ms FROM attempt WHERE win = 1 AND ms > 0 AND ts >= ? AND mode IN (${modes})`).all(since) as Array<{ ms: number }>;
  const hBuckets = [...TIME_BUCKETS.map((s, i) => ({ from: i ? TIME_BUCKETS[i - 1] : 0, to: s, n: 0 })), { from: TIME_BUCKETS[TIME_BUCKETS.length - 1], to: null as number | null, n: 0 }];
  const sorted = times.map((t) => t.ms).sort((a, b) => a - b);
  for (const ms of sorted) {
    const s = ms / 1000;
    const k = TIME_BUCKETS.findIndex((b) => s < b);
    hBuckets[k < 0 ? hBuckets.length - 1 : k].n++;
  }

  // ημερολόγιο: τελευταίος χρόνος (για χάρτη θερμότητας)
  const cal = u.prep('SELECT ts, win FROM attempt WHERE ts >= ?').all(now - 365 * DAY) as Array<{ ts: number; win: number }>;
  const calendar = new Map<string, { day: string; attempts: number; wins: number }>();
  for (const c of cal) {
    const day = localDay(c.ts);
    const x = calendar.get(day) ?? { day, attempts: 0, wins: 0 };
    x.attempts++;
    x.wins += c.win;
    calendar.set(day, x);
  }

  const runs = Object.fromEntries(
    (u.prep('SELECT mode, max(score) AS best, count(*) AS n FROM run GROUP BY mode').all() as Array<{ mode: string; best: number; n: number }>).map((r) => [r.mode, { best: r.best, runs: r.n }]),
  );
  const totals = u.prep(`SELECT count(*) AS attempts, sum(win) AS wins, count(DISTINCT puzzle_id) AS puzzles FROM attempt WHERE mode IN (${modes})`).get() as { attempts: number; wins: number | null; puzzles: number };

  return {
    days,
    dayChoices: DAY_CHOICES,
    global,
    themes: themes.sort((a, b) => b.results.nb - a.results.nb),
    weakThemes: weak,
    strongThemes: strong,
    mostPlayed,
    byPhase: group(byPhase, true),
    byColor: group(byColor),
    byLength: group(byLength, true),
    byOpening: group(byOpening).slice(0, 20),
    ratings: svc.ratings(),
    ratingHistory: [...perDay.values()],
    firstTryPercent: global.firstWinPercent,
    solveTime: { buckets: hBuckets, median: sorted.length ? sorted[sorted.length >> 1] : null, count: sorted.length },
    calendar: [...calendar.values()],
    runs,
    runModes: RUN_MODES,
    totals: { attempts: totals.attempts, wins: totals.wins ?? 0, puzzles: totals.puzzles },
  };
}

/** Επίδοση ανά θέμα για τη λίστα θεμάτων (χρώμα «αδύναμο/δυνατό»). */
export function themePerformance(svc: TacticsService, days: number): Map<string, { results: Results; verdict: 'weak' | 'strong' | null }> {
  const d = dashboard(svc, days) as { themes: Array<{ key: string; results: Results }>; weakThemes: Array<{ key: string }>; strongThemes: Array<{ key: string }> };
  const weak = new Set(d.weakThemes.map((x) => x.key));
  const strong = new Set(d.strongThemes.map((x) => x.key));
  return new Map(d.themes.map((x) => [x.key, { results: x.results, verdict: weak.has(x.key) ? 'weak' : strong.has(x.key) ? 'strong' : null }]));
}
