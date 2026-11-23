/**
 * «Οι παρτίδες μου» από Lichess και Chess.com (ρύθμιση `myGames`, μόνο αν την ανοίξει ο χρήστης): κάθε 10′ οι νέες
 * τελειωμένες παρτίδες του μπαίνουν στη βάση «Οι παρτίδες μου». Την πρώτη φορά (ή με νέο username) όσες έπαιξε τις
 * τελευταίες 24 ώρες· μετά μόνο οι καινούργιες. Πού έμεινε ο συγχρονισμός: APP_DIR/mygames.json.
 * Μόνο κλασικό σκάκι (όχι Chess960, παραλλαγές ή παρτίδες από θέση).
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanSiteUser } from '../core/social.ts';
import type { Router } from './http.ts';
import type { Library } from './library.ts';
import { APP_DIR } from './paths.ts';
import { chesscomJson, codeOf, lichessNdjson } from './watch.ts';

const STATE_FILE = path.join(APP_DIR, 'mygames.json');
const EVERY = 10 * 60_000;
/** την πρώτη φορά: οι παρτίδες των τελευταίων 24 ωρών */
const FIRST = 24 * 3600_000;
const SOURCES = ['lichess', 'chesscom'] as const;
type SourceName = (typeof SOURCES)[number];

export interface MyGames {
  lichess?: string;
  chesscom?: string;
}

interface Source {
  user: string;
  /** Lichess: createdAt της τελευταίας παρτίδας· Chess.com: end_time (ms) */
  last: number;
}

interface State {
  lichess?: Source;
  chesscom?: Source;
  /** τελευταίος έλεγχος, πόσες μπήκαν τότε, σφάλμα */
  at?: number;
  added?: number;
  total?: number;
  error?: string | null;
}

/** Η ρύθμιση, καθαρή (null: κλειστή). */
export function myGamesOf(v: unknown): MyGames | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const li = cleanSiteUser(o.lichess);
  const cc = cleanSiteUser(o.chesscom);
  return li || cc ? { ...(li ? { lichess: li } : {}), ...(cc ? { chesscom: cc } : {}) } : null;
}

function readState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State;
  } catch {
    return {};
  }
}

function writeState(s: State): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(s));
  } catch {
    /* θα ξαναδοκιμάσει στον επόμενο έλεγχο (με κίνδυνο διπλών μόνο αν χαθεί και το αρχείο) */
  }
}

/** Lichess: οι παρτίδες από το `since` (createdAt), μόνο κλασικές ταχύτητες, με ρολόγια και άνοιγμα. */
async function fromLichess(user: string, since: number): Promise<{ pgn: string[]; last: number }> {
  const q = new URLSearchParams({
    since: String(since + 1),
    max: '300',
    pgnInJson: 'true',
    clocks: 'true',
    opening: 'true',
    sort: 'dateAsc',
    perfType: 'ultraBullet,bullet,blitz,rapid,classical,correspondence',
  });
  const text = await lichessNdjson(`/api/games/user/${encodeURIComponent(user)}?${q}`);
  const pgn: string[] = [];
  let last = since;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const g = JSON.parse(line) as { createdAt?: number; variant?: string; pgn?: string };
      if (typeof g.createdAt === 'number') last = Math.max(last, g.createdAt);
      if (g.variant === 'standard' && typeof g.pgn === 'string' && g.pgn.trim()) pgn.push(g.pgn.trim());
    } catch {
      /* μισή γραμμή */
    }
  }
  return { pgn, last };
}

/** Chess.com: από τα αρχεία του μήνα (και του προηγούμενου, αν χρειάζεται), όσες τελείωσαν μετά το `since`. */
async function fromChesscom(user: string, since: number): Promise<{ pgn: string[]; last: number }> {
  const now = new Date();
  const months: string[] = [];
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  if (since < monthStart) {
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    months.push(`${prev.getUTCFullYear()}/${String(prev.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  months.push(`${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`);
  const pgn: string[] = [];
  let last = since;
  for (const m of months) {
    const d = await chesscomJson<{ games?: Array<{ end_time?: number; rules?: string; pgn?: string }> }>(`/player/${user.toLowerCase()}/games/${m}`);
    const games = (d?.games ?? []).filter((g) => Number(g.end_time) * 1000 > since).sort((a, b) => Number(a.end_time) - Number(b.end_time));
    for (const g of games) {
      last = Math.max(last, Number(g.end_time) * 1000);
      if (g.rules === 'chess' && typeof g.pgn === 'string' && g.pgn.trim()) pgn.push(g.pgn.trim());
    }
  }
  return { pgn, last };
}

export function registerMyGames(r: Router, lib: Library): void {
  let running: Promise<number> | null = null;
  let lastCfg = '';

  const status = () => {
    const s = readState();
    return { on: Boolean(myGamesOf(lib.settings.myGames)), at: s.at ?? null, added: s.added ?? 0, total: s.total ?? 0, error: s.error ?? null };
  };

  const sync = async (): Promise<number> => {
    const cfg = myGamesOf(lib.settings.myGames);
    const target = lib.entries.find((e) => e.kind === 'mygames');
    if (!cfg || !target || !lib.addPgn) return 0;
    const st = readState();
    let added = 0;
    let error: string | null = null;
    for (const src of SOURCES) {
      const user = cfg[src as SourceName];
      if (!user) continue;
      const old = st[src];
      const cur: Source = old && old.user.toLowerCase() === user.toLowerCase() ? old : { user, last: Date.now() - FIRST };
      try {
        const got = src === 'lichess' ? await fromLichess(user, cur.last) : await fromChesscom(user, cur.last);
        if (got.pgn.length) added += lib.addPgn(target.id, got.pgn.join('\n\n'));
        st[src] = { user, last: got.last };
      } catch (e) {
        error = `${src}:${codeOf(e)}`;
        st[src] = cur;
      }
    }
    st.at = Date.now();
    st.added = added;
    st.total = (st.total ?? 0) + added;
    st.error = error;
    writeState(st);
    if (added) r.broadcast('mygames', { added, name: target.name, dbId: target.id });
    r.broadcast('mygamesStatus', status());
    return added;
  };

  /** ένας συγχρονισμός τη φορά */
  const run = (): Promise<number> => {
    running ??= sync().finally(() => (running = null));
    return running;
  };

  // κάθε 10′, και αμέσως μόλις αλλάξει η ρύθμιση (έλεγχος κάθε 15″, χωρίς δίκτυο)
  let lastRun = 0;
  setInterval(() => {
    const cfg = JSON.stringify(myGamesOf(lib.settings.myGames));
    const changed = cfg !== lastCfg;
    lastCfg = cfg;
    if (cfg === 'null') return;
    if (changed || Date.now() - lastRun >= EVERY) {
      lastRun = Date.now();
      void run().catch(() => {});
    }
  }, 15_000).unref();

  r.get('/api/mygames', () => status());
  r.post('/api/mygames/sync', async () => {
    lastRun = Date.now();
    const added = await run();
    return { ...status(), added };
  });
}
