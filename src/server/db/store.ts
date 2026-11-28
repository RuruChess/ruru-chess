/**
 * Βάση δεδομένων παρτίδων του Ruru (ένα αρχείο SQLite .skdb).
 *
 * games  — κεφαλίδες (μικρές γραμμές, γρήγορη σάρωση/φίλτρα)
 * moves  — κινήσεις (tokens 16-bit) και σχόλια ανά παρτίδα
 * players / events / sites / annotators — λεξικά ονομάτων με κλειδί αναζήτησης
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { RESULT_TEXT, formatPgnDate, nameWords, parseElo, parsePgnDate, parseResult, searchKey } from '../text.ts';
import { packJson, unpackJson } from './pack.ts';
import { SPEED_ALL, eventNameSpeed, eventSpeed, nameDecides } from './speed.ts';
import { START_FEN } from '../../core/chess.ts';
import { GF_COMMENTS, GF_NAGS, GF_SHAPES, GF_VARIATIONS, decodeGame, encodeGame } from '../../core/codec.ts';
import { medalsOfFlags, medalsToText, textToMedals } from '../../core/medals.ts';

export const GF_DELETED = 0x100;
export const GF_MARKED = 0x200;

/**
 * Σχήμα ανά μορφή. Μορφή 1: ετικέτες ως JSON (+ deflate) στη στήλη `tags`. Μορφή 2: λεξικό
 * ετικετών (`tagkeys`, `tagvals`) και ζεύγη αριθμών στη στήλη `tagdata`· η `tags` δεν υπάρχει, ώστε
 * οι εκδόσεις ως την 2.2.0 (που δεν ελέγχουν τη μορφή) να δίνουν σφάλμα αντί να τη διαβάζουν λάθος.
 */
function schema(format: number): string {
  return `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS players(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sites(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS annotators(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS games(
  id INTEGER PRIMARY KEY,
  white INTEGER NOT NULL, black INTEGER NOT NULL,
  welo INTEGER NOT NULL DEFAULT 0, belo INTEGER NOT NULL DEFAULT 0,
  event INTEGER NOT NULL, site INTEGER NOT NULL,
  date INTEGER NOT NULL DEFAULT 0, round TEXT NOT NULL DEFAULT '',
  result INTEGER NOT NULL DEFAULT 0, eco TEXT NOT NULL DEFAULT '',
  plies INTEGER NOT NULL DEFAULT 0, annotator INTEGER NOT NULL DEFAULT 0,
  flags INTEGER NOT NULL DEFAULT 0, fen TEXT, ${format >= 2 ? 'tagdata BLOB' : 'tags TEXT'}
);
CREATE TABLE IF NOT EXISTS moves(id INTEGER PRIMARY KEY, data BLOB NOT NULL, comments TEXT);
${
  format >= 2
    ? `CREATE TABLE IF NOT EXISTS tagkeys(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, inline INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tagvals(id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE);`
    : ''
}
`;
}

export const INDEXES = `
CREATE INDEX IF NOT EXISTS players_key ON players(key);
CREATE INDEX IF NOT EXISTS events_key ON events(key);
CREATE INDEX IF NOT EXISTS sites_key ON sites(key);
CREATE INDEX IF NOT EXISTS games_white ON games(white);
CREATE INDEX IF NOT EXISTS games_black ON games(black);
CREATE INDEX IF NOT EXISTS games_event ON games(event);
CREATE INDEX IF NOT EXISTS games_date ON games(date);
CREATE INDEX IF NOT EXISTS games_eco ON games(eco);
`;

/** Ετικέτες που αποθηκεύονται σε στήλες (οι υπόλοιπες πάνε στο tags). */
const COLUMN_TAGS = new Set(['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'ECO', 'Annotator', 'PlyCount', 'FEN', 'SetUp', 'Medals']);

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

export interface NewGame {
  headers: Record<string, string>;
  tokens: Uint16Array;
  comments: string[] | null;
  fen: string | null;
  flags: number;
  plies: number;
  /** ήδη συμπιεσμένα σχόλια (από τους workers εισαγωγής) */
  packedComments?: Uint8Array | null;
}

/** Οι ετικέτες που δεν έχουν δική τους στήλη. */
export function extraTags(h: Record<string, string>): Record<string, string> | null {
  let out: Record<string, string> | null = null;
  for (const [k, v] of Object.entries(h)) {
    if (COLUMN_TAGS.has(k) || v === '' || v === undefined) continue;
    (out ??= {})[k] = v;
  }
  return out;
}

export interface StoredGame {
  row: GameRow;
  headers: Record<string, string>;
  tokens: Uint16Array;
  comments: string[] | null;
  fen: string | null;
}

export interface SearchCriteria {
  white?: string;
  black?: string;
  /** αναζήτηση παίκτη με οποιοδήποτε χρώμα */
  player?: string;
  /** αν ισχύει, τα white/black ταιριάζουν και ανάποδα */
  ignoreColors?: boolean;
  event?: string;
  site?: string;
  annotator?: string;
  yearFrom?: number;
  yearTo?: number;
  eloFrom?: number;
  eloTo?: number;
  /** ελάχιστο Elo και των δύο / ενός από τους δύο */
  eloBoth?: boolean;
  ecoFrom?: string;
  ecoTo?: string;
  results?: number[];
  minPlies?: number;
  maxPlies?: number;
  annotated?: boolean;
  /** μετάλλια (μάσκα bits του MEDALS): αρκεί ένα από αυτά */
  medals?: number;
  deleted?: boolean;
  ids?: number[];
  /** κείμενο που περιέχεται στα σχόλια */
  commentText?: string;
  /** υλικό κάποια στιγμή στην παρτίδα, π.χ. «KRP-KR» (σάρωση κινήσεων, όχι SQL) */
  material?: string;
  /** το υλικό και με αντίστροφα χρώματα */
  materialAnyColor?: boolean;
  /** ελιγμός ενός κομματιού, π.χ. «Nd2 Nf1 Ng3» (σάρωση κινήσεων) */
  maneuver?: string;
  /** 0 λευκά, 1 μαύρα (χωρίς τιμή: οποιοδήποτε) */
  maneuverSide?: number;
  /** δομή πιονιών κάποια στιγμή στην παρτίδα, από FEN (σάρωση κινήσεων) */
  pawns?: string;
  /** exact (και τα δύο χρώματα, προεπιλογή) · white · black · files (μόνο οι στήλες) */
  pawnsMode?: string;
  /** ρυθμός (μάσκα SPEED_* του speed.ts): κλασικό 1, rapid 2, blitz 4, αλληλογραφία 8· αρκεί ένας */
  speeds?: number;
}

type DictName = 'players' | 'events' | 'sites' | 'annotators';

/** Έκδοση του αρχείου ρυθμών (<βάση>.speed): αλλάζει όταν αλλάζουν οι κανόνες του speed.ts. */
const SPEED_FILE_VERSION = 1;

/**
 * Έκδοση της μορφής του αρχείου (meta «format»). Αλλάζει όταν αλλάζει ο τρόπος αποθήκευσης·
 * οι βάσεις χωρίς «format» (όλες ως την 2.2.0) είναι η 1. Γράφεται μόνο σε νέα αρχεία.
 * 2: λεξικό ετικετών (μόνο νέες βάσεις ή μετατροπή με κουμπί, `convertToCurrentFormat`).
 */
export const DB_FORMAT = 2;

/** Έκδοση των στατιστικών στο meta (2: το avgElo μετρά και τα δύο χρώματα· οι παλιές βάσεις δεν έχουν `v`). */
const STATS_VERSION = 2;

/** Βάση από νεότερη έκδοση του Ruru: δεν ανοίγει, ώστε να μη διαβαστεί ή γραφτεί λάθος. */
export class DbFormatError extends Error {}

/** Η μορφή μιας ανοιχτής σύνδεσης: 0 = νέο αρχείο χωρίς πίνακες. */
function storedFormat(db: DatabaseSync): number {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()) return 0;
  const r = db.prepare("SELECT value FROM meta WHERE key = 'format'").get() as { value: string } | undefined;
  return r ? Number(r.value) || 1 : 1;
}

function tokensToBlob(t: Uint16Array): Uint8Array {
  return new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
}

function blobToTokens(b: Uint8Array): Uint16Array {
  if (b.byteOffset % 2 === 0) return new Uint16Array(b.buffer, b.byteOffset, b.byteLength >> 1);
  return new Uint16Array(b.slice().buffer);
}

function pushVarint(out: number[], n: number): void {
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
}

/**
 * Χρήσεις κλειδιού μετά τις οποίες κρίνεται αν οι τιμές του είναι σχεδόν μοναδικές (> 90% νέες,
 * π.χ. GameId). Νωρίτερα θα έπεφταν έξω και τα FIDE ID: στην αρχή κάθε βάσης όλοι είναι καινούργιοι.
 */
const INLINE_AFTER = 2000;

/**
 * Λεξικό ετικετών της μορφής 2 (όπως στο Scid): κάθε διαφορετικό κλειδί (tagkeys) και τιμή
 * (tagvals) γράφεται μία φορά και η παρτίδα κρατά στο `tagdata` ζεύγη varint: το id του κλειδιού
 * και 2·id της τιμής ή 2·μήκος+1 και μετά τα bytes UTF-8 (τιμή μέσα στην παρτίδα). Κλειδιά με
 * σχεδόν μοναδικές τιμές (π.χ. GameId) περνούν σε τιμές μέσα στην παρτίδα (`inline`), γιατί εκεί το
 * λεξικό θα έπιανε διπλό χώρο. Οι κρυφές μνήμες ψάχνουν στη βάση όταν κάτι λείπει (άλλη σύνδεση
 * μπορεί να πρόσθεσε κλειδιά/τιμές)· το λεξικό δεν σβήνει ποτέ εγγραφές, άρα τα id μένουν έγκυρα.
 */
class TagDict {
  private keys = new Map<string, number>();
  private keyNames = new Map<number, string>();
  private inline = new Set<number>();
  private vals = new Map<string, number>();
  private texts = new Map<number, string>();
  /** χρήσεις / νέες τιμές ανά κλειδί σε αυτή τη σύνδεση */
  private use = new Map<number, { n: number; fresh: number }>();
  private loaded = false;
  private pos = 0;
  private readonly prep: (sql: string) => StatementSync;

  constructor(prep: (sql: string) => StatementSync) {
    this.prep = prep;
  }

  /** Μετά από ROLLBACK: ό,τι γράφτηκε στη συναλλαγή χάθηκε, άρα και οι κρυφές μνήμες. */
  reset(): void {
    for (const m of [this.keys, this.keyNames, this.vals, this.texts, this.use]) m.clear();
    this.inline.clear();
    this.loaded = false;
  }

  private loadKeys(): void {
    if (this.loaded) return;
    for (const r of this.prep('SELECT id, name, inline FROM tagkeys').all() as Array<{ id: number; name: string; inline: number }>) {
      this.keys.set(r.name, r.id);
      this.keyNames.set(r.id, r.name);
      if (r.inline) this.inline.add(r.id);
    }
    this.loaded = true;
  }

  private keyId(name: string): number {
    this.loadKeys();
    let id = this.keys.get(name);
    if (id === undefined) {
      const r = this.prep('SELECT id, inline FROM tagkeys WHERE name = ?').get(name) as { id: number; inline: number } | undefined;
      id = r ? r.id : Number(this.prep('INSERT INTO tagkeys(name) VALUES (?)').run(name).lastInsertRowid);
      if (r?.inline) this.inline.add(id);
      this.keys.set(name, id);
      this.keyNames.set(id, name);
    }
    return id;
  }

  private valueId(key: number, v: string): number {
    let u = this.use.get(key);
    if (!u) this.use.set(key, (u = { n: 0, fresh: 0 }));
    u.n++;
    let id = this.vals.get(v);
    if (id === undefined) {
      id = (this.prep('SELECT id FROM tagvals WHERE value = ?').get(v) as { id: number } | undefined)?.id;
      if (id === undefined) {
        id = Number(this.prep('INSERT INTO tagvals(value) VALUES (?)').run(v).lastInsertRowid);
        u.fresh++;
        // σχεδόν κάθε τιμή του κλειδιού είναι καινούργια: στο εξής μέσα στην παρτίδα
        if (u.n >= INLINE_AFTER && u.fresh * 10 > u.n * 9) {
          this.inline.add(key);
          this.prep('UPDATE tagkeys SET inline = 1 WHERE id = ?').run(key);
        }
      }
      this.vals.set(v, id);
      this.texts.set(id, v);
    }
    return id;
  }

  encode(tags: Record<string, string>): Uint8Array | null {
    const out: number[] = [];
    for (const [k, raw] of Object.entries(tags)) {
      const v = String(raw);
      const key = this.keyId(k);
      pushVarint(out, key);
      if (this.inline.has(key)) {
        const b = Buffer.from(v, 'utf8');
        pushVarint(out, b.length * 2 + 1);
        for (const x of b) out.push(x);
      } else pushVarint(out, this.valueId(key, v) * 2);
    }
    return out.length ? Uint8Array.from(out) : null;
  }

  private varint(b: Uint8Array): number {
    let n = 0;
    let mul = 1;
    for (;;) {
      if (this.pos >= b.length) throw new Error('Χαλασμένες ετικέτες');
      const x = b[this.pos++];
      n += (x & 0x7f) * mul;
      if (x < 0x80) return n;
      mul *= 0x80;
    }
  }

  private keyName(id: number): string {
    let name = this.keyNames.get(id);
    if (name === undefined) {
      name = (this.prep('SELECT name FROM tagkeys WHERE id = ?').get(id) as { name: string } | undefined)?.name;
      if (name === undefined) throw new Error('Χαλασμένες ετικέτες');
      this.keyNames.set(id, name);
    }
    return name;
  }

  private text(id: number): string {
    let v = this.texts.get(id);
    if (v === undefined) {
      v = (this.prep('SELECT value FROM tagvals WHERE id = ?').get(id) as { value: string } | undefined)?.value;
      if (v === undefined) throw new Error('Χαλασμένες ετικέτες');
      this.texts.set(id, v);
    }
    return v;
  }

  decode(b: Uint8Array): Record<string, string> {
    const h: Record<string, string> = {};
    this.pos = 0;
    while (this.pos < b.length) {
      const key = this.keyName(this.varint(b));
      const v = this.varint(b);
      if (v % 2) {
        const len = (v - 1) / 2;
        if (this.pos + len > b.length) throw new Error('Χαλασμένες ετικέτες');
        h[key] = Buffer.from(b.buffer, b.byteOffset + this.pos, len).toString('utf8');
        this.pos += len;
      } else h[key] = this.text(v / 2);
    }
    return h;
  }
}

export class GameDatabase {
  readonly file: string;
  readonly db: DatabaseSync;
  private dicts: Record<DictName, Map<string, number>> = {
    players: new Map(),
    events: new Map(),
    sites: new Map(),
    annotators: new Map(),
  };
  private dictLoaded = false;
  private stmt: Record<string, StatementSync> = {};
  private bulk = false;
  /** σύνδεση μόνο για ανάγνωση: δεν γράφει τίποτα, ούτε αρχεία δίπλα στη βάση */
  private readonly reader: boolean;
  /** μορφή του αρχείου (1 = ετικέτες JSON, 2 = λεξικό ετικετών) */
  readonly format: number;
  /** στήλη των πρόσθετων ετικετών: `tags` (μορφή 1) ή `tagdata` (μορφή 2) */
  private readonly tagCol: string;
  private readonly tagDict: TagDict | null;
  /**
   * Σύνδεση ανάγνωσης όσο άλλη σύνδεση εισάγει παρτίδες (βήμα 4 του σχεδίου Scid): πλήθος και id
   * της βάσης πριν από την εισαγωγή. Οι νέες παρτίδες παίρνουν συνεχόμενα id, άρα το πλήθος όσων
   * έχουν γίνει COMMIT βγαίνει από το max(id), χωρίς count(*) και χωρίς τα παλιά meta.
   */
  growing: { count: number; maxId: number } | null = null;

  /** `format`: μόνο για νέο αρχείο (π.χ. 1 στα τεστ, για βάση όπως της 2.2.0). */
  constructor(file: string, opts: { create?: boolean; reader?: boolean; format?: number } = {}) {
    if (!opts.create && !fs.existsSync(file)) throw new Error(`Δεν βρέθηκε η βάση ${file}`);
    this.file = file;
    this.reader = Boolean(opts.reader);
    this.db = new DatabaseSync(file);
    // αναμονή αντί για «database is locked» όταν ανοίγουν πολλές συνδέσεις μαζί (workers)
    this.db.exec('PRAGMA busy_timeout=10000;');
    // πριν από το σχήμα: σε βάση νεότερης μορφής δεν πρέπει να φτιαχτούν ούτε πίνακες
    const format = storedFormat(this.db);
    if (format > DB_FORMAT) {
      this.db.close();
      throw new DbFormatError(`Η βάση «${path.basename(file)}» είναι από νεότερη έκδοση του Ruru (μορφή ${format}). Ενημέρωσε το Ruru για να την ανοίξεις.`);
    }
    this.format = format || Math.min(DB_FORMAT, Math.max(1, opts.format ?? DB_FORMAT));
    this.tagCol = this.format >= 2 ? 'tagdata' : 'tags';
    this.tagDict = this.format >= 2 ? new TagDict((sql) => this.prep(sql)) : null;
    if (opts.reader) {
      // σαρώσεις σε workers: μόνο ανάγνωση, χωρίς σχήμα, μικρή cache
      this.db.exec('PRAGMA query_only=1; PRAGMA cache_size=-8192; PRAGMA temp_store=MEMORY;');
      return;
    }
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY;');
    // νέο αρχείο: σχήμα και «format» μαζί, ώστε να μη μείνει ποτέ σχήμα μορφής 2 χωρίς «format»
    if (format === 0) this.db.exec('BEGIN');
    this.db.exec(schema(this.format));
    this.db.exec(INDEXES);
    // κενές εγγραφές λεξικών (id 0 = «?»)
    for (const d of ['players', 'events', 'sites', 'annotators'] as DictName[]) {
      this.db.exec(`INSERT OR IGNORE INTO ${d}(id, name, key) VALUES (0, '', '')`);
    }
    if (format === 0) {
      this.setMeta('format', String(this.format));
      this.db.exec('COMMIT');
    }
  }

  /**
   * ROLLBACK μιας συναλλαγής που άνοιξε ο καλών. Ό,τι μπήκε στα λεξικά (παίκτες, τουρνουά, ετικέτες)
   * μέσα της χάθηκε, άρα ξεχνιούνται και οι κρυφές μνήμες τους· αλλιώς οι επόμενες παρτίδες θα έδειχναν
   * σε id που δεν υπάρχουν.
   */
  rollback(): void {
    this.db.exec('ROLLBACK');
    for (const m of Object.values(this.dicts)) m.clear();
    this.dictLoaded = false;
    this.tagDict?.reset();
  }

  /** Πρόσθετες ετικέτες → τιμή της στήλης `tags`/`tagdata`. */
  private packTags(tags: Record<string, string> | null): Uint8Array | null {
    if (!tags) return null;
    return this.tagDict ? this.tagDict.encode(tags) : packJson(tags);
  }

  /** Τιμή της στήλης `tags`/`tagdata` → ετικέτες (σφάλμα αν είναι χαλασμένες). */
  private unpackTags(raw: unknown): Record<string, string> | null {
    if (raw == null) return null;
    return this.tagDict ? this.tagDict.decode(raw as Uint8Array) : unpackJson<Record<string, string>>(raw);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ήδη κλειστή
    }
  }

  private prep(sql: string): StatementSync {
    let s = this.stmt[sql];
    if (!s) this.stmt[sql] = s = this.db.prepare(sql);
    return s;
  }

  getMeta(key: string): string | null {
    const r = this.prep('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? r.value : null;
  }

  setMeta(key: string, value: string): void {
    this.prep('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  private cachedCount: number | null = null;
  private dataVersion = -1;

  /**
   * Μόνιμη σύνδεση (π.χ. του worker των λιστών): αν έγραψε άλλη σύνδεση από την τελευταία
   * φορά, οι μετρήσεις στη μνήμη δεν ισχύουν πια (ξαναδιαβάζονται από το meta).
   */
  syncCounts(): void {
    const v = (this.prep('PRAGMA data_version').get() as { data_version: number }).data_version;
    if (v === this.dataVersion) return;
    this.dataVersion = v;
    this.cachedCount = null;
    this.cachedStats = null;
    this.speedCache = null;
  }

  /** Πλήθος παρτίδων (με κρυφή μνήμη: σε βάσεις εκατομμυρίων το count(*) κοστίζει). */
  count(): number {
    if (this.growing) return this.growing.count + Math.max(0, this.maxId() - this.growing.maxId);
    if (this.cachedCount !== null) return this.cachedCount;
    const meta = this.getMeta('count');
    if (meta !== null && !this.bulk) return (this.cachedCount = Number(meta));
    const c = (this.prep('SELECT count(*) AS c FROM games').get() as { c: number }).c;
    if (!this.bulk && !this.reader) this.setMeta('count', String(c));
    return (this.cachedCount = c);
  }

  /** Μετά από εγγραφές: οι αποθηκευμένες μετρήσεις/στατιστικά δεν ισχύουν πια. */
  private invalidateCounts(): void {
    this.cachedCount = null;
    this.cachedStats = null;
    this.speedCache = null;
    if (!this.bulk) {
      this.prep("DELETE FROM meta WHERE key IN ('count', 'stats')").run();
      fs.rmSync(this.speedFile(), { force: true });
    }
  }

  minId(): number {
    return (this.prep('SELECT ifnull(min(id), 1) AS m FROM games').get() as { m: number }).m;
  }

  maxId(): number {
    return (this.prep('SELECT ifnull(max(id), 0) AS m FROM games').get() as { m: number }).m;
  }

  // -------------------------------------------------------------------------
  // Ρυθμός (κλασικό / rapid / blitz / αλληλογραφία) ανά τουρνουά

  private speedCache: { sig: string; masks: Uint8Array } | null = null;

  /** Το αρχείο ρυθμών δίπλα στη βάση, όπως τα .pos / .tree. */
  private speedFile(): string {
    return this.file.replace(/\.(skdb|kbdb)$/i, '') + '.speed';
  }

  /**
   * Μάσκα ρυθμού (SPEED_*) για κάθε id τουρνουά: από το όνομα και τις ετικέτες (Mode, TimeControl) της
   * πρώτης παρτίδας του. Υπολογίζεται μία φορά (Lumbras: 600 χιλ. τουρνουά, λίγα δευτερόλεπτα) και μένει στη
   * μνήμη και στο <βάση>.speed· ξαναϋπολογίζεται όταν αλλάξουν οι παρτίδες ή τα τουρνουά.
   */
  eventSpeeds(): Uint8Array {
    const maxEvent = (this.prep('SELECT ifnull(max(id), 0) AS m FROM events').get() as { m: number }).m;
    const sig = `v${SPEED_FILE_VERSION}:${this.count()}:${this.maxId()}:${maxEvent}`;
    if (this.speedCache?.sig === sig) return this.speedCache.masks;
    const file = this.speedFile();
    try {
      const buf = fs.readFileSync(file);
      const nl = buf.indexOf(10);
      if (nl > 0 && buf.subarray(0, nl).toString('utf8') === sig && buf.length - nl - 1 === maxEvent + 1) {
        const masks = new Uint8Array(buf.subarray(nl + 1));
        this.speedCache = { sig, masks };
        return masks;
      }
    } catch {
      // δεν υπάρχει ακόμη
    }
    const masks = new Uint8Array(maxEvent + 1);
    // ονόματα πρώτα· ετικέτες (της πρώτης παρτίδας) μόνο όπου το όνομα δεν αρκεί, διαβασμένες με τη σειρά
    // των id (σειριακά στον δίσκο, όχι σκόρπια)
    const names = new Map<number, string>();
    for (const e of this.db.prepare('SELECT id, name FROM events').iterate() as Iterable<{ id: number; name: string }>) {
      const byName = eventNameSpeed(e.name);
      if (nameDecides(byName)) masks[e.id] = byName;
      else names.set(e.id, e.name);
    }
    const pending: Array<[game: number, event: number]> = [];
    for (const r of this.db.prepare('SELECT event, min(id) AS g FROM games GROUP BY event').iterate() as Iterable<{ event: number; g: number }>) {
      if (names.has(r.event)) pending.push([r.g, r.event]);
    }
    pending.sort((a, b) => a[0] - b[0]);
    const tagsOf = this.db.prepare(`SELECT ${this.tagCol} AS tags FROM games WHERE id = ?`);
    for (const [g, ev] of pending) {
      const raw = (tagsOf.get(g) as { tags: unknown } | undefined)?.tags;
      let tags: Record<string, string> | null = null;
      try {
        tags = this.unpackTags(raw);
      } catch {
        tags = null;
      }
      masks[ev] = eventSpeed(names.get(ev)!, tags);
    }
    this.speedCache = { sig, masks };
    if (this.reader) return masks;
    try {
      fs.writeFileSync(file, Buffer.concat([Buffer.from(sig + '\n', 'utf8'), Buffer.from(masks.buffer, masks.byteOffset, masks.byteLength)]));
    } catch {
      // π.χ. φάκελος μόνο για ανάγνωση: μένει η μνήμη
    }
    return masks;
  }

  // -------------------------------------------------------------------------
  // Μαζική εισαγωγή

  beginBulk(): void {
    this.bulk = true;
    this.db.exec('PRAGMA synchronous=OFF;');
    this.loadDicts();
    this.db.exec('BEGIN');
  }

  commitBulk(intermediate = true): void {
    this.db.exec('COMMIT');
    if (intermediate) this.db.exec('BEGIN');
  }

  endBulk(): void {
    if (this.bulk) this.db.exec('COMMIT');
    this.bulk = false;
    this.invalidateCounts();
    this.db.exec('PRAGMA synchronous=NORMAL;');
  }

  /** Σβήνει τα ευρετήρια πριν από μεγάλη εισαγωγή (ξαναφτιάχνονται στο endBulk). */
  dropIndexes(): void {
    for (const name of ['games_white', 'games_black', 'games_event', 'games_date', 'games_eco']) this.db.exec(`DROP INDEX IF EXISTS ${name}`);
  }

  createIndexes(): void {
    this.db.exec(INDEXES);
  }

  private loadDicts(): void {
    if (this.dictLoaded) return;
    for (const d of Object.keys(this.dicts) as DictName[]) {
      const map = this.dicts[d];
      for (const r of this.db.prepare(`SELECT id, name FROM ${d}`).iterate() as Iterable<{ id: number; name: string }>) map.set(r.name, r.id);
    }
    this.dictLoaded = true;
  }

  private dictId(d: DictName, name: string | undefined): number {
    const n = (name ?? '').trim();
    if (!n || n === '?' || n === '-') return 0;
    this.loadDicts();
    const map = this.dicts[d];
    const id = map.get(n);
    if (id !== undefined) return id;
    const r = this.prep(`INSERT INTO ${d}(name, key) VALUES (?, ?)`).run(n, searchKey(n));
    const nid = Number(r.lastInsertRowid);
    map.set(n, nid);
    return nid;
  }

  private headerColumns(h: Record<string, string>, plies: number, flags: number, fen: string | null) {
    const tags = extraTags(h);
    return [
      this.dictId('players', h.White),
      this.dictId('players', h.Black),
      parseElo(h.WhiteElo),
      parseElo(h.BlackElo),
      this.dictId('events', h.Event),
      this.dictId('sites', h.Site),
      parsePgnDate(h.Date),
      h.Round && h.Round !== '?' && h.Round !== '-' ? h.Round : '',
      parseResult(h.Result),
      /^[A-E]\d\d/.test(h.ECO ?? '') ? h.ECO!.slice(0, 3) : '',
      plies,
      this.dictId('annotators', h.Annotator),
      // μετάλλια στα bits 16–31 (από την ετικέτα Medals)
      (flags & 0xffff) + textToMedals(h.Medals) * 65536,
      fen,
      this.packTags(tags),
    ] as const;
  }

  private batchStmt(rows: number, kind: 'games' | 'moves'): StatementSync {
    const key = `batch:${kind}:${rows}`;
    let s = this.stmt[key];
    if (!s) {
      const sql =
        kind === 'games'
          ? `INSERT INTO games(id, white, black, welo, belo, event, site, date, round, result, eco, plies, annotator, flags, fen, ${this.tagCol}) VALUES ${new Array(rows).fill('(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`
          : `INSERT INTO moves(id, data, comments) VALUES ${new Array(rows).fill('(?,?,?)').join(',')}`;
      this.stmt[key] = s = this.db.prepare(sql);
    }
    return s;
  }

  /** Μαζική εισαγωγή με γνωστά id (firstId, firstId+1, …). */
  insertBatch(games: NewGame[], firstId: number): void {
    this.invalidateCounts();
    const CHUNK = 64;
    for (let k = 0; k < games.length; k += CHUNK) {
      const part = games.slice(k, k + CHUNK);
      const gArgs: Array<number | string | Uint8Array | null> = [];
      const mArgs: Array<number | string | Uint8Array | null> = [];
      part.forEach((g, i) => {
        const id = firstId + k + i;
        gArgs.push(id, ...this.headerColumns(g.headers, g.plies, g.flags, g.fen));
        mArgs.push(id, tokensToBlob(g.tokens), g.packedComments ?? (g.comments ? packJson(g.comments) : null));
      });
      this.batchStmt(part.length, 'games').run(...gArgs);
      this.batchStmt(part.length, 'moves').run(...mArgs);
    }
  }

  insertGame(g: NewGame, id?: number): number {
    this.invalidateCounts();
    const cols = this.headerColumns(g.headers, g.plies, g.flags, g.fen);
    const r = this.prep(
      `INSERT INTO games(id, white, black, welo, belo, event, site, date, round, result, eco, plies, annotator, flags, fen, ${this.tagCol}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id ?? null, ...cols);
    const gid = Number(r.lastInsertRowid);
    this.prep('INSERT INTO moves(id, data, comments) VALUES (?, ?, ?)').run(gid, tokensToBlob(g.tokens), g.packedComments ?? (g.comments ? packJson(g.comments) : null));
    return gid;
  }

  replaceGame(id: number, g: NewGame): void {
    this.invalidateCounts();
    const cols = this.headerColumns(g.headers, g.plies, g.flags, g.fen);
    this.db.exec('BEGIN');
    try {
      this.prep(`UPDATE games SET white=?, black=?, welo=?, belo=?, event=?, site=?, date=?, round=?, result=?, eco=?, plies=?, annotator=?, flags=?, fen=?, ${this.tagCol}=? WHERE id=?`).run(...cols, id);
      this.prep('UPDATE moves SET data=?, comments=? WHERE id=?').run(tokensToBlob(g.tokens), g.comments ? packJson(g.comments) : null, id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.rollback();
      throw e;
    }
  }

  /** ids των παρτίδων με κάποια από τις σημαίες της μάσκας (π.χ. σχολιασμένες). */
  idsWithFlags(mask: number): Int32Array {
    const out: number[] = [];
    for (const r of this.prep('SELECT id FROM games WHERE (flags & ?) <> 0').iterate(mask) as Iterable<{ id: number }>) out.push(r.id);
    return Int32Array.from(out);
  }

  /** Αφαιρεί βαριάντες / σχόλια / σύμβολα / γραφικά από παρτίδες (μία συναλλαγή· UnAnnotateDB). */
  stripGames(ids: ArrayLike<number>, opts: { variations?: boolean; comments?: boolean; nags?: boolean; shapes?: boolean }): void {
    const ANN = GF_VARIATIONS | GF_COMMENTS | GF_NAGS | GF_SHAPES;
    const upMoves = this.prep('UPDATE moves SET data = ?, comments = ? WHERE id = ?');
    const upFlags = this.prep(`UPDATE games SET flags = (flags & ~${ANN}) | ? WHERE id = ?`);
    this.db.exec('BEGIN');
    try {
      for (let i = 0; i < ids.length; i++) {
        const g = this.getGame(ids[i]);
        if (!g) continue;
        const game = decodeGame(g.tokens, g.comments, g.fen ?? START_FEN);
        game.strip(opts);
        const enc = encodeGame(game);
        upMoves.run(tokensToBlob(enc.tokens), enc.comments.length ? packJson(enc.comments) : null, ids[i]);
        upFlags.run(enc.flags & ANN, ids[i]);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Σημαδεύει / ξε-σημαδεύει παρτίδες ως διαγραμμένες· σβήνονται με την οριστική αφαίρεση. */
  setDeleted(ids: number[], deleted: boolean): void {
    const st = this.prep(deleted ? `UPDATE games SET flags = flags | ${GF_DELETED} WHERE id = ?` : `UPDATE games SET flags = flags & ~${GF_DELETED} WHERE id = ?`);
    this.db.exec('BEGIN');
    for (const id of ids) st.run(id);
    this.db.exec('COMMIT');
  }

  /** Οριστική αφαίρεση των σημαδεμένων παρτίδων· επιστρέφει πόσες σβήστηκαν. */
  purgeDeleted(): number {
    this.invalidateCounts();
    this.db.exec('BEGIN');
    this.db.exec(`DELETE FROM moves WHERE id IN (SELECT id FROM games WHERE flags & ${GF_DELETED})`);
    const r = this.prep(`DELETE FROM games WHERE flags & ${GF_DELETED}`).run();
    this.db.exec('COMMIT');
    return Number(r.changes);
  }

  /** Οριστική αφαίρεση συγκεκριμένων παρτίδων (Delete στη λίστα)· επιστρέφει πόσες σβήστηκαν. */
  deleteGames(ids: number[]): number {
    this.invalidateCounts();
    const moves = this.prep('DELETE FROM moves WHERE id = ?');
    const games = this.prep('DELETE FROM games WHERE id = ?');
    let n = 0;
    this.db.exec('BEGIN');
    for (const id of ids) {
      moves.run(id);
      n += Number(games.run(id).changes);
    }
    this.db.exec('COMMIT');
    return n;
  }

  /**
   * Διπλές παρτίδες (ίδιοι παίκτες, αποτέλεσμα, ημικινήσεις, έτος και κινήσεις)· μένει η
   * παλαιότερη, οι ήδη διαγραμμένες δεν μετρούν. Πρώτα υποψήφιες με κλειδί 52 bit από τα
   * πεδία (~20 B ανά παρτίδα, άρα αντέχει και 12 εκατ.), μετά σύγκριση κινήσεων μόνο γι' αυτές.
   */
  /** `onProgress`: (done, total) το πολύ κάθε 250 ms, από 0 ως done = total. */
  doubleIds(onProgress?: (done: number, total: number) => void): Int32Array {
    const minId = this.minId();
    const cap = this.maxId() - minId + 1;
    const ids = new Int32Array(cap);
    const keys = new Float64Array(cap);
    let n = 0;
    // σάρωση όλων των γραμμών ως το SPLIT, έλεγχος κινήσεων των υποψηφίων το υπόλοιπο
    const TOTAL = 1000;
    const SPLIT = 850;
    let last = 0;
    const tick = (done: number) => {
      const now = Date.now();
      if (now - last < 250) return;
      last = now;
      onProgress!(done, TOTAL);
    };
    onProgress?.(0, TOTAL);
    const st = this.prep(`SELECT id, white AS w, black AS b, result AS r, plies AS p, date AS d FROM games WHERE (flags & ${GF_DELETED}) = 0`);
    for (const row of st.iterate() as Iterable<{ id: number; w: number; b: number; r: number; p: number; d: number }>) {
      if (onProgress && (n & 4095) === 4095) tick(Math.min(SPLIT, Math.floor((SPLIT * (row.id - minId + 1)) / cap)));
      const y = Math.floor(row.d / 10000);
      let h1 = Math.imul(row.w, 0x9e3779b1) ^ Math.imul(row.b, 0x85ebca77) ^ Math.imul(row.r * 4096 + row.p, 0xc2b2ae3d) ^ Math.imul(y, 0x27d4eb2f);
      h1 = Math.imul(h1 ^ (h1 >>> 15), 0x2c1b3c6d);
      let h2 = Math.imul(row.w ^ 0x5bd1e995, 0x27d4eb2f) + Math.imul(row.b ^ 0x1b873593, 0x165667b1) + Math.imul(y + row.p * 8, 0x9e3779b1) + row.r;
      h2 = Math.imul(h2 ^ (h2 >>> 13), 0x5bd1e995);
      ids[n] = row.id;
      keys[n++] = ((h1 ^ (h1 >>> 12)) >>> 0) * 1048576 + ((h2 ^ (h2 >>> 15)) & 0xfffff);
    }
    const sorted = keys.slice(0, n).sort();
    const dupKeys = new Set<number>();
    for (let i = 1; i < n; i++) if (sorted[i] === sorted[i - 1]) dupKeys.add(sorted[i]);
    const cand: number[] = [];
    for (let i = 0; i < n; i++) if (dupKeys.has(keys[i])) cand.push(ids[i]);
    cand.sort((a, b) => a - b);
    const one = this.prep('SELECT g.white AS w, g.black AS b, g.result AS r, g.plies AS p, g.date AS d, m.data AS data FROM games g JOIN moves m ON m.id = g.id WHERE g.id = ?');
    const seen = new Set<string>();
    const dups: number[] = [];
    for (let j = 0; j < cand.length; j++) {
      const id = cand[j];
      if (onProgress && (j & 1023) === 1023) tick(SPLIT + Math.floor(((TOTAL - SPLIT) * j) / cand.length));
      const g = one.get(id) as { w: number; b: number; r: number; p: number; d: number; data: Uint8Array } | undefined;
      if (!g) continue;
      const k = `${g.w}|${g.b}|${g.r}|${g.p}|${Math.floor(g.d / 10000)}|${createHash('sha1').update(g.data).digest('base64')}`;
      if (seen.has(k)) dups.push(id);
      else seen.add(k);
    }
    onProgress?.(TOTAL, TOTAL);
    return Int32Array.from(dups);
  }

  // -------------------------------------------------------------------------
  // Ανάγνωση

  private static ROW_SQL = `SELECT g.id, pw.name AS white, pb.name AS black, g.welo, g.belo, e.name AS event, s.name AS site,
      g.date, g.round, g.result, g.eco, g.plies, a.name AS annotator, g.flags
    FROM games g JOIN players pw ON pw.id = g.white JOIN players pb ON pb.id = g.black
    JOIN events e ON e.id = g.event JOIN sites s ON s.id = g.site JOIN annotators a ON a.id = g.annotator`;

  rows(ids: ArrayLike<number>): GameRow[] {
    if (!ids.length) return [];
    const list = Array.from(ids);
    const out = new Map<number, GameRow>();
    for (let k = 0; k < list.length; k += 500) {
      const chunk = list.slice(k, k + 500);
      const sql = `${GameDatabase.ROW_SQL} WHERE g.id IN (${chunk.map(() => '?').join(',')})`;
      for (const r of this.db.prepare(sql).all(...chunk) as unknown as GameRow[]) out.set(r.id, r);
    }
    return list.map((id) => out.get(id)).filter((r): r is GameRow => Boolean(r));
  }

  getGame(id: number): StoredGame | null {
    const row = this.rows([id])[0];
    if (!row) return null;
    const g = this.prep(`SELECT fen, ${this.tagCol} AS tags FROM games WHERE id = ?`).get(id) as { fen: string | null; tags: unknown };
    const m = this.prep('SELECT data, comments FROM moves WHERE id = ?').get(id) as { data: Uint8Array; comments: unknown } | undefined;
    let tags: Record<string, string> | null = null;
    try {
      tags = this.unpackTags(g.tags);
    } catch {
      // χαλασμένες ετικέτες: αγνοούνται
    }
    const headers = rowToHeaders(row, tags);
    if (g.fen) {
      headers.SetUp = '1';
      headers.FEN = g.fen;
    }
    return {
      row,
      headers,
      tokens: m ? blobToTokens(m.data) : new Uint16Array(0),
      comments: m ? unpackJson<string[]>(m.comments) : null,
      fen: g.fen,
    };
  }

  /** Κινήσεις μόνο (για ευρετήρια / αναζητήσεις). */
  moveData(id: number): { tokens: Uint16Array; fen: string | null } | null {
    const m = this.prep('SELECT m.data AS data, g.fen AS fen FROM moves m JOIN games g ON g.id = m.id WHERE m.id = ?').get(id) as { data: Uint8Array; fen: string | null } | undefined;
    return m ? { tokens: blobToTokens(m.data), fen: m.fen } : null;
  }

  /** Επαναλήπτης όλων των παρτίδων (κινήσεις + βασικά πεδία) σε σειρά id. */
  *iterateMoves(fromId = 0): Generator<{ id: number; tokens: Uint16Array; fen: string | null; result: number; welo: number; belo: number; date: number }> {
    const st = this.db.prepare('SELECT g.id AS id, m.data AS data, g.fen AS fen, g.result AS result, g.welo AS welo, g.belo AS belo, g.date AS date FROM games g JOIN moves m ON m.id = g.id WHERE g.id > ? ORDER BY g.id');
    for (const r of st.iterate(fromId) as Iterable<{ id: number; data: Uint8Array; fen: string | null; result: number; welo: number; belo: number; date: number }>) {
      yield { id: r.id, tokens: blobToTokens(r.data), fen: r.fen, result: r.result, welo: r.welo, belo: r.belo, date: r.date };
    }
  }

  /** Επαναλήπτης των παρτίδων (όχι των διαγραμμένων) με τα σχόλιά τους, π.χ. για το δέντρο εκπαίδευσης. */
  *iterateWithComments(): Generator<{ id: number; tokens: Uint16Array; fen: string | null; comments: string[] | null }> {
    const st = this.db.prepare(`SELECT g.id AS id, m.data AS data, g.fen AS fen, m.comments AS comments FROM games g JOIN moves m ON m.id = g.id WHERE (g.flags & ${GF_DELETED}) = 0 ORDER BY g.id`);
    for (const r of st.iterate() as Iterable<{ id: number; data: Uint8Array; fen: string | null; comments: unknown }>) {
      yield { id: r.id, tokens: blobToTokens(r.data), fen: r.fen, comments: unpackJson<string[]>(r.comments) };
    }
  }

  /** Κινήσεις των παρτίδων ενός εύρους id (σαρώσεις σε workers). */
  *movesInRange(from: number, to: number): Generator<{ id: number; tokens: Uint16Array; fen: string | null }> {
    const st = this.prep('SELECT g.id AS id, m.data AS data, g.fen AS fen FROM games g JOIN moves m ON m.id = g.id WHERE g.id BETWEEN ? AND ?');
    for (const r of st.iterate(from, to) as Iterable<{ id: number; data: Uint8Array; fen: string | null }>) {
      yield { id: r.id, tokens: blobToTokens(r.data), fen: r.fen };
    }
  }

  allIds(): Int32Array {
    const n = this.count();
    const out = new Int32Array(n);
    let k = 0;
    // σάρωση στενού ευρετηρίου (πολύ πιο γρήγορη από τον πίνακα με τις ετικέτες)
    let st: StatementSync;
    try {
      st = this.db.prepare('SELECT id FROM games INDEXED BY games_date');
    } catch {
      st = this.db.prepare('SELECT id FROM games');
    }
    st.setReturnArrays(true);
    for (const r of st.iterate() as Iterable<number[]>) {
      if (k < n) out[k++] = r[0];
    }
    const res = k === n ? out : out.slice(0, k);
    return res.sort();
  }

  /** Ταξινόμηση πολλών id κατά όνομα (παίκτης / τουρνουά) στη μνήμη, με σάρωση ευρετηρίου. */
  private sortByName(ids: Int32Array, column: 'white' | 'black' | 'event', desc: boolean): Int32Array {
    const dict = column === 'event' ? 'events' : 'players';
    const maxDict = (this.db.prepare(`SELECT ifnull(max(id), 0) AS m FROM ${dict}`).get() as { m: number }).m;
    const rank = new Int32Array(maxDict + 1);
    let r = 0;
    const ds = this.db.prepare(`SELECT id FROM ${dict} ORDER BY key, id`);
    ds.setReturnArrays(true);
    for (const row of ds.iterate() as Iterable<number[]>) rank[row[0]] = r++;
    const maxId = this.maxId();
    const keyOf = new Int32Array(maxId + 1);
    const gs = this.db.prepare(`SELECT id, ${column} FROM games INDEXED BY games_${column}`);
    gs.setReturnArrays(true);
    for (const row of gs.iterate() as Iterable<number[]>) keyOf[row[0]] = rank[row[1]];
    // σταθερή ταξινόμηση μέτρησης κατά κλειδί (τα id πρώτα σε αύξουσα σειρά)
    const sorted = ids.slice().sort();
    const counts = new Int32Array(r + 1);
    for (let i = 0; i < sorted.length; i++) counts[keyOf[sorted[i]] + 1]++;
    for (let i = 1; i <= r; i++) counts[i] += counts[i - 1];
    const out = new Int32Array(sorted.length);
    for (let i = 0; i < sorted.length; i++) out[counts[keyOf[sorted[i]]]++] = sorted[i];
    return desc ? out.reverse() : out;
  }

  // -------------------------------------------------------------------------
  // Αναζήτηση κεφαλίδων

  /**
   * Ονόματα (παίκτες, τουρνουά…) που ταιριάζουν σε κείμενο αναζήτησης:
   * - με «*»: οπουδήποτε (LIKE)·
   * - μία λέξη ή με κόμμα: από την αρχή του ονόματος, όπως πάντα («carl» → «Carlsen, Magnus»)·
   * - πολλές λέξεις χωρίς κόμμα: και με οποιαδήποτε σειρά, κάθε λέξη αρχή κάποιας λέξης του ονόματος
   *   («Magnus Carlsen» → «Carlsen, Magnus»). Υποψήφια από το ευρετήριο, ένα εύρος ανά λέξη (στο κλειδί
   *   πρώτο είναι το επώνυμο)· τα αρχικά («M») δεν ανοίγουν εύρος, μόνο φιλτράρουν.
   */
  private dictMatch(d: DictName, text: string): number[] | null {
    const key = searchKey(text);
    if (!key) return null;
    if (key.includes('*')) return (this.db.prepare(`SELECT id FROM ${d} WHERE key LIKE ?`).all(key.replace(/\*/g, '%')) as Array<{ id: number }>).map((r) => r.id);
    const range = this.prep(`SELECT id, key FROM ${d} WHERE key >= ? AND key < ?`);
    const ids = new Set<number>();
    for (const r of range.all(key, key + '￿') as Array<{ id: number }>) ids.add(r.id);
    const words = nameWords(key);
    if (key.includes(',') || words.length < 2) return [...ids];
    for (const w of new Set(words)) {
      if (w.length < 2) continue;
      for (const r of range.all(w, w + '￿') as Array<{ id: number; key: string }>) {
        if (ids.has(r.id)) continue;
        const nw = nameWords(r.key);
        if (words.every((q) => nw.some((x) => x.startsWith(q)))) ids.add(r.id);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }

  search(c: SearchCriteria): Int32Array {
    const where: string[] = [];
    const args: Array<number | string> = [];
    const inList = (col: string, ids: number[]) => {
      if (!ids.length) {
        where.push('0');
        return;
      }
      where.push(`${col} IN (${ids.join(',')})`);
    };
    const pw = c.white ? this.dictMatch('players', c.white) : null;
    const pb = c.black ? this.dictMatch('players', c.black) : null;
    if (pw && pb) {
      if (c.ignoreColors) {
        const a = pw.join(',') || '-1';
        const b = pb.join(',') || '-1';
        where.push(`((white IN (${a}) AND black IN (${b})) OR (white IN (${b}) AND black IN (${a})))`);
      } else {
        inList('white', pw);
        inList('black', pb);
      }
    } else if (pw) {
      if (c.ignoreColors) {
        const a = pw.join(',') || '-1';
        where.push(`(white IN (${a}) OR black IN (${a}))`);
      } else inList('white', pw);
    } else if (pb) {
      if (c.ignoreColors) {
        const b = pb.join(',') || '-1';
        where.push(`(white IN (${b}) OR black IN (${b}))`);
      } else inList('black', pb);
    }
    if (c.player) {
      const p = this.dictMatch('players', c.player) ?? [];
      const a = p.join(',') || '-1';
      where.push(`(white IN (${a}) OR black IN (${a}))`);
    }
    if (c.event) inList('event', this.dictMatch('events', c.event) ?? []);
    if (c.site) inList('site', this.dictMatch('sites', c.site) ?? []);
    if (c.annotator) inList('annotator', this.dictMatch('annotators', c.annotator) ?? []);
    if (c.yearFrom) {
      where.push('date >= ?');
      args.push(c.yearFrom * 10000);
    }
    if (c.yearTo) {
      where.push('date < ?');
      args.push((c.yearTo + 1) * 10000);
    }
    if (c.eloFrom) {
      where.push(c.eloBoth ? 'welo >= ? AND belo >= ?' : '(welo >= ? OR belo >= ?)');
      args.push(c.eloFrom, c.eloFrom);
    }
    if (c.eloTo) {
      where.push(c.eloBoth ? 'welo <= ? AND belo <= ?' : '(welo <= ? OR belo <= ?)');
      args.push(c.eloTo, c.eloTo);
    }
    if (c.ecoFrom) {
      where.push('eco >= ?');
      args.push(c.ecoFrom.toUpperCase());
    }
    if (c.ecoTo) {
      where.push('eco <= ? AND eco <> \'\'');
      args.push(c.ecoTo.toUpperCase());
    }
    if (c.results && c.results.length && c.results.length < 4) where.push(`result IN (${c.results.map(Number).join(',')})`);
    if (c.minPlies) {
      where.push('plies >= ?');
      args.push(c.minPlies);
    }
    if (c.maxPlies) {
      where.push('plies <= ?');
      args.push(c.maxPlies);
    }
    if (c.annotated) where.push('(flags & 2) <> 0');
    if (c.medals) where.push(`((flags >> 16) & ${c.medals & 0xffff}) <> 0`);
    if (c.deleted !== undefined) where.push(c.deleted ? `(flags & ${GF_DELETED}) <> 0` : `(flags & ${GF_DELETED}) = 0`);
    if (c.ids) where.push(`id IN (${c.ids.map(Number).join(',') || '-1'})`);
    const speeds = (c.speeds ?? 0) & SPEED_ALL;
    if (speeds && speeds !== SPEED_ALL) {
      // τουρνουά του ρυθμού, ή όσα δεν είναι (όποια λίστα είναι μικρότερη: τα κλασικά είναι τα περισσότερα)
      const masks = this.eventSpeeds();
      const yes: number[] = [];
      const no: number[] = [];
      for (let e = 0; e < masks.length; e++) if (masks[e]) (masks[e] & speeds ? yes : no).push(e);
      if (yes.length <= no.length) where.push(yes.length ? `event IN (${yes.join(',')})` : '0');
      else if (no.length) where.push(`event NOT IN (${no.join(',')})`);
    }
    const sql = `SELECT id FROM games${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id`;
    const out: number[] = [];
    for (const r of this.db.prepare(sql).iterate(...args) as Iterable<{ id: number }>) out.push(r.id);
    if (c.commentText && c.commentText.trim()) {
      const key = searchKey(c.commentText);
      const hits = new Set<number>();
      for (const r of this.db.prepare('SELECT id, comments FROM moves WHERE comments IS NOT NULL').iterate() as Iterable<{ id: number; comments: unknown }>) {
        const list = unpackJson<string[]>(r.comments);
        if (list && list.some((t) => searchKey(t.replace(/\[%[^\]]*\]/g, '')).includes(key))) hits.add(r.id);
      }
      return Int32Array.from(out.filter((id) => hits.has(id)));
    }
    return Int32Array.from(out);
  }

  // -------------------------------------------------------------------------
  // Ταξινόμηση

  /** Ταξινομεί λίστα id κατά στήλη. */
  sortIds(ids: Int32Array, column: string, desc: boolean): Int32Array {
    const sorts: Record<string, [string, string]> = {
      white: ['pw.key', 'JOIN players pw ON pw.id = g.white'],
      black: ['pb.key', 'JOIN players pb ON pb.id = g.black'],
      welo: ['g.welo', ''],
      belo: ['g.belo', ''],
      event: ['e.key', 'JOIN events e ON e.id = g.event'],
      site: ['s.key', 'JOIN sites s ON s.id = g.site'],
      date: ['g.date', ''],
      round: ['CAST(g.round AS INTEGER)', ''],
      result: ['g.result', ''],
      eco: ['g.eco', ''],
      plies: ['g.plies', ''],
      annotator: ['a.key', 'JOIN annotators a ON a.id = g.annotator'],
    };
    const s = sorts[column];
    if (!s) {
      const copy = ids.slice().sort();
      return desc ? copy.reverse() : copy;
    }
    if ((column === 'white' || column === 'black' || column === 'event') && ids.length > 100_000) {
      try {
        return this.sortByName(ids, column, desc);
      } catch {
        // χωρίς ευρετήριο: συνέχεια με SQL
      }
    }
    const dir = desc ? 'DESC' : 'ASC';
    let from = 'games g';
    // σύνδεση ανάγνωσης: το πλήθος της μπορεί να είναι παλιό (βάση που μεγαλώνει), άρα πάντα με τον πίνακα
    if (this.reader || ids.length !== this.count()) {
      // ο προσωρινός πίνακας δεν αγγίζει το αρχείο της βάσης, αλλά το query_only τον απαγορεύει
      if (this.reader) this.db.exec('PRAGMA query_only=0');
      try {
        this.db.exec('DROP TABLE IF EXISTS temp.sel; CREATE TEMP TABLE sel(id INTEGER PRIMARY KEY);');
        const ins = this.db.prepare('INSERT OR IGNORE INTO temp.sel(id) VALUES (?)');
        this.db.exec('BEGIN');
        for (const id of ids) ins.run(id);
        this.db.exec('COMMIT');
      } finally {
        if (this.reader) this.db.exec('PRAGMA query_only=1');
      }
      from = 'temp.sel t JOIN games g ON g.id = t.id';
    }
    const out = new Int32Array(ids.length);
    let k = 0;
    for (const r of this.db.prepare(`SELECT g.id AS id FROM ${from} ${s[1]} ORDER BY ${s[0]} ${dir}, g.id ${dir}`).iterate() as Iterable<{ id: number }>) {
      if (k < out.length) out[k++] = r.id;
    }
    return k === out.length ? out : out.slice(0, k);
  }

  // -------------------------------------------------------------------------
  // Κατάλογοι (παίκτες, τουρνουά)

  players(prefix: string, limit = 200): Array<{ id: number; name: string; games: number; maxElo: number; first: number; last: number }> {
    const key = searchKey(prefix);
    const cols = `p.id, p.name,
          (SELECT count(*) FROM games WHERE white = p.id) + (SELECT count(*) FROM games WHERE black = p.id) AS games`;
    // πολλές λέξεις χωρίς κόμμα («Magnus Carlsen»): με οποιαδήποτε σειρά, όπως στην αναζήτηση
    const anyOrder = !key.includes(',') && !key.includes('*') && nameWords(key).length > 1;
    const ids = anyOrder ? (this.dictMatch('players', prefix) ?? []).slice(0, 5000) : [];
    const rows = (
      anyOrder
        ? ids.length
          ? this.db.prepare(`SELECT ${cols} FROM players p WHERE p.id > 0 AND p.id IN (${ids.join(',')}) ORDER BY p.key LIMIT ?`).all(limit)
          : []
        : this.db.prepare(`SELECT ${cols} FROM players p WHERE p.id > 0 AND p.key >= ? AND p.key < ? ORDER BY p.key LIMIT ?`).all(key, key + '￿', limit)
    ) as Array<{ id: number; name: string; games: number }>;
    return rows.map((r) => {
      const s = this.db
        .prepare(
          `SELECT max(CASE WHEN white = ? THEN welo ELSE belo END) AS maxElo, min(nullif(date,0)) AS first, max(date) AS last FROM games WHERE white = ? OR black = ?`,
        )
        .get(r.id, r.id, r.id) as { maxElo: number | null; first: number | null; last: number | null };
      return { ...r, maxElo: s.maxElo ?? 0, first: s.first ?? 0, last: s.last ?? 0 };
    });
  }

  playerIdByName(name: string): number | null {
    const r = this.prep('SELECT id FROM players WHERE name = ?').get(name) as { id: number } | undefined;
    return r ? r.id : null;
  }

  playerName(id: number): string {
    const r = this.prep('SELECT name FROM players WHERE id = ?').get(id) as { name: string } | undefined;
    return r?.name ?? '';
  }

  // -------------------------------------------------------------------------
  // Βελτίωση βάσης (ImproveDB)

  /** Όλοι οι παίκτες: id → όνομα. */
  playerNames(): Map<number, string> {
    const out = new Map<number, string>();
    for (const r of this.db.prepare('SELECT id, name FROM players WHERE id > 0').iterate() as Iterable<{ id: number; name: string }>) out.set(r.id, r.name);
    return out;
  }

  /** Παρτίδες ανά παίκτη (όνομα → πλήθος, χωρίς τις διαγραμμένες). */
  playerGameCounts(): Map<string, number> {
    const byId = new Map<number, number>();
    for (const col of ['white', 'black']) {
      for (const r of this.db.prepare(`SELECT ${col} AS id, count(*) AS n FROM games WHERE (flags & ${GF_DELETED}) = 0 GROUP BY ${col}`).iterate() as Iterable<{ id: number; n: number }>) {
        byId.set(r.id, (byId.get(r.id) ?? 0) + r.n);
      }
    }
    const out = new Map<string, number>();
    for (const [id, name] of this.playerNames()) {
      const n = byId.get(id);
      if (n) out.set(name, n);
    }
    return out;
  }

  /** Παίκτες με κλειδί αναζήτησης που αρχίζει από `prefix`. */
  playersByKeyPrefix(prefix: string): Array<{ id: number; name: string }> {
    return this.prep('SELECT id, name FROM players WHERE key >= ? AND key < ?').all(prefix, prefix + '￿') as Array<{ id: number; name: string }>;
  }

  playerGames(id: number): number {
    return (this.prep('SELECT (SELECT count(*) FROM games WHERE white = ?1) + (SELECT count(*) FROM games WHERE black = ?1) AS n').get(id) as { n: number }).n;
  }

  /** Ιστορικό Elo ενός παίκτη από τις παρτίδες με γνωστή ημερομηνία. */
  eloHistory(id: number): Array<{ date: number; elo: number }> {
    return this.prep('SELECT date, welo AS elo FROM games WHERE white = ?1 AND welo > 0 AND date > 0 UNION ALL SELECT date, belo AS elo FROM games WHERE black = ?1 AND belo > 0 AND date > 0').all(id) as Array<{ date: number; elo: number }>;
  }

  /** FIDE ID ενός παίκτη από τις ετικέτες των πιο πρόσφατων παρτίδων του ('' αν δεν βρεθεί). */
  fideIdOf(id: number): string {
    for (const [col, tag] of [['white', 'WhiteFideId'], ['black', 'BlackFideId']] as const) {
      for (const r of this.prep(`SELECT ${this.tagCol} AS tags FROM games WHERE ${col} = ? AND ${this.tagCol} IS NOT NULL ORDER BY date DESC LIMIT 8`).all(id) as Array<{ tags: unknown }>) {
        const v = this.unpackTags(r.tags)?.[tag];
        if (v && /^[1-9]\d*$/.test(v)) return v;
      }
    }
    return '';
  }

  /** Παρτίδες με γνωστή ημερομηνία όπου λείπει το Elo κάποιας πλευράς. */
  missingElo(): Array<{ id: number; white: number; black: number; welo: number; belo: number; date: number }> {
    return this.db.prepare(`SELECT id, white, black, welo, belo, date FROM games WHERE (welo = 0 OR belo = 0) AND date > 0 AND (flags & ${GF_DELETED}) = 0`).all() as Array<{ id: number; white: number; black: number; welo: number; belo: number; date: number }>;
  }

  /** Παίκτες και FIDE ID (από τις ετικέτες) κάθε παρτίδας. */
  *fideTags(): Generator<{ id: number; white: number; black: number; wf: string; bf: string }> {
    for (const r of this.db.prepare(`SELECT id, white, black, ${this.tagCol} AS tags FROM games WHERE (flags & ${GF_DELETED}) = 0`).iterate() as Iterable<{ id: number; white: number; black: number; tags: unknown }>) {
      const t = this.unpackTags(r.tags);
      yield { id: r.id, white: r.white, black: r.black, wf: t?.WhiteFideId ?? '', bf: t?.BlackFideId ?? '' };
    }
  }

  /** Μετονομασία παίκτη σε όλες τις παρτίδες (συγχώνευση αν το νέο όνομα υπάρχει ήδη). */
  renamePlayer(from: string, to: string): number {
    const id = this.playerIdByName(from);
    if (id === null || from === to.trim()) return 0;
    const toId = this.dictId('players', to);
    if (!toId) return 0;
    let n = 0;
    this.tx(() => {
      n = Number(this.prep('UPDATE games SET white = ? WHERE white = ?').run(toId, id).changes) + Number(this.prep('UPDATE games SET black = ? WHERE black = ?').run(toId, id).changes);
      this.prep('DELETE FROM players WHERE id = ?').run(id);
    });
    this.dicts.players.delete(from);
    return n;
  }

  /** Συμπλήρωση Elo (μία συναλλαγή). */
  setElos(list: ReadonlyArray<{ id: number; side: 'w' | 'b'; elo: number }>): void {
    const w = this.prep('UPDATE games SET welo = ? WHERE id = ?');
    const b = this.prep('UPDATE games SET belo = ? WHERE id = ?');
    this.tx(() => {
      for (const x of list) (x.side === 'w' ? w : b).run(x.elo, x.id);
    });
    this.invalidateCounts();
  }

  /** Πρόσθετες ετικέτες σε παρτίδες, π.χ. FIDE ID (μία συναλλαγή). */
  addTags(list: ReadonlyArray<{ id: number; tags: Record<string, string> }>): void {
    const get = this.prep(`SELECT ${this.tagCol} AS tags FROM games WHERE id = ?`);
    const put = this.prep(`UPDATE games SET ${this.tagCol} = ? WHERE id = ?`);
    this.tx(() => {
      for (const x of list) {
        const r = get.get(x.id) as { tags: unknown } | undefined;
        if (r) put.run(this.packTags({ ...(this.unpackTags(r.tags) ?? {}), ...x.tags }), x.id);
      }
    });
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.rollback();
      throw e;
    }
  }

  tournaments(prefix: string, limit = 300): Array<{ event: string; site: string; year: number; games: number; eventId: number; siteId: number }> {
    const key = searchKey(prefix);
    // πρώτα τα τουρνουά (λεξικό), μετά μόνο οι δικές τους παρτίδες — γρήγορο και σε τεράστιες βάσεις
    const eventIds = key
      ? (this.db.prepare('SELECT id FROM events WHERE key >= ? AND key < ? ORDER BY key LIMIT ?').all(key, key + '￿', limit) as Array<{ id: number }>).map((r) => r.id)
      : (this.db.prepare('SELECT DISTINCT event AS id FROM (SELECT event FROM games ORDER BY id DESC LIMIT 50000) LIMIT ?').all(limit) as Array<{ id: number }>).map((r) => r.id);
    if (!eventIds.length) return [];
    return this.db
      .prepare(
        `SELECT e.name AS event, s.name AS site, g.date / 10000 AS year, count(*) AS games, g.event AS eventId, g.site AS siteId
         FROM games g JOIN events e ON e.id = g.event JOIN sites s ON s.id = g.site
         WHERE g.event IN (${eventIds.join(',')})
         GROUP BY g.event, g.site, g.date / 10000 ORDER BY year DESC, e.key LIMIT ?`,
      )
      .all(limit) as Array<{ event: string; site: string; year: number; games: number; eventId: number; siteId: number }>;
  }

  tournamentGames(eventId: number, siteId: number, year: number): Int32Array {
    const out: number[] = [];
    for (const r of this.db
      .prepare('SELECT id FROM games WHERE event = ? AND site = ? AND date / 10000 = ? ORDER BY id')
      .iterate(eventId, siteId, year) as Iterable<{ id: number }>) out.push(r.id);
    return Int32Array.from(out);
  }

  /** Βασικά στατιστικά της βάσης. */
  private cachedStats: DbStats | null = null;
  /** τα στατιστικά του meta είναι από παλιότερο τύπο (ξαναϋπολογισμός με `refreshStats`, σε worker) */
  statsOutdated = false;

  stats(): DbStats {
    if (this.cachedStats) return this.cachedStats;
    const meta = this.getMeta('stats');
    if (meta) {
      const { v, ...s } = JSON.parse(meta) as DbStats & { v?: number };
      this.statsOutdated = v !== STATS_VERSION;
      return (this.cachedStats = s);
    }
    const s = this.computeStats();
    this.statsOutdated = false;
    if (!this.reader) this.setMeta('stats', JSON.stringify({ ...s, v: STATS_VERSION }));
    return (this.cachedStats = s);
  }

  /** Τα στατιστικά ξαναδιαβάζονται από το meta (π.χ. μετά από `refreshStats` άλλης σύνδεσης). */
  forgetStats(): void {
    this.cachedStats = null;
  }

  /**
   * Ξαναϋπολογίζει τα στατιστικά και τα γράφει στο meta σε μία συναλλαγή: αν η βάση άλλαξε από
   * άλλη σύνδεση στο μεταξύ, δεν γράφεται τίποτα (false). `beforeWrite`: μόνο για τα τεστ.
   */
  refreshStats(beforeWrite?: () => void): boolean {
    this.db.exec('BEGIN');
    try {
      const s = this.computeStats();
      beforeWrite?.();
      this.setMeta('stats', JSON.stringify({ ...s, v: STATS_VERSION }));
      this.db.exec('COMMIT');
      this.cachedStats = s;
      this.statsOutdated = false;
      return true;
    } catch {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // η συναλλαγή έκλεισε ήδη
      }
      return false;
    }
  }

  private computeStats(): DbStats {
    const g = this.prep(
      `SELECT count(*) AS games, min(nullif(date, 0)) AS first, max(date) AS last,
        sum(result = 1) AS w, sum(result = 2) AS d, sum(result = 3) AS b, sum(result = 0) AS u,
        (coalesce(sum(nullif(welo, 0)), 0) + coalesce(sum(nullif(belo, 0)), 0)) * 1.0
          / nullif(count(nullif(welo, 0)) + count(nullif(belo, 0)), 0) AS avgElo FROM games`,
    ).get() as { games: number; first: number | null; last: number | null; w: number; d: number; b: number; u: number; avgElo: number | null };
    const p = (this.prep('SELECT count(*) AS c FROM players').get() as { c: number }).c - 1;
    const e = (this.prep('SELECT count(*) AS c FROM events').get() as { c: number }).c - 1;
    return {
      games: g.games,
      players: p,
      events: e,
      firstYear: g.first ? Math.floor(g.first / 10000) : 0,
      lastYear: g.last ? Math.floor(g.last / 10000) : 0,
      results: [g.w ?? 0, g.d ?? 0, g.b ?? 0, g.u ?? 0],
      avgElo: Math.round(g.avgElo ?? 0),
    };
  }

  /**
   * Μετατροπή βάσης μορφής 1 στην τρέχουσα (μόνο με κουμπί, ποτέ αυτόματα). Γράφεται νέο αρχείο
   * δίπλα (`<αρχείο>.convert`) με τις ίδιες παρτίδες και τα ίδια id (άρα ισχύουν τα .pos/.tree/.speed),
   * μετά το παλιό γίνεται αντίγραφο ασφαλείας `<αρχείο>.bak` και το νέο παίρνει τη θέση του. Ως εκείνη
   * τη στιγμή το αρχικό αρχείο μένει ανέγγιχτο· σε σφάλμα ή ακύρωση σβήνει μόνο το μισό νέο.
   * Οι υπόλοιπες συνδέσεις στη βάση πρέπει να έχουν κλείσει.
   */
  static async convertToCurrentFormat(
    file: string,
    opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<{ backup: string; before: number; after: number }> {
    const tmp = `${file}.convert`;
    const clean = () => {
      for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });
    };
    clean();
    const before = fs.statSync(file).size;
    const src = new GameDatabase(file);
    let dst: GameDatabase | null = null;
    try {
      if (src.format >= DB_FORMAT) throw new Error('Η βάση έχει ήδη τη νέα μορφή');
      const free = fs.statfsSync(path.dirname(file));
      if (free.bavail * free.bsize < before + 256 * 1024 * 1024) throw new Error(`Δεν υπάρχει αρκετός ελεύθερος χώρος στον δίσκο (χρειάζονται έως ${Math.ceil(before / 1024 ** 2)} MB).`);
      const total = (src.prep('SELECT count(*) AS n FROM games').get() as { n: number }).n;
      const span = src.prep('SELECT ifnull(min(id), 1) AS lo, ifnull(max(id), 0) AS hi FROM games').get() as { lo: number; hi: number };
      const d = (dst = new GameDatabase(tmp, { create: true }));
      d.dropIndexes();
      d.db.prepare('ATTACH DATABASE ? AS v1').run(file);
      d.db.exec('PRAGMA synchronous=OFF');
      d.db.exec('BEGIN');
      for (const t of ['players', 'events', 'sites', 'annotators']) d.db.exec(`INSERT OR REPLACE INTO main.${t}(id, name, key) SELECT id, name, key FROM v1.${t}`);
      d.db.exec("INSERT OR REPLACE INTO main.meta(key, value) SELECT key, value FROM v1.meta WHERE key <> 'format'");
      const moves = d.db.prepare('INSERT INTO main.moves(id, data, comments) SELECT id, data, comments FROM v1.moves WHERE id BETWEEN ? AND ?');
      const rows = d.db.prepare('SELECT id, white, black, welo, belo, event, site, date, round, result, eco, plies, annotator, flags, fen, tags FROM v1.games WHERE id BETWEEN ? AND ? ORDER BY id');
      const ins = d.db.prepare('INSERT INTO main.games(id, white, black, welo, belo, event, site, date, round, result, eco, plies, annotator, flags, fen, tagdata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      type Row = { id: number; white: number; black: number; welo: number; belo: number; event: number; site: number; date: number; round: string; result: number; eco: string; plies: number; annotator: number; flags: number; fen: string | null; tags: unknown };
      let done = 0;
      const STEP = 20_000;
      for (let a = span.lo; a <= span.hi; a += STEP) {
        opts.signal?.throwIfAborted();
        moves.run(a, a + STEP - 1);
        for (const r of rows.iterate(a, a + STEP - 1) as Iterable<Row>) {
          let tags: Record<string, string> | null = null;
          try {
            tags = unpackJson<Record<string, string>>(r.tags);
          } catch {
            // χαλασμένες ετικέτες: και η ανάγνωση της μορφής 1 τις αγνοεί
          }
          ins.run(r.id, r.white, r.black, r.welo, r.belo, r.event, r.site, r.date, r.round, r.result, r.eco, r.plies, r.annotator, r.flags, r.fen, d.packTags(tags));
          done++;
        }
        d.db.exec('COMMIT');
        opts.onProgress?.(done, total);
        await new Promise((res) => setImmediate(res));
        d.db.exec('BEGIN');
      }
      d.db.exec('COMMIT');
      d.db.exec('PRAGMA synchronous=NORMAL');
      const count = (sql: string) => (d.db.prepare(sql).get() as { n: number }).n;
      if (count('SELECT count(*) AS n FROM main.games') !== total || count('SELECT count(*) AS n FROM main.moves') !== count('SELECT count(*) AS n FROM v1.moves')) {
        throw new Error('Η μετατροπή δεν βγήκε πλήρης· η βάση έμεινε όπως ήταν.');
      }
      d.db.exec('DETACH DATABASE v1');
      d.createIndexes();
      d.db.exec('ANALYZE');
      d.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      d.close();
      dst = null;
      src.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      src.close();
    } catch (e) {
      dst?.close();
      src.close();
      clean();
      throw e;
    }
    const wal = `${file}-wal`;
    if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
      clean();
      throw new Error('Η βάση είναι ανοιχτή και αλλού (π.χ. σε άλλο παράθυρο του Ruru)· κλείσ\' την και ξαναδοκίμασε.');
    }
    let backup = `${file}.bak`;
    for (let i = 2; fs.existsSync(backup); i++) backup = `${file}.${i}.bak`;
    try {
      fs.renameSync(file, backup);
    } catch (e) {
      clean();
      throw new Error(`Η βάση είναι σε χρήση και δεν αντικαταστάθηκε (${(e as Error).message}).`);
    }
    for (const f of [wal, `${file}-shm`]) fs.rmSync(f, { force: true });
    try {
      fs.renameSync(tmp, file);
    } catch (e) {
      fs.renameSync(backup, file);
      clean();
      throw e;
    }
    return { backup, before, after: fs.statSync(file).size };
  }
}

export interface DbStats {
  games: number;
  players: number;
  events: number;
  firstYear: number;
  lastYear: number;
  results: number[];
  avgElo: number;
}

export function rowToHeaders(row: GameRow, tags: Record<string, string> | null): Record<string, string> {
  const h: Record<string, string> = {
    Event: row.event || '?',
    Site: row.site || '?',
    Date: formatPgnDate(row.date),
    Round: row.round || '?',
    White: row.white || '?',
    Black: row.black || '?',
    Result: RESULT_TEXT[row.result] ?? '*',
  };
  if (row.welo) h.WhiteElo = String(row.welo);
  if (row.belo) h.BlackElo = String(row.belo);
  if (row.eco) h.ECO = row.eco;
  if (row.annotator) h.Annotator = row.annotator;
  const medals = medalsOfFlags(row.flags);
  if (medals) h.Medals = medalsToText(medals);
  if (tags) Object.assign(h, tags);
  return h;
}
