/**
 * Φίλοι στο Ruru: τα μηνύματα ανάμεσα στην εφαρμογή και στον server (relay/, UserHub) και οι κοινοί κανόνες
 * (όνομα, TAG, κωδικός ανάκτησης, όρια). Τα χρησιμοποιούν και ο server και η εφαρμογή (χωρίς DOM).
 *
 * Ομάδες (φάση 2): ομάδα με όνομα, μέλη με ρόλους (ιδιοκτήτης, διαχειριστής, μέλος), chat ομάδας και κοινή ανάλυση
 * για όλη την ομάδα. Μπαίνει κανείς μόνο με πρόσκληση από ιδιοκτήτη ή διαχειριστή.
 *
 * Λογαριασμός: Όνομα#TAG (το TAG, 4 ψηφία, το δίνει ο server). Το μυστικό κλειδί μένει στον υπολογιστή του χρήστη
 * (ui.social) και στον server μόνο το SHA-256 του. Ο κωδικός ανάκτησης είναι το ίδιο κλειδί σε ομάδες των 4.
 */

/** Τι κάνει ο χρήστης: «online» χωρίς τίποτα άλλο, «away» (λείπει), σε παρτίδα, σε κοινή ανάλυση, εκτός σύνδεσης. */
export type Status = 'online' | 'away' | 'game' | 'analysis' | 'offline';

export interface Presence {
  s: Status;
  /** το δωμάτιο της παρτίδας ή της ανάλυσης (στον ίδιο server) */
  room?: string;
  /** η παρτίδα περιμένει ακόμη αντίπαλο */
  open?: boolean;
}

/** Ό,τι στέλνει η εφαρμογή για τον εαυτό της (null = απλώς online). */
export interface Activity {
  s: 'away' | 'game' | 'analysis';
  room?: string;
  open?: boolean;
}

export interface Person {
  id: string;
  name: string;
  tag: string;
}

/** friend: φίλοι· in: μου ζήτησε φιλία· out: του ζήτησα φιλία. */
export type FriendState = 'friend' | 'in' | 'out';

/** Τα usernames του χρήστη σε άλλα sites (τα βλέπουν μόνο οι φίλοι του). */
export interface Accounts {
  lichess?: string;
  chesscom?: string;
}

export interface Friend extends Person {
  state: FriendState;
  p: Presence;
  unread: number;
  /** τελευταίο μήνυμα της συνομιλίας (ώρα) */
  lastAt: number;
  /** Lichess / Chess.com (μόνο για φίλους) */
  acc?: Accounts;
}

/** Lichess (2–20) και Chess.com (3–25): λατινικά γράμματα, ψηφία, _ και -. */
const SITE_USER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,24}$/;

/** Username από ό,τι έγραψε ο χρήστης (δέχεται και «@όνομα» ή το link του προφίλ). null αν δεν είναι σωστό. */
export function cleanSiteUser(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?(lichess\.org\/@\/|chess\.com\/(member|players?)\/)/i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
  return SITE_USER_RE.test(s) ? s : null;
}

/** Λογαριασμοί από ό,τι στάλθηκε: μόνο τα γνωστά πεδία, ελεγμένα (null αν δεν μένει κανένας). */
export function cleanAccounts(v: unknown): Accounts | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const acc: Accounts = {};
  const li = cleanSiteUser(o.lichess);
  if (li) acc.lichess = li;
  const cc = cleanSiteUser(o.chesscom);
  if (cc) acc.chesscom = cc;
  return acc.lichess || acc.chesscom ? acc : null;
}

export interface DmMsg {
  id: number;
  from: string;
  kind: 'text' | 'invite' | 'file';
  /** κείμενο, ή για πρόσκληση JSON {kind, room}, ή για αρχείο JSON FileShare */
  text: string;
  at: number;
  /** στο chat ομάδας: ποιος το έγραψε (μπορεί να μην είναι φίλος) */
  name?: string;
  tag?: string;
}

export type TeamRole = 'owner' | 'admin' | 'member';

/** Μια ομάδα όπως τη βλέπει ο χρήστης στη λίστα του. */
export interface TeamRow {
  id: string;
  name: string;
  role: TeamRole;
  /** member: μέλος· invited: πρόσκληση που περιμένει απάντηση */
  state: 'member' | 'invited';
  count: number;
  unread: number;
  lastAt: number;
  /** ποιος με κάλεσε (για πρόσκληση) */
  by?: string;
}

export interface TeamMember extends Person {
  role: TeamRole;
  p: Presence;
}

export interface TeamInfo {
  id: string;
  name: string;
  members: TeamMember[];
  /** προσκλήσεις που περιμένουν */
  invites: Person[];
}

export interface Invite {
  kind: 'game' | 'analysis';
  room: string;
  /** παρτίδα: το ρολόι («5+3»· '' χωρίς ρολόι) */
  tc?: string;
  /** παρτίδα: με τι παίζει ο καλεσμένος */
  color?: 'white' | 'black' | 'random';
  /** ανάλυση: ποια παρτίδα (π.χ. «Banikas – Vysochin») */
  title?: string;
}

const TC_RE = /^\d{1,3}\+\d{1,3}$/;

/** Πρόσκληση από ό,τι έστειλε ο χρήστης: μόνο τα γνωστά πεδία, ελεγμένα (ίδιο στον server και στη σελίδα). */
export function cleanInvite(v: unknown): Invite | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if ((o.kind !== 'game' && o.kind !== 'analysis') || typeof o.room !== 'string' || !ROOM_ID_RE.test(o.room)) return null;
  const inv: Invite = { kind: o.kind, room: o.room };
  if (o.kind === 'game') {
    if (o.tc === '' || (typeof o.tc === 'string' && TC_RE.test(o.tc))) inv.tc = o.tc;
    if (o.color === 'white' || o.color === 'black' || o.color === 'random') inv.color = o.color;
  } else {
    const title = cleanText(o.title).replace(/\s+/g, ' ').slice(0, 80);
    if (title) inv.title = title;
  }
  return inv;
}

/** Παρτίδες (PGN σε απλό κείμενο) που στάλθηκαν σε φίλο ή ομάδα· το αρχείο μένει στον server 7 μέρες. */
export interface FileShare {
  id: string;
  name: string;
  games: number;
  /** μέγεθος του PGN (bytes) */
  size: number;
  /** πότε λήγει (ms) */
  exp: number;
}

/** Έκδοση των όρων χρήσης (TERMS.md). Όταν αλλάζει, τους δέχεται ξανά ο καθένας πριν συνδεθεί. */
export const TERMS_VERSION = '2026-11-22';
/** Όριο ηλικίας για λογαριασμό. */
export const MIN_AGE = 16;

/** Αποδοχή των όρων και δήλωση ηλικίας. */
export interface Consent {
  terms: string;
  age16: true;
}

export function validConsent(v: unknown): v is Consent {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return c.terms === TERMS_VERSION && c.age16 === true;
}

export const REPORT_REASONS = ['abuse', 'child', 'illegal', 'copyright', 'impersonation', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_MAX_TEXT = 1000;
/** οι αναφορές σβήνουν το αργότερο τόσες μέρες μετά */
export const REPORT_DAYS = 180;

/** Τι αναφέρεται: χρήστης, ομάδα, ή μήνυμα (`mid`) σε συνομιλία με φίλο (`id`) ή ομάδα (`team`). */
export interface ReportTarget {
  id?: string;
  team?: string;
  mid?: number;
}

export type SocialClientMsg =
  | { t: 'auth'; key: string; accept?: Consent }
  | ({ t: 'report'; reason: ReportReason; text: string } & ReportTarget)
  | { t: 'activity'; a: Activity | null }
  /** τα usernames μου σε Lichess / Chess.com (null: κανένα) */
  | { t: 'accounts'; acc: Accounts | null }
  | { t: 'add'; name: string; tag: string }
  | { t: 'accept'; id: string }
  /** απόρριψη αιτήματος, ακύρωση δικού μου ή αφαίρεση φίλου */
  | { t: 'remove'; id: string }
  /** φίλος, αίτημα, παλιά επαφή ή (με `team`) μέλος ομάδας μου */
  | { t: 'block'; id: string; team?: string }
  | { t: 'unblock'; id: string }
  | { t: 'history'; peer: string; before?: number }
  | { t: 'send'; peer: string; text: string }
  | ({ t: 'invite'; peer: string } & Invite)
  /** απάντηση σε πρόσκληση: ναι (μπαίνω) ή όχι τώρα */
  | { t: 'reply'; peer: string; mid: number; kind: Invite['kind']; ok: boolean }
  | { t: 'read'; peer: string }
  | { t: 'delmsg'; peer: string; mid: number }
  | { t: 'clear'; peer: string }
  // ομάδες
  | { t: 'team_create'; name: string }
  | { t: 'team_get'; team: string }
  | { t: 'team_invite'; team: string; peer: string }
  | { t: 'team_accept'; team: string }
  | { t: 'team_decline'; team: string }
  | { t: 'team_leave'; team: string }
  /** αφαίρεση μέλους ή ακύρωση πρόσκλησης */
  | { t: 'team_kick'; team: string; id: string }
  | { t: 'team_role'; team: string; id: string; role: TeamRole }
  | { t: 'team_rename'; team: string; name: string }
  | { t: 'team_send'; team: string; text: string }
  /** κοινή ανάλυση για όλη την ομάδα: «Μπες» σε όλα τα μέλη */
  | { t: 'team_analysis'; team: string; room: string; title?: string }
  | { t: 'team_history'; team: string; before?: number }
  | { t: 'team_delmsg'; team: string; mid: number }
  | { t: 'team_clear'; team: string }
  | { t: 'team_read'; team: string }
  | { t: 'ping' };

export type SocialError = 'notfound' | 'self' | 'already' | 'rate' | 'limit' | 'notfriend' | 'blocked' | 'bad' | 'teamname' | 'teams' | 'teamfull' | 'role' | 'notmember';

export type SocialServerMsg =
  | { t: 'hello'; me: Person; acc?: Accounts | null; friends: Friend[]; blocked: Person[]; teams: TeamRow[] }
  /** άλλαξαν τα usernames μου (από αυτό ή άλλο παράθυρο) */
  | { t: 'accounts'; acc: Accounts | null }
  | { t: 'friend'; f: Friend }
  | { t: 'unfriend'; id: string }
  | { t: 'presence'; id: string; p: Presence }
  | { t: 'blocked'; list: Person[] }
  | { t: 'history'; peer: string; msgs: DmMsg[]; more: boolean; before?: number }
  | { t: 'msg'; peer: string; m: DmMsg; unread: number }
  | { t: 'msgdel'; peer: string; mid: number }
  | { t: 'cleared'; peer: string }
  | { t: 'read'; peer: string }
  | { t: 'added'; name: string; tag: string; friends: boolean }
  | { t: 'reply'; peer: string; mid: number; kind: Invite['kind']; ok: boolean }
  | { t: 'team'; team: TeamRow }
  | { t: 'unteam'; id: string }
  | { t: 'teaminfo'; info: TeamInfo }
  | { t: 'tmsg'; team: string; m: DmMsg; unread: number }
  | { t: 'thistory'; team: string; msgs: DmMsg[]; more: boolean; before?: number }
  | { t: 'tmsgdel'; team: string; mid: number }
  | { t: 'tcleared'; team: string }
  | { t: 'tread'; team: string }
  | { t: 'error'; code: SocialError }
  /** το κλειδί είναι σωστό, αλλά χρειάζεται αποδοχή όρων και ηλικίας */
  | { t: 'terms' }
  | { t: 'reported'; id: string }
  /** διαγράφηκε ο λογαριασμός μέλους: φεύγουν τα μηνύματά του από το chat της ομάδας */
  | { t: 'tforget'; team: string; id: string }
  | { t: 'pong' };

export const SOCIAL_MAX_TEXT = 2000;
export const SOCIAL_MAX_FRIENDS = 200;
export const SOCIAL_HISTORY_PAGE = 50;
/** μηνύματα που μένουν σε κάθε συνομιλία (τα παλαιότερα σβήνουν) */
export const SOCIAL_KEEP = 5000;

/** μέλη (και προσκλήσεις) ανά ομάδα, ομάδες ανά χρήστη */
export const TEAM_MAX = 50;
export const TEAMS_PER_USER = 20;

/** αρχεία: μόνο PGN σε απλό κείμενο (pgnFile.ts), έως 1 MB, 7 μέρες στον server */
export const FILE_MAX = 1024 * 1024;
export const FILE_DAYS = 7;
/** πάνω από τόσες παρτίδες δεν χωρούν στο 1 MB, ούτε άδειες (μόνο οι 7 ετικέτες πιάνουν πάνω από 100 bytes) */
export const FILE_MAX_GAMES = 10_000;
export const FILE_RE = /^[a-z2-9]{20}$/;

export const USER_RE = /^[a-z2-9]{16}$/;
export const TEAM_RE = /^[a-z2-9]{12}$/;
export const ROOM_ID_RE = /^[a-z2-9]{8}$/;
const KEY_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const KEY_LEN = 24;

/** Όνομα: 3–16 γράμματα, ψηφία ή κενά (όχι στην αρχή ή στο τέλος). null αν δεν είναι σωστό. */
export function cleanSocialName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  return /^[\p{L}\p{N}][\p{L}\p{N} ]{1,14}[\p{L}\p{N}]$/u.test(s) ? s : null;
}

/** Όνομα ομάδας: 3–24 γράμματα, ψηφία, κενά ή - _ . (όχι κενό στην αρχή ή στο τέλος). */
export function cleanTeamName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  return /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,22}[\p{L}\p{N}.]$/u.test(s) ? s : null;
}

export const nameKey = (name: string) => name.normalize('NFC').toLowerCase();

/** «Όνομα#1234» → {name, tag}. */
export function parseNameTag(v: string): { name: string; tag: string } | null {
  const m = /^(.+?)\s*#\s*(\d{4})$/.exec(v.trim());
  if (!m) return null;
  const name = cleanSocialName(m[1]);
  return name ? { name, tag: m[2] } : null;
}

export function randomKey(): string {
  const bytes = new Uint8Array(KEY_LEN);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += KEY_ABC[b % KEY_ABC.length];
  return s;
}

/** Το κλειδί για να το γράψει ή να το αντιγράψει κανείς: ABCD-EFGH-… */
export const recoveryCode = (key: string) => key.match(/.{1,4}/g)?.join('-') ?? key;

/** Ό,τι έγραψε ο χρήστης ως κωδικό ανάκτησης → το κλειδί (ή null). */
export function parseRecovery(v: string): string | null {
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === KEY_LEN && [...s].every((c) => KEY_ABC.includes(c)) ? s : null;
}

export async function hashKey(key: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`knightbase-social:${key}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Η μία συνομιλία δύο φίλων. */
export const dmId = (a: string, b: string) => (a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`);

export function parseInvite(m: DmMsg): Invite | null {
  if (m.kind !== 'invite') return null;
  try {
    return cleanInvite(JSON.parse(m.text));
  } catch {
    return null;
  }
}

export function parseFile(m: DmMsg): FileShare | null {
  if (m.kind !== 'file') return null;
  try {
    const v = JSON.parse(m.text) as FileShare;
    return FILE_RE.test(v.id) && typeof v.name === 'string' && Number.isFinite(v.size) && Number.isFinite(v.exp) ? { ...v, games: Number(v.games) || 0 } : null;
  } catch {
    return null;
  }
}

/** Όνομα αρχείου για αποστολή: χωρίς χαρακτήρες που δεν επιτρέπονται σε αρχεία, έως 60. */
export function cleanFileName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v
    .replace(/[\u0000-\u001f<>:"/\\|?*]|\p{Bidi_Control}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return s || null;
}

/** Καθαρό κείμενο μηνύματος (χωρίς χαρακτήρες ελέγχου, έως 2.000 χαρακτήρες). */
export function cleanText(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, SOCIAL_MAX_TEXT) : '';
}
