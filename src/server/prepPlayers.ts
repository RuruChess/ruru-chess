/**
 * «Προετοιμασία για αντίπαλο», το κομμάτι FIDE / OTB: ένας παίκτης σε όλες τις τοπικές βάσεις.
 * - Η φόρμα δεν δείχνει βάσεις: ψάχνονται όλες (πρώτα η αναφοράς, τελευταία τα βιβλία), εκτός από τις «Αντίπαλος - …».
 * - Μόνο με συνδέσεις ανάγνωσης που κλείνουν αμέσως: όχι `lib.handle`, που θα άλλαζε το «τελευταίο άνοιγμα» σε όλες.
 * - Ίδιο πρόσωπο: ίδιες λέξεις στο όνομα, ίδιο FIDE ID στις ετικέτες, ή αρχικό που δεν ταιριάζει σε άλλον. Παρτίδα με
 *   άλλο FIDE ID μένει έξω (συνονόματοι). Ό,τι απλώς μοιάζει προτείνεται στο «Ίσως και», δεν μπαίνει μόνο του.
 */
import fs from 'node:fs';
import { TK_VEND, TK_VSTART } from '../core/codec.ts';
import {
  GameSet,
  nameMatches,
  nameParts,
  personKey,
  prepSpeed,
  siteGameKey,
  type GameId,
  type OtbMatch,
  type OtbSuggestion,
  type PrepOtb,
  type PrepSpeed,
} from '../core/prep.ts';
import { GF_DELETED, GameDatabase, type StoredGame } from './db/store.ts';
import { SPEED_BLITZ, SPEED_CLASSICAL, SPEED_CORR, SPEED_RAPID, eventSpeed, timeControlSpeed } from './db/speed.ts';
import { originOf, type DbEntry, type Library } from './library.ts';

/** Προτάσεις στη λίστα του πεδίου. */
const SHOWN = 12;
/** Ονόματα ανά βάση που μετριούνται σε μία αναζήτηση (το «Garcia» της Lumbras έχει 2.248). */
const MAX_NAMES = 6000;

const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Οι βάσεις όπου ψάχνει, με τη σειρά προτεραιότητας για τις διπλές. */
export function otbDbs(lib: Pick<Library, 'entries' | 'busy' | 'settings'>, prepDbs: ReadonlySet<string>): DbEntry[] {
  const ref = (lib.settings.ui as { referenceDb?: string } | undefined)?.referenceDb;
  const rank = (e: DbEntry) => (e.id === ref ? 0 : originOf(e) === 'book' ? 2 : 1);
  const size = (e: DbEntry) => fs.statSync(e.file, { throwIfNoEntry: false })?.size ?? 0;
  return lib.entries
    .filter((e) => {
      if (prepDbs.has(e.id) || e.name.startsWith('Αντίπαλος - ')) return false;
      const job = lib.busy(e.id);
      return job?.kind !== 'import' && job?.kind !== 'convert';
    })
    .map((e) => ({ e, rank: rank(e), size: size(e) }))
    .filter((x) => x.size > 0)
    .sort((a, b) => a.rank - b.rank || b.size - a.size)
    .map((x) => x.e);
}

async function eachDb(dbs: DbEntry[], signal: AbortSignal | undefined, visit: (db: GameDatabase, e: DbEntry) => void | Promise<void>): Promise<void> {
  for (const e of dbs) {
    if (signal?.aborted) return;
    let db: GameDatabase | undefined;
    try {
      db = new GameDatabase(e.file, { reader: true });
      await visit(db, e);
    } catch (err) {
      // μία χαλασμένη ή νεότερης μορφής βάση δεν σταματά τις υπόλοιπες
      console.error(`Προετοιμασία, βάση «${e.name}»:`, (err as Error).message);
    } finally {
      db?.close();
    }
    await breathe();
  }
}

/** Παίκτες που το κλειδί τους αρχίζει από κάποια από τις λέξεις (με το ευρετήριο players_key). */
function namesStarting(db: GameDatabase, starts: string[]): Map<number, string> {
  const out = new Map<number, string>();
  const range = db.db.prepare('SELECT id, name FROM players WHERE id > 0 AND key >= ? AND key < ?');
  for (const w of new Set(starts)) for (const r of range.all(w, `${w}￿`) as Array<{ id: number; name: string }>) out.set(r.id, r.name);
  return out;
}

/** Το FIDE ID της πλευράς, όπως κι αν γράφεται η ετικέτα (WhiteFideId, WhiteFIDEId…). */
function fideIdOf(h: Record<string, string>, color: GameId['color']): number | undefined {
  const want = `${color}fideid`;
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === want && /^[1-9]\d{2,9}$/.test(v)) return Number(v);
  return undefined;
}

/** Η κύρια γραμμή ως tokens: δύο βάσεις με την ίδια παρτίδα διαφέρουν συχνά μόνο στα σχόλια. */
export function mainMoves(tokens: Uint16Array): number[] {
  const out: number[] = [];
  let depth = 0;
  for (const tk of tokens) {
    if (tk === TK_VSTART) depth++;
    else if (tk === TK_VEND) depth--;
    else if (!depth && tk < 0x8000) out.push(tk);
  }
  return out;
}

/**
 * Ρυθμοί μιας παρτίδας. Στις OTB με τους κανόνες των βάσεων (speed.ts): εκεί το «90+30» είναι λεπτά και κλασικό, ενώ
 * στα sites δευτερόλεπτα. «Rapid & Blitz» χωρίς TimeControl: και τα δύο.
 */
export function gameSpeeds(h: Record<string, string>): PrepSpeed[] {
  if (siteGameKey(h)) return [prepSpeed(h)];
  let mask = eventSpeed(h.Event ?? '', h);
  if (mask === (SPEED_RAPID | SPEED_BLITZ)) mask = timeControlSpeed(h.TimeControl ?? '') || mask;
  if (mask & SPEED_CORR) return ['daily'];
  const out: PrepSpeed[] = [];
  if (mask & SPEED_CLASSICAL) out.push('classical');
  if (mask & SPEED_RAPID) out.push('rapid');
  if (mask & SPEED_BLITZ) {
    const tc = /^(\d+)\s*\+\s*(\d+)$/.exec((h.TimeControl ?? '').trim());
    const base = tc ? Number(tc[1]) : 0;
    // εδώ είναι ήδη blitz: βάση πάνω από 10 είναι δευτερόλεπτα
    const bullet = /bullet/i.test(h.Event ?? '') || (tc !== null && (base > 10 ? base : base * 60) + 40 * Number(tc[2]) < 180);
    out.push(bullet ? 'bullet' : 'blitz');
  }
  return out;
}

// ---------------------------------------------------------------------------
// προτάσεις όσο γράφεις

export async function searchPlayers(dbs: DbEntry[], q: string): Promise<OtbSuggestion[]> {
  const parts = nameParts(q);
  const starts = parts.filter((w) => w.length >= 2);
  if (q.trim().length < 3 || !starts.length) return [];
  interface Group {
    name: string;
    games: number;
    db: DbEntry;
    id: number;
  }
  const groups = new Map<string, Group>();
  await eachDb(dbs, undefined, async (db, e) => {
    const count = db.db.prepare('SELECT (SELECT count(*) FROM games WHERE white = ?) + (SELECT count(*) FROM games WHERE black = ?) AS n');
    const here = new Map<string, Group & { top: number }>();
    let counted = 0;
    for (const [id, name] of namesStarting(db, starts)) {
      if (!nameMatches(q, name)) continue;
      if (++counted > MAX_NAMES) break;
      // η Lumbras κάνει ~1,5″ για χιλιάδες ονόματα: όχι μονοκόμματα, θα πάγωνε όλη η εφαρμογή
      if (counted % 50 === 0) await breathe();
      const n = (count.get(id, id) as { n: number }).n;
      if (!n) continue;
      const key = personKey(name);
      const g = here.get(key);
      if (!g) here.set(key, { name, games: n, db: e, id, top: n });
      else {
        g.games += n;
        if (n > g.top) Object.assign(g, { name, id, top: n });
      }
    }
    for (const [key, g] of here) if (g.games > (groups.get(key)?.games ?? 0)) groups.set(key, g);
  });

  // ολόκληρο όνομα πρώτο· σκέτο επώνυμο όχι («Papadopoulos» με 13 παρτίδες πάνω από όλους)
  const wanted = parts.length > 1 ? personKey(q) : null;
  const top = [...groups.entries()].sort(([ka, a], [kb, b]) => Number(kb === wanted) - Number(ka === wanted) || b.games - a.games).slice(0, SHOWN);
  const out = new Map<string, OtbSuggestion>();
  await eachDb([...new Set(top.map(([, g]) => g.db))], undefined, (db, e) => {
    for (const [key, g] of top) {
      if (g.db !== e) continue;
      const s = db.db
        .prepare('SELECT max(CASE WHEN white = ? THEN welo ELSE belo END) AS elo, min(nullif(date, 0)) AS first, max(date) AS last FROM games WHERE white = ? OR black = ?')
        .get(g.id, g.id, g.id) as { elo: number | null; first: number | null; last: number | null };
      let fideId: number | undefined;
      for (const r of db.db.prepare('SELECT id, white FROM games WHERE white = ? OR black = ? ORDER BY date DESC LIMIT 20').all(g.id, g.id) as Array<{ id: number; white: number }>) {
        fideId ??= fideIdOf(db.getGame(r.id)?.headers ?? {}, r.white === g.id ? 'white' : 'black');
      }
      out.set(key, { name: g.name, games: g.games, maxElo: s.elo ?? 0, first: s.first ?? 0, last: s.last ?? 0, ...(fideId ? { fideId } : {}) });
    }
  });
  return top.flatMap(([key]) => out.get(key) ?? []);
}

// ---------------------------------------------------------------------------
// οι παρτίδες του παίκτη

export interface OtbGame extends GameId {
  game: StoredGame;
  /** όλα τα αντίτυπα της παρτίδας στις βάσεις (για την «Ενημέρωση») */
  copies: Array<{ dbId: string; id: number }>;
}

/** Παρτίδα χρήσιμη για ανοίγματα: από την αρχική θέση, κανονικό σκάκι, όχι ανάλυση χωρίς ημερομηνία και αποτέλεσμα. */
function usable(g: StoredGame): boolean {
  if (g.fen || !g.row.plies || (!g.row.date && !g.row.result)) return false;
  return !g.headers.Variant || /^(standard|chess|normal|classical)$/i.test(g.headers.Variant);
}

/** Πόσα μέρη της ημερομηνίας είναι γνωστά. */
const precision = (d: number) => Number(d >= 10000) + Number(d % 10000 >= 100) + Number(d % 100 > 0);

/**
 * Οι παρτίδες του παίκτη από όλες τις βάσεις, χωρίς διπλές.
 * `exact`: παλιά προετοιμασία — μόνο αυτά τα ονόματα, στις βάσεις όπου είχαν διαλεχτεί.
 */
export async function findOtb(
  dbs: DbEntry[],
  who: PrepOtb,
  signal?: AbortSignal,
  exact?: Array<{ dbId: string; players: string[] }>,
): Promise<{ match: OtbMatch; games: OtbGame[] }> {
  const key = personKey(who.name);
  // με κόμμα: επώνυμο, μικρό· χωρίς: όλες οι λέξεις πρέπει να υπάρχουν («Magnus Carlsen»)
  const [before, ...after] = who.name.split(',');
  const surname = nameParts(before);
  const given = nameParts(after.join(' '));
  const extra = new Set(who.extra ?? []);
  const restOf = (name: string) => nameParts(name).filter((w) => !surname.includes(w));
  const candidate = (name: string): boolean => {
    if (extra.has(name) || personKey(name) === key) return true;
    if (!surname.length) return false;
    // σκέτο επώνυμο χωρίς ID: μόνο το ίδιο όνομα, αλλιώς θα διαβάζονταν όλοι οι συνεπώνυμοι
    if (!given.length && surname.length === 1 && !who.fideId) return false;
    const w = nameParts(name);
    if (!surname.every((x) => w.includes(x))) return false;
    const rest = restOf(name);
    return !given.length || !rest.length || rest.some((x) => x[0] === given[0][0]);
  };

  interface Found {
    e: DbEntry;
    id: number;
    name: string;
    color: GameId['color'];
    fide?: number;
    game: StoredGame;
  }
  interface NameStat {
    perDb: Map<string, number>;
    ids: Map<number, number>;
    tagged: number;
    untagged: number;
  }
  const found: Found[] = [];
  const stats = new Map<string, NameStat>();
  await eachDb(exact ? dbs.filter((e) => exact.some((x) => x.dbId === e.id)) : dbs, signal, async (db, e) => {
    const names = new Map<number, string>();
    const chosen = exact ? exact.filter((x) => x.dbId === e.id).flatMap((x) => x.players) : [...extra];
    for (const name of chosen) {
      const id = db.playerIdByName(name);
      if (id !== null) names.set(id, name);
    }
    if (!exact) {
      for (const [id, name] of namesStarting(db, [...surname, ...given].filter((w) => w.length >= 2))) if (candidate(name)) names.set(id, name);
    }
    const games = db.db.prepare(`SELECT id, white FROM games WHERE (white = ? OR black = ?) AND (flags & ${GF_DELETED}) = 0 ORDER BY id`);
    let read = 0;
    for (const [pid, name] of names) {
      for (const r of games.all(pid, pid) as Array<{ id: number; white: number }>) {
        if (++read % 500 === 0) await breathe();
        if (signal?.aborted) return;
        const game = db.getGame(r.id);
        if (!game || !usable(game)) continue;
        const color = r.white === pid ? 'white' : 'black';
        const fide = fideIdOf(game.headers, color);
        found.push({ e, id: r.id, name, color, fide, game });
        let s = stats.get(name);
        if (!s) stats.set(name, (s = { perDb: new Map(), ids: new Map(), tagged: 0, untagged: 0 }));
        s.perDb.set(e.id, (s.perDb.get(e.id) ?? 0) + 1);
        if (fide) {
          s.tagged++;
          s.ids.set(fide, (s.ids.get(fide) ?? 0) + 1);
        } else s.untagged++;
      }
    }
  });

  // το FIDE ID: αυτό που έδωσε ο χρήστης, αλλιώς αυτό που έχουν σχεδόν όλες οι παρτίδες του ονόματος
  const sameKey = (name: string) => personKey(name) === key;
  const idCount = new Map<number, number>();
  for (const [name, s] of stats) if (sameKey(name)) for (const [id, n] of s.ids) idCount.set(id, (idCount.get(id) ?? 0) + n);
  const byCount = [...idCount].sort((a, b) => b[1] - a[1]);
  const tagged = byCount.reduce((n, x) => n + x[1], 0);
  const dominant = byCount.length > 0 && byCount[0][1] >= tagged * 0.9;
  const fideId = exact ? undefined : (who.fideId ?? (dominant ? byCount[0][0] : undefined));
  const idSomewhere = fideId !== undefined && [...stats.values()].some((s) => s.ids.has(fideId));

  const keyHasId = fideId !== undefined && [...stats].some(([name, s]) => sameKey(name) && s.ids.has(fideId));
  const trusted = new Set<string>();
  const initials: string[] = [];
  for (const [name, s] of stats) {
    const mine = fideId ? (s.ids.get(fideId) ?? 0) : 0;
    if (exact || extra.has(name) || mine * 2 > s.tagged) trusted.add(name);
    else if (sameKey(name)) {
      // με ID, το ίδιο όνομα χωρίς κανένα τέτοιο ID είναι συνονόματος όταν το ID υπάρχει αλλού («…, Ioannis K»)
      if (!who.fideId || keyHasId || !idSomewhere) trusted.add(name);
    } else if (given.length) {
      const rest = restOf(name);
      if (rest.length && rest.every((w) => w.length === 1) && given[0].startsWith(rest[0])) initials.push(name);
    }
  }
  // «Batsis, L» μόνο αν κανένας άλλος συνεπώνυμος δεν αρχίζει από L (ούτε συνονόματος, π.χ. «…, Ioannis K»)
  for (const name of initials) {
    const first = restOf(name)[0];
    const rival = [...stats.keys()].some((other) => {
      const w = restOf(other)[0] ?? '';
      return !trusted.has(other) && w.length > 1 && w[0] === first;
    });
    if (!rival) trusted.add(name);
  }
  const mine = found.filter((f) => (f.fide && fideId ? f.fide === fideId : trusted.has(f.name)));

  // οι πιο πλήρεις πρώτες· στην ισοπαλία μένει η σειρά των βάσεων
  const rows: OtbGame[] = mine
    .map(
      (f): OtbGame => ({
        color: f.color,
        opp: f.color === 'white' ? f.game.row.black : f.game.row.white,
        date: f.game.row.date,
        result: f.game.row.result,
        moves: mainMoves(f.game.tokens),
        key: siteGameKey(f.game.headers),
        game: f.game,
        copies: [{ dbId: f.e.id, id: f.id }],
      }),
    )
    .sort((a, b) => b.moves.length - a.moves.length);
  const set = new GameSet<OtbGame>();
  const games: OtbGame[] = [];
  let checked = 0;
  for (const g of rows) {
    if (++checked % 2000 === 0) await breathe();
    const same = set.add(g);
    if (!same) {
      games.push(g);
      continue;
    }
    same.copies.push(...g.copies);
    if (precision(g.date) > precision(same.date)) same.date = g.date;
  }

  const similar = (name: string) => {
    const w = restOf(name)[0];
    if (sameKey(name) || !w || !given.length) return true;
    return w.startsWith(given[0]) || given[0].startsWith(w) || w.slice(0, 4) === given[0].slice(0, 4);
  };
  const maybe = [...stats]
    .filter(([name, s]) => !trusted.has(name) && s.untagged > 0 && similar(name))
    .map(([name, s]) => ({ name, games: Math.max(...s.perDb.values()) }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 4);

  return {
    games,
    match: {
      ...(fideId ? { fideId } : {}),
      games: games.length,
      last: games.reduce((d, g) => Math.max(d, g.date), 0),
      dbs: [...new Set(mine.map((f) => f.e.name))],
      names: [...new Set(mine.map((f) => f.name))],
      maybe,
      namesakes: !fideId && byCount.length > 1 ? byCount.slice(0, 4).map(([id, n]) => ({ id, games: n })) : [],
    },
  };
}
