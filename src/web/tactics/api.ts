/** Κλήσεις και τύποι του /api/tactics/* για τον εκπαιδευτή τακτικής (το συμβόλαιο ορίζει το src/server/tactics/index.ts). */
import { api } from '../api.ts';

export type Color = 'white' | 'black';

export interface ThemeName {
  key: string;
  el: string;
  en: string;
}

/** Puzzle όπως το δίνει ο server (format.ts: puzzleJson). */
export interface Puzzle {
  id: string;
  source: string;
  sourceName: { el: string; en: string };
  /** θέση πριν από την πρώτη κίνηση της γραμμής */
  fen: string;
  /** όλη η γραμμή σε UCI· με `pre` η πρώτη είναι του αντιπάλου */
  moves: string[];
  pre: boolean;
  /** χρώμα του λύτη */
  color: Color;
  solverMoves: number;
  rating: number;
  rd: number | null;
  popularity: number | null;
  plays: number | null;
  approximate: boolean;
  themes: ThemeName[];
  opening: { id: number; family: string; variation: string | null; tags: string } | null;
  gameUrl: string | null;
  ply: number | null;
  mate: boolean;
  kind: 'solve' | 'test' | 'practice';
  /** στόχος από τα δεδομένα: τεστ (bm, am, βαθμοί ανά κίνηση) ή παιχνίδι με τη μηχανή (αποτέλεσμα) */
  goal?: { kind: string; result?: 'win' | 'draw'; bm?: string[]; am?: string[]; points?: Record<string, number> } | null;
  /** ό,τι λέει η πηγή: ετικέτα, λύση με υποβαριάντες, θέμα του STS, σχόλιο */
  meta?: Record<string, unknown> | null;
}

/** Μια θέση στη λίστα μιας συλλογής. */
export interface CollectionItem {
  index: number;
  id: string;
  /** αύξων αριθμός μέσα στη συλλογή */
  seq: number;
  /** παίκτες και τουρνουά, ετικέτα ή κωδικός τεστ (στα μαθήματα ο τίτλος τους) */
  title: string;
  /** ο τίτλος στα αγγλικά (μαθήματα) */
  titleEn?: string;
  rating: number;
  /** λύθηκε, λάθος ή όχι ακόμη */
  status: 'win' | 'loss' | null;
  /** μόνο στα μαθήματα της εφαρμογής: η θέση, ο στόχος και το επίπεδο */
  fen?: string;
  goal?: 'win' | 'draw';
  part?: string;
  partEn?: string;
}

/** Μια συλλογή μόνη της: ενότητες (αρχεία ή θέματα), πρόοδος και μια σελίδα θέσεων. */
export interface CollectionInfo {
  key: string;
  name: { el: string; en: string };
  about: { el: string; en: string };
  section: 'tactics' | 'endgame' | 'strategy';
  mode: 'solve' | 'practice' | 'test';
  solution: 'lines' | 'best' | 'none';
  /** ενότητες (name: όπως στα δεδομένα, en: το αγγλικό όνομα όπου υπάρχει) */
  parts: Array<{ name: string; en?: string; n: number }>;
  file: string;
  total: number;
  offset: number;
  progress: { tried: number; solved: number };
  items: CollectionItem[];
}

/** Μία γραμμή της μηχανής (αξιολόγηση από τη σκοπιά των λευκών). */
export interface EngineLine {
  uci: string[];
  san: string[];
  cp: number | null;
  mate: number | null;
  depth: number;
}

/** Μικρή μορφή των γρήγορων τρόπων (compactJson). */
export interface CompactPuzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  color: Color;
  themes: string[];
}

export interface RatingState {
  mode: 'standard' | 'blitz';
  rating: number;
  deviation: number;
  volatility: number;
  n: number;
  updated: number | null;
  provisional: boolean;
}

export interface Ratings {
  standard: RatingState;
  blitz: RatingState;
}

export interface RatingChange {
  before: number;
  after: number;
  delta: number;
  rd: number;
  provisional: boolean;
}

export interface AttemptResult {
  firstTry: boolean;
  attemptId: number;
  rating?: { standard: RatingChange; blitz: RatingChange & { score: number; t0: number }; weight: string };
  addedToFailed?: boolean;
  card?: { deck: number; grade: number; due: number; state: string; scheduledDays: number };
  cycle?: { cycle: number; solved: number; total: number; finished: boolean };
  median: number | null;
  ratings: Ratings;
}

export interface AttemptInput {
  id: string;
  mode: string;
  win: boolean;
  ms: number;
  hints?: number;
  wrong?: string | null;
  angle?: string[];
  deck?: number;
  cycle?: number;
}

export interface Hint {
  level: 1 | 2 | 3;
  piece: { letter: string; el: string; en: string };
  from: string;
  to?: string;
  uci?: string;
  san?: string;
}

export interface Refutation {
  played: string;
  expected: string | null;
  expectedSan: string | null;
  fen: string;
  engine: boolean;
  reply?: string | null;
  replySan?: string | null;
  line?: string[];
  lineUci?: string[];
  cp?: number | null;
  mate?: number | null;
  depth?: number | null;
  error?: string;
}

export interface Results {
  nb: number;
  firstWins: number;
  fixed: number;
  unfixed: number;
  failed: number;
  puzzleRatingAvg: number;
  performance: number;
  firstWinPercent: number;
  clear: boolean;
}

export interface ThemeResult extends ThemeName {
  results: Results;
  replay: string[];
}

export interface Dashboard {
  days: number;
  dayChoices: number[];
  global: Results;
  themes: ThemeResult[];
  weakThemes: ThemeResult[];
  strongThemes: ThemeResult[];
  mostPlayed: ThemeResult[];
  byPhase: Array<ThemeName & { results: Results }>;
  byColor: Array<{ key: string; results: Results }>;
  byLength: Array<ThemeName & { results: Results }>;
  byOpening: Array<{ key: string; results: Results }>;
  ratings: Ratings;
  ratingHistory: Array<{ day: string; standard: number; blitz: number | null; n: number }>;
  firstTryPercent: number;
  solveTime: { buckets: Array<{ from: number; to: number | null; n: number }>; median: number | null; count: number };
  calendar: Array<{ day: string; attempts: number; wins: number }>;
  runs: Record<string, { best: number; runs: number }>;
  totals: { attempts: number; wins: number; puzzles: number };
}

export interface ThemeDef {
  key: string;
  bit: number | null;
  group: string;
  cat: string;
  el: string;
  en: string;
  descEl: string;
  descEn: string;
  count: number | null;
  performance: Results | null;
  verdict: 'weak' | 'strong' | null;
}

export interface ThemesInfo {
  groups: Record<string, { el: string; en: string }>;
  categories: Record<string, { el: string; en: string }>;
  difficulties: Record<string, { delta: number; el: string; en: string }>;
  themes: ThemeDef[];
}

export interface OpeningFamily {
  family: string;
  count: number;
  variations: Array<{ id: number; name: string; tags: string; count: number }>;
}

export interface TacticsJob {
  id: string;
  source: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  phase: string;
  message?: string;
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
  imported: number;
  rejected: number;
  filtered: number;
  started: number;
  finished?: number;
  error?: string;
}

export interface QualityPreset {
  minPopularity: number;
  minPlays: number;
  maxRd: number;
  count: number;
  mb: number;
  el: string;
  en: string;
}

export interface SourceInfo {
  key: string;
  kind: string;
  /** ομάδα για το «όλα» (lichess, lucas, epd, mine) */
  group: string;
  /** σελίδα της «Βελτίωσης» και υποομάδα μέσα της */
  section: 'tactics' | 'endgame' | 'strategy';
  cat: string;
  /** τι ακριβώς περιέχει */
  about: { el: string; en: string };
  /** τι λύση δίνει η ίδια η πηγή: πλήρεις γραμμές, μόνο την καλύτερη κίνηση, ή καμία (μόνο θέσεις) */
  solution: 'lines' | 'best' | 'none';
  name: { el: string; en: string };
  license: string;
  url: string;
  /** μεγάλη συλλογή: δεν μπαίνει με το «όλες οι συλλογές» */
  optional: boolean;
  /** λύση με κινήσεις, τεστ (μία κίνηση) ή εξάσκηση */
  mode: 'solve' | 'practice' | 'test';
  /** περίπου πόσες θέσεις (πριν από την εισαγωγή) */
  approx: number;
  count: number;
  /** μέγεθος στη βάση (εκτίμηση) */
  bytes: number;
  state: 'none' | 'imported' | 'interrupted' | 'queued' | 'running';
  job: TacticsJob | null;
  interrupted: unknown;
  importedAt: number | null;
  info: { quality?: string } | null;
}

export interface SourcesInfo {
  dir: string;
  sources: SourceInfo[];
  totals: { puzzles: number; dbBytes: number; userDbBytes: number; freeBytes: number; minFreeBytes: number };
  qualityPresets: Record<string, QualityPreset>;
  jobs: TacticsJob[];
}

export interface Deck {
  id: number;
  name: string;
  kind: 'failed' | 'custom' | 'mine' | 'woodpecker' | 'mistakes';
  cards: number;
  due: number;
  new: number;
  learning: number;
  review: number;
}

export interface DueInfo {
  now: number;
  total: number;
  tomorrow: number;
  byDeck: Array<{ deck: number; name: string; due: number }>;
}

export interface Cycle {
  id: number;
  n: number;
  started: number;
  finished: number | null;
  target_days: number;
  solved: number;
  correct: number;
  total_ms: number;
  days: number;
  accuracy: number | null;
  avgMs: number | null;
  deadline: number;
  onTime: boolean | null;
}

export interface WoodpeckerSet {
  id: number;
  name: string;
  params: { size: number; min: number; max: number; themes: string[]; targetDays: number; color: Color | null };
  created: number;
  total: number;
  cycles: Cycle[];
  current: { id: number; n: number; solved: number; total: number; finished: number | null; next: string | null } | null;
  recommendation: { nextTargetDays: number; restUntil: number | null; complete: boolean };
}

export interface RunRow {
  id: number;
  mode: string;
  ts: number;
  score: number;
  best_combo: number | null;
  errors: number | null;
  ms: number | null;
}

export interface RunStats {
  best: RunRow | null;
  recent: RunRow[];
  count: number;
  average: number | null;
  todayBest: number | null;
}

export interface RunSet {
  mode: 'storm' | 'streak' | 'rush';
  color?: Color;
  variant?: string;
  config: { timeSeconds: number | null; penaltySeconds?: number; combo?: Array<[number, number]>; firstMoveDelayMs?: number; strikes?: number; skips?: number };
  puzzles: CompactPuzzle[];
  stats: RunStats;
}

export interface HistoryItem {
  id: number;
  puzzle: string;
  ts: number;
  mode: string;
  win: boolean;
  firstTry: boolean;
  p_rating: number;
  ms: number;
}

/** Φίλτρα επιλογής του βαθμολογημένου τρόπου (ρυθμίσεις: `ui.tactics`). */
export interface PickFilters {
  difficulty: string;
  themes: string[];
  match: 'any' | 'all';
  opening: string;
  color: '' | Color;
  /** πηγή puzzles ('' = του Lichess)· π.χ. lucas-gm-mates, polgar, epd-wac */
  source: string;
}

export const NO_FILTERS: PickFilters = { difficulty: 'standard', themes: [], match: 'any', opening: '', color: '', source: '' };

const qs = (o: Record<string, string | number | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const tacticsApi = {
  sources: () => api.get<SourcesInfo>('/api/tactics/sources'),
  importLichess: (quality: string) => api.post<{ job: TacticsJob }>('/api/tactics/import', { source: 'lichess', quality }),
  /** μια συλλογή (κλειδί) ή ομάδα («lucas», «epd»…, «extras» = όλες χωρίς τις μεγάλες) */
  importCollection: (source: string) => api.post<{ job: TacticsJob }>('/api/tactics/import', { source }),
  collection: (key: string, file = '', offset = 0, limit = 100) => api.get<CollectionInfo>(`/api/tactics/collection/${encodeURIComponent(key)}${qs({ file: file || undefined, offset, limit })}`),
  collectionAt: (key: string, i: number, file = '') => api.get<{ total: number; index: number; puzzle: Puzzle | null }>(`/api/tactics/collection/${encodeURIComponent(key)}/at${qs({ i, file: file || undefined })}`),
  engine: (fen: string, multipv = 1, movetime = 800) => api.post<{ engine: boolean; lines: EngineLine[] }>('/api/tactics/engine', { fen, multipv, movetime }),
  cancelJob: (id: string) => api.post<{ job: TacticsJob }>(`/api/tactics/import/${id}/cancel`),
  ratings: () => api.get<Ratings>('/api/tactics/rating'),
  themes: () => api.get<ThemesInfo>('/api/tactics/themes'),
  openings: (q: string) => api.get<{ families: OpeningFamily[] }>(`/api/tactics/openings${qs({ q })}`),
  nextRated: (f: PickFilters, exclude: string[]) =>
    api.get<{ puzzle: Puzzle | null; compromise: number | null; window: [number, number] | null }>(
      `/api/tactics/next${qs({ mode: 'rated', diff: f.difficulty, themes: f.themes.join(','), match: f.themes.length > 1 ? f.match : undefined, opening: f.opening, color: f.color, source: f.source, exclude: exclude.slice(-200).join(',') })}`,
    ),
  nextReview: (deck?: number) => api.get<{ puzzle: Puzzle | null; deck: number | null; due: number | null; remaining: number }>(`/api/tactics/next${qs({ mode: 'review', deck })}`),
  nextWoodpecker: (deck: number) => api.get<{ puzzle: Puzzle | null; deck: number; cycle: number; finished: boolean }>(`/api/tactics/next${qs({ mode: 'woodpecker', deck })}`),
  nextReplay: (theme: string, exclude: string[]) => api.get<{ puzzle: Puzzle | null; remaining: number }>(`/api/tactics/next${qs({ mode: 'replay', theme, exclude: exclude.join(',') })}`),
  puzzle: (id: string) => api.get<{ puzzle: Puzzle }>(`/api/tactics/puzzle/${encodeURIComponent(id)}`),
  daily: () => api.get<{ day: string; puzzle: Puzzle | null; origin: string | null; solved: boolean }>('/api/tactics/daily'),
  hint: (id: string, ply: number, level: number) => api.get<Hint>(`/api/tactics/hint${qs({ id, ply, level })}`),
  refute: (id: string, ply: number, uci: string) => api.post<Refutation>('/api/tactics/refute', { id, ply, uci, movetime: 900 }),
  attempt: (a: AttemptInput) => api.post<AttemptResult>('/api/tactics/attempt', a),
  flag: (id: string, bad: boolean) => api.post<{ id: string; bad: boolean }>(`/api/tactics/puzzle/${encodeURIComponent(id)}/flag`, { bad }),
  dashboard: (days: number) => api.get<Dashboard>(`/api/tactics/dashboard${qs({ days })}`),
  history: (failed: boolean, limit = 30) => api.get<{ total: number; items: HistoryItem[] }>(`/api/tactics/history${qs({ failed: failed ? 1 : undefined, limit })}`),
  decks: () => api.get<{ decks: Deck[] }>('/api/tactics/decks'),
  due: () => api.get<DueInfo>('/api/tactics/review/due?limit=1'),
  woodpeckers: () => api.get<{ sets: WoodpeckerSet[] }>('/api/tactics/woodpecker'),
  woodpecker: (id: number) => api.get<WoodpeckerSet>(`/api/tactics/woodpecker/${id}`),
  createWoodpecker: (o: { name?: string; size: number; min: number; max: number; themes: string[]; targetDays: number }) => api.post<WoodpeckerSet>('/api/tactics/woodpecker', o),
  newCycle: (id: number, targetDays?: number) => api.post<WoodpeckerSet>(`/api/tactics/woodpecker/${id}/cycle`, { targetDays }),
  run: (mode: 'storm' | 'streak' | 'rush', variant?: string) => api.get<RunSet>(`/api/tactics/run/${mode}${qs({ variant })}`),
  saveRun: (o: { mode: string; variant?: string; score: number; bestCombo?: number; errors?: number; topRating?: number; ms?: number; puzzles: Array<{ id: string; win: boolean; ms?: number }> }) =>
    api.post<RunStats & { id: number; failed: string[] }>('/api/tactics/run', o),
  themeNames: () => api.get<ThemeName[]>('/api/tactics/theme-names'),
};
