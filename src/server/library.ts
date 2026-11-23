/**
 * Κατάλογος βάσεων (το «παράθυρο βάσεων»), εργασίες εισαγωγής και ρυθμίσεις.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameDatabase } from './db/store.ts';
import { PositionIndex } from './db/posindex.ts';
import { importAny, rebuildIndex, type ImportProgress } from './db/importer.ts';
import { APP_DIR, defaultDatabasesDir, ensureDir, migrateAppDir, quickFolders, readPreset, relocateLegacy } from './paths.ts';
import { safeFileName } from './text.ts';
import { CbhDatabase } from './formats/cbh.ts';
import { extractCbv } from './formats/cbv.ts';

export interface DbSource {
  path: string;
  size: number;
  mtime: number;
  kind: string;
}

export interface DbEntry {
  id: string;
  name: string;
  file: string;
  kind: 'user' | 'clipboard' | 'mygames' | 'imported';
  source?: DbSource;
  created: number;
  lastOpened?: number;
  /** από πού ήρθε: «Βιβλίο σε βάση» (για τα φίλτρα και τις ετικέτες των Βάσεων) */
  origin?: 'book';
}

/** Η προέλευση μιας βάσης· οι βάσεις του «Βιβλίο σε βάση» πριν από το πεδίο `origin` φαίνονται από το προσωρινό PGN τους. */
export function originOf(e: Pick<DbEntry, 'origin' | 'source'>): DbEntry['origin'] {
  if (e.origin) return e.origin;
  // και skakibase-book: βάσεις από πριν από τη μετονομασία
  return e.source && /[\\/](knightbase|skakibase)-book[\\/]/i.test(e.source.path) ? 'book' : undefined;
}

export interface Job {
  id: string;
  dbId: string;
  kind: 'import' | 'index' | 'edit' | 'convert';
  title: string;
  progress: ImportProgress;
  status: 'running' | 'done' | 'error' | 'cancelled';
  error?: string;
  started: number;
  abort: AbortController;
}

export interface EngineConfig {
  id: string;
  name: string;
  path: string;
  options: Record<string, string | number | boolean>;
  /** ορίσματα γραμμής εντολών (Lc0: --weights=…) */
  args?: string[];
  /** «ανθρώπινη» μηχανή (Maia): παίζει σαν άνθρωπος αυτού του Elo, με έναν κόμβο ανά κίνηση */
  human?: { elo: number };
  /** η Leela (Lc0 με κανονικό δίκτυο) */
  leela?: boolean;
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
  /** «Οι παρτίδες μου» αυτόματα από Lichess / Chess.com (null ή χωρίς usernames: κλειστό) */
  myGames?: { lichess?: string; chesscom?: string } | null;
  bookPath?: string;
  [k: string]: unknown;
}

const LIB_FILE = path.join(APP_DIR, 'library.json');
const SETTINGS_FILE = path.join(APP_DIR, 'settings.json');

/** Γλώσσα στην πρώτη εκκίνηση: αυτή του εγκαταστάτη (preset.json), αλλιώς των Windows. */
function defaultLanguage(): 'el' | 'en' {
  const l = readPreset().language;
  if (l === 'el' || l === 'en') return l;
  return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('el') ? 'el' : 'en';
}

function idFor(file: string): string {
  return crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 12);
}

/** Κατάληξη των νέων βάσεων· οι παλιές .skdb (από πριν από τη μετονομασία) ανοίγουν κανονικά. */
export const DB_EXT = '.kbdb';
const DB_FILE = /\.(kbdb|skdb)$/i;

export const isDbFile = (file: string): boolean => DB_FILE.test(file);

export function baseOf(file: string): string {
  return file.replace(DB_FILE, '');
}

const dbName = (file: string): string => path.basename(baseOf(file));

/** Υπάρχει ήδη βάση με αυτό το όνομα (χωρίς κατάληξη); Και με την άλλη κατάληξη: τα .pos/.tree θα ήταν κοινά. */
const nameTaken = (base: string): boolean => ['.kbdb', '.skdb', '.pos', '.tree'].some((x) => fs.existsSync(base + x));

interface OpenDb {
  db: GameDatabase;
  index: PositionIndex | null;
}

/** Ό,τι αλλάζει τη βάση ή θέλει το ευρετήριο θέσεων (αναζήτηση θέσης, δέντρο, βιβλίο…) περιμένει το τέλος της εισαγωγής. */
export const AFTER_IMPORT = 'Η βάση εισάγεται ακόμη· αυτό γίνεται μόλις τελειώσει η εισαγωγή.';

export class Library {
  entries: DbEntry[] = [];
  settings: Settings;
  jobs = new Map<string, Job>();
  private open = new Map<string, OpenDb>();
  /** βάσεις που εισάγονται: πλήθος και μέγιστο id πριν από την εισαγωγή (για τη σύνδεση ανάγνωσης) */
  private importBase = new Map<string, { count: number; maxId: number }>();
  onJob: (job: Job) => void = () => {};

  constructor() {
    migrateAppDir();
    ensureDir(APP_DIR);
    this.settings = this.loadSettings();
    ensureDir(this.settings.databasesDir);
    try {
      this.entries = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')) as DbEntry[];
    } catch {
      this.entries = [];
    }
    // πριν από το φιλτράρισμα: μετά τη μετονομασία οι βάσεις είναι στο Έγγραφα\Ruru
    this.entries = relocateLegacy(this.entries).value;
    this.entries = this.entries.filter((e) => fs.existsSync(e.file));
    this.ensureDefaults();
    this.save();
  }

  private loadSettings(): Settings {
    const defaults: Settings = {
      language: defaultLanguage(),
      databasesDir: defaultDatabasesDir(),
      engines: [],
      defaultEngine: null,
      boardTheme: 'classic',
      pieceSet: 'cburnett',
      showCoordinates: true,
      animationMs: 150,
      onlineLookups: true,
      watchLive: true,
    };
    try {
      const saved = relocateLegacy(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<Settings>);
      const settings = { ...defaults, ...saved.value };
      // το θέμα σκακιέρας μετονομάστηκε στην 3.0.0: όποιος το είχε διαλέξει το κρατά
      if (settings.boardTheme === 'chessbase') settings.boardTheme = 'slate';
      if (saved.changed) fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      return settings;
    } catch {
      return defaults;
    }
  }

  /** ειδοποίηση για κάθε αποθήκευση ρυθμίσεων (ο server τη στέλνει σε όλα τα παράθυρα) */
  onSettingsChange: ((s: Settings) => void) | null = null;
  /** προσθήκη παρτίδων (PGN) σε βάση, με ενημέρωση των παραθύρων· το ορίζει το api.ts. Πόσες μπήκαν. */
  addPgn: ((id: string, pgn: string) => number) | null = null;

  saveSettings(patch: Partial<Settings>): Settings {
    this.settings = { ...this.settings, ...patch };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
    this.onSettingsChange?.(this.settings);
    return this.settings;
  }

  save(): void {
    fs.writeFileSync(LIB_FILE, JSON.stringify(this.entries, null, 2));
  }

  private ensureDefaults(): void {
    const dir = this.settings.databasesDir;
    const want: Array<[DbEntry['kind'], string]> = [['mygames', 'Οι παρτίδες μου']];
    for (const [kind, name] of want) {
      if (this.entries.some((e) => e.kind === kind)) continue;
      // παλιό αρχείο .skdb με το ίδιο όνομα: το ίδιο (όχι δεύτερο δίπλα του, με κοινά .pos/.tree)
      const old = path.join(dir, `${name}.skdb`);
      const file = fs.existsSync(old) ? old : path.join(dir, name + DB_EXT);
      new GameDatabase(file, { create: true }).close();
      this.entries.push({ id: idFor(file), name, file, kind, created: Date.now() });
    }
  }

  find(id: string): DbEntry {
    const e = this.entries.find((x) => x.id === id);
    if (!e) throw new HttpError(404, 'Δεν βρέθηκε η βάση');
    return e;
  }

  busy(id: string): Job | undefined {
    for (const j of this.jobs.values()) if (j.dbId === id && j.status === 'running') return j;
    return undefined;
  }

  /** Ανοιχτή σύνδεση στη βάση (με το ευρετήριο θέσεων αν υπάρχει). */
  handle(id: string): OpenDb {
    const e = this.find(id);
    const job = this.busy(id);
    if (job && job.kind === 'import') throw new HttpError(409, AFTER_IMPORT);
    if (job && job.kind === 'convert') throw new HttpError(409, 'Η βάση μετατρέπεται στη νέα μορφή…');
    let h = this.open.get(id);
    // η σύνδεση ανάγνωσης της εισαγωγής δεν μένει μετά το τέλος της
    if (h?.db.growing) {
      this.closeHandle(id);
      h = undefined;
    }
    if (!h) {
      const db = new GameDatabase(e.file);
      const base = baseOf(e.file);
      let index: PositionIndex | null = null;
      if (PositionIndex.exists(base)) {
        try {
          index = new PositionIndex(base);
        } catch {
          index = null;
        }
      }
      h = { db, index };
      this.open.set(id, h);
      e.lastOpened = Date.now();
      this.save();
    }
    return h;
  }

  /** Εισάγεται τώρα (και ανοίγει ήδη για ανάγνωση); */
  importing(id: string): boolean {
    return this.importBase.has(id) && this.busy(id)?.kind === 'import';
  }

  /**
   * Σύνδεση μόνο για ανάγνωση (λίστα και παρτίδες). Όσο η βάση εισάγεται
   * βλέπει όσες παρτίδες έχουν γίνει COMMIT, χωρίς ευρετήριο θέσεων και χωρίς να γράφει τίποτα
   * (αλλιώς η εισαγωγή θα περίμενε)· αλλιώς ίδια με το `handle`.
   */
  read(id: string): OpenDb {
    if (!this.importing(id)) return this.handle(id);
    let h = this.open.get(id);
    if (!h) {
      const db = new GameDatabase(this.find(id).file, { reader: true });
      db.growing = this.importBase.get(id)!;
      h = { db, index: null };
      this.open.set(id, h);
    }
    return h;
  }

  private closeHandle(id: string): void {
    const h = this.open.get(id);
    if (h) {
      h.index?.close();
      h.db.close();
      this.open.delete(id);
    }
  }

  /** Μετά από αλλαγές: το ευρετήριο ξαναφτιάχνεται αυτόματα στις μικρές βάσεις. */
  markChanged(id: string): void {
    const h = this.open.get(id);
    if (!h || h.db.growing) return;
    h.db.setMeta('edited', '1');
    h.db.setMeta('indexStale', '1');
    if (h.db.count() <= 300_000) this.scheduleReindex(id);
  }

  private reindexTimers = new Map<string, NodeJS.Timeout>();
  scheduleReindex(id: string, delay = 1500): void {
    clearTimeout(this.reindexTimers.get(id));
    this.reindexTimers.set(
      id,
      setTimeout(() => {
        this.reindexTimers.delete(id);
        // η βάση μπορεί να αφαιρέθηκε στο μεταξύ: σφάλμα εδώ θα έριχνε όλον τον server
        if (!this.entries.some((e) => e.id === id)) return;
        if (this.busy(id)) return this.scheduleReindex(id, 3000);
        try {
          this.startIndexJob(id);
        } catch (err) {
          console.error('Ευρετήριο:', (err as Error).message);
        }
      }, delay),
    );
  }

  list(): Array<DbEntry & { games: number; size: number; busy: Job | null; indexStale: boolean; format: number; missing?: boolean }> {
    return this.entries.map((e) => {
      let games = 0;
      let size = 0;
      let indexStale = false;
      let format = 0;
      try {
        size = fs.statSync(e.file).size;
        const job = this.busy(e.id);
        if (this.importing(e.id)) {
          // οι παρτίδες που έχουν ήδη μπει (η βάση ανοίγει και κατά την εισαγωγή)
          const db = this.read(e.id).db;
          games = db.count();
          format = db.format;
        } else if (!job || (job.kind !== 'import' && job.kind !== 'convert')) {
          const h = this.open.get(e.id);
          if (h) {
            games = h.db.count();
            indexStale = h.db.getMeta('indexStale') === '1';
            format = h.db.format;
          } else {
            const db = new GameDatabase(e.file);
            games = db.count();
            indexStale = db.getMeta('indexStale') === '1';
            format = db.format;
            db.close();
          }
        }
      } catch {
        // αρχείο σε χρήση
      }
      return { ...e, origin: originOf(e), games, size, busy: this.busy(e.id) ?? null, indexStale, format };
    });
  }

  /** Νέα βάση στον φάκελο βάσεων, ή στο αρχείο που διάλεξε ο χρήστης (`file`). */
  create(name: string, chosen?: string): DbEntry {
    let file = chosen ? (isDbFile(chosen) ? chosen : `${chosen}${DB_EXT}`) : this.uniqueFile(name);
    if (chosen) {
      if (nameTaken(baseOf(file))) throw new HttpError(409, 'Υπάρχει ήδη βάση με αυτό το όνομα στον φάκελο');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      file = path.resolve(file);
    }
    new GameDatabase(file, { create: true }).close();
    const e: DbEntry = { id: idFor(file), name: dbName(file), file, kind: 'user', created: Date.now() };
    this.entries.push(e);
    this.save();
    return e;
  }

  private uniqueFile(name: string): string {
    const dir = this.settings.databasesDir;
    const base = safeFileName(name);
    let file = path.join(dir, base);
    for (let k = 2; nameTaken(file); k++) file = path.join(dir, `${base} (${k})`);
    return file + DB_EXT;
  }

  rename(id: string, name: string): DbEntry {
    const e = this.find(id);
    e.name = name.trim() || e.name;
    this.save();
    return e;
  }

  remove(id: string, deleteFiles: boolean): void {
    const e = this.find(id);
    const job = this.busy(id);
    if (job) job.abort.abort();
    clearTimeout(this.reindexTimers.get(id));
    this.reindexTimers.delete(id);
    this.closeHandle(id);
    this.entries = this.entries.filter((x) => x.id !== id);
    this.save();
    if (deleteFiles) {
      const base = baseOf(e.file);
      for (const f of [e.file, e.file + '-wal', e.file + '-shm', base + '.pos', base + '.tree', base + '.speed']) fs.rmSync(f, { force: true });
    }
  }

  /**
   * Άνοιγμα αρχείου: .kbdb (και παλιό .skdb) προστίθεται κατευθείαν· PGN / ChessBase / αρχειοθήκες
   * εισάγονται σε νέα βάση (αν δεν έχουν ήδη εισαχθεί χωρίς αλλαγές).
   */
  openFile(file: string, opts: { removeSource?: boolean; origin?: DbEntry['origin'] } = {}): { entry: DbEntry; job: Job | null } {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) throw new HttpError(404, `Δεν βρέθηκε το αρχείο ${abs}`);
    const ext = path.extname(abs).toLowerCase();
    if (isDbFile(abs)) {
      const existing = this.entries.find((e) => path.resolve(e.file).toLowerCase() === abs.toLowerCase());
      if (existing) return { entry: existing, job: null };
      const e: DbEntry = { id: idFor(abs), name: dbName(abs), file: abs, kind: 'user', created: Date.now() };
      new GameDatabase(abs).close();
      this.entries.push(e);
      this.save();
      return { entry: e, job: null };
    }
    // κρυπτογραφημένες αρχειοθήκες της ChessBase (DES με κωδικό): δεν διαβάζονται
    if (ext === '.cbz') {
      throw new HttpError(
        422,
        `Το «${path.basename(abs)}» είναι κρυπτογραφημένο (με κωδικό) αρχείο της ChessBase. ` +
          'Άνοιξέ το μία φορά με το ChessBase (Αρχείο → Άνοιγμα) για να γίνει βάση .cbh και μετά άνοιξε εδώ το .cbh.',
      );
    }
    if (!['.pgn', '.cbh', '.cbv', '.si4', '.7z', '.zip', '.gz', '.bz2', '.xz'].includes(ext)) {
      throw new HttpError(400, `Μη υποστηριζόμενη μορφή: ${ext || 'χωρίς κατάληξη'} (υποστηρίζονται .pgn, .cbh, .cbv, .si4, .7z, .zip, .kbdb)`);
    }
    if (ext === '.si4') {
      const stem = abs.slice(0, -4);
      const missing = ['.sn4', '.sg4'].filter((x) => !fs.existsSync(stem + x));
      if (missing.length) {
        throw new HttpError(422, `Η βάση Scid «${path.basename(abs)}» είναι ελλιπής: λείπουν τα αρχεία ${missing.join(', ')}. Αντίγραψε και τα τρία αρχεία (.si4, .sn4, .sg4) στον ίδιο φάκελο.`);
      }
    }
    if (ext === '.cbh') {
      const cb = new CbhDatabase(abs);
      const missing = cb.missing;
      cb.close();
      if (missing.length) {
        // συχνά η πλήρης βάση υπάρχει ως αρχείο .cbv (π.χ. στις Λήψεις): εισαγωγή από εκεί
        const base = path.basename(abs, ext);
        const archive = [path.dirname(abs), ...quickFolders().map((f) => f.path)]
          .flatMap((d) => ['.cbv', '.cbz'].map((x) => path.join(d, base + x)))
          .find((f) => fs.existsSync(f));
        if (archive?.toLowerCase().endsWith('.cbv')) return this.openFile(archive);
        throw new HttpError(
          422,
          `Η βάση ChessBase «${path.basename(abs)}» είναι ελλιπής: λείπουν τα αρχεία ${missing.join(', ')}. ` +
            (archive
              ? `Η πλήρης βάση υπάρχει στο κρυπτογραφημένο «${archive}»: άνοιξέ το μία φορά με το ChessBase και μετά άνοιξε εδώ το .cbh που θα βγει.`
              : 'Αντίγραψε όλα τα αρχεία της βάσης (.cbh, .cbg, .cbp, .cbt, .cba…) στον ίδιο φάκελο.'),
        );
      }
    }
    const st = fs.statSync(abs);
    const existing = this.entries.find((e) => e.source && path.resolve(e.source.path).toLowerCase() === abs.toLowerCase());
    if (existing) {
      const job = this.busy(existing.id);
      if (job) return { entry: existing, job };
      const same = existing.source!.size === st.size && existing.source!.mtime === Math.round(st.mtimeMs);
      if (same) return { entry: existing, job: null };
      // το αρχείο άλλαξε: ξανά εισαγωγή (σε νέα βάση αν η παλιά έχει αλλαγές του χρήστη)
      let edited = false;
      try {
        const db = new GameDatabase(existing.file);
        edited = db.getMeta('edited') === '1';
        db.close();
      } catch {
        edited = true;
      }
      if (!edited) {
        this.remove(existing.id, true);
      }
    }
    // .cbv: αποσυμπίεση σε προσωρινό φάκελο και εισαγωγή της βάσης (.cbh ή .pgn) που περιέχει
    let importFile = abs;
    let cleanup: ((status: Job['status']) => void) | undefined;
    // κατεβασμένο αρχείο (π.χ. βάση αναφοράς): σβήνεται όταν η εισαγωγή πετύχει
    if (opts.removeSource) cleanup = (status) => status === 'done' && fs.rmSync(abs, { force: true });
    if (ext === '.cbv') {
      const dir = path.join(os.tmpdir(), 'knightbase-cbv', crypto.randomUUID().slice(0, 8));
      const removeDir = () => fs.rmSync(dir, { recursive: true, force: true });
      cleanup = removeDir;
      let inner: string | undefined;
      try {
        const files = extractCbv(abs, dir);
        inner = files.find((f) => /\.cbh$/i.test(f)) ?? files.find((f) => /\.pgn$/i.test(f));
      } catch (e) {
        removeDir();
        throw new HttpError(422, `Το «${path.basename(abs)}» δεν αποσυμπιέζεται: ${(e as Error).message}`);
      }
      if (!inner) {
        removeDir();
        throw new HttpError(422, `Το «${path.basename(abs)}» δεν περιέχει βάση (.cbh ή .pgn)`);
      }
      importFile = inner;
    }
    const name = path.basename(abs).replace(/\.(pgn|cbh|cbv|si4|7z|zip|gz|bz2|xz)$/i, '').replace(/\.pgn$/i, '');
    const target = this.uniqueFile(name);
    const entry: DbEntry = {
      id: idFor(target),
      name: dbName(target),
      file: target,
      kind: 'imported',
      source: { path: abs, size: st.size, mtime: Math.round(st.mtimeMs), kind: ext.slice(1) },
      created: Date.now(),
      ...(opts.origin ? { origin: opts.origin } : {}),
    };
    new GameDatabase(target, { create: true }).close();
    this.entries.push(entry);
    this.save();
    const job = this.startImportJob(entry, importFile, cleanup);
    return { entry, job };
  }

  /** Εισαγωγή αρχείου σε υπάρχουσα βάση (προσθήκη παρτίδων). */
  importInto(id: string, file: string | string[]): Job {
    const e = this.find(id);
    if (this.busy(id)) throw new HttpError(409, 'Η βάση είναι απασχολημένη');
    return this.startImportJob(e, (Array.isArray(file) ? file : [file]).map((f) => path.resolve(f)));
  }

  /** Βρίσκει ή φτιάχνει βάση με όνομα (π.χ. «TWIC»). */
  ensureNamed(name: string): DbEntry {
    return this.entries.find((e) => e.name === name && e.kind === 'user') ?? this.create(name);
  }

  private newJob(dbId: string, kind: Job['kind'], title: string): Job {
    const job: Job = {
      id: crypto.randomUUID(),
      dbId,
      kind,
      title,
      progress: { phase: 'reading', games: 0, bytes: 0, totalBytes: 0, errors: 0, skipped: 0 },
      status: 'running',
      started: Date.now(),
      abort: new AbortController(),
    };
    this.jobs.set(job.id, job);
    this.onJob(job);
    return job;
  }

  /** `cleanup`: μετά την εισαγωγή (π.χ. σβήσιμο των αρχείων που βγήκαν από .cbv). */
  private startImportJob(entry: DbEntry, fileOrFiles: string | string[], cleanup?: (status: Job['status']) => void): Job {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    const file = files[0];
    this.closeHandle(entry.id);
    const job = this.newJob(entry.id, 'import', files.length > 1 ? `Εισαγωγή ${files.length} αρχείων` : `Εισαγωγή ${path.basename(file)}`);
    const run = async () => {
      const db = new GameDatabase(entry.file);
      this.importBase.set(entry.id, { count: db.count(), maxId: db.maxId() });
      let total = 0;
      try {
        for (let k = 0; k < files.length; k++) {
          const last = k === files.length - 1;
          const res = await importAny(files[k], db, baseOf(entry.file), {
            signal: job.abort.signal,
            // με πολλά αρχεία το ευρετήριο φτιάχνεται μία φορά στο τέλος
            skipIndex: files.length > 1,
            onProgress: (p) => {
              job.progress = { ...p, games: total + p.games, message: files.length > 1 ? `(${k + 1}/${files.length}) ${p.message ?? path.basename(files[k])}` : p.message };
              this.onJob(job);
            },
          });
          total += res.games;
          job.progress = { ...res, games: total };
          if (res.phase === 'cancelled') break;
          if (last && files.length > 1) {
            await rebuildIndex(db, baseOf(entry.file), {
              signal: job.abort.signal,
              onProgress: (p) => {
                job.progress = { ...p, games: total };
                this.onJob(job);
              },
            });
          }
        }
        job.status = job.progress.phase === 'cancelled' ? 'cancelled' : 'done';
      } catch (err) {
        job.status = job.abort.signal.aborted ? 'cancelled' : 'error';
        job.error = (err as Error).message;
      } finally {
        db.close();
        // τέλος: η σύνδεση ανάγνωσης κλείνει, η επόμενη ανοίγει κανονικά (με το ευρετήριο θέσεων)
        this.importBase.delete(entry.id);
        this.closeHandle(entry.id);
      }
      if (job.status !== 'done' && entry.kind === 'imported' && (entry.source?.path === file || cleanup)) {
        // αποτυχημένη πρώτη εισαγωγή: η μισή βάση δεν κρατιέται
        this.remove(entry.id, true);
      }
      cleanup?.(job.status);
      this.onJob(job);
    };
    void run();
    return job;
  }

  startIndexJob(id: string): Job {
    const e = this.find(id);
    const existing = this.busy(id);
    if (existing) return existing;
    const job = this.newJob(id, 'index', 'Ευρετήριο θέσεων');
    const run = async () => {
      const h = this.handle(id);
      h.index?.close();
      h.index = null;
      try {
        await rebuildIndex(h.db, baseOf(e.file), {
          signal: job.abort.signal,
          onProgress: (p) => {
            job.progress = p;
            this.onJob(job);
          },
        });
        h.index = new PositionIndex(baseOf(e.file));
        job.status = 'done';
      } catch (err) {
        job.status = 'error';
        job.error = (err as Error).message;
      }
      this.onJob(job);
    };
    void run();
    return job;
  }

  /**
   * Μετατροπή βάσης μορφής 1 (ως την 2.2.0) στη νέα μορφή (λεξικό ετικετών), μόνο με κουμπί. Το
   * παλιό αρχείο μένει δίπλα ως αντίγραφο ασφαλείας (`.bak`)· το μήνυμα της εργασίας λέει πού.
   */
  convertFormat(id: string): Job {
    const e = this.find(id);
    if (this.busy(id)) throw new HttpError(409, 'Η βάση είναι απασχολημένη');
    this.closeHandle(id);
    const job = this.newJob(id, 'convert', 'Μετατροπή στη νέα μορφή');
    const run = async () => {
      try {
        const r = await GameDatabase.convertToCurrentFormat(e.file, {
          signal: job.abort.signal,
          onProgress: (done, total) => {
            job.progress = { ...job.progress, games: done, bytes: done, totalBytes: total };
            this.onJob(job);
          },
        });
        const mb = (n: number) => (n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 2 : 0);
        job.progress = { ...job.progress, phase: 'done', message: `${mb(r.before)} MB → ${mb(r.after)} MB· αντίγραφο ασφαλείας: ${r.backup}` };
        job.status = 'done';
      } catch (err) {
        if (job.abort.signal.aborted) job.status = 'cancelled';
        else {
          job.status = 'error';
          job.error = (err as Error).message;
        }
      }
      this.onJob(job);
    };
    void run();
    return job;
  }

  /** Εργασία επεξεργασίας μιας βάσης (π.χ. αφαίρεση σχολιασμού) με πρόοδο και ακύρωση. */
  runJob(id: string, title: string, work: (db: GameDatabase, job: Job, progress: (done: number, total: number, message?: string) => void) => Promise<void>): Job {
    if (this.busy(id)) throw new HttpError(409, 'Η βάση είναι απασχολημένη');
    const db = this.handle(id).db;
    const job = this.newJob(id, 'edit', title);
    const run = async () => {
      try {
        await work(db, job, (done, total, message) => {
          job.progress = { phase: 'reading', games: done, bytes: done, totalBytes: total, errors: 0, skipped: 0, message };
          this.onJob(job);
        });
        job.status = job.abort.signal.aborted ? 'cancelled' : 'done';
      } catch (err) {
        job.status = 'error';
        job.error = (err as Error).message;
      }
      this.onJob(job);
    };
    void run();
    return job;
  }

  cancelJob(jobId: string): void {
    this.jobs.get(jobId)?.abort.abort();
  }

  publicJob(j: Job): Omit<Job, 'abort'> {
    const { abort: _a, ...rest } = j;
    void _a;
    return rest;
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
