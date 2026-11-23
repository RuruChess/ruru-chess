/** Οι δύο βάσεις της Τακτικής: puzzles.sqlite (ξαναχτίζεται από τις πηγές) και tactics-user.sqlite (η πρόοδος του χρήστη). */
import fs from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { THEMES } from './themes.ts';

/** Σημαίες puzzle (στήλη flags· μπαίνει στο ευρετήριο επιλογής). */
export const F_WHITE = 1; // ο λύτης παίζει με τα λευκά
export const F_MATE = 2; // η λύση τελειώνει με ματ
export const F_INACTIVE = 4; // δεν υπάρχει πια στην πηγή· μένει για το ιστορικό του χρήστη
export const F_OWN = 8; // από τις παρτίδες του χρήστη
export const F_PRE = 16; // η πρώτη κίνηση της γραμμής είναι του αντιπάλου (μορφή Lichess)
export const F_UNRATED = 32; // βαθμός κατά προσέγγιση· όχι στον βαθμολογημένο τρόπο
export const F_TEST = 64; // θέση τεστ (EPD: πολλές σωστές κινήσεις, βαθμοί STS)
export const F_PRACTICE = 128; // εξάσκηση με στόχο απέναντι στη μηχανή
export const F_STALE = 256; // προσωρινό σημάδι κατά την επανεισαγωγή

export const LICHESS_SOURCE_ID = 1;

const PUZZLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS source(
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, name TEXT, license TEXT, url TEXT,
  version TEXT, imported_at INT, n INT NOT NULL DEFAULT 0, info TEXT);
CREATE TABLE IF NOT EXISTS theme(
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name_el TEXT, name_en TEXT, desc_el TEXT, desc_en TEXT,
  grp TEXT, weight_class TEXT, n INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS opening(id INTEGER PRIMARY KEY, family TEXT NOT NULL, tags TEXT NOT NULL UNIQUE, n INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS puzzle(
  id INTEGER PRIMARY KEY,
  source_id INT NOT NULL,
  pos BLOB NOT NULL,
  line BLOB NOT NULL,
  rating INT NOT NULL, rd INT, pop INT, plays INT,
  th1 INT NOT NULL DEFAULT 0, th2 INT NOT NULL DEFAULT 0,
  opening_id INT, game TEXT, ply INT, goal TEXT, meta TEXT,
  flags INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS daily(day TEXT PRIMARY KEY, puzzle_id INT NOT NULL) WITHOUT ROWID;
`;

/** Ευρετήρια επιλογής: το πρώτο καλύπτει πλήρως την αναζήτηση βαθμού + θεμάτων + χρώματος. */
export const PUZZLE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS ix_puzzle_rating ON puzzle(rating, th1, th2, flags)',
  'CREATE INDEX IF NOT EXISTS ix_puzzle_opening ON puzzle(opening_id, rating) WHERE opening_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS ix_puzzle_source ON puzzle(source_id, rating) WHERE source_id <> 1',
];

const USER_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS attempt(
  id INTEGER PRIMARY KEY, puzzle_id INT NOT NULL, ts INT NOT NULL, mode TEXT NOT NULL,
  win INT NOT NULL, first_try INT NOT NULL, ms INT, hints INT NOT NULL DEFAULT 0, wrong_uci TEXT,
  r_before REAL, r_after REAL, b_before REAL, b_after REAL, p_rating INT, p_moves INT, theme_angle TEXT,
  ctx INT, moves_ok INT, score REAL);
CREATE INDEX IF NOT EXISTS ix_attempt_puzzle ON attempt(puzzle_id);
CREATE INDEX IF NOT EXISTS ix_attempt_ts ON attempt(ts);
CREATE INDEX IF NOT EXISTS ix_attempt_ctx ON attempt(ctx, mode) WHERE ctx IS NOT NULL;
CREATE TABLE IF NOT EXISTS rating(mode TEXT PRIMARY KEY, r REAL NOT NULL, rd REAL NOT NULL, vol REAL NOT NULL, n INT NOT NULL DEFAULT 0, updated INT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS deck(id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, params TEXT, created INT NOT NULL);
CREATE TABLE IF NOT EXISTS card(
  deck_id INT NOT NULL, puzzle_id INT NOT NULL, due INT NOT NULL,
  stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0, scheduled INT NOT NULL DEFAULT 0,
  learning_steps INT NOT NULL DEFAULT 0, reps INT NOT NULL DEFAULT 0, lapses INT NOT NULL DEFAULT 0,
  state INT NOT NULL DEFAULT 0, last INT, added INT NOT NULL, ord INT NOT NULL DEFAULT 0,
  PRIMARY KEY(deck_id, puzzle_id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_card_due ON card(deck_id, due);
CREATE INDEX IF NOT EXISTS ix_card_puzzle ON card(puzzle_id);
CREATE TABLE IF NOT EXISTS cycle(
  id INTEGER PRIMARY KEY, deck_id INT NOT NULL, n INT NOT NULL, started INT NOT NULL, finished INT,
  target_days INT NOT NULL, solved INT NOT NULL DEFAULT 0, correct INT NOT NULL DEFAULT 0,
  total_ms INT NOT NULL DEFAULT 0, points INT NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_cycle_deck ON cycle(deck_id, n);
CREATE TABLE IF NOT EXISTS run(id INTEGER PRIMARY KEY, mode TEXT NOT NULL, ts INT NOT NULL, score INT NOT NULL, best_combo INT, errors INT, top_rating INT, ms INT, info TEXT);
CREATE INDEX IF NOT EXISTS ix_run_mode ON run(mode, score);
CREATE TABLE IF NOT EXISTS flag(puzzle_id INTEGER PRIMARY KEY, bad INT NOT NULL DEFAULT 1, note TEXT, ts INT NOT NULL);
CREATE TABLE IF NOT EXISTS gen_job(id INTEGER PRIMARY KEY, db TEXT, filter TEXT, nodes INT, state TEXT, done INT, total INT, found INT, started INT);
`;

/** Κοινή βάση των δύο αρχείων: σύνδεση, ρυθμίσεις SQLite, κρυφή μνήμη προετοιμασμένων εντολών. */
class Sqlite {
  readonly db: DatabaseSync;
  readonly file: string;
  private stmts = new Map<string, StatementSync>();

  constructor(file: string, schema: string) {
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY;');
    this.db.exec(schema);
  }

  /** Προετοιμασμένη εντολή (μία φορά ανά κείμενο SQL). */
  prep(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  getMeta(k: string): string | null {
    const r = this.prep('SELECT v FROM meta WHERE k = ?').get(k) as { v: string } | undefined;
    return r ? r.v : null;
  }

  setMeta(k: string, v: string | null): void {
    if (v === null) this.prep('DELETE FROM meta WHERE k = ?').run(k);
    else this.prep('INSERT INTO meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
  }

  getJson<T>(k: string): T | null {
    const v = this.getMeta(k);
    if (v === null) return null;
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }

  setJson(k: string, v: unknown): void {
    this.setMeta(k, v === null ? null : JSON.stringify(v));
  }

  /** Συναλλαγή: όλα ή τίποτα. */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  size(): number {
    let n = 0;
    for (const f of [this.file, this.file + '-wal']) {
      try {
        n += fs.statSync(f).size;
      } catch {
        // δεν υπάρχει
      }
    }
    return n;
  }

  close(): void {
    this.stmts.clear();
    try {
      this.db.close();
    } catch {
      // ήδη κλειστή
    }
  }
}

export interface PuzzleRow {
  id: number;
  source_id: number;
  pos: Uint8Array;
  line: Uint8Array;
  rating: number;
  rd: number | null;
  pop: number | null;
  plays: number | null;
  th1: number;
  th2: number;
  opening_id: number | null;
  game: string | null;
  ply: number | null;
  goal: string | null;
  meta: string | null;
  flags: number;
}

/** puzzles.sqlite: τα puzzles όλων των πηγών, τα θέματα, τα ανοίγματα. */
export class PuzzleDb extends Sqlite {
  constructor(file: string) {
    super(file, PUZZLE_SCHEMA);
    this.db.exec('PRAGMA cache_size=-65536;');
    // Τα ευρετήρια φτιάχνονται εδώ μόνο σε άδειο πίνακα (αμέσως). Σε γεμάτο πίνακα χωρίς ευρετήρια
    // (εισαγωγή που κόπηκε με κλείσιμο του server) θα «πάγωνε» ο server ~10 s: τα φτιάχνει worker (`missingIndexes`).
    if (!this.prep('SELECT 1 FROM puzzle LIMIT 1').get()) for (const sql of PUZZLE_INDEXES) this.db.exec(sql);
    this.syncThemes();
  }

  /** Λείπει κάποιο από τα ευρετήρια επιλογής; (χωρίς αυτά κάθε επιλογή σαρώνει όλο τον πίνακα) */
  missingIndexes(): boolean {
    const n = (this.prep("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name IN ('ix_puzzle_rating', 'ix_puzzle_opening', 'ix_puzzle_source')").get() as { n: number }).n;
    return n < PUZZLE_INDEXES.length;
  }

  /** Ο πίνακας theme ακολουθεί το puzzle-themes.json (id = bit). */
  private syncThemes(): void {
    const st = this.prep(
      `INSERT INTO theme(id, key, name_el, name_en, desc_el, desc_en, grp, weight_class) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET key = excluded.key, name_el = excluded.name_el, name_en = excluded.name_en,
         desc_el = excluded.desc_el, desc_en = excluded.desc_en, grp = excluded.grp, weight_class = excluded.weight_class`,
    );
    this.tx(() => {
      for (const t of THEMES) if (t.bit !== null) st.run(t.bit, t.key, t.el, t.en, t.descEl, t.descEn, t.group, t.weight);
    });
  }

  get(id: number): PuzzleRow | undefined {
    return this.prep('SELECT * FROM puzzle WHERE id = ?').get(id) as PuzzleRow | undefined;
  }

  /** Πολλά puzzles (σε κομμάτια των 500 για το όριο παραμέτρων της SQLite). */
  getMany(ids: readonly number[]): Map<number, PuzzleRow> {
    const out = new Map<number, PuzzleRow>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.db.prepare(`SELECT * FROM puzzle WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as unknown as PuzzleRow[];
      for (const r of rows) out.set(r.id, r);
    }
    return out;
  }

  sourceId(key: string): number | null {
    const r = this.prep('SELECT id FROM source WHERE key = ?').get(key) as { id: number } | undefined;
    return r ? r.id : null;
  }
}

/** tactics-user.sqlite: προσπάθειες, βαθμοί, τράπουλες, κύκλοι Woodpecker, γρήγοροι γύροι. Δεν σβήνεται ποτέ από εισαγωγές. */
export class UserDb extends Sqlite {
  constructor(file: string) {
    super(file, USER_SCHEMA);
    // η πρόοδος του χρήστη: πλήρης συγχρονισμός στον δίσκο
    this.db.exec('PRAGMA synchronous=FULL;');
  }

  /** Puzzles που αναφέρονται στην πρόοδο (δεν σβήνονται ποτέ από επανεισαγωγή). */
  referencedIds(): Set<number> {
    const out = new Set<number>();
    for (const sql of ['SELECT DISTINCT puzzle_id AS id FROM attempt', 'SELECT DISTINCT puzzle_id AS id FROM card', 'SELECT puzzle_id AS id FROM flag']) {
      for (const r of this.db.prepare(sql).iterate() as Iterable<{ id: number }>) out.add(r.id);
    }
    return out;
  }
}
