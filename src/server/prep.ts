/**
 * «Προετοιμασία για αντίπαλο» (μόνιμη καρτέλα δίπλα στο Watch Live): οι παρτίδες ενός παίκτη από τρεις πηγές (FIDE / OTB,
 * Lichess, Chess.com) μπαίνουν σε μία βάση «Αντίπαλος - <όνομα>», με ενιαίο όνομα παίκτη (ώστε ο φάκελος του παίκτη και
 * η αναζήτηση να τον βρίσκουν μία φορά). Μετά, αναφορά: σκορ ανά χρώμα και ρυθμό, Elo, δέντρο ρεπερτορίου με λευκά /
 * μαύρα (από τη δική του μεριά), πρόσφατες παρτίδες.
 * - OTB: από όλες τις τοπικές βάσεις μαζί, χωρίς επιλογή βάσεων (prepPlayers.ts). Online πηγή με τις OTB παρτίδες ενός
 *   παίκτη δεν υπάρχει: η FIDE δεν δημοσιεύει παρτίδες και η σελίδα του Lichess με τα τουρνουά ενός παίκτη FIDE δεν
 *   έχει API (και είναι πίσω από έλεγχο Cloudflare). Το Lichess δίνει μόνο ποιος είναι ένα FIDE ID.
 * - Τα φίλτρα (περίοδος, συνολικό όριο, χρώμα, ρυθμοί, rated) είναι κοινά και για τις τρεις πηγές. Οι πηγές διαβάζονται
 *   παράλληλα (κάθε site με ένα αίτημα τη φορά), βγαίνουν οι διπλές, το όριο μοιράζεται και γράφονται από τη νεότερη.
 * - Διακοπή ή σφάλμα: μένει ό,τι κατέβηκε, και το σημείο «ως εδώ» μιας πηγής προχωρά μόνο όταν τελειώσει (αλλιώς η
 *   «Ενημέρωση» θα πηδούσε τις παλιότερες που δεν πρόλαβαν).
 * - Ενημέρωση: μόνο οι καινούργιες (Lichess από createdAt, Chess.com από end_time, τοπικά όσα id δεν είχαν βρεθεί).
 * - Ο κατάλογος των προετοιμασιών: APP_DIR/prep.json. Πρόοδος στα παράθυρα με SSE `prep`.
 * - Μόνο κλασικό σκάκι (όχι Chess960, παραλλαγές ή παρτίδες από θέση).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Position, START_FEN } from '../core/chess.ts';
import { decodeGame, encodeGame, replayMainline, tokenToMove } from '../core/codec.ts';
import { parseGames, writeGame } from '../core/pgn.ts';
import {
  GameSet,
  PREP_DEFAULTS,
  PREP_PICK_SPEEDS,
  PREP_SOURCES,
  PREP_SPEEDS,
  addLine,
  cleanPlayerName,
  inPeriod,
  newRoot,
  periodStart,
  prepSource,
  pruneTree,
  renameInPgn,
  sameName,
  shareLimit,
  siteGameKey,
  type FidePlayer,
  type GameId,
  type OtbSuggestion,
  type PrepInfo,
  type PrepNode,
  type PrepOpts,
  type PrepOtb,
  type PrepProgress,
  type PrepSource,
  type PrepSourceProgress,
  type PrepSpeed,
} from '../core/prep.ts';
import { cleanSiteUser } from '../core/social.ts';
import type { Router } from './http.ts';
import { HttpError, type Library } from './library.ts';
import { APP_DIR } from './paths.ts';
import { findOtb, gameSpeeds, mainMoves, otbDbs, searchPlayers } from './prepPlayers.ts';
import { formatPgnDate } from './text.ts';
import { chesscomJson, codeOf, lichessCached, lichessStream } from './watch.ts';

const STATE_FILE = path.join(APP_DIR, 'prep.json');
/** βάθος του δέντρου ρεπερτορίου (ημικινήσεις) */
const TREE_PLIES = 16;
/** όριο ανά site όταν ο χρήστης διαλέξει «όλες» (προστασία από λογαριασμούς με εκατοντάδες χιλιάδες παρτίδες) */
const HARD_MAX = 20_000;
/** το Lichess δεν δέχεται παλιότερο `since` */
const LICHESS_EPOCH = 1356998400070;

/** Η προετοιμασία όπως αποθηκεύεται. */
interface Prep extends PrepInfo {
  /** παλιά μορφή (μία βάση, ένα όνομα): γίνεται `locals` */
  local?: { dbId: string; player: string };
  /** Lichess: createdAt της πιο πρόσφατης παρτίδας· Chess.com: end_time (ms) */
  li?: number;
  cc?: number;
  /** η πρώτη λήψη ολοκληρώθηκε σε όλες τις πηγές */
  done?: boolean;
  /** τοπικά: ανά βάση-πηγή, τα id που βρέθηκαν ήδη (μπήκαν, ήταν διπλές ή εκτός φίλτρων) */
  localSeen?: Record<string, number[]>;
  /** παλιά μορφή: τα id της μίας βάσης */
  localIds?: number[];
}

const trimFide = (x: any): FidePlayer | null =>
  x && Number.isInteger(x.id) && typeof x.name === 'string'
    ? {
        id: x.id,
        name: cleanPlayerName(x.name),
        federation: String(x.federation ?? ''),
        year: Number.isInteger(x.year) ? x.year : null,
        title: typeof x.title === 'string' ? x.title : null,
        ...(x.standard ? { standard: Number(x.standard) } : {}),
        ...(x.rapid ? { rapid: Number(x.rapid) } : {}),
        ...(x.blitz ? { blitz: Number(x.blitz) } : {}),
      }
    : null;

/** Παλιές προετοιμασίες στη νέα μορφή: μία τοπική βάση με ένα όνομα, φίλτρα χωρίς χρώμα. */
function upgrade(p: Prep): Prep {
  const opts: PrepOpts = { ...p.opts, color: p.opts.color ?? 'both' };
  if (!p.local || p.locals) return { ...p, opts };
  const { local, localIds, ...rest } = p;
  return { ...rest, opts, locals: [{ dbId: local.dbId, players: [local.player] }], localSeen: { [local.dbId]: localIds ?? [] } };
}

function readAll(): Prep[] {
  try {
    const v = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Prep[];
    return Array.isArray(v) ? v.map(upgrade) : [];
  } catch {
    return [];
  }
}

function writeAll(list: Prep[]): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(list));
  } catch {
    /* χωρίς αρχείο: η προετοιμασία μένει μόνο για αυτή την εκτέλεση */
  }
}

/** Ρυθμοί του Lichess (perfType) για τους δικούς μας. */
const LICHESS_PERF: Record<PrepSpeed, string> = { bullet: 'ultraBullet,bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', daily: 'correspondence' };
/** time_class του Chess.com. */
const CC_CLASS: Record<string, PrepSpeed> = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', daily: 'daily' };

function cleanOpts(v: unknown): PrepOpts {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const speeds = PREP_PICK_SPEEDS.filter((s) => Array.isArray(o.speeds) && o.speeds.includes(s));
  const num = (x: unknown, fallback: number, top: number) => (typeof x === 'number' && x >= 0 ? Math.min(top, Math.floor(x)) : fallback);
  const after = typeof o.after === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.after) && !Number.isNaN(Date.parse(o.after)) ? o.after : undefined;
  return {
    speeds: speeds.length ? speeds : PREP_DEFAULTS.speeds,
    months: after ? 0 : num(o.months, PREP_DEFAULTS.months, 240),
    ...(after ? { after } : {}),
    max: num(o.max, PREP_DEFAULTS.max, HARD_MAX),
    rated: o.rated !== false,
    color: o.color === 'white' || o.color === 'black' ? o.color : 'both',
  };
}

function cleanOtb(v: unknown): PrepOtb | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 120) : '';
  if (!name) return undefined;
  const id = Number(o.fideId);
  const extra = Array.isArray(o.extra) ? o.extra.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
  return { name, ...(Number.isSafeInteger(id) && id > 0 ? { fideId: id } : {}), ...(extra.length ? { extra } : {}) };
}

/** Παρτίδα έτοιμη να μπει στη βάση της προετοιμασίας. */
interface Candidate extends GameId {
  /** για την ταξινόμηση από τη νεότερη */
  time: number;
  pgn: () => string;
}

/** Ό,τι χρειάζεται μια πηγή όσο διαβάζει. */
interface Fetch {
  signal: AbortSignal;
  start: { day: number; ms: number };
  /** γεμίζει όσο διαβάζει, ώστε σε διακοπή να μένει ό,τι ήρθε */
  out: Candidate[];
  report: (found: number, month?: string) => void;
}

const dayOfMs = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};
const msOfDay = (day: number) => (day >= 10000 ? Date.UTC(Math.floor(day / 10000), Math.max(0, (Math.floor(day / 100) % 100) - 1), day % 100 || 1) : 0);

/** Παρτίδα site με το ενιαίο όνομα (null: χωρίς κινήσεις ή χαλασμένη). */
function onlineGame(raw: string, user: string, name: string, time: number): Candidate | null {
  const pgn = renameInPgn(raw.trim(), user, name);
  const game = parseGames(pgn)[0]?.game;
  if (!game) return null;
  const moves = mainMoves(encodeGame(game).tokens);
  if (!moves.length) return null;
  const h = game.headers;
  const color = h.WhiteAccount ? 'white' : 'black';
  const result = h.Result === '1-0' ? 1 : h.Result === '1/2-1/2' ? 2 : h.Result === '0-1' ? 3 : 0;
  return { color, opp: (color === 'white' ? h.Black : h.White) ?? '', date: dayOfMs(time), result, moves, key: siteGameKey(h), time, pgn: () => pgn };
}

/** Ένα αίτημα που δεν δέχεται signal: η «Διακοπή» δεν το περιμένει. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new Error('aborted'));
    if (signal.aborted) stop();
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

export function registerPrep(r: Router, lib: Library): void {
  const running = new Map<string, { ac: AbortController; progress: PrepProgress }>();
  const send = (p: PrepProgress) => r.broadcast('prep', p);

  /** Οι προετοιμασίες που η βάση τους υπάρχει ακόμη. */
  const list = (): Prep[] => readAll().filter((p) => lib.entries.some((e) => e.id === p.dbId));
  const save = (p: Prep) => {
    const all = readAll().filter((x) => x.id !== p.id);
    all.unshift(p);
    writeAll(all);
  };
  const find = (id: string): Prep => {
    const p = list().find((x) => x.id === id);
    if (!p) throw new HttpError(404, 'Η προετοιμασία δεν βρέθηκε (μήπως σβήστηκε η βάση της;)');
    return p;
  };

  /** Οι βάσεις όπου ψάχνει το FIDE / OTB (όχι οι βάσεις των προετοιμασιών). */
  const searchable = () => otbDbs(lib, new Set(readAll().map((p) => p.dbId)));

  /** Lichess: ροή ndjson με PGN, από την πιο πρόσφατη· χρώμα, ρυθμοί και rated φιλτράρονται από το ίδιο. */
  async function fromLichess(p: Prep, f: Fetch): Promise<number> {
    const o = p.opts;
    const since = Math.max(p.li ? p.li + 1 : 0, f.start.ms);
    const limit = o.max || HARD_MAX;
    const q = new URLSearchParams({
      max: String(limit),
      pgnInJson: 'true',
      clocks: 'true',
      opening: 'true',
      sort: 'dateDesc',
      perfType: o.speeds.map((s) => LICHESS_PERF[s]).join(','),
    });
    if (since) q.set('since', String(Math.max(LICHESS_EPOCH, Math.floor(since))));
    if (o.rated) q.set('rated', 'true');
    if (o.color !== 'both') q.set('color', o.color);
    let last = p.li ?? 0;
    // το Lichess δεν τηρεί πάντα το max (π.χ. 50 για max=30): το όριο κρατιέται κι εδώ
    await lichessStream(`/api/games/user/${encodeURIComponent(p.lichess!)}?${q}`, f.signal, (line) => {
      try {
        const g = JSON.parse(line) as { createdAt?: number; variant?: string; pgn?: string; initialFen?: string };
        if (typeof g.createdAt !== 'number') return;
        last = Math.max(last, g.createdAt);
        if (g.variant !== 'standard' || g.initialFen || typeof g.pgn !== 'string') return;
        const c = onlineGame(g.pgn, p.lichess!, p.name, g.createdAt);
        if (!c) return;
        f.out.push(c);
        f.report(f.out.length);
        if (f.out.length >= limit) return 'stop';
      } catch {
        /* μισή γραμμή ή χαλασμένη παρτίδα */
      }
    });
    return last;
  }

  /** Chess.com: τα αρχεία των μηνών ένα ένα, από τον πιο πρόσφατο, ως το όριο ή την περίοδο. */
  async function fromChesscom(p: Prep, f: Fetch): Promise<number> {
    const o = p.opts;
    const user = p.chesscom!.toLowerCase();
    const arch = await abortable(chesscomJson<{ archives?: string[] }>(`/player/${user}/games/archives`), f.signal);
    if (!arch) throw new HttpError(404, 'notfound');
    let last = p.cc ?? 0;
    // το Chess.com δεν έχει κατηγορία κλασικού
    if (!o.speeds.some((s) => s !== 'classical')) return last;
    const since = Math.max(p.cc ? p.cc + 1 : 0, f.start.ms);
    const months = (arch.archives ?? [])
      .map((u) => /\/games\/(\d{4})\/(\d{2})$/.exec(u))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => ({ key: `${m[1]}/${m[2]}`, end: Date.UTC(Number(m[1]), Number(m[2]), 1) }))
      .filter((m) => m.end > since)
      .reverse();
    const limit = o.max || HARD_MAX;
    type CcArchived = { end_time?: number; rules?: string; rated?: boolean; time_class?: string; pgn?: string; initial_setup?: string; white?: { username?: string } };
    for (const m of months) {
      if (f.signal.aborted || f.out.length >= limit) break;
      f.report(f.out.length, m.key);
      const d = await abortable(chesscomJson<{ games?: CcArchived[] }>(`/player/${user}/games/${m.key}`), f.signal);
      const games = (d?.games ?? []).sort((a, b) => Number(b.end_time) - Number(a.end_time));
      for (const g of games) {
        const end = Number(g.end_time) * 1000;
        if (!(end >= since)) continue;
        last = Math.max(last, end);
        if (g.rules !== 'chess' || typeof g.pgn !== 'string' || !g.pgn.trim()) continue;
        if (g.initial_setup && g.initial_setup !== START_FEN) continue;
        if (!o.speeds.includes(CC_CLASS[g.time_class ?? ''] ?? 'rapid')) continue;
        if (o.rated && g.rated === false) continue;
        if (o.color !== 'both' && (g.white?.username?.toLowerCase() === user) !== (o.color === 'white')) continue;
        const c = onlineGame(g.pgn, p.chesscom!, p.name, end);
        if (!c) continue;
        f.out.push(c);
        if (f.out.length >= limit) break;
      }
    }
    f.report(f.out.length);
    return last;
  }

  /**
   * OTB από όλες τις βάσεις, με τα ίδια φίλτρα. Παρτίδα που ένα αντίτυπό της είχε ξαναβρεθεί δεν ξαναμπαίνει (ούτε αν
   * τη φέρει τώρα άλλη βάση). Οι παλιές προετοιμασίες μένουν στις βάσεις και στα ονόματά τους, χωρίς φίλτρα.
   */
  async function fromOtb(p: Prep, f: Fetch): Promise<{ seen: Record<string, number[]>; fideId?: number }> {
    const o = p.opts;
    const old = !p.otb;
    const { games, match } = await findOtb(searchable(), p.otb ?? { name: p.name }, f.signal, old ? p.locals : undefined);
    if (f.signal.aborted) return { seen: {} };
    const before = new Map(Object.entries(p.localSeen ?? {}).map(([db, ids]) => [db, new Set(ids)]));
    const seen = new Map([...before].map(([db, ids]) => [db, new Set(ids)]));
    for (const g of games) {
      let known = false;
      for (const c of g.copies) {
        if (before.get(c.dbId)?.has(c.id)) known = true;
        if (!seen.has(c.dbId)) seen.set(c.dbId, new Set());
        seen.get(c.dbId)!.add(c.id);
      }
      if (known) continue;
      const h = g.game.headers;
      if (!old) {
        if (o.color !== 'both' && g.color !== o.color) continue;
        if (!inPeriod(g.date, f.start.day)) continue;
        if (!gameSpeeds(h).some((s) => o.speeds.includes(s))) continue;
        // οι OTB δεν έχουν ετικέτα rated: κόβονται μόνο οι δηλωμένες casual
        if (o.rated && /^casual\b/i.test(h.Event ?? '')) continue;
      }
      f.out.push({
        color: g.color,
        opp: g.opp,
        date: g.date,
        result: g.result,
        moves: g.moves,
        key: g.key,
        time: msOfDay(g.date),
        pgn: () => {
          const game = decodeGame(g.game.tokens, g.game.comments, START_FEN);
          game.headers = { ...game.headers, ...h, [g.color === 'white' ? 'White' : 'Black']: p.name };
          if (g.date !== g.game.row.date) game.headers.Date = formatPgnDate(g.date);
          return writeGame(game);
        },
      });
    }
    f.report(f.out.length);
    return { seen: Object.fromEntries([...seen].map(([db, ids]) => [db, [...ids]])), fideId: match.fideId };
  }

  async function run(p: Prep, ac: AbortController): Promise<void> {
    const active = PREP_SOURCES.filter((s) => (s === 'otb' ? p.otb || p.locals?.length : p[s]));
    const states = new Map<PrepSource, PrepSourceProgress>(active.map((s) => [s, { state: 'running', found: 0 }]));
    const progress: PrepProgress = { id: p.id, phase: 'running', added: 0, sources: Object.fromEntries(states) };
    running.set(p.id, { ac, progress });
    send(progress);
    // όχι ένα SSE ανά παρτίδα: ως 5 το δευτερόλεπτο
    let timer: NodeJS.Timeout | undefined;
    const sendSoon = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        send(progress);
      }, 200);
    };
    const start = periodStart(p.opts);
    const got: Record<PrepSource, Candidate[]> = { otb: [], lichess: [], chesscom: [] };
    const next: { li?: number; cc?: number; seen?: Record<string, number[]> } = {};
    let fideId = p.otb?.fideId ?? p.fide?.id;
    try {
      await Promise.all(
        active.map(async (src) => {
          const state = states.get(src)!;
          const f: Fetch = {
            signal: ac.signal,
            start,
            out: got[src],
            report: (found, month) => {
              state.found = found;
              state.month = month;
              sendSoon();
            },
          };
          try {
            if (src === 'lichess') {
              const last = await fromLichess(p, f);
              if (!ac.signal.aborted) next.li = last;
            } else if (src === 'chesscom') {
              const last = await fromChesscom(p, f);
              if (!ac.signal.aborted) next.cc = last;
            } else {
              const r = await fromOtb(p, f);
              if (!ac.signal.aborted) next.seen = r.seen;
              fideId ??= r.fideId;
            }
            state.state = ac.signal.aborted ? 'cancelled' : 'done';
          } catch (e) {
            if (ac.signal.aborted) state.state = 'cancelled';
            else {
              state.state = 'error';
              // το μήνυμα ενός σφάλματος των βάσεων δεν είναι κωδικός
              state.error = src === 'otb' ? 'failed' : codeOf(e);
              if (src === 'otb') console.error('Προετοιμασία, OTB:', e);
            }
          }
          state.found = got[src].length;
          delete state.month;
          sendSoon();
        }),
      );

      // χωρίς διπλές: πρώτα ό,τι έχει ήδη η βάση, μετά OTB, Lichess, Chess.com
      const target = lib.handle(p.dbId).db;
      const set = new GameSet<GameId>();
      let existing = 0;
      for (const id of target.search({ deleted: false })) {
        const g = target.getGame(id);
        if (!g) continue;
        existing++;
        const white = sameName(g.headers.White, p.name);
        set.add({ color: white ? 'white' : 'black', opp: white ? g.row.black : g.row.white, date: g.row.date, result: g.row.result, moves: mainMoves(g.tokens), key: siteGameKey(g.headers) });
      }
      const fresh = active.map((src) => got[src].filter((g) => !set.add(g)).sort((a, b) => b.time - a.time));

      // συνολικό όριο· πηγή που κόπηκε στη μέση κρατά το μερίδιό της για την επόμενη προσπάθεια
      const finished = p.done ?? p.at > 0;
      const unfinished = active.map((src) => {
        const s = states.get(src)!;
        return s.state !== 'done' && s.error !== 'notfound';
      });
      const room = p.opts.max ? Math.max(0, finished ? p.opts.max : p.opts.max - existing) : null;
      const quota = room === null ? fresh.map((x) => x.length) : shareLimit(fresh.map((x, i) => (unfinished[i] ? Infinity : x.length)), room);
      const picked = active.flatMap((src, i) => fresh[i].slice(0, quota[i]).map((g) => ({ src, g }))).sort((a, b) => b.g.time - a.g.time);
      if (picked.length && lib.addPgn) {
        // σε κομμάτια, ώστε να μη μένει μία τεράστια συναλλαγή
        for (let i = 0; i < picked.length; i += 500) progress.added += lib.addPgn(p.dbId, picked.slice(i, i + 500).map((x) => x.g.pgn()).join('\n\n'));
        for (const { src } of picked) p.counts[src === 'otb' ? 'local' : src]++;
      }

      if (next.li !== undefined) p.li = next.li;
      if (next.cc !== undefined) p.cc = next.cc;
      if (next.seen) p.localSeen = next.seen;
      p.done = finished || !unfinished.includes(true);
      if (fideId && !ac.signal.aborted) {
        try {
          const f = trimFide(await abortable(lichessCached(`/api/fide/player/${fideId}`), ac.signal));
          if (f) p.fide = f;
        } catch {
          /* μένουν τα Elo της προηγούμενης φοράς */
        }
      }
      p.at = Date.now();
      const errors = [...states].flatMap(([src, s]) => (s.error ? [`${src}:${s.error}`] : []));
      p.error = errors.length ? errors.join(' ') : null;
      // αν αφαιρέθηκε από τη λίστα όσο έτρεχε, δεν ξαναμπαίνει
      if (readAll().some((x) => x.id === p.id)) save(p);
      if (progress.added) r.broadcast('db', { id: p.dbId });
      progress.phase = ac.signal.aborted ? 'cancelled' : 'done';
    } catch (e) {
      console.error('Προετοιμασία:', e);
      progress.phase = 'error';
    } finally {
      clearTimeout(timer);
      running.delete(p.id);
      send(progress);
    }
  }

  // -------------------------------------------------------------------------
  // αναφορά

  function report(p: Prep) {
    const gdb = lib.handle(p.dbId).db;
    const tree = { white: newRoot(), black: newRoot() };
    const score = { white: [0, 0, 0], black: [0, 0, 0] };
    const bySpeed = new Map<PrepSpeed, number[]>();
    const bySource = new Map<string, number>();
    const ratings = new Map<string, { source: string; speed: PrepSpeed; elo: number; date: number }>();
    const opponents = new Map<string, number[]>();
    const recent: Array<{ id: number; at: string; color: 'white' | 'black'; opp: string; oppElo: number; elo: number; res: number | null; date: number; speed: PrepSpeed; source: string; opening: string; event: string }> = [];
    let total = 0;
    let first = 0;
    let lastDate = 0;
    const pos = Position.start();
    for (const id of gdb.search({ deleted: false })) {
      const g = gdb.getGame(id);
      if (!g) continue;
      const h = g.headers;
      const color: 'white' | 'black' | null = sameName(h.White, p.name) ? 'white' : sameName(h.Black, p.name) ? 'black' : null;
      if (!color) continue;
      total++;
      const res = g.row.result === 1 ? (color === 'white' ? 1 : 0) : g.row.result === 3 ? (color === 'white' ? 0 : 1) : g.row.result === 2 ? 0.5 : null;
      const slot = res === 1 ? 0 : res === 0.5 ? 1 : res === 0 ? 2 : -1;
      const date = g.row.date || 0;
      if (date && (!first || date < first)) first = date;
      if (date > lastDate) lastDate = date;
      // online μόνο όσες έχουν id του site: οι OTB βάσεις γράφουν και «chess.com INT» ως τόπο (Elo FIDE, χρόνοι σε λεπτά)
      const source = siteGameKey(h) ? prepSource(h) : 'otb';
      const speed = gameSpeeds(h)[0] ?? 'classical';
      bySource.set(source, (bySource.get(source) ?? 0) + 1);
      if (slot >= 0) {
        score[color][slot]++;
        const s = bySpeed.get(speed) ?? [0, 0, 0];
        s[slot]++;
        bySpeed.set(speed, s);
      } else if (!bySpeed.has(speed)) bySpeed.set(speed, [0, 0, 0]);
      const elo = color === 'white' ? g.row.welo : g.row.belo;
      const rk = `${source}:${speed}`;
      if (elo && (!ratings.has(rk) || date >= ratings.get(rk)!.date)) ratings.set(rk, { source, speed, elo, date });
      const opp = color === 'white' ? g.row.black : g.row.white;
      if (slot >= 0) {
        const o = opponents.get(opp) ?? [0, 0, 0];
        o[slot]++;
        opponents.set(opp, o);
      }
      recent.push({ id, at: h.UTCTime ?? h.EndTime ?? '', color, opp, oppElo: color === 'white' ? g.row.belo : g.row.welo, elo, res, date, speed, source, opening: h.Opening ?? '', event: g.row.event });
      if (g.fen) continue;
      const sans: string[] = [];
      try {
        replayMainline(g.tokens, pos, null, (pp, ply, next) => {
          if (ply >= TREE_PLIES || next === 0xffff) return true;
          sans.push(pp.san(tokenToMove(pp, next)));
          return false;
        });
      } catch {
        /* χαλασμένη παρτίδα: όσες κινήσεις διαβάστηκαν */
      }
      addLine(tree[color], sans, res, date);
    }
    recent.sort((a, b) => b.date - a.date || b.at.localeCompare(a.at) || b.id - a.id);
    const speeds = PREP_SPEEDS.filter((s) => bySpeed.has(s)).map((s) => ({ speed: s, w: bySpeed.get(s)![0], d: bySpeed.get(s)![1], l: bySpeed.get(s)![2] }));
    return {
      prep: p,
      games: total,
      first,
      last: lastDate,
      sources: Object.fromEntries(bySource),
      score,
      speeds,
      ratings: [...ratings.values()].sort((a, b) => b.date - a.date),
      opponents: [...opponents.entries()]
        .map(([name, s]) => ({ name, w: s[0], d: s[1], l: s[2] }))
        .sort((a, b) => b.w + b.d + b.l - (a.w + a.d + a.l))
        .slice(0, 10),
      tree: { white: pruneTree(tree.white), black: pruneTree(tree.black) } as { white: PrepNode; black: PrepNode },
      recent: recent.slice(0, 30),
    };
  }

  // -------------------------------------------------------------------------
  // API

  r.get('/api/prep', () => ({ preps: list(), running: [...running.values()].map((x) => x.progress) }));

  r.post('/api/prep/start', (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    let p: Prep;
    if (typeof b.id === 'string') {
      // ενημέρωση: οι ίδιες πηγές και φίλτρα, μόνο οι καινούργιες παρτίδες
      const old = find(b.id);
      if (running.has(old.id)) throw new HttpError(409, 'Η προετοιμασία τρέχει ήδη');
      p = { ...old, counts: { ...old.counts } };
    } else {
      const user = (v: unknown, site: string): string | undefined => {
        if (typeof v !== 'string' || !v.trim()) return undefined;
        const clean = cleanSiteUser(v);
        if (!clean) throw new HttpError(400, `Το username του ${site} δεν είναι έγκυρο`);
        return clean;
      };
      const lichess = user(b.lichess, 'Lichess');
      const chesscom = user(b.chesscom, 'Chess.com');
      const otb = cleanOtb(b.otb);
      if (!lichess && !chesscom && !otb) throw new HttpError(400, 'Συμπλήρωσε ένα πεδίο: FIDE / OTB, Lichess ή Chess.com');
      const name = cleanPlayerName(otb?.name ?? '') || lichess || chesscom!;
      // «άλλαξε φίλτρα» σε προετοιμασία χωρίς παρτίδες: η ίδια βάση, όχι «Αντίπαλος - … (2)», «(3)»
      const prev = typeof b.replace === 'string' ? list().find((x) => x.id === b.replace) : undefined;
      const reuse = prev && !running.has(prev.id) && !lib.handle(prev.dbId).db.search({ deleted: false }).length ? prev : undefined;
      const title = `Αντίπαλος - ${name}`;
      const entry = reuse ? lib.rename(reuse.dbId, title) : lib.create(title);
      p = {
        id: reuse?.id ?? crypto.randomUUID().slice(0, 10),
        name,
        dbId: entry.id,
        lichess,
        chesscom,
        otb,
        opts: cleanOpts(b.opts),
        counts: { lichess: 0, chesscom: 0, local: 0 },
        at: 0,
        done: false,
      };
      save(p);
      r.broadcast('db', { id: entry.id });
    }
    void run(p, new AbortController());
    return { prep: p };
  });

  /** Το πεδίο FIDE / OTB: όνομα → παίκτες των βάσεων· FIDE ID → ο παίκτης από το Lichess (τα ονόματα δεν στέλνονται). */
  r.get('/api/prep/players', async (req): Promise<OtbSuggestion[]> => {
    const q = (req.query.get('q') ?? '').trim();
    if (!/^\d+$/.test(q)) return searchPlayers(searchable(), q);
    if (q.length < 4 || q.length > 10) return [];
    try {
      const f = trimFide(await lichessCached(`/api/fide/player/${q}`));
      return f ? [{ name: f.name, fideId: f.id, games: 0, maxElo: f.standard ?? 0, first: 0, last: 0, fide: f }] : [];
    } catch (e) {
      if (codeOf(e) === 'notfound') return [];
      throw new HttpError(502, codeOf(e));
    }
  });

  /** Ο παίκτης που διαλέχτηκε: πόσες παρτίδες, από ποιες βάσεις, ποια ονόματα. */
  r.post('/api/prep/player', async (req) => {
    const who = cleanOtb(req.body);
    if (!who) throw new HttpError(400, 'Λείπει το όνομα του παίκτη');
    return (await findOtb(searchable(), who)).match;
  });

  r.post('/api/prep/:id/cancel', (req) => {
    running.get(req.params.id)?.ac.abort();
    return { ok: true };
  });

  // η αναφορά ξαναϋπολογίζεται μόνο όταν αλλάξει η βάση (παρτίδες) ή η προετοιμασία (ενημέρωση)
  const reports = new Map<string, { key: string; data: ReturnType<typeof report> }>();
  r.get('/api/prep/:id/report', (req) => {
    const p = find(req.params.id);
    const key = `${p.at}:${lib.handle(p.dbId).db.count()}`;
    const hit = reports.get(p.id);
    if (hit && hit.key === key) return hit.data;
    const data = report(p);
    reports.set(p.id, { key, data });
    if (reports.size > 20) reports.delete(reports.keys().next().value!);
    return data;
  });

  /** Αφαίρεση από τον κατάλογο (η βάση μένει· σβήνεται από τις Βάσεις αν θέλει ο χρήστης). */
  r.post('/api/prep/:id/forget', (req) => {
    running.get(req.params.id)?.ac.abort();
    writeAll(readAll().filter((x) => x.id !== req.params.id));
    return { ok: true };
  });
}
