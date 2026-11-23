/**
 * Ruru — Φίλοι (relay/SOCIAL.md, φάση 1). Τρία είδη Durable Object με SQLite:
 *
 *  Directory     (ένα για όλους): Όνομα#TAG → χρήστης, νέος λογαριασμός, ανάκτηση με το κλειδί.
 *  UserHub       (ένα ανά χρήστη): προφίλ, φίλοι και αιτήματα, μπλοκ, αδιάβαστα. Κρατά τα WebSocket του Ruru
 *                του χρήστη (hibernation) και του στέλνει ό,τι συμβαίνει· όταν αλλάζει η παρουσία του, ειδοποιεί τους φίλους.
 *  Conversation  (μία ανά ζεύγος φίλων και μία ανά ομάδα): τα μηνύματα, μόνιμα, μέχρι να σβηστεί η συνομιλία.
 *  Team          (μία ανά ομάδα): όνομα, μέλη και ρόλοι, προσκλήσεις· μοιράζει τα μηνύματα της ομάδας στα μέλη.
 *
 * Διαγραφή λογαριασμού: το UserHub κρατά στο `links` κάθε χρήστη, ομάδα και αρχείο που το αφορά (και όσα δεν
 * είναι πια φίλοι ή ομάδες του) και με alarm τα καθαρίζει ένα ένα, με επανάληψη αν κάτι αποτύχει, πριν σβηστεί.
 *
 * Μόνο το UserHub μιλά με τον έξω κόσμο (WebSocket /social?u=<id>, το κλειδί στο πρώτο μήνυμα). Τα υπόλοιπα
 * καλούνται μόνο από τον ίδιο τον server (RPC).
 */
import { DurableObject } from 'cloudflare:workers';
import { checkPgnFile } from '../../src/core/pgnFile.ts';
import {
  FILE_DAYS,
  FILE_RE,
  REPORT_DAYS,
  REPORT_MAX_TEXT,
  REPORT_REASONS,
  ROOM_ID_RE,
  SOCIAL_HISTORY_PAGE,
  SOCIAL_KEEP,
  SOCIAL_MAX_FRIENDS,
  TEAMS_PER_USER,
  TEAM_MAX,
  TEAM_RE,
  TERMS_VERSION,
  USER_RE,
  cleanAccounts,
  cleanSocialName,
  cleanTeamName,
  cleanInvite,
  cleanText,
  dmId,
  hashKey,
  nameKey,
  randomKey,
  validConsent,
  type Accounts,
  type Activity,
  type FileShare,
  type DmMsg,
  type Friend,
  type FriendState,
  type Person,
  type Presence,
  type SocialClientMsg,
  type SocialError,
  type SocialServerMsg,
  type TeamInfo,
  type TeamRole,
  type TeamRow,
} from '../../src/core/social.ts';
import { randomId } from '../../src/core/online.ts';

export interface SocialEnv {
  DIRECTORY: DurableObjectNamespace<Directory>;
  USERS: DurableObjectNamespace<UserHub>;
  CONVS: DurableObjectNamespace<Conversation>;
  TEAMS: DurableObjectNamespace<Team>;
  /** τα αρχεία που στέλνονται (Workers KV, λήγουν μόνα τους σε 7 μέρες) */
  FILES: KVNamespace;
}

/** Μια αναφορά, όπως τη βλέπει ο υπεύθυνος (relay/admin.mjs). */
export interface Report {
  id: string;
  at: number;
  reporter: string;
  target: string;
  target_name: string;
  team: string;
  team_name: string;
  conv: string;
  mid: number;
  reason: string;
  text: string;
  /** αντίγραφο του μηνύματος, όπως ήταν όταν αναφέρθηκε */
  evidence: string;
  [k: string]: SqlStorageValue;
}

const HOUR = 60 * 60 * 1000;

/** το αρχείο ενός μηνύματος-αρχείου (JSON FileShare) */
function fileIdOf(text: string): string | null {
  try {
    const id = (JSON.parse(text) as { id?: unknown }).id;
    return typeof id === 'string' && FILE_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Σβήνει από τον server τα αρχεία μηνυμάτων που διαγράφηκαν (αλλιώς θα έμεναν ως τη λήξη τους). */
async function dropFiles(env: SocialEnv, ids: Array<string | undefined>): Promise<void> {
  await Promise.allSettled(ids.filter((id): id is string => Boolean(id)).map((id) => env.FILES.delete(id)));
}
const DAY = 24 * HOUR;
const MAX_IN = 50;

// ---------------------------------------------------------------------------
// Directory

export class Directory extends DurableObject<SocialEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: SocialEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, lc TEXT NOT NULL, tag TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, at INTEGER NOT NULL)');
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_name ON users (lc, tag)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS regs (ip TEXT NOT NULL, at INTEGER NOT NULL)');
    try {
      // 1: ο λογαριασμός έχει πλήρες `links` από την αρχή του· NULL: φτιάχτηκε στη δοκιμή, πριν υπάρξει
      this.sql.exec('ALTER TABLE users ADD COLUMN indexed INTEGER');
    } catch {
      // υπάρχει ήδη
    }
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, at INTEGER NOT NULL, reporter TEXT NOT NULL, target TEXT NOT NULL, target_name TEXT NOT NULL, team TEXT NOT NULL, team_name TEXT NOT NULL, conv TEXT NOT NULL, mid INTEGER NOT NULL, reason TEXT NOT NULL, text TEXT NOT NULL, evidence TEXT NOT NULL)',
    );
    void ctx.blockConcurrencyWhile(() => this.schedule());
  }

  /** Οι IP των εγγραφών σβήνουν σε μία ώρα και οι αναφορές σε REPORT_DAYS, ακόμη κι αν δεν ξαναγίνει τίποτα. */
  private async schedule(): Promise<void> {
    const reg = this.sql.exec<{ at: number | null }>('SELECT MIN(at) AS at FROM regs').one().at;
    const rep = this.sql.exec<{ at: number | null }>('SELECT MIN(at) AS at FROM reports').one().at;
    const due = [reg === null ? Infinity : reg + HOUR, rep === null ? Infinity : rep + REPORT_DAYS * DAY];
    const next = Math.min(...due);
    if (next !== Infinity) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 1000));
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.sql.exec('DELETE FROM regs WHERE at <= ?', now - HOUR);
    this.sql.exec('DELETE FROM reports WHERE at <= ?', now - REPORT_DAYS * DAY);
    await this.schedule();
  }

  async person(id: string): Promise<Person | null> {
    const r = this.sql.exec<{ id: string; name: string; tag: string }>('SELECT id, name, tag FROM users WHERE id = ?', id).toArray()[0];
    return r ? { id: r.id, name: r.name, tag: r.tag } : null;
  }

  /**
   * Διαγραφή: όνομα, κλειδί και κάθε αναφορά από αυτόν ή γι' αυτόν. Για λογαριασμό της δοκιμής (χωρίς πλήρες
   * `links`) δίνει και τους υπόλοιπους της δοκιμής, για να ψαχτούν παλιές φιλίες και ομάδες.
   */
  async remove(id: string, oldAccount: boolean): Promise<string[]> {
    this.sql.exec('DELETE FROM users WHERE id = ?', id);
    this.sql.exec('DELETE FROM reports WHERE reporter = ? OR target = ?', id, id);
    if (!oldAccount) return [];
    return this.sql.exec<{ id: string }>('SELECT id FROM users WHERE indexed IS NULL').toArray().map((r) => r.id);
  }

  async addReport(r: Omit<Report, 'id' | 'at'>): Promise<string> {
    const id = randomId(8);
    this.sql.exec(
      'INSERT INTO reports (id, at, reporter, target, target_name, team, team_name, conv, mid, reason, text, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, Date.now(), r.reporter, r.target, r.target_name, r.team, r.team_name, r.conv, r.mid, r.reason, r.text, r.evidence,
    );
    await this.schedule();
    return id;
  }

  /** Οι λογαριασμοί της δοκιμής (από πριν από τη διαγραφή και τους όρους): μόνο ανάγνωση. */
  async testAccounts(): Promise<Array<{ id: string; name: string; tag: string; at: number }>> {
    return this.sql.exec<{ id: string; name: string; tag: string; at: number }>('SELECT id, name, tag, at FROM users WHERE indexed IS NULL ORDER BY at').toArray();
  }

  async reports(): Promise<Report[]> {
    return this.sql.exec<Report>('SELECT * FROM reports ORDER BY at LIMIT 500').toArray();
  }

  async reportById(id: string): Promise<Report | null> {
    return this.sql.exec<Report>('SELECT * FROM reports WHERE id = ?', id).toArray()[0] ?? null;
  }

  async reportsBy(reporter: string): Promise<Array<{ id: string; at: number; reason: string; text: string }>> {
    return this.sql.exec<{ id: string; at: number; reason: string; text: string }>('SELECT id, at, reason, text FROM reports WHERE reporter = ?', reporter).toArray();
  }

  async closeReport(id: string): Promise<boolean> {
    return this.sql.exec('DELETE FROM reports WHERE id = ? RETURNING id', id).toArray().length > 0;
  }

  /** Νέος λογαριασμός: τυχαίο TAG που δεν το έχει άλλος με το ίδιο όνομα. Το κλειδί επιστρέφεται μόνο εδώ. */
  async register(rawName: string, ip: string, consent: unknown): Promise<{ userId: string; name: string; tag: string; key: string } | { error: 'name' | 'rate' | 'full' | 'consent' }> {
    if (!validConsent(consent)) return { error: 'consent' };
    const name = cleanSocialName(rawName);
    if (!name) return { error: 'name' };
    const now = Date.now();
    this.sql.exec('DELETE FROM regs WHERE at < ?', now - HOUR);
    const n = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM regs WHERE ip = ?', ip).one().n;
    // (τοπικά, στο wrangler dev, η IP είναι του ίδιου υπολογιστή: χωρίς όριο, για τις δοκιμές με πολλούς χρήστες)
    if (n >= 5 && !['local', '127.0.0.1', '::1'].includes(ip)) return { error: 'rate' };
    const key = randomKey();
    const keyHash = await hashKey(key);
    const id = randomId(16);
    // χωρίς await ανάμεσα στον έλεγχο και στην εγγραφή
    const lc = nameKey(name);
    let tag = '';
    for (let i = 0; i < 40 && !tag; i++) {
      const t = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (!this.sql.exec('SELECT 1 FROM users WHERE lc = ? AND tag = ?', lc, t).toArray().length) tag = t;
    }
    if (!tag) return { error: 'full' };
    this.sql.exec('INSERT INTO users (id, name, lc, tag, key_hash, at, indexed) VALUES (?, ?, ?, ?, ?, ?, 1)', id, name, lc, tag, keyHash, now);
    this.sql.exec('INSERT INTO regs (ip, at) VALUES (?, ?)', ip, now);
    await this.schedule();
    await this.env.USERS.get(this.env.USERS.idFromName(id)).init({ id, name, tag }, keyHash);
    return { userId: id, name, tag, key };
  }

  /** Μόνο με ακριβές Όνομα#TAG (κεφαλαία/πεζά δεν μετράνε). */
  async find(name: string, tag: string): Promise<Person | null> {
    const r = this.sql.exec<{ id: string; name: string; tag: string }>('SELECT id, name, tag FROM users WHERE lc = ? AND tag = ?', nameKey(name), tag).toArray()[0];
    return r ? { id: r.id, name: r.name, tag: r.tag } : null;
  }

  async recover(keyHash: string): Promise<Person | null> {
    const r = this.sql.exec<{ id: string; name: string; tag: string }>('SELECT id, name, tag FROM users WHERE key_hash = ?', keyHash).toArray()[0];
    return r ? { id: r.id, name: r.name, tag: r.tag } : null;
  }
}

// ---------------------------------------------------------------------------
// Conversation

export class Conversation extends DurableObject<SocialEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: SocialEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)');
  }

  async post(from: string, kind: DmMsg['kind'], text: string): Promise<DmMsg> {
    const at = Date.now();
    const id = this.sql.exec<{ id: number }>('INSERT INTO msgs (sender, kind, text, at) VALUES (?, ?, ?, ?) RETURNING id', from, kind, text, at).one().id;
    if (id % 100 === 0) this.sql.exec('DELETE FROM msgs WHERE id <= ?', id - SOCIAL_KEEP);
    return { id, from, kind, text, at };
  }

  async history(before?: number): Promise<{ msgs: DmMsg[]; more: boolean }> {
    const rows = this.sql
      .exec<{ id: number; sender: string; kind: string; text: string; at: number }>(
        'SELECT id, sender, kind, text, at FROM msgs WHERE id < ? ORDER BY id DESC LIMIT ?',
        before ?? Number.MAX_SAFE_INTEGER,
        SOCIAL_HISTORY_PAGE + 1,
      )
      .toArray();
    const more = rows.length > SOCIAL_HISTORY_PAGE;
    const msgs = rows
      .slice(0, SOCIAL_HISTORY_PAGE)
      .reverse()
      .map((r) => ({ id: r.id, from: r.sender, kind: (r.kind === 'invite' || r.kind === 'file' ? r.kind : 'text') as DmMsg['kind'], text: r.text, at: r.at }));
    return { msgs, more };
  }

  /** Μόνο ο αποστολέας σβήνει το μήνυμά του· αν ήταν αρχείο, δίνει και το αρχείο για να σβηστεί. */
  async remove(from: string, mid: number): Promise<{ ok: boolean; file?: string }> {
    const row = this.sql.exec<{ kind: string; text: string }>('SELECT kind, text FROM msgs WHERE id = ? AND sender = ?', mid, from).toArray()[0];
    if (!row) return { ok: false };
    this.sql.exec('DELETE FROM msgs WHERE id = ?', mid);
    const file = row.kind === 'file' ? fileIdOf(row.text) : null;
    return { ok: true, ...(file ? { file } : {}) };
  }

  async one(mid: number): Promise<DmMsg | null> {
    const r = this.sql.exec<{ id: number; sender: string; kind: string; text: string; at: number }>('SELECT id, sender, kind, text, at FROM msgs WHERE id = ?', mid).toArray()[0];
    return r ? { id: r.id, from: r.sender, kind: r.kind as DmMsg['kind'], text: r.text, at: r.at } : null;
  }

  /** Για την εξαγωγή των δεδομένων κάποιου: μόνο όσα έγραψε ο ίδιος. */
  async bySender(from: string): Promise<Array<{ kind: string; text: string; at: number }>> {
    return this.sql.exec<{ kind: string; text: string; at: number }>('SELECT kind, text, at FROM msgs WHERE sender = ? ORDER BY id', from).toArray();
  }

  /** Διαγραφή λογαριασμού: όλα τα μηνύματά του σε αυτή τη συνομιλία· δίνει τα αρχεία του. */
  async forget(from: string): Promise<string[]> {
    const files = this.sql
      .exec<{ text: string }>("SELECT text FROM msgs WHERE sender = ? AND kind = 'file'", from)
      .toArray()
      .map((r) => fileIdOf(r.text))
      .filter((id): id is string => Boolean(id));
    this.sql.exec('DELETE FROM msgs WHERE sender = ?', from);
    return files;
  }

  /** Σβήνει όλη τη συνομιλία· δίνει τα αρχεία της, για να σβηστούν κι αυτά. */
  async clear(): Promise<string[]> {
    const files = this.sql
      .exec<{ text: string }>("SELECT text FROM msgs WHERE kind = 'file'")
      .toArray()
      .map((r) => fileIdOf(r.text))
      .filter((id): id is string => Boolean(id));
    this.sql.exec('DELETE FROM msgs');
    return files;
  }
}

// ---------------------------------------------------------------------------
// UserHub

interface Attach {
  auth: boolean;
  a: Activity | null;
}
interface FriendRow {
  id: string;
  name: string;
  tag: string;
  state: string;
  p: string | null;
  unread: number;
  last_at: number;
  acc: string | null;
  [k: string]: SqlStorageValue;
}

interface TeamDbRow {
  id: string;
  name: string;
  role: string;
  state: string;
  count: number;
  unread: number;
  last_at: number;
  inviter: string | null;
  [k: string]: SqlStorageValue;
}

const OFFLINE: Presence = { s: 'offline' };
const samePresence = (a: Presence, b: Presence) => a.s === b.s && (a.room ?? '') === (b.room ?? '') && Boolean(a.open) === Boolean(b.open);

function cleanActivity(a: unknown): Activity | null {
  if (!a || typeof a !== 'object') return null;
  const v = a as Activity;
  if (v.s === 'away') return { s: 'away' };
  if (v.s !== 'game' && v.s !== 'analysis') return null;
  return { s: v.s, ...(typeof v.room === 'string' && ROOM_ID_RE.test(v.room) ? { room: v.room } : {}), ...(v.s === 'game' && v.open ? { open: true } : {}) };
}

export class UserHub extends DurableObject<SocialEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: SocialEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // το ping της εφαρμογής απαντιέται χωρίς να «ξυπνήσει» το αντικείμενο
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    this.schema();
    // λογαριασμός από τη δοκιμή: στο links ό,τι ξέρουμε ήδη
    if (this.meta('id') && !this.meta('linked')) {
      this.sql.exec("INSERT OR IGNORE INTO links SELECT 'u', id, 0 FROM friends");
      this.sql.exec("INSERT OR IGNORE INTO links SELECT 'u', id, 0 FROM blocked");
      this.sql.exec("INSERT OR IGNORE INTO links SELECT 't', id, 0 FROM teams");
      this.setMeta('linked', '1');
    }
  }

  private schema(): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS friends (id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL, state TEXT NOT NULL, since INTEGER NOT NULL, p TEXT, unread INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0)',
    );
    // Lichess / Chess.com του φίλου (στήλη από τη φάση 2 του Watch Live)
    try {
      this.sql.exec('ALTER TABLE friends ADD COLUMN acc TEXT');
    } catch {
      // υπάρχει ήδη
    }
    this.sql.exec('CREATE TABLE IF NOT EXISTS blocked (id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL, at INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset INTEGER NOT NULL)');
    this.sql.exec(
      'CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1, unread INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0, inviter TEXT)',
    );
    // u: χρήστης, t: ομάδα, f: αρχείο που έστειλα. Δεν φεύγουν με αποχώρηση ή αφαίρεση: τα θέλει η διαγραφή
    this.sql.exec('CREATE TABLE IF NOT EXISTS links (kind TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, id))');
  }

  // ---- αποθήκευση

  private meta(k: string): string | null {
    return this.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v ?? null;
  }
  private setMeta(k: string, v: string): void {
    this.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, v);
  }
  /** null και όσο διαγράφεται */
  private me(): Person | null {
    const id = this.meta('id');
    return id && !this.meta('deleting') ? { id, name: this.meta('name') ?? '', tag: this.meta('tag') ?? '' } : null;
  }
  private row(id: string): FriendRow | undefined {
    return this.sql.exec<FriendRow>('SELECT * FROM friends WHERE id = ?', id).toArray()[0];
  }
  private isFriend(id: string): boolean {
    return this.row(id)?.state === 'friend';
  }
  private toFriend(r: FriendRow): Friend {
    let p: Presence = OFFLINE;
    let acc: Accounts | null = null;
    try {
      if (r.state === 'friend' && r.p) p = JSON.parse(r.p) as Presence;
      if (r.state === 'friend' && r.acc) acc = cleanAccounts(JSON.parse(r.acc));
    } catch {
      // παλιά εγγραφή
    }
    return { id: r.id, name: r.name, tag: r.tag, state: r.state as FriendState, p, unread: r.unread, lastAt: r.last_at, ...(acc ? { acc } : {}) };
  }
  private friends(): Friend[] {
    return this.sql.exec<FriendRow>('SELECT * FROM friends').toArray().map((r) => this.toFriend(r));
  }
  /** `acc`: undefined = μένει ό,τι ήταν, null = κανένας λογαριασμός */
  private upsert(p: Person, state: FriendState, presence?: Presence, acc?: Accounts | null): void {
    this.link('u', p.id);
    const old = this.row(p.id);
    const a = acc === undefined ? (old?.acc ?? null) : acc ? JSON.stringify(acc) : null;
    if (old) this.sql.exec('UPDATE friends SET name = ?, tag = ?, state = ?, p = ?, acc = ? WHERE id = ?', p.name, p.tag, state, presence ? JSON.stringify(presence) : old.p, a, p.id);
    else this.sql.exec('INSERT INTO friends (id, name, tag, state, since, p, acc) VALUES (?, ?, ?, ?, ?, ?, ?)', p.id, p.name, p.tag, state, Date.now(), presence ? JSON.stringify(presence) : null, a);
  }
  /** τα δικά μου usernames σε Lichess / Chess.com */
  private myAccounts(): Accounts | null {
    try {
      return cleanAccounts(JSON.parse(this.meta('accounts') ?? 'null'));
    } catch {
      return null;
    }
  }
  private blockedList(): Person[] {
    return this.sql.exec<{ id: string; name: string; tag: string }>('SELECT id, name, tag FROM blocked ORDER BY at').toArray().map((r) => ({ id: r.id, name: r.name, tag: r.tag }));
  }
  private isBlocked(id: string): boolean {
    return this.sql.exec('SELECT 1 FROM blocked WHERE id = ?', id).toArray().length > 0;
  }

  private link(kind: 'u' | 't' | 'f', id: string): void {
    this.sql.exec('INSERT OR IGNORE INTO links (kind, id, at) VALUES (?, ?, ?)', kind, id, Date.now());
  }
  private linked(kind: 'u' | 't' | 'f', id: string): boolean {
    return this.sql.exec('SELECT 1 FROM links WHERE kind = ? AND id = ?', kind, id).toArray().length > 0;
  }
  private directory() {
    return this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('directory'));
  }
  private accepted16(): boolean {
    return this.meta('terms') === TERMS_VERSION;
  }

  /** Όριο ρυθμού: έως `max` φορές ανά `windowMs`. */
  private allow(k: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const r = this.sql.exec<{ n: number; reset: number }>('SELECT n, reset FROM rate WHERE k = ?', k).toArray()[0];
    if (!r || r.reset <= now) {
      this.sql.exec('INSERT OR REPLACE INTO rate (k, n, reset) VALUES (?, 1, ?)', k, now + windowMs);
      return true;
    }
    if (r.n >= max) return false;
    this.sql.exec('UPDATE rate SET n = n + 1 WHERE k = ?', k);
    return true;
  }

  private hub(id: string) {
    return this.env.USERS.get(this.env.USERS.idFromName(id));
  }
  // ---- ομάδες

  private teamRow(id: string): TeamDbRow | undefined {
    return this.sql.exec<TeamDbRow>('SELECT * FROM teams WHERE id = ?', id).toArray()[0];
  }
  private toTeam(r: TeamDbRow): TeamRow {
    return { id: r.id, name: r.name, role: r.role as TeamRole, state: r.state === 'invited' ? 'invited' : 'member', count: r.count, unread: r.unread, lastAt: r.last_at, ...(r.inviter ? { by: r.inviter } : {}) };
  }
  private teamsList(): TeamRow[] {
    return this.sql.exec<TeamDbRow>('SELECT * FROM teams').toArray().map((r) => this.toTeam(r));
  }
  private memberTeams(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM teams WHERE state = 'member'").one().n;
  }
  /** η ομάδα, αν είμαι μέλος της */
  private myTeam(team: unknown): TeamDbRow | undefined {
    if (typeof team !== 'string' || !TEAM_RE.test(team)) return undefined;
    const r = this.teamRow(team);
    return r?.state === 'member' ? r : undefined;
  }
  private team(id: string) {
    return this.env.TEAMS.get(this.env.TEAMS.idFromName(id));
  }
  private dropTeam(id: string): void {
    this.sql.exec('DELETE FROM teams WHERE id = ?', id);
    this.broadcast({ t: 'unteam', id });
  }
  private pushTeam(id: string): void {
    const r = this.teamRow(id);
    if (r) this.broadcast({ t: 'team', team: this.toTeam(r) });
  }

  private conv(peer: string) {
    const me = this.meta('id') ?? '';
    return this.env.CONVS.get(this.env.CONVS.idFromName(dmId(me, peer)));
  }

  // ---- WebSocket

  private sockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((w) => w.readyState === WebSocket.OPEN && (w.deserializeAttachment() as Attach | null)?.auth);
  }
  private send(ws: WebSocket, msg: SocialServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // κλείνει ήδη
    }
  }
  private broadcast(msg: SocialServerMsg): void {
    const text = JSON.stringify(msg);
    for (const w of this.sockets()) {
      try {
        w.send(text);
      } catch {
        // κλείνει ήδη
      }
    }
  }

  /** Η παρουσία μου τώρα, από τα ανοιχτά Ruru (με προτεραιότητα: παρτίδα, ανάλυση, online, λείπει). */
  async presenceNow(): Promise<Presence> {
    const acts = this.sockets().map((w) => (w.deserializeAttachment() as Attach).a);
    if (!acts.length) return OFFLINE;
    const game = acts.find((a) => a?.s === 'game');
    if (game) return { ...game };
    const an = acts.find((a) => a?.s === 'analysis');
    if (an) return { ...an };
    if (acts.some((a) => !a)) return { s: 'online' };
    return { s: 'away' };
  }

  /** Αν άλλαξε η παρουσία μου: ειδοποίηση των φίλων. */
  private async pushPresence(): Promise<void> {
    const me = this.meta('id');
    if (!me) return;
    const p = await this.presenceNow();
    const old = JSON.parse(this.meta('presence') ?? '{"s":"offline"}') as Presence;
    if (samePresence(p, old)) return;
    this.setMeta('presence', JSON.stringify(p));
    const ids = this.sql.exec<{ id: string }>("SELECT id FROM friends WHERE state = 'friend'").toArray().map((r) => r.id);
    await Promise.allSettled(ids.map((id) => this.hub(id).peerPresence(me, p)));
  }

  async fetch(req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ auth: false, a: null } satisfies Attach);
    if (!this.me()) server.close(4404, 'no such user');
    void req;
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string' || data.length > 8000) return;
    let m: SocialClientMsg;
    try {
      m = JSON.parse(data) as SocialClientMsg;
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    const at = ws.deserializeAttachment() as Attach | null;
    const me = this.me();
    if (!me) return ws.close(4404, 'no such user');

    if (!at?.auth) {
      // το πρώτο μήνυμα: το κλειδί
      if (m.t !== 'auth' || typeof m.key !== 'string' || (await hashKey(m.key)) !== this.meta('key_hash')) return ws.close(4401, 'bad key');
      if (!this.accepted16()) {
        // ως τότε η σύνδεση δεν δίνει και δεν δέχεται τίποτα· διαγραφή και εξαγωγή γίνονται με HTTP
        if (!validConsent(m.accept)) return this.send(ws, { t: 'terms' });
        this.setMeta('terms', TERMS_VERSION);
        this.setMeta('terms_at', String(Date.now()));
      }
      ws.serializeAttachment({ auth: true, a: null } satisfies Attach);
      // η παρουσία και οι λογαριασμοί των φίλων από τους ίδιους (σε περίπτωση που χάθηκε κάποια ειδοποίηση)
      const ids = this.sql.exec<{ id: string }>("SELECT id FROM friends WHERE state = 'friend'").toArray().map((r) => r.id);
      const got = await Promise.allSettled(ids.map((id) => this.hub(id).info()));
      got.forEach((g, i) => {
        if (g.status !== 'fulfilled') return;
        const acc = cleanAccounts(g.value.acc);
        this.sql.exec('UPDATE friends SET p = ?, acc = ? WHERE id = ?', JSON.stringify(g.value.p), acc ? JSON.stringify(acc) : null, ids[i]);
      });
      this.send(ws, { t: 'hello', me, acc: this.myAccounts(), friends: this.friends(), blocked: this.blockedList(), teams: this.teamsList() });
      await this.pushPresence();
      return;
    }

    const err = (code: SocialError) => this.send(ws, { t: 'error', code });
    switch (m.t) {
      case 'activity': {
        ws.serializeAttachment({ auth: true, a: cleanActivity(m.a) } satisfies Attach);
        await this.pushPresence();
        return;
      }
      case 'accounts': {
        if (!this.allow('acc', 30, HOUR)) return err('rate');
        const acc = cleanAccounts(m.acc);
        this.setMeta('accounts', JSON.stringify(acc));
        this.broadcast({ t: 'accounts', acc });
        const ids = this.sql.exec<{ id: string }>("SELECT id FROM friends WHERE state = 'friend'").toArray().map((r) => r.id);
        await Promise.allSettled(ids.map((id) => this.hub(id).peerAccounts(me.id, acc)));
        return;
      }
      case 'report': {
        if (!(REPORT_REASONS as readonly unknown[]).includes(m.reason)) return err('bad');
        const team = typeof m.team === 'string' && TEAM_RE.test(m.team) ? this.teamRow(m.team) : undefined;
        if (m.team !== undefined && !team) return err('notmember');
        const other = typeof m.id === 'string' && USER_RE.test(m.id) && m.id !== me.id ? m.id : '';
        // μόνο για ό,τι βλέπει: γνωστό του χρήστη, ή μέλος ομάδας του
        if (other && !this.linked('u', other) && !(team?.state === 'member' && (await this.team(team.id).isMember(other)))) return err('bad');
        let target = other;
        let conv = '';
        let mid = 0;
        let evidence = '';
        if (m.mid !== undefined) {
          if (typeof m.mid !== 'number') return err('bad');
          if (team?.state === 'member') conv = `team:${team.id}`;
          else if (!team && other && this.linked('u', other)) conv = dmId(me.id, other);
          else return err('bad');
          // το περιεχόμενο το παίρνει ο server από τη συνομιλία, όχι από όποιον αναφέρει
          const msg = await this.env.CONVS.get(this.env.CONVS.idFromName(conv)).one(m.mid);
          if (!msg || msg.from === me.id) return err('bad');
          target = msg.from;
          mid = msg.id;
          evidence = msg.text;
        }
        if (!target && !team) return err('bad');
        if (!this.allow('report', 10, DAY)) return err('rate');
        const dir = this.directory();
        const who = target ? await dir.person(target) : null;
        const id = await dir.addReport({
          reporter: me.id,
          target,
          target_name: who ? `${who.name}#${who.tag}` : '',
          team: team?.id ?? '',
          team_name: team?.name ?? '',
          conv,
          mid,
          reason: m.reason,
          text: cleanText(m.text).slice(0, REPORT_MAX_TEXT),
          evidence,
        });
        this.send(ws, { t: 'reported', id });
        return;
      }
      case 'add': {
        if (!this.allow('add', 20, HOUR)) return err('rate');
        const name = cleanSocialName(m.name);
        if (!name || typeof m.tag !== 'string' || !/^\d{4}$/.test(m.tag)) return err('notfound');
        const p = await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('directory')).find(name, m.tag);
        if (!p) return err('notfound');
        if (p.id === me.id) return err('self');
        if (this.isBlocked(p.id)) return err('blocked');
        const old = this.row(p.id);
        if (old?.state === 'friend' || old?.state === 'out') return err('already');
        if (this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM friends').one().n >= SOCIAL_MAX_FRIENDS) return err('limit');
        // πριν από την κλήση: ο άλλος ίσως κρατήσει το όνομά μου (αίτημα)
        this.link('u', p.id);
        const r = await this.hub(p.id).incomingRequest(me, await this.presenceNow(), this.myAccounts());
        if (r.gone) return err('notfound');
        if (!this.me()) return;
        if (r.friends) this.upsert(p, 'friend', r.p, cleanAccounts(r.acc));
        else this.upsert(p, 'out');
        const row = this.row(p.id);
        if (row) this.broadcast({ t: 'friend', f: this.toFriend(row) });
        this.send(ws, { t: 'added', name: p.name, tag: p.tag, friends: r.friends });
        return;
      }
      case 'accept': {
        const old = typeof m.id === 'string' ? this.row(m.id) : undefined;
        if (!old || old.state !== 'in') return;
        const r = await this.hub(old.id).accepted(me, await this.presenceNow(), this.myAccounts());
        if (!r) {
          // ακύρωσε στο μεταξύ το αίτημα
          this.sql.exec('DELETE FROM friends WHERE id = ?', old.id);
          this.broadcast({ t: 'unfriend', id: old.id });
          return;
        }
        this.upsert(old, 'friend', r.p, cleanAccounts(r.acc));
        const row = this.row(old.id);
        if (row) this.broadcast({ t: 'friend', f: this.toFriend(row) });
        return;
      }
      case 'remove': {
        const old = typeof m.id === 'string' ? this.row(m.id) : undefined;
        if (!old) return;
        this.sql.exec('DELETE FROM friends WHERE id = ?', old.id);
        this.broadcast({ t: 'unfriend', id: old.id });
        await this.hub(old.id).unfriended(me.id).catch(() => {});
        return;
      }
      case 'block': {
        if (typeof m.id !== 'string' || !USER_RE.test(m.id) || m.id === me.id) return err('bad');
        const id = m.id;
        let who: Person | null = this.row(id) ?? null;
        if (!who) {
          const t = this.myTeam(m.team);
          // μόνο κάποιον που βλέπει: όχι όποιο id να 'ναι
          if (!this.linked('u', id) && !(t && (await this.team(t.id).isMember(id)))) return err('bad');
          if (!this.allow('block', 60, HOUR)) return err('rate');
          who = await this.directory().person(id);
          if (!who) return err('notfound');
          // κρατώ το όνομά του: η διαγραφή του πρέπει να με βρει
          this.link('u', id);
          if (!(await this.hub(id).linkBack(me.id))) return err('notfound');
          if (!this.me()) return;
        }
        this.sql.exec('INSERT OR REPLACE INTO blocked (id, name, tag, at) VALUES (?, ?, ?, ?)', id, who.name, who.tag, Date.now());
        this.sql.exec('DELETE FROM friends WHERE id = ?', id);
        this.broadcast({ t: 'unfriend', id });
        this.broadcast({ t: 'blocked', list: this.blockedList() });
        await this.hub(id).unfriended(me.id).catch(() => {});
        return;
      }
      case 'unblock': {
        if (typeof m.id !== 'string') return;
        this.sql.exec('DELETE FROM blocked WHERE id = ?', m.id);
        this.broadcast({ t: 'blocked', list: this.blockedList() });
        return;
      }
      case 'history': {
        if (typeof m.peer !== 'string' || !this.isFriend(m.peer)) return err('notfriend');
        const before = typeof m.before === 'number' && m.before > 0 ? Math.floor(m.before) : undefined;
        const h = await this.conv(m.peer).history(before);
        this.send(ws, { t: 'history', peer: m.peer, msgs: h.msgs, more: h.more, ...(before ? { before } : {}) });
        return;
      }
      case 'send':
      case 'invite': {
        if (typeof m.peer !== 'string' || !this.isFriend(m.peer)) return err('notfriend');
        let kind: DmMsg['kind'] = 'text';
        let text = '';
        if (m.t === 'send') {
          if (!this.allow('msg', 40, 60_000)) return err('rate');
          text = cleanText(m.text);
          if (!text) return;
        } else {
          if (!this.allow('invite', 20, 10 * 60_000)) return err('rate');
          const inv = cleanInvite(m);
          if (!inv) return err('bad');
          kind = 'invite';
          text = JSON.stringify(inv);
        }
        const msg = await this.conv(m.peer).post(me.id, kind, text);
        await this.deliver(m.peer, msg);
        await this.hub(m.peer)
          .deliver(me.id, msg)
          .catch(() => {});
        return;
      }
      // ---- ομάδες
      case 'team_create': {
        if (!this.allow('team', 5, DAY)) return err('rate');
        const name = cleanTeamName(m.name);
        if (!name) return err('teamname');
        if (this.memberTeams() >= TEAMS_PER_USER) return err('teams');
        const id = randomId(12);
        this.link('t', id);
        if (!(await this.team(id).create(id, name, me))) return err('bad');
        if (!this.me()) return;
        this.sql.exec("INSERT OR REPLACE INTO teams (id, name, role, state, count, unread, last_at) VALUES (?, ?, 'owner', 'member', 1, 0, ?)", id, name, Date.now());
        this.pushTeam(id);
        return;
      }
      case 'team_get': {
        const t = this.myTeam(m.team);
        if (!t) return;
        const info = await this.team(t.id).info(me.id);
        if (info) this.send(ws, { t: 'teaminfo', info });
        else this.dropTeam(t.id);
        return;
      }
      case 'team_invite': {
        const t = this.myTeam(m.team);
        if (!t) return err('notmember');
        const f = typeof m.peer === 'string' ? this.row(m.peer) : undefined;
        if (!f || f.state !== 'friend') return err('notfriend');
        if (!this.allow('tinvite', 60, HOUR)) return err('rate');
        const e = await this.team(t.id).invite(me.id, { id: f.id, name: f.name, tag: f.tag });
        if (e) return err(e);
        const info = await this.team(t.id).info(me.id);
        if (info) this.send(ws, { t: 'teaminfo', info });
        return;
      }
      case 'team_accept': {
        const t = typeof m.team === 'string' ? this.teamRow(m.team) : undefined;
        if (!t || t.state !== 'invited') return;
        if (this.memberTeams() >= TEAMS_PER_USER) return err('teams');
        // το Team ενημερώνει όλα τα μέλη (και εμένα) με teamUpdate
        if (!(await this.team(t.id).join(me))) {
          this.dropTeam(t.id);
          return err('notfound');
        }
        return;
      }
      case 'team_decline': {
        const t = typeof m.team === 'string' ? this.teamRow(m.team) : undefined;
        if (!t || t.state !== 'invited') return;
        await this.team(t.id)
          .decline(me.id)
          .catch(() => {});
        this.dropTeam(t.id);
        return;
      }
      case 'team_leave': {
        const t = this.myTeam(m.team);
        if (!t) return;
        await this.team(t.id)
          .leave(me.id)
          .catch(() => {});
        this.dropTeam(t.id);
        return;
      }
      case 'team_kick':
      case 'team_role':
      case 'team_rename':
      case 'team_clear': {
        const t = this.myTeam(m.team);
        if (!t) return err('notmember');
        const team = this.team(t.id);
        let e: SocialError | null;
        if (m.t === 'team_kick') e = typeof m.id === 'string' ? await team.kick(me.id, m.id) : 'bad';
        else if (m.t === 'team_role') e = typeof m.id === 'string' && ['owner', 'admin', 'member'].includes(m.role) ? await team.setRole(me.id, m.id, m.role) : 'bad';
        else if (m.t === 'team_rename') e = await team.rename(me.id, m.name);
        else e = await team.clear(me.id);
        if (e) return err(e);
        if (m.t !== 'team_clear') {
          const info = await team.info(me.id);
          if (info) this.send(ws, { t: 'teaminfo', info });
        }
        return;
      }
      case 'team_send':
      case 'team_analysis': {
        const t = this.myTeam(m.team);
        if (!t) return err('notmember');
        let kind: DmMsg['kind'] = 'text';
        let text = '';
        if (m.t === 'team_send') {
          if (!this.allow('msg', 40, 60_000)) return err('rate');
          text = cleanText(m.text);
          if (!text) return;
        } else {
          if (!this.allow('invite', 20, 10 * 60_000)) return err('rate');
          const inv = cleanInvite({ kind: 'analysis', room: m.room, title: m.title });
          if (!inv) return err('bad');
          kind = 'invite';
          text = JSON.stringify(inv);
        }
        if (!(await this.team(t.id).post(me.id, kind, text))) {
          this.dropTeam(t.id);
          return err('notmember');
        }
        return;
      }
      case 'team_history': {
        const t = this.myTeam(m.team);
        if (!t) return;
        const before = typeof m.before === 'number' && m.before > 0 ? Math.floor(m.before) : undefined;
        let h = await this.team(t.id).history(me.id, before);
        if (!h) return;
        const hidden = new Set(this.blockedList().map((p) => p.id));
        let msgs = h.msgs.filter((x) => !hidden.has(x.from));
        // σελίδα μόνο με μπλοκαρισμένους: η προηγούμενη, αλλιώς το «Παλαιότερα» δεν θα προχωρούσε
        while (!msgs.length && h.more) {
          h = await this.team(t.id).history(me.id, h.msgs[0].id);
          if (!h) return;
          msgs = h.msgs.filter((x) => !hidden.has(x.from));
        }
        this.send(ws, { t: 'thistory', team: t.id, msgs, more: h.more, ...(before ? { before } : {}) });
        return;
      }
      case 'team_delmsg': {
        const t = this.myTeam(m.team);
        if (!t || typeof m.mid !== 'number') return;
        await this.team(t.id).remove(me.id, m.mid);
        return;
      }
      case 'team_read': {
        const t = this.myTeam(m.team);
        if (!t) return;
        this.sql.exec('UPDATE teams SET unread = 0 WHERE id = ?', t.id);
        this.broadcast({ t: 'tread', team: t.id });
        return;
      }
      case 'reply': {
        if (typeof m.peer !== 'string' || !this.isFriend(m.peer) || typeof m.mid !== 'number' || (m.kind !== 'game' && m.kind !== 'analysis')) return;
        if (!this.allow('reply', 60, 10 * 60_000)) return;
        await this.hub(m.peer)
          .inviteReply(me.id, m.mid, m.kind, Boolean(m.ok))
          .catch(() => {});
        return;
      }
      case 'read': {
        if (typeof m.peer !== 'string') return;
        this.sql.exec('UPDATE friends SET unread = 0 WHERE id = ?', m.peer);
        this.broadcast({ t: 'read', peer: m.peer });
        return;
      }
      case 'delmsg': {
        if (typeof m.peer !== 'string' || typeof m.mid !== 'number' || !this.row(m.peer)) return;
        const r = await this.conv(m.peer).remove(me.id, m.mid);
        if (!r.ok) return;
        await dropFiles(this.env, [r.file]);
        await this.msgDeleted(m.peer, m.mid);
        await this.hub(m.peer)
          .msgDeleted(me.id, m.mid)
          .catch(() => {});
        return;
      }
      case 'clear': {
        if (typeof m.peer !== 'string' || !this.row(m.peer)) return;
        await dropFiles(this.env, await this.conv(m.peer).clear());
        await this.convCleared(m.peer);
        await this.hub(m.peer)
          .convCleared(me.id)
          .catch(() => {});
        return;
      }
      default:
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // ήδη κλειστό
    }
    await this.pushPresence();
  }

  async webSocketError(): Promise<void> {
    await this.pushPresence();
  }

  // ---- RPC (από τον Directory και από τα UserHub των άλλων)

  async init(p: Person, keyHash: string): Promise<void> {
    if (this.meta('id')) return;
    this.setMeta('linked', '1');
    this.setMeta('indexed', '1');
    // η εγγραφή γίνεται μόνο με αποδοχή (Directory.register)
    this.setMeta('terms', TERMS_VERSION);
    this.setMeta('terms_at', String(Date.now()));
    this.setMeta('id', p.id);
    this.setMeta('name', p.name);
    this.setMeta('tag', p.tag);
    this.setMeta('key_hash', keyHash);
  }

  /** Αίτημα φιλίας από κάποιον. Αν του είχα ζητήσει κι εγώ, γινόμαστε αμέσως φίλοι. */
  async incomingRequest(from: Person, p: Presence, acc?: Accounts | null): Promise<{ friends: boolean; gone?: boolean; p?: Presence; acc?: Accounts | null }> {
    if (!this.me()) return { friends: false, gone: true };
    if (!USER_RE.test(from.id) || this.isBlocked(from.id)) return { friends: false };
    const old = this.row(from.id);
    if (old?.state === 'out' || old?.state === 'friend') {
      this.upsert(from, 'friend', p, cleanAccounts(acc));
      const row = this.row(from.id);
      if (row) this.broadcast({ t: 'friend', f: this.toFriend(row) });
      return { friends: true, p: await this.presenceNow(), acc: this.myAccounts() };
    }
    if (old?.state === 'in') return { friends: false };
    if (this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM friends WHERE state = 'in'").one().n >= MAX_IN) return { friends: false };
    this.upsert(from, 'in');
    const row = this.row(from.id);
    if (row) this.broadcast({ t: 'friend', f: this.toFriend(row) });
    return { friends: false };
  }

  /** Ο άλλος δέχτηκε το αίτημά μου· η παρουσία και οι λογαριασμοί μου γι' αυτόν (ή null αν δεν περίμενα πια). */
  async accepted(from: Person, p: Presence, acc?: Accounts | null): Promise<{ p: Presence; acc: Accounts | null } | null> {
    const old = this.row(from.id);
    if (!this.me() || !old || old.state !== 'out') return null;
    this.upsert(from, 'friend', p, cleanAccounts(acc));
    const row = this.row(from.id);
    if (row) this.broadcast({ t: 'friend', f: this.toFriend(row) });
    return { p: await this.presenceNow(), acc: this.myAccounts() };
  }

  async linkBack(from: string): Promise<boolean> {
    if (!this.me()) return false;
    this.link('u', from);
    return true;
  }

  /** Η παρουσία μου για μέλος ομάδας: όποιον έχω μπλοκάρει με βλέπει εκτός σύνδεσης. */
  async presenceFor(viewer: string): Promise<Presence> {
    return this.isBlocked(viewer) ? OFFLINE : this.presenceNow();
  }

  /** Για έναν φίλο: τι κάνω τώρα και τα usernames μου. */
  async info(): Promise<{ p: Presence; acc: Accounts | null }> {
    return { p: await this.presenceNow(), acc: this.myAccounts() };
  }

  async unfriended(fromId: string): Promise<void> {
    if (!this.row(fromId)) return;
    this.sql.exec('DELETE FROM friends WHERE id = ?', fromId);
    this.broadcast({ t: 'unfriend', id: fromId });
  }

  async peerAccounts(fromId: string, acc: Accounts | null): Promise<void> {
    if (!this.isFriend(fromId)) return;
    const a = cleanAccounts(acc);
    this.sql.exec('UPDATE friends SET acc = ? WHERE id = ?', a ? JSON.stringify(a) : null, fromId);
    const row = this.row(fromId);
    if (row) this.broadcast({ t: 'friend', f: this.toFriend(row) });
  }

  async peerPresence(fromId: string, p: Presence): Promise<void> {
    if (!this.isFriend(fromId)) return;
    this.sql.exec('UPDATE friends SET p = ? WHERE id = ?', JSON.stringify(p), fromId);
    this.broadcast({ t: 'presence', id: fromId, p });
  }

  /** Νέο μήνυμα στη συνομιλία με τον `peer` (δικό μου ή δικό του). */
  async deliver(peer: string, m: DmMsg): Promise<void> {
    if (!this.isFriend(peer)) return;
    const mine = m.from === this.meta('id');
    this.sql.exec(`UPDATE friends SET last_at = ?${mine ? '' : ', unread = unread + 1'} WHERE id = ?`, m.at, peer);
    this.broadcast({ t: 'msg', peer, m, unread: this.row(peer)?.unread ?? 0 });
  }

  /** Ο φίλος απάντησε σε πρόσκλησή μου. */
  // ---- RPC από το Team

  /** Πρόσκληση σε ομάδα. false αν έχω ήδη πολλές ομάδες. */
  async teamInvited(team: string, name: string, count: number, by: string): Promise<boolean> {
    if (!this.me()) return false;
    this.link('t', team);
    const old = this.teamRow(team);
    if (old?.state === 'member') return true;
    if (this.memberTeams() >= TEAMS_PER_USER) return false;
    this.sql.exec("INSERT OR REPLACE INTO teams (id, name, role, state, count, unread, last_at, inviter) VALUES (?, ?, 'member', 'invited', ?, 0, ?, ?)", team, name, count, Date.now(), by);
    this.pushTeam(team);
    return true;
  }

  /** Άλλαξε κάτι στην ομάδα (όνομα, ρόλος μου, πλήθος μελών) ή μόλις μπήκα. */
  async teamUpdate(team: string, name: string, role: TeamRole, count: number): Promise<void> {
    if (!this.me()) return;
    this.link('t', team);
    const old = this.teamRow(team);
    if (old) this.sql.exec("UPDATE teams SET name = ?, role = ?, state = 'member', count = ?, inviter = NULL WHERE id = ?", name, role, count, team);
    else this.sql.exec("INSERT INTO teams (id, name, role, state, count, unread, last_at) VALUES (?, ?, ?, 'member', ?, 0, ?)", team, name, role, count, Date.now());
    this.pushTeam(team);
  }

  async teamRemoved(team: string): Promise<void> {
    if (this.teamRow(team)) this.dropTeam(team);
  }

  async teamDeliver(team: string, m: DmMsg): Promise<void> {
    const r = this.teamRow(team);
    if (!r || r.state !== 'member' || this.isBlocked(m.from)) return;
    const mine = m.from === this.meta('id');
    this.sql.exec(`UPDATE teams SET last_at = ?${mine ? '' : ', unread = unread + 1'} WHERE id = ?`, m.at, team);
    this.broadcast({ t: 'tmsg', team, m, unread: this.teamRow(team)?.unread ?? 0 });
  }

  async teamMsgDeleted(team: string, mid: number): Promise<void> {
    this.broadcast({ t: 'tmsgdel', team, mid });
  }

  async teamCleared(team: string): Promise<void> {
    this.sql.exec('UPDATE teams SET unread = 0 WHERE id = ?', team);
    this.broadcast({ t: 'tcleared', team });
  }

  async teamForgot(team: string, who: string): Promise<void> {
    this.broadcast({ t: 'tforget', team, id: who });
  }

  async teamInviterGone(team: string): Promise<void> {
    if (!this.teamRow(team)) return;
    this.sql.exec('UPDATE teams SET inviter = NULL WHERE id = ?', team);
    this.pushTeam(team);
  }

  // ---- διαγραφή και εξαγωγή λογαριασμού

  /** Με το κλειδί του χρήστη. */
  async deleteAccount(key: string): Promise<boolean> {
    return (await this.verifyKey(key)) && (await this.beginDelete());
  }

  /** Κλείνει αμέσως τον λογαριασμό· το καθάρισμα το κάνει το alarm, αφού τελειώσουν όσα ήταν στη μέση. */
  async beginDelete(): Promise<boolean> {
    if (!this.meta('id')) return false;
    this.setMeta('deleting', '1');
    this.sql.exec("DELETE FROM meta WHERE k IN ('key_hash', 'accounts')");
    for (const w of this.ctx.getWebSockets()) {
      try {
        w.close(4404, 'account deleted');
      } catch {
        // κλείνει ήδη
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + 2000);
    return true;
  }

  async alarm(): Promise<void> {
    const id = this.meta('id');
    if (!id || !this.meta('deleting')) return;
    try {
      if (!this.meta('delisted')) {
        const peers = await this.directory().remove(id, !this.meta('indexed'));
        for (const p of peers) {
          if (p === id) continue;
          this.link('u', p);
          for (const t of await this.hub(p).teamIds()) this.link('t', t);
        }
        this.setMeta('delisted', '1');
      }
      // λίγα τη φορά (όριο υποαιτημάτων του Workers)
      const todo = this.sql.exec<{ kind: string; id: string }>('SELECT kind, id FROM links LIMIT 20').toArray();
      for (const l of todo) {
        if (l.kind === 'u') {
          await this.hub(l.id).forget(id);
          await dropFiles(this.env, await this.conv(l.id).clear());
        } else if (l.kind === 't') await this.team(l.id).forget(id);
        else await this.env.FILES.delete(l.id);
        this.sql.exec('DELETE FROM links WHERE kind = ? AND id = ?', l.kind, l.id);
      }
      if (this.sql.exec('SELECT 1 FROM links LIMIT 1').toArray().length) {
        await this.ctx.storage.setAlarm(Date.now() + 1000);
        return;
      }
      await this.ctx.storage.deleteAll();
      this.schema();
    } catch {
      // ό,τι έμεινε ξαναδοκιμάζεται ώσπου να σβηστεί
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }

  /** Ο `who` διαγράφηκε. */
  async forget(who: string): Promise<void> {
    const had = Boolean(this.row(who));
    const wasBlocked = this.isBlocked(who);
    this.sql.exec('DELETE FROM friends WHERE id = ?', who);
    this.sql.exec('DELETE FROM blocked WHERE id = ?', who);
    this.sql.exec("DELETE FROM links WHERE kind = 'u' AND id = ?", who);
    if (had) {
      this.broadcast({ t: 'cleared', peer: who });
      this.broadcast({ t: 'unfriend', id: who });
    }
    if (wasBlocked) this.broadcast({ t: 'blocked', list: this.blockedList() });
  }

  async teamIds(): Promise<string[]> {
    return this.sql.exec<{ id: string }>("SELECT id FROM links WHERE kind = 't'").toArray().map((r) => r.id);
  }

  /** Τα δεδομένα του χρήστη (πρόσβαση και φορητότητα): τα μηνύματα των άλλων δεν είναι δικά του. */
  async exportData(key: string): Promise<{ json: string } | { error: 'auth' | 'rate' }> {
    if (!(await this.verifyKey(key))) return { error: 'auth' };
    if (!this.allow('export', 10, HOUR)) return { error: 'rate' };
    const me = this.me();
    if (!me) return { error: 'auth' };
    const links = this.sql.exec<{ kind: string; id: string }>("SELECT kind, id FROM links WHERE kind IN ('u', 't')").toArray();
    const messages = [];
    for (const l of links) {
      const name = l.kind === 't' ? `team:${l.id}` : dmId(me.id, l.id);
      for (const m of await this.env.CONVS.get(this.env.CONVS.idFromName(name)).bySender(me.id)) messages.push({ conversation: name, ...m });
    }
    const data = {
      exported: new Date().toISOString(),
      account: { ...me, accounts: this.myAccounts(), terms: this.meta('terms'), termsAcceptedAt: Number(this.meta('terms_at')) || null },
      friends: this.friends().map(({ p: _presence, acc: _acc, ...f }) => f),
      blocked: this.blockedList(),
      teams: this.teamsList(),
      files: this.sql.exec<{ id: string; at: number }>("SELECT id, at FROM links WHERE kind = 'f'").toArray(),
      reports: await this.directory().reportsBy(me.id),
      messages,
    };
    return { json: JSON.stringify(data, null, 2) };
  }

  // ---- αρχεία (από τον Worker: /api/social/file)

  async verifyKey(key: string): Promise<boolean> {
    return typeof key === 'string' && (await hashKey(key)) === this.meta('key_hash') && Boolean(this.me());
  }

  /** Μπορώ να στείλω αρχείο στον φίλο `to` ή στην ομάδα `team`; Δίνει τη συνομιλία. */
  async fileCheck(key: string, to: string, team: string, id: string): Promise<{ conv: string } | { error: SocialError | 'auth' }> {
    if (!(await this.verifyKey(key)) || !this.accepted16()) return { error: 'auth' };
    const me = this.meta('id') ?? '';
    if (team) {
      if (!this.myTeam(team)) return { error: 'notmember' };
    } else if (!this.isFriend(to)) return { error: 'notfriend' };
    if (!this.allow('file', 10, DAY)) return { error: 'rate' };
    this.sql.exec("DELETE FROM links WHERE kind = 'f' AND at < ?", Date.now() - (FILE_DAYS + 1) * DAY);
    this.link('f', id);
    return { conv: team ? `team:${team}` : dmId(me, to) };
  }

  /** Έλεγχος περιεχομένου πριν αποθηκευτεί οτιδήποτε. */
  async fileInspect(data: Uint8Array): Promise<{ games: number } | { error: 'large' | 'notpgn' }> {
    const pgn = checkPgnFile(data);
    return 'error' in pgn ? { error: pgn.error } : { games: pgn.games };
  }

  /** Το αρχείο ανέβηκε: μήνυμα-αρχείο στη συνομιλία (με τον φίλο ή στην ομάδα). */
  /** false: στο μεταξύ διαγράφηκε ή δεν είναι πια στη συνομιλία (το αρχείο δεν πρέπει να μείνει) */
  async fileShared(to: string, team: string, file: FileShare): Promise<boolean> {
    const me = this.me();
    if (!me) return false;
    const text = JSON.stringify(file);
    if (team) return this.team(team).post(me.id, 'file', text);
    if (!this.isFriend(to)) return false;
    const msg = await this.conv(to).post(me.id, 'file', text);
    await this.deliver(to, msg);
    await this.hub(to)
      .deliver(me.id, msg)
      .catch(() => {});
    return true;
  }

  async inviteReply(fromId: string, mid: number, kind: 'game' | 'analysis', ok: boolean): Promise<void> {
    if (!this.isFriend(fromId)) return;
    this.broadcast({ t: 'reply', peer: fromId, mid, kind, ok });
  }

  async msgDeleted(peer: string, mid: number): Promise<void> {
    this.broadcast({ t: 'msgdel', peer, mid });
  }

  async convCleared(peer: string): Promise<void> {
    if (!this.row(peer)) return;
    this.sql.exec('UPDATE friends SET unread = 0 WHERE id = ?', peer);
    this.broadcast({ t: 'cleared', peer });
  }
}

// ---------------------------------------------------------------------------
// Team

interface MemberRow {
  id: string;
  name: string;
  tag: string;
  role: string;
  joined: number;
  [k: string]: SqlStorageValue;
}

/** μικρότερο = περισσότερα δικαιώματα */
const RANK: Record<TeamRole, number> = { owner: 0, admin: 1, member: 2 };

export class Team extends DurableObject<SocialEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: SocialEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL, role TEXT NOT NULL, joined INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL, inviter TEXT NOT NULL, at INTEGER NOT NULL)');
    // όλοι όσοι έγραψαν ποτέ στην ομάδα (για τα ονόματα στο ιστορικό)
    this.sql.exec('CREATE TABLE IF NOT EXISTS names (id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT NOT NULL)');
    try {
      this.sql.exec('ALTER TABLE invites ADD COLUMN inviter_id TEXT');
    } catch {
      // υπάρχει ήδη
    }
  }

  private meta(k: string): string | null {
    return this.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v ?? null;
  }
  private setMeta(k: string, v: string): void {
    this.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, v);
  }
  private member(id: string): MemberRow | undefined {
    return this.sql.exec<MemberRow>('SELECT * FROM members WHERE id = ?', id).toArray()[0];
  }
  private members(): MemberRow[] {
    return this.sql.exec<MemberRow>('SELECT * FROM members ORDER BY joined').toArray();
  }
  private invites(): Person[] {
    return this.sql.exec<{ id: string; name: string; tag: string }>('SELECT id, name, tag FROM invites ORDER BY at').toArray().map((r) => ({ id: r.id, name: r.name, tag: r.tag }));
  }
  private roleOf(id: string): TeamRole | null {
    return (this.member(id)?.role as TeamRole | undefined) ?? null;
  }
  private hub(id: string) {
    return this.env.USERS.get(this.env.USERS.idFromName(id));
  }
  private conv() {
    return this.env.CONVS.get(this.env.CONVS.idFromName(`team:${this.meta('id') ?? ''}`));
  }
  private addName(p: Person): void {
    this.sql.exec('INSERT OR REPLACE INTO names (id, name, tag) VALUES (?, ?, ?)', p.id, p.name, p.tag);
  }

  /** Όλα τα μέλη μαθαίνουν όνομα, ρόλο τους και πλήθος μελών. */
  private async notifyAll(): Promise<void> {
    const id = this.meta('id') ?? '';
    const name = this.meta('name') ?? '';
    const list = this.members();
    await Promise.allSettled(list.map((m) => this.hub(m.id).teamUpdate(id, name, m.role as TeamRole, list.length)));
  }

  async isMember(id: string): Promise<boolean> {
    return Boolean(this.member(id));
  }

  async create(id: string, name: string, owner: Person): Promise<boolean> {
    if (this.meta('id')) return false;
    this.setMeta('id', id);
    this.setMeta('name', name);
    this.sql.exec("INSERT INTO members (id, name, tag, role, joined) VALUES (?, ?, ?, 'owner', ?)", owner.id, owner.name, owner.tag, Date.now());
    this.addName(owner);
    return true;
  }

  /** Μέλη (με την παρουσία τους τώρα) και προσκλήσεις· μόνο για μέλη. */
  async info(me: string): Promise<TeamInfo | null> {
    if (!this.member(me)) return null;
    const list = this.members();
    const ps = await Promise.allSettled(list.map((m) => this.hub(m.id).presenceFor(me)));
    return {
      id: this.meta('id') ?? '',
      name: this.meta('name') ?? '',
      members: list.map((m, i) => {
        const p = ps[i];
        return { id: m.id, name: m.name, tag: m.tag, role: m.role as TeamRole, p: p.status === 'fulfilled' ? p.value : OFFLINE };
      }),
      invites: this.invites(),
    };
  }

  /** Πρόσκληση από ιδιοκτήτη ή διαχειριστή. */
  async invite(by: string, target: Person): Promise<SocialError | null> {
    const r = this.roleOf(by);
    if (!r) return 'notmember';
    if (r === 'member') return 'role';
    if (this.member(target.id) || this.sql.exec('SELECT 1 FROM invites WHERE id = ?', target.id).toArray().length) return 'already';
    if (this.members().length + this.invites().length >= TEAM_MAX) return 'teamfull';
    const byName = this.member(by)?.name ?? '';
    this.sql.exec('INSERT INTO invites (id, name, tag, inviter, at, inviter_id) VALUES (?, ?, ?, ?, ?, ?)', target.id, target.name, target.tag, byName, Date.now(), by);
    const ok = await this.hub(target.id)
      .teamInvited(this.meta('id') ?? '', this.meta('name') ?? '', this.members().length, byName)
      .catch(() => false);
    if (!ok) {
      this.sql.exec('DELETE FROM invites WHERE id = ?', target.id);
      return 'teams';
    }
    return null;
  }

  async join(p: Person): Promise<boolean> {
    if (!this.sql.exec('SELECT 1 FROM invites WHERE id = ?', p.id).toArray().length) return false;
    this.sql.exec('DELETE FROM invites WHERE id = ?', p.id);
    if (this.members().length >= TEAM_MAX) return false;
    this.sql.exec("INSERT OR REPLACE INTO members (id, name, tag, role, joined) VALUES (?, ?, ?, 'member', ?)", p.id, p.name, p.tag, Date.now());
    this.addName(p);
    await this.notifyAll();
    return true;
  }

  async decline(id: string): Promise<void> {
    this.sql.exec('DELETE FROM invites WHERE id = ?', id);
  }

  /** Αποχώρηση. Αν φύγει ο ιδιοκτήτης, ιδιοκτήτης γίνεται ο πιο παλιός διαχειριστής (ή μέλος)· ο τελευταίος σβήνει την ομάδα. */
  async leave(id: string): Promise<void> {
    const m = this.member(id);
    if (!m) return;
    this.sql.exec('DELETE FROM members WHERE id = ?', id);
    const rest = this.members();
    if (!rest.length) return this.dissolve();
    if (m.role === 'owner') {
      const next = rest.find((x) => x.role === 'admin') ?? rest[0];
      this.sql.exec("UPDATE members SET role = 'owner' WHERE id = ?", next.id);
    }
    await this.notifyAll();
  }

  /** Η ομάδα σβήνεται: από τον τελευταίο που φεύγει, ή από τον υπεύθυνο μετά από αναφορά. */
  async dissolve(): Promise<void> {
    const team = this.meta('id');
    if (!team) return;
    await Promise.allSettled([...this.members(), ...this.invites()].map((p) => this.hub(p.id).teamRemoved(team)));
    await dropFiles(this.env, await this.conv().clear());
    for (const t of ['members', 'invites', 'names', 'meta']) this.sql.exec(`DELETE FROM ${t}`);
  }

  /** Διαγραφή λογαριασμού μέλους (τωρινού, παλιού ή προσκεκλημένου). */
  async forget(id: string): Promise<void> {
    const team = this.meta('id');
    if (!team) return; // η ομάδα έχει ήδη σβηστεί με όλο το chat της
    await dropFiles(this.env, await this.conv().forget(id));
    const name = this.sql.exec<{ name: string }>('SELECT name FROM names WHERE id = ?', id).toArray()[0]?.name;
    if (name !== undefined) {
      // οι προσκλήσεις που έστειλε κρατούν το όνομά του (οι παλιές χωρίς inviter_id)
      const sent = this.sql.exec<{ id: string }>('SELECT id FROM invites WHERE inviter_id = ? OR (inviter_id IS NULL AND inviter = ?)', id, name).toArray();
      for (const i of sent) {
        await this.hub(i.id).teamInviterGone(team);
        this.sql.exec("UPDATE invites SET inviter = '', inviter_id = '' WHERE id = ?", i.id);
      }
    }
    this.sql.exec('DELETE FROM invites WHERE id = ?', id);
    this.sql.exec('DELETE FROM names WHERE id = ?', id);
    if (this.member(id)) await this.leave(id);
    await Promise.allSettled(this.members().map((x) => this.hub(x.id).teamForgot(team, id)));
  }

  /** Αφαίρεση μέλους (ο ιδιοκτήτης όλους, ο διαχειριστής μόνο απλά μέλη) ή ακύρωση πρόσκλησης. */
  async kick(by: string, target: string): Promise<SocialError | null> {
    const r = this.roleOf(by);
    if (!r) return 'notmember';
    if (target === by) return 'bad';
    const team = this.meta('id') ?? '';
    if (this.sql.exec('SELECT 1 FROM invites WHERE id = ?', target).toArray().length) {
      if (r === 'member') return 'role';
      this.sql.exec('DELETE FROM invites WHERE id = ?', target);
      await this.hub(target)
        .teamRemoved(team)
        .catch(() => {});
      return null;
    }
    const m = this.member(target);
    if (!m) return 'notmember';
    if (RANK[r] >= RANK[m.role as TeamRole]) return 'role';
    this.sql.exec('DELETE FROM members WHERE id = ?', target);
    await this.hub(target)
      .teamRemoved(team)
      .catch(() => {});
    await this.notifyAll();
    return null;
  }

  /** Ρόλοι: μόνο ο ιδιοκτήτης. «owner» = μεταβίβαση (ο παλιός γίνεται διαχειριστής). */
  async setRole(by: string, target: string, role: TeamRole): Promise<SocialError | null> {
    if (this.roleOf(by) !== 'owner') return 'role';
    if (target === by || !this.member(target)) return 'bad';
    if (role === 'owner') this.sql.exec("UPDATE members SET role = 'admin' WHERE id = ?", by);
    this.sql.exec('UPDATE members SET role = ? WHERE id = ?', role, target);
    await this.notifyAll();
    return null;
  }

  async rename(by: string, raw: string): Promise<SocialError | null> {
    const r = this.roleOf(by);
    if (!r || r === 'member') return 'role';
    const name = cleanTeamName(raw);
    if (!name) return 'teamname';
    this.setMeta('name', name);
    await this.notifyAll();
    return null;
  }

  /** Νέο μήνυμα (ή πρόσκληση σε ανάλυση) στο chat της ομάδας → σε όλα τα μέλη. */
  async post(from: string, kind: DmMsg['kind'], text: string): Promise<boolean> {
    const m = this.member(from);
    if (!m) return false;
    const msg = await this.conv().post(from, kind, text);
    const full: DmMsg = { ...msg, name: m.name, tag: m.tag };
    const team = this.meta('id') ?? '';
    await Promise.allSettled(this.members().map((x) => this.hub(x.id).teamDeliver(team, full)));
    return true;
  }

  async history(me: string, before?: number): Promise<{ msgs: DmMsg[]; more: boolean } | null> {
    if (!this.member(me)) return null;
    const h = await this.conv().history(before);
    const names = new Map(this.sql.exec<{ id: string; name: string; tag: string }>('SELECT id, name, tag FROM names').toArray().map((r) => [r.id, r]));
    return { msgs: h.msgs.map((m) => ({ ...m, name: names.get(m.from)?.name ?? '?', tag: names.get(m.from)?.tag ?? '' })), more: h.more };
  }

  /** Ο αποστολέας σβήνει το μήνυμά του. */
  async remove(me: string, mid: number): Promise<void> {
    if (this.member(me)) await this.removeMsg(me, mid);
  }

  async removeMsg(sender: string, mid: number): Promise<void> {
    const r = await this.conv().remove(sender, mid);
    if (!r.ok) return;
    await dropFiles(this.env, [r.file]);
    const team = this.meta('id') ?? '';
    await Promise.allSettled(this.members().map((x) => this.hub(x.id).teamMsgDeleted(team, mid)));
  }

  /** Διαγραφή όλου του chat (ιδιοκτήτης ή διαχειριστής). */
  async clear(me: string): Promise<SocialError | null> {
    const r = this.roleOf(me);
    if (!r || r === 'member') return 'role';
    await dropFiles(this.env, await this.conv().clear());
    const team = this.meta('id') ?? '';
    await Promise.allSettled(this.members().map((x) => this.hub(x.id).teamCleared(team)));
    return null;
  }
}
