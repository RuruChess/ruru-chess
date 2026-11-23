/** Επικοινωνία με τον τοπικό server του Ruru. */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `Σφάλμα ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => call<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => call<T>('POST', url, body),
  put: <T>(url: string, body: unknown = {}) => call<T>('PUT', url, body),
  del: <T>(url: string) => call<T>('DELETE', url),
};

// ---------------------------------------------------------------------------
// Γεγονότα από τον server (SSE)

type Listener = (data: any) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;
/** Ταυτότητα αυτού του παραθύρου (ο server καταλαβαίνει πότε κλείνει, π.χ. οι Ρυθμίσεις). */
export const WINDOW_ID = Math.random().toString(36).slice(2, 10);

/** Η έκδοση του server όταν συνδεθήκαμε: αν μετά από επανασύνδεση είναι άλλη (ενημέρωση), ξαναφόρτωση της σελίδας. */
let serverVersion: string | null = null;

function ensureSource(): void {
  if (source) return;
  source = new EventSource(`/api/events?win=${WINDOW_ID}`);
  source.addEventListener('open', () => {
    for (const l of openListeners) l();
    void fetch('/api/version')
      .then((r) => r.json() as Promise<{ version?: string }>)
      .then((v) => {
        if (serverVersion && v.version && v.version !== serverVersion) location.reload();
        serverVersion = v.version ?? serverVersion;
      })
      .catch(() => {});
  });
  for (const type of listeners.keys()) attach(type);
}

const attached = new Set<string>();
function attach(type: string): void {
  if (!source || attached.has(type)) return;
  attached.add(type);
  source.addEventListener(type, (ev) => {
    const data = JSON.parse((ev as MessageEvent).data);
    for (const l of listeners.get(type) ?? []) l(data);
  });
}

const openListeners = new Set<() => void>();
/** Κάθε φορά που ανοίγει (ή ξανανοίγει) η σύνδεση SSE: ό,τι στάλθηκε πριν από αυτήν χάθηκε. */
export function onServerOpen(fn: () => void): () => void {
  openListeners.add(fn);
  ensureSource();
  return () => openListeners.delete(fn);
}

export function onServerEvent(type: string, fn: Listener): () => void {
  let set = listeners.get(type);
  if (!set) listeners.set(type, (set = new Set()));
  set.add(fn);
  ensureSource();
  attach(type);
  return () => set!.delete(fn);
}

// ---------------------------------------------------------------------------
// Τύποι απαντήσεων

export interface DbInfo {
  id: string;
  name: string;
  file: string;
  kind: 'user' | 'clipboard' | 'mygames' | 'imported';
  source?: { path: string; size: number; mtime: number; kind: string };
  games: number;
  size: number;
  busy: JobInfo | null;
  indexStale: boolean;
  /** μορφή του αρχείου: 1 = ως την 2.2.0 (μετατρέπεται με κουμπί), 2 = λεξικό ετικετών, 0 = άγνωστη */
  format?: number;
  created: number;
  lastOpened?: number;
  /** από το «Βιβλίο σε βάση» */
  origin?: 'book';
}

export interface JobInfo {
  id: string;
  dbId: string;
  kind: 'import' | 'index' | 'edit' | 'convert';
  title: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  error?: string;
  progress: { phase: string; games: number; bytes: number; totalBytes: number; errors: number; skipped: number; message?: string; existing?: { done: number; total: number } };
}

export interface GameRow {
  id: number;
  white: string;
  black: string;
  welo: number;
  belo: number;
  event: string;
  site: string;
  date: number;
  round: string;
  result: number;
  eco: string;
  plies: number;
  annotator: string;
  flags: number;
}

export interface SearchCriteria {
  white?: string;
  black?: string;
  player?: string;
  ignoreColors?: boolean;
  event?: string;
  site?: string;
  annotator?: string;
  yearFrom?: number;
  yearTo?: number;
  eloFrom?: number;
  eloTo?: number;
  eloBoth?: boolean;
  ecoFrom?: string;
  ecoTo?: string;
  results?: number[];
  minPlies?: number;
  maxPlies?: number;
  annotated?: boolean;
  deleted?: boolean;
  ids?: number[];
  commentText?: string;
  /** μετάλλια (μάσκα): αρκεί ένα */
  medals?: number;
  /** υλικό κάποια στιγμή στην παρτίδα, π.χ. «KRP-KR» */
  material?: string;
  materialAnyColor?: boolean;
  /** ελιγμός ενός κομματιού, π.χ. «Nd2 Nf1 Ng3» */
  maneuver?: string;
  maneuverSide?: number;
  /** δομή πιονιών κάποια στιγμή στην παρτίδα, από FEN */
  pawns?: string;
  /** exact (προεπιλογή) · white · black · files */
  pawnsMode?: 'exact' | 'white' | 'black' | 'files';
  /** ρυθμός (μάσκα): κλασικό 1, rapid 2, blitz 4, αλληλογραφία 8· αρκεί ένας */
  speeds?: number;
}

export interface ViewSpec {
  filter?: SearchCriteria;
  fen?: string;
  sort?: { col: string; desc: boolean };
  /** θέση πέρα από το βάθος του ευρετηρίου: σάρωση όλων των παρτίδων */
  deep?: boolean;
}

export interface TreeMoveInfo {
  san: string;
  uci: string;
  games: number;
  w: number;
  d: number;
  l: number;
  score: number;
  elo: number;
  perf: number;
  year: number;
}

export interface EngineConfig {
  id: string;
  name: string;
  path: string;
  options: Record<string, string | number | boolean>;
  args?: string[];
  /** «ανθρώπινη» μηχανή (Maia): δεν είναι για ανάλυση */
  human?: { elo: number };
  /** η Leela (Lc0) */
  leela?: boolean;
}

export interface PvLine {
  multipv: number;
  depth: number;
  seldepth: number;
  cp: number | null;
  mate: number | null;
  bound: string;
  nodes: number;
  nps: number;
  time: number;
  uci: string[];
  san: string[];
}

export interface AnalysisEvent {
  session: string;
  engine: string;
  fen: string;
  lines: PvLine[];
  depth: number;
  nodes: number;
  nps: number;
  hashfull: number;
  done: boolean;
}

export interface Settings {
  language: 'el' | 'en';
  databasesDir: string;
  engines: EngineConfig[];
  defaultEngine: string | null;
  boardTheme: string;
  pieceSet: string;
  showCoordinates: boolean;
  animationMs: number;
  onlineLookups: boolean;
  /** Watch Live και κατάσταση φίλων από το Lichess */
  watchLive?: boolean;
  /** «Οι παρτίδες μου» αυτόματα από Lichess / Chess.com (null: κλειστό) */
  myGames?: { lichess?: string; chesscom?: string } | null;
  /** έλεγχος για νέα έκδοση στην εκκίνηση (προεπιλογή: ναι) */
  updateCheck?: boolean;
  bookPath?: string;
  ui?: Record<string, unknown>;
}

/** `/api/version`: έκδοση και σύνδεσμοι του έργου (null όσοι δεν έχουν οριστεί στο package.json). */
export interface AppInfo {
  name: string;
  version: string;
  node: string;
  links: { site: string | null; support: string | null; repo: string | null; releases: string | null };
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  url: string | null;
  checkedAt: number;
}

/** Ανοίγει τον διάλογο αρχείων των Windows. */
export async function pickFiles(kind: 'open' | 'save' | 'savebook' | 'savedb' | 'exe' | 'book', opts: { initialDir?: string; name?: string } = {}): Promise<string[]> {
  const r = await api.post<{ paths: string[] }>(`/api/dialog/${kind}`, opts);
  return r.paths;
}
