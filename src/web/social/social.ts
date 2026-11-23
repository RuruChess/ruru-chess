/**
 * Φίλοι: η σύνδεση του Ruru με τον server (relay/, UserHub) και η κατάσταση που βλέπουν η στήλη «Φίλοι»
 * της Βιβλιοθήκης και τα παράθυρα chat. Μία σύνδεση, μόνο στο κύριο παράθυρο· τα ξεχωριστά παράθυρα (π.χ. μια
 * παρτίδα σε κοινή ανάλυση) λένε τι κάνουν μέσω BroadcastChannel, ώστε να φαίνεται στους φίλους.
 *
 * Τα chat κρατιούνται με κλειδί: το id του φίλου, ή «t:<id>» για το chat μιας ομάδας.
 */
import { create } from 'zustand';
import type { Accounts, Activity, Consent, DmMsg, Friend, Invite, Person, ReportTarget, SocialClientMsg, SocialError, SocialServerMsg, TeamInfo, TeamRow } from '../../core/social.ts';
import { PGN_MIME, checkPgnFile, readCapped } from '../../core/pgnFile.ts';
import { FILE_MAX, FILE_MAX_GAMES, TERMS_VERSION, cleanSocialName, parseFile, parseInvite, parseRecovery } from '../../core/social.ts';
import type { LegalDoc } from '../components/LegalText.tsx';
import { L, fmtNum } from '../i18n.ts';
import { api, type DbInfo, type JobInfo } from '../api.ts';
import { OPEN_KEY, useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';
import { serverDown } from '../online/server.ts';
import { CONTACT_EMAIL, SOCIAL } from '../../core/features.ts';
import { playChime } from '../sounds.ts';

export interface SocialAccount {
  server: string;
  userId: string;
  name: string;
  tag: string;
  key: string;
}

export function accountOf(ui: Record<string, unknown> | undefined): SocialAccount | null {
  const a = ui?.social as SocialAccount | null | undefined;
  return SOCIAL && a && a.server && a.userId && a.key && a.name ? a : null;
}

export interface ChatLog {
  msgs: DmMsg[];
  more: boolean;
  loaded: boolean;
}

/** Συμμετοχή ως καλεσμένος σε δωμάτιο του server (από πρόσκληση ή από την παρουσία ενός φίλου). */
export interface RoomJoin {
  server: string;
  id: string;
  name: string;
  /** μόνο για να δω την παρτίδα ενός φίλου (θεατής) */
  watch?: boolean;
}

/** Νέα παρτίδα που έφτιαξα για να καλέσω έναν φίλο (ανοίγει στην «Παίξε με φίλο» ως οικοδεσπότης). */
export interface HostGame {
  server: string;
  id: string;
  token: string;
  /** το όνομα του φίλου που καλέσαμε */
  invited: string;
}

export interface SocialState {
  /** terms: το κλειδί δεκτό, περιμένει αποδοχή όρων και ηλικίας */
  status: 'off' | 'connecting' | 'open' | 'retrying' | 'bad' | 'gone' | 'terms';
  me: Person | null;
  /** τα usernames μου σε Lichess / Chess.com (από τον server) */
  myAcc: Accounts | null;
  friends: Friend[];
  blocked: Person[];
  logs: Record<string, ChatLog>;
  teams: TeamRow[];
  /** μέλη και προσκλήσεις των ομάδων που άνοιξε ο χρήστης (από τον server, όταν ζητηθούν) */
  teamInfo: Record<string, TeamInfo>;
  /** ανοιχτό παράθυρο ομάδας (μέλη, ρόλοι, προσκλήσεις) και «Νέα ομάδα» */
  teamView: string | null;
  newTeam: boolean;
  /** ανοιχτά παράθυρα chat (κάτω δεξιά): φίλος ή «t:<ομάδα>» */
  chats: Array<{ peer: string; min: boolean }>;
  /** προσκλήσεις που ήρθαν τώρα (ειδοποίηση με ✓ / ✗)· με `team` όταν ήρθαν στο chat μιας ομάδας */
  invites: Array<{ peer: string; m: DmMsg; team?: string }>;
  /** βάσεις που έστειλαν φίλοι ή μέλη ομάδας (ειδοποίηση με ✓ = «Εισαγωγή») */
  files: Array<{ peer: string; m: DmMsg; team?: string }>;
  /** «Αποστολή σε φίλο ή ομάδα»: τι (βάση / επιλεγμένες παρτίδες) και σε ποιον, όσα είναι ήδη γνωστά */
  sendDialog: SendRequest | null;
  /**
   * πρόσκληση σε κοινή ανάλυση που περιμένει να ξεκινήσει μια νέα ανάλυση: σε φίλους και σε όλες τις ομάδες εδώ
   * (`skip`: οι αναλύσεις που έτρεχαν ήδη)
   */
  pending: { peers: string[]; teams: string[]; skip: string[] } | null;
  /** για τις καρτέλες «Παίξε με φίλο» και «Κοινή ανάλυση»: άνοιξε αυτό το δωμάτιο ως καλεσμένος */
  joinGame: RoomJoin | null;
  joinAnalysis: RoomJoin | null;
  hostGame: HostGame | null;
  /** «Παρτίδα με…»: το παράθυρο της πρόσκλησης (χρώμα, ρολόι) για αυτόν τον φίλο */
  gameDialog: string | null;
  /** «Κοινή ανάλυση με…»: τι θα αναλύσετε (σε φίλο ή σε όλη την ομάδα) */
  analysisDialog: { peer?: string; team?: string } | null;
  /** ξεκίνα κοινή ανάλυση στην ανοιχτή παρτίδα αυτής της καρτέλας */
  shareTab: string | null;
  /** η καρτέλα «Κοινή ανάλυση» να ξεκινήσει μόνη της: άδεια σκακιέρα ή η τελευταία ανάλυση */
  shareStart: 'empty' | 'resume' | null;
  /** οι παρτίδες που είναι ανοιχτές στα ξεχωριστά παράθυρα (`win`: το παράθυρο), για το «Κοινή ανάλυση με…» */
  openGames: OpenGame[];
  /** αποτέλεσμα της τελευταίας «Προσθήκης φίλου» */
  addResult: { ok: boolean; text: string } | null;
  /** μόλις φτιάχτηκε ο λογαριασμός: δείξε τον κωδικό ανάκτησης */
  showCode: boolean;
  /** παράθυρα του Safety.tsx */
  legal: LegalDoc | null;
  deleting: boolean;
  report: { target: ReportTarget; label: string } | null;
  /** ο αριθμός της αναφοράς που μόλις στάλθηκε */
  reported: string | null;
}

const EMPTY = {
  me: null,
  myAcc: null,
  friends: [],
  blocked: [],
  teams: [],
  teamInfo: {},
  logs: {},
  chats: [],
  invites: [],
  files: [],
  pending: null,
  addResult: null,
  deleting: false,
  report: null,
  reported: null,
} satisfies Partial<SocialState>;

export const useSocial = create<SocialState>(() => ({ status: 'off', joinGame: null, joinAnalysis: null, hostGame: null, gameDialog: null, analysisDialog: null, shareTab: null, shareStart: null, openGames: [], teamView: null, newTeam: false, sendDialog: null, showCode: false, legal: null, ...EMPTY }));

export interface OpenGame {
  id: string;
  title: string;
  win?: string;
}

export interface SendRequest {
  dbId?: string;
  /** μόνο αυτές οι παρτίδες της βάσης (αλλιώς όλη) */
  ids?: number[];
  peer?: string;
  team?: string;
}

/** «1 παρτίδα» / «12 παρτίδες» */
export const gamesText = (n: number) => (n === 1 ? L('1 παρτίδα', '1 game') : L(`${fmtNum(n)} παρτίδες`, `${fmtNum(n)} games`));

/** Το κλειδί του chat μιας ομάδας. */
export const teamKey = (id: string) => `t:${id}`;
const teamOfKey = (key: string) => (key.startsWith('t:') ? key.slice(2) : null);
export const teamOf = (id: string) => get().teams.find((t) => t.id === id);
const sameInvite = (i: { m: DmMsg; team?: string }, m: DmMsg, team?: string) => i.m.id === m.id && (i.team ?? '') === (team ?? '');
/**
 * Απάντηση σε πρόσκληση (από την ειδοποίηση, τη γραμμή του φίλου ή το chat): φεύγουν όλες οι προσκλήσεις
 * του ίδιου φίλου ή της ίδιας ομάδας, όχι μόνο αυτή με το ίδιο id (π.χ. «Μπες» σε παλιότερη στο chat).
 */
const dropInvites = (m: DmMsg, team?: string) =>
  set((s) => ({ invites: s.invites.filter((i) => !sameInvite(i, m, team) && (team ? i.team !== team : i.team || i.peer !== m.from)) }));

const set = useSocial.setState;
const get = useSocial.getState;
const toast = (text: string, kind: 'info' | 'ok' | 'error' = 'info') => useApp.getState().toast(text, kind);

export const fullName = (p: Person) => `${p.name}#${p.tag}`;
export const friendOf = (id: string) => get().friends.find((f) => f.id === id);

// ---------------------------------------------------------------------------
// λογαριασμός

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as T };
}

const consent = (): Consent => ({ terms: TERMS_VERSION, age16: true });

/** Νέος λογαριασμός (η φόρμα έχει ήδη την αποδοχή όρων και ηλικίας). Επιστρέφει μήνυμα λάθους ή null. */
export async function registerSocial(server: string, rawName: string): Promise<string | null> {
  const name = cleanSocialName(rawName);
  if (!name) return L('Το όνομα θέλει 3–16 γράμματα ή ψηφία (και κενά ανάμεσα).', 'The name needs 3–16 letters or digits (spaces allowed in between).');
  try {
    const r = await postJson<{ userId: string; name: string; tag: string; key: string; error?: string }>(`${server}/api/social/register`, { name, accept: consent() });
    if (r.data.error === 'consent') return L('Οι όροι άλλαξαν. Ενημέρωσε το Ruru Chess και δοκίμασε ξανά.', 'The terms have changed. Update Ruru Chess and try again.');
    if (!r.ok) return r.data.error === 'rate' ? L('Πολλοί νέοι λογαριασμοί από εδώ. Δοκίμασε σε μία ώρα.', 'Too many new accounts from here. Try again in an hour.') : L('Δεν έγινε. Δοκίμασε άλλο όνομα.', 'That did not work. Try another name.');
    set({ showCode: true });
    setUiLater({ social: { server, userId: r.data.userId, name: r.data.name, tag: r.data.tag, key: r.data.key } satisfies SocialAccount });
    return null;
  } catch {
    return L('Δεν απαντά ο server. Έλεγξε τη σύνδεσή σου στο internet.', 'The server does not respond. Check your internet connection.');
  }
}

/** Ο λογαριασμός σε αυτόν τον υπολογιστή από τον κωδικό ανάκτησης. */
export async function recoverSocial(server: string, code: string): Promise<string | null> {
  const key = parseRecovery(code);
  if (!key) return L('Ο κωδικός έχει 24 γράμματα και ψηφία (π.χ. ABCD-EFGH-…).', 'The code has 24 letters and digits (e.g. ABCD-EFGH-…).');
  try {
    const r = await postJson<{ userId: string; name: string; tag: string; key: string }>(`${server}/api/social/recover`, { key });
    if (!r.ok) return r.status === 404 ? L('Δεν βρέθηκε λογαριασμός με αυτόν τον κωδικό.', 'No account found with this code.') : L('Δεν έγινε. Δοκίμασε ξανά.', 'That did not work. Try again.');
    setUiLater({ social: { server, userId: r.data.userId, name: r.data.name, tag: r.data.tag, key } satisfies SocialAccount });
    return null;
  } catch {
    return L('Δεν απαντά ο server. Έλεγξε τη σύνδεσή σου στο internet.', 'The server does not respond. Check your internet connection.');
  }
}

export function signOutSocial(): void {
  setUiLater({ social: null });
}

const accountCall = (a: SocialAccount, what: 'delete' | 'export') =>
  fetch(`${a.server.replace(/\/+$/, '')}/api/social/${what}?u=${encodeURIComponent(a.userId)}`, { method: 'POST', headers: { Authorization: `Bearer ${a.key}` } });

/** Πλήρης διαγραφή από τον server. Επιστρέφει μήνυμα λάθους ή null. */
export async function deleteSocial(a: SocialAccount): Promise<string | null> {
  try {
    const r = await accountCall(a, 'delete');
    if (!r.ok) return L(`Δεν έγινε η διαγραφή. Δοκίμασε ξανά ή γράψε στο ${CONTACT_EMAIL}.`, `The account was not deleted. Try again or write to ${CONTACT_EMAIL}.`);
    set({ deleting: false, showCode: false });
    signOutSocial();
    toast(L('Ο λογαριασμός έκλεισε και τα δεδομένα του σβήνονται από τον server μέσα σε λίγα λεπτά.', 'The account is closed and its data is being deleted from the server within minutes.'), 'ok');
    return null;
  } catch {
    return L('Δεν απαντά ο server. Ο λογαριασμός δεν διαγράφηκε.', 'The server does not respond. The account was not deleted.');
  }
}

/** Τα δεδομένα του λογαριασμού σε αρχείο JSON. */
export async function downloadMyData(a: SocialAccount): Promise<void> {
  try {
    const r = await accountCall(a, 'export');
    if (!r.ok) return toast(r.status === 429 ? ERR.rate() : L('Δεν έγινε η λήψη των δεδομένων.', 'Your data could not be downloaded.'), 'error');
    const url = URL.createObjectURL(await r.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `ruru-account-${a.name}-${a.tag}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    toast(L('Δεν απαντά ο server.', 'The server does not respond.'), 'error');
  }
}

export const openReport = (target: ReportTarget, label: string) => set({ report: { target, label }, reported: null });

// ---------------------------------------------------------------------------
// σύνδεση

let acc: SocialAccount | null = null;
let ws: WebSocket | null = null;
let authed = false;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let ping: ReturnType<typeof setInterval> | undefined;

/** Σύνδεση με τον λογαριασμό (ή αποσύνδεση με null). Καλείται από το App σε κάθε αλλαγή των ρυθμίσεων. */
export function connectSocial(a: SocialAccount | null): void {
  if (OPEN_KEY) return;
  if (a && acc && a.server === acc.server && a.userId === acc.userId && a.key === acc.key) return;
  if (!a && !acc) return;
  clearTimeout(timer);
  clearInterval(ping);
  const old = ws;
  ws = null;
  old?.close(1000);
  authed = false;
  acc = a;
  retry = 0;
  set({ status: a ? 'connecting' : 'off', ...EMPTY });
  if (a) open();
}

function open(): void {
  const a = acc;
  if (!a) return;
  const sock = new WebSocket(`${a.server.replace(/\/+$/, '').replace(/^http/, 'ws')}/social?u=${encodeURIComponent(a.userId)}`);
  ws = sock;
  sock.onopen = () => {
    sock.send(JSON.stringify({ t: 'auth', key: a.key } satisfies SocialClientMsg));
    ping = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('{"t":"ping"}'), 25_000);
  };
  sock.onmessage = (ev) => {
    let m: SocialServerMsg;
    try {
      m = JSON.parse(String(ev.data)) as SocialServerMsg;
    } catch {
      return;
    }
    if (ws === sock) handle(m);
  };
  sock.onclose = (ev) => {
    clearInterval(ping);
    if (ws !== sock) return;
    ws = null;
    authed = false;
    // 4401: λάθος κλειδί· 4404: ο λογαριασμός δεν υπάρχει (π.χ. άλλος server)
    if (ev.code === 4401) return set({ status: 'bad' });
    if (ev.code === 4404) return set({ status: 'gone' });
    set({ status: 'retrying' });
    timer = setTimeout(open, Math.min(15_000, 1000 * 2 ** retry++));
  };
}

export function acceptTerms(): void {
  if (!acc || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ t: 'auth', key: acc.key, accept: consent() } satisfies SocialClientMsg));
}

export function socialSend(m: SocialClientMsg): boolean {
  if (!ws || !authed || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}

/** Τα usernames μου σε Lichess / Chess.com (τα βλέπουν οι φίλοι μου). */
export const setAccounts = (acc: Accounts | null): boolean => socialSend({ t: 'accounts', acc });

const ERR: Record<SocialError, () => string> = {
  notfound: () => L('Δεν υπάρχει κανείς με αυτό το Όνομα#TAG.', 'Nobody has this Name#TAG.'),
  self: () => L('Αυτό είναι το δικό σου όνομα 🙂', 'That is your own name 🙂'),
  already: () => L('Είστε ήδη φίλοι ή περιμένει ήδη το αίτημά σου.', 'You are already friends, or your request is already waiting.'),
  rate: () => L('Πολλά μαζί· περίμενε λίγο και ξαναδοκίμασε.', 'Too many at once; wait a little and try again.'),
  limit: () => L('Έφτασες το όριο των 200 φίλων.', 'You have reached the limit of 200 friends.'),
  notfriend: () => L('Δεν είστε (πια) φίλοι.', 'You are not friends (any more).'),
  blocked: () => L('Τον έχεις μπλοκάρει· ξεμπλόκαρέ τον πρώτα (μενού ⋮ → Μπλοκαρισμένοι).', 'You have blocked them; unblock them first (menu ⋮ → Blocked).'),
  bad: () => L('Κάτι δεν πήγε καλά.', 'Something went wrong.'),
  teamname: () => L('Το όνομα της ομάδας θέλει 3–24 γράμματα ή ψηφία.', 'The team name needs 3–24 letters or digits.'),
  teams: () => L('Έφτασε το όριο των 20 ομάδων (για σένα ή για τον φίλο που καλείς).', 'The limit of 20 teams has been reached (yours or your friend’s).'),
  teamfull: () => L('Η ομάδα είναι γεμάτη (έως 50 μέλη και προσκλήσεις).', 'The team is full (up to 50 members and invitations).'),
  role: () => L('Αυτό το κάνει μόνο ο ιδιοκτήτης ή διαχειριστής της ομάδας.', 'Only the team owner or an admin can do that.'),
  notmember: () => L('Δεν είσαι (πια) μέλος αυτής της ομάδας.', 'You are not a member of this team (any more).'),
};

function upsertTeam(t: TeamRow): void {
  set((s) => {
    const i = s.teams.findIndex((x) => x.id === t.id);
    return { teams: i < 0 ? [...s.teams, t] : s.teams.map((x) => (x.id === t.id ? t : x)) };
  });
}

/** ζήτα το ιστορικό ενός chat (φίλου ή ομάδας) */
function askHistory(key: string, before?: number): void {
  const team = teamOfKey(key);
  socialSend(team ? { t: 'team_history', team, ...(before ? { before } : {}) } : { t: 'history', peer: key, ...(before ? { before } : {}) });
}

function setHistory(key: string, msgs: DmMsg[], more: boolean, before?: number): void {
  const s = get();
  const old = s.logs[key];
  const all = before && old ? [...msgs, ...old.msgs.filter((x) => x.id >= before)] : msgs;
  set({ logs: { ...s.logs, [key]: { msgs: all, more, loaded: true } } });
}

function upsertFriend(f: Friend): void {
  set((s) => {
    const i = s.friends.findIndex((x) => x.id === f.id);
    return { friends: i < 0 ? [...s.friends, f] : s.friends.map((x) => (x.id === f.id ? f : x)) };
  });
}

function handle(m: SocialServerMsg): void {
  const s = get();
  switch (m.t) {
    case 'hello': {
      authed = true;
      retry = 0;
      set({ status: 'open', me: m.me, myAcc: m.acc ?? null, friends: m.friends, blocked: m.blocked, teams: m.teams ?? [] });
      sentActivity = '';
      pushActivity();
      // τα ανοιχτά chat: ξανά το ιστορικό (μπορεί να ήρθαν μηνύματα όσο ήμασταν εκτός)
      for (const c of get().chats) askHistory(c.peer);
      const view = get().teamView;
      if (view) socialSend({ t: 'team_get', team: view });
      return;
    }
    // ---- ομάδες
    case 'team': {
      const old = s.teams.find((t) => t.id === m.team.id);
      upsertTeam(m.team);
      if (m.team.state === 'invited' && !old) playChime();
      // άλλαξε κάτι (μέλη, ρόλοι): νέα στοιχεία, αν είναι ανοιχτό το παράθυρο της ομάδας
      if (m.team.state === 'member' && s.teamView === m.team.id) socialSend({ t: 'team_get', team: m.team.id });
      return;
    }
    case 'unteam': {
      const key = teamKey(m.id);
      const teamInfo = { ...s.teamInfo };
      delete teamInfo[m.id];
      set({
        teams: s.teams.filter((t) => t.id !== m.id),
        teamInfo,
        chats: s.chats.filter((c) => c.peer !== key),
        invites: s.invites.filter((i) => i.team !== m.id),
        files: s.files.filter((i) => i.team !== m.id),
        teamView: s.teamView === m.id ? null : s.teamView,
        pending: s.pending?.teams.includes(m.id) ? (s.pending.peers.length || s.pending.teams.length > 1 ? { ...s.pending, teams: s.pending.teams.filter((x) => x !== m.id) } : null) : s.pending,
      });
      return;
    }
    case 'teaminfo':
      set({ teamInfo: { ...s.teamInfo, [m.info.id]: m.info } });
      return;
    case 'thistory':
      setHistory(teamKey(m.team), m.msgs, m.more, m.before);
      return;
    case 'tmsg': {
      const key = teamKey(m.team);
      const log = s.logs[key];
      const logs = log ? { ...s.logs, [key]: { ...log, msgs: log.msgs.some((x) => x.id === m.m.id) ? log.msgs : [...log.msgs, m.m] } } : s.logs;
      const teams = s.teams.map((t) => (t.id === m.team ? { ...t, unread: m.unread, lastAt: m.m.at } : t));
      let invites = s.invites;
      // κοινή ανάλυση για την ομάδα: ειδοποίηση με ✓ σε όλους εκτός από αυτόν που την ξεκίνησε
      if (m.m.from !== s.me?.id && parseInvite(m.m)) {
        invites = [...invites.filter((i) => i.team !== m.team), { peer: m.m.from, m: m.m, team: m.team }];
        playChime();
      }
      const files = m.m.from !== s.me?.id && parseFile(m.m) ? [...s.files, { peer: m.m.from, m: m.m, team: m.team }] : s.files;
      if (files !== s.files) playChime();
      set({ logs, teams, invites, files });
      return;
    }
    case 'tmsgdel': {
      const key = teamKey(m.team);
      const log = s.logs[key];
      if (log) set({ logs: { ...s.logs, [key]: { ...log, msgs: log.msgs.filter((x) => x.id !== m.mid) } } });
      set({ invites: get().invites.filter((i) => !(i.team === m.team && i.m.id === m.mid)), files: get().files.filter((i) => !(i.team === m.team && i.m.id === m.mid)) });
      return;
    }
    case 'tcleared':
      set({
        logs: { ...s.logs, [teamKey(m.team)]: { msgs: [], more: false, loaded: true } },
        teams: s.teams.map((t) => (t.id === m.team ? { ...t, unread: 0 } : t)),
        invites: s.invites.filter((i) => i.team !== m.team),
      });
      return;
    case 'tread':
      set({ teams: s.teams.map((t) => (t.id === m.team ? { ...t, unread: 0 } : t)) });
      return;
    case 'accounts':
      set({ myAcc: m.acc });
      return;
    case 'friend': {
      const old = s.friends.find((f) => f.id === m.f.id);
      upsertFriend(m.f);
      if (m.f.state === 'in' && !old) playChime();
      if (m.f.state === 'friend' && old?.state === 'out') toast(L(`Ο/Η ${fullName(m.f)} δέχτηκε το αίτημά σου.`, `${fullName(m.f)} accepted your request.`), 'ok');
      return;
    }
    case 'unfriend':
      set({
        friends: s.friends.filter((f) => f.id !== m.id),
        chats: s.chats.filter((c) => c.peer !== m.id),
        invites: s.invites.filter((i) => i.team || i.peer !== m.id),
        files: s.files.filter((i) => i.team || i.peer !== m.id),
      });
      return;
    case 'presence':
      set({ friends: s.friends.map((f) => (f.id === m.id ? { ...f, p: m.p } : f)) });
      return;
    case 'blocked': {
      const ids = new Set(m.list.map((p) => p.id));
      // ξεμπλοκάρισμα: τα chat των ομάδων ξαναζητιούνται, για να φανούν τα μηνύματά του
      const reload = s.blocked.some((p) => !ids.has(p.id));
      const logs: typeof s.logs = {};
      for (const [key, log] of Object.entries(s.logs)) {
        if (!teamOfKey(key)) logs[key] = log;
        else if (!reload) logs[key] = { ...log, msgs: log.msgs.filter((x) => !ids.has(x.from)) };
      }
      set({
        blocked: m.list,
        logs,
        invites: s.invites.filter((i) => !ids.has(i.m.from)),
        files: s.files.filter((i) => !ids.has(i.m.from)),
      });
      if (reload) for (const c of s.chats) if (teamOfKey(c.peer)) askHistory(c.peer);
      return;
    }
    case 'history':
      setHistory(m.peer, m.msgs, m.more, m.before);
      return;
    case 'msg': {
      const log = s.logs[m.peer];
      const logs = log ? { ...s.logs, [m.peer]: { ...log, msgs: log.msgs.some((x) => x.id === m.m.id) ? log.msgs : [...log.msgs, m.m] } } : s.logs;
      const friends = s.friends.map((f) => (f.id === m.peer ? { ...f, unread: m.unread, lastAt: m.m.at } : f));
      const theirs = m.m.from !== s.me?.id;
      let chats = s.chats;
      let invites = s.invites;
      if (theirs) {
        // όπως στο LoL: το chat εμφανίζεται (μαζεμένο) μόλις έρθει μήνυμα
        if (!chats.some((c) => c.peer === m.peer)) chats = [...chats, { peer: m.peer, min: true }].slice(-4);
        if (parseInvite(m.m)) {
          invites = [...invites.filter((i) => i.team || i.peer !== m.peer), { peer: m.peer, m: m.m }];
          playChime();
        }
        if (parseFile(m.m)) {
          set({ files: [...get().files, { peer: m.peer, m: m.m }] });
          playChime();
        }
      }
      set({ logs, friends, chats, invites });
      if (theirs && !log) socialSend({ t: 'history', peer: m.peer });
      return;
    }
    case 'msgdel': {
      const log = s.logs[m.peer];
      if (log) set({ logs: { ...s.logs, [m.peer]: { ...log, msgs: log.msgs.filter((x) => x.id !== m.mid) } } });
      set({ invites: get().invites.filter((i) => i.team || i.m.id !== m.mid), files: get().files.filter((i) => i.team || i.m.id !== m.mid) });
      return;
    }
    case 'cleared':
      set({
        logs: { ...s.logs, [m.peer]: { msgs: [], more: false, loaded: true } },
        friends: s.friends.map((f) => (f.id === m.peer ? { ...f, unread: 0 } : f)),
        invites: s.invites.filter((i) => i.team || i.peer !== m.peer),
      });
      return;
    case 'read':
      set({ friends: s.friends.map((f) => (f.id === m.peer ? { ...f, unread: 0 } : f)) });
      return;
    case 'added':
      set({
        addResult: {
          ok: true,
          text: m.friends
            ? L(`Είστε πια φίλοι με τον/την ${m.name}#${m.tag}.`, `You are now friends with ${m.name}#${m.tag}.`)
            : L(`Στάλθηκε αίτημα φιλίας στον/στην ${m.name}#${m.tag}.`, `Friend request sent to ${m.name}#${m.tag}.`),
        },
      });
      return;
    case 'reply': {
      const n = s.friends.find((f) => f.id === m.peer)?.name ?? '';
      if (!m.ok)
        toast(
          m.kind === 'game'
            ? L(`Ο/Η ${n} δεν μπορεί να παίξει τώρα.`, `${n} cannot play right now.`)
            : L(`Ο/Η ${n} δεν μπορεί τώρα για κοινή ανάλυση.`, `${n} cannot join the shared analysis right now.`),
          'info',
        );
      // όταν δέχεται: το «μπήκε» το λέει η ίδια η παρτίδα ή η ανάλυση, μόλις μπει
      return;
    }
    case 'terms':
      authed = false;
      retry = 0;
      set({ status: 'terms' });
      return;
    case 'reported':
      if (s.report) set({ reported: m.id });
      else toast(L(`Η αναφορά καταχωρήθηκε (${m.id}).`, `Report recorded (${m.id}).`), 'ok');
      return;
    case 'tforget': {
      const key = teamKey(m.team);
      const log = s.logs[key];
      set({
        ...(log ? { logs: { ...s.logs, [key]: { ...log, msgs: log.msgs.filter((x) => x.from !== m.id) } } } : {}),
        invites: s.invites.filter((i) => i.team !== m.team || i.m.from !== m.id),
        files: s.files.filter((i) => i.team !== m.team || i.m.from !== m.id),
      });
      return;
    }
    case 'error':
      if (['notfound', 'self', 'already', 'limit', 'blocked'].includes(m.code)) set({ addResult: { ok: false, text: ERR[m.code]() } });
      else toast(ERR[m.code](), 'error');
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------
// chat

/** Άνοιγμα chat: φίλου (id) ή ομάδας (teamKey). */
export function openChat(peer: string, min = false): void {
  const s = get();
  const chats = [...s.chats.filter((c) => c.peer !== peer), { peer, min }].slice(-4);
  set({ chats });
  if (!s.logs[peer]?.loaded) askHistory(peer);
}

/** Παλαιότερα μηνύματα ενός chat. */
export function olderMessages(key: string): void {
  const first = get().logs[key]?.msgs[0]?.id;
  if (first) askHistory(key, first);
}

export function closeChat(peer: string): void {
  set((s) => ({ chats: s.chats.filter((c) => c.peer !== peer) }));
}

export function toggleChat(peer: string): void {
  set((s) => ({ chats: s.chats.map((c) => (c.peer === peer ? { ...c, min: !c.min } : c)) }));
}

/** «Όχι τώρα»: η ειδοποίηση φεύγει και ο φίλος το μαθαίνει (για πρόσκληση ομάδας, μόνο φεύγει). */
export function declineInvite(m: DmMsg, team?: string): void {
  const inv = parseInvite(m);
  dropInvites(m, team);
  if (inv && !team) socialSend({ t: 'reply', peer: m.from, mid: m.id, kind: inv.kind, ok: false });
}

// ---------------------------------------------------------------------------
// τι κάνει ο χρήστης (παρουσία) και προσκλήσεις

/** Τα στοιχεία που φεύγουν με την πρόσκληση (ρολόι και χρώμα του καλεσμένου, ή τίτλος της ανάλυσης). */
export type InviteInfo = Omit<Invite, 'kind' | 'room'>;
type LocalActivity = Activity & { server: string; info?: InviteInfo; /** η καρτέλα της παρτίδας που μοιράζεται */ tab?: string };
const sources = new Map<string, LocalActivity>();
let idle = false;
let sentActivity = '';
const sameServer = (server: string) => Boolean(acc) && server.replace(/\/+$/, '') === acc?.server.replace(/\/+$/, '');

function currentActivity(): Activity | null {
  const all = [...sources.values()];
  const pick = all.find((a) => a.s === 'game') ?? all.find((a) => a.s === 'analysis');
  if (pick) return { s: pick.s, ...(pick.room && sameServer(pick.server) ? { room: pick.room } : {}), ...(pick.open ? { open: true } : {}) };
  return idle ? { s: 'away' } : null;
}

function pushActivity(): void {
  const a = currentActivity();
  const k = JSON.stringify(a);
  if (k !== sentActivity && socialSend({ t: 'activity', a })) sentActivity = k;
  checkPending();
}

function applyActivity(source: string, a: LocalActivity | null): void {
  if (a) sources.set(source, a);
  else sources.delete(source);
  pushActivity();
}

const chan = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('knightbase-social') : null;
/** οι πηγές αυτού του (ξεχωριστού) παραθύρου */
const mine = new Map<string, LocalActivity>();

/**
 * Η καρτέλα «Παίξε με φίλο» ή μια κοινή ανάλυση λέει τι κάνει (null όταν τελειώσει). `server`: ο server του
 * δωματίου (το δωμάτιο φαίνεται στους φίλους μόνο αν είναι ο ίδιος με των Φίλων).
 */
export function setActivity(source: string, a: LocalActivity | null): void {
  if (OPEN_KEY) {
    if (a) mine.set(source, a);
    else mine.delete(source);
    chan?.postMessage({ t: 'act', source, a });
    return;
  }
  applyActivity(source, a);
}

export function activityOf(source: string): LocalActivity | undefined {
  return sources.get(source);
}

// «λείπει»: 10 λεπτά χωρίς ποντίκι ή πληκτρολόγιο σε κανένα παράθυρο του Ruru
let lastInput = Date.now();
let lastAlive = 0;
const onInput = () => {
  lastInput = Date.now();
  if (OPEN_KEY && lastInput - lastAlive > 60_000) {
    lastAlive = lastInput;
    chan?.postMessage({ t: 'alive' });
  }
};
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'mousemove', 'wheel']) window.addEventListener(ev, onInput, { passive: true });
  if (OPEN_KEY) {
    // οι παρτίδες αυτού του παραθύρου, για το «Κοινή ανάλυση με…» του κύριου παραθύρου
    const gamesHere = (): OpenGame[] => useApp.getState().tabs.flatMap((t) => (t.kind === 'game' ? [{ id: t.id, title: t.title }] : []));
    let sentGames = '';
    const postGames = (force = false) => {
      const games = gamesHere();
      const k = JSON.stringify(games);
      if (!force && k === sentGames) return;
      sentGames = k;
      chan?.postMessage({ t: 'games', win: OPEN_KEY, games });
    };
    useApp.subscribe(() => postGames());
    window.addEventListener('pagehide', () => {
      for (const source of mine.keys()) chan?.postMessage({ t: 'act', source, a: null });
      chan?.postMessage({ t: 'games', win: OPEN_KEY, games: [] });
    });
    if (chan)
      chan.onmessage = (e: MessageEvent<{ t: string; friends?: Friend[]; teams?: TeamRow[]; status?: SocialState['status']; tab?: string }>) => {
        const d = e.data;
        if (d?.t === 'ask') {
          for (const [source, a] of mine) chan.postMessage({ t: 'act', source, a });
          postGames(true);
        }
        // οι φίλοι και οι ομάδες από το κύριο παράθυρο (για την «Αποστολή» από το παράθυρο μιας βάσης)
        else if (d?.t === 'lists') set({ friends: d.friends ?? [], teams: d.teams ?? [], status: d.status ?? 'off' });
        // «Κοινή ανάλυση με…» σε παρτίδα αυτού του παραθύρου
        else if (d?.t === 'share' && d.tab && gamesHere().some((g) => g.id === d.tab)) {
          set({ shareTab: d.tab });
          useApp.getState().activate(d.tab);
          window.focus();
        }
      };
  } else {
    if (chan) {
      chan.onmessage = (e: MessageEvent<{ t: string; source?: string; a?: LocalActivity | null; win?: string; games?: OpenGame[] }>) => {
        const d = e.data;
        if (d?.t === 'act' && typeof d.source === 'string') applyActivity(d.source, d.a ?? null);
        else if (d?.t === 'games' && typeof d.win === 'string') {
          const win = d.win;
          set((s) => ({ openGames: [...s.openGames.filter((g) => g.win !== win), ...(d.games ?? []).map((g) => ({ id: g.id, title: g.title, win }))] }));
        }
        else if (d?.t === 'alive') onInput();
        else if (d?.t === 'lists?') {
          const s = get();
          chan.postMessage({ t: 'lists', friends: s.friends.filter((f) => f.state === 'friend'), teams: s.teams.filter((t) => t.state === 'member'), status: s.status });
        }
      };
      chan.postMessage({ t: 'ask' });
    }
    setInterval(() => {
      const now = Date.now() - lastInput > 10 * 60_000;
      if (now !== idle) {
        idle = now;
        pushActivity();
      }
    }, 30_000);
  }
}

/** Η κοινή ανάλυση που τρέχει (η πιο πρόσφατη), στον ίδιο server με τους Φίλους. */
function runningAnalysis(skip: string[] = []): LocalActivity | undefined {
  return [...sources.values()].reverse().find((x) => x.s === 'analysis' && x.room && sameServer(x.server) && !skip.includes(x.room));
}

/** Μόλις ξεκινήσει μια νέα κοινή ανάλυση: η πρόσκληση φεύγει σε όλους όσοι περιμένουν. */
function checkPending(): void {
  const p = get().pending;
  if (!p) return;
  const a = runningAnalysis(p.skip);
  if (!a?.room) return;
  set({ pending: null });
  let sent = 0;
  for (const team of p.teams) if (socialSend({ t: 'team_analysis', team, room: a.room, ...(a.info?.title ? { title: a.info.title } : {}) })) sent++;
  for (const peer of p.peers) if (socialSend({ t: 'invite', peer, kind: 'analysis', room: a.room, ...a.info })) sent++;
  if (sent) sentToast(p);
}

/**
 * Φίλος ή ομάδα μέσα / έξω από την πρόσκληση της «Κοινής ανάλυσης» (τα κουτάκια της καρτέλας). Φεύγει
 * μόλις ξεκινήσει μια νέα ανάλυση (όχι σε όσες έτρεχαν ήδη όταν ξεκίνησε η επιλογή).
 */
export function togglePending(t: { peer?: string; team?: string }, on: boolean): void {
  const p = get().pending ?? { peers: [], teams: [], skip: [...sources.values()].flatMap((x) => (x.s === 'analysis' && x.room ? [x.room] : [])) };
  const next = {
    ...p,
    peers: on ? (t.peer && !p.peers.includes(t.peer) ? [...p.peers, t.peer] : p.peers) : p.peers.filter((x) => x !== t.peer),
    teams: on ? (t.team && !p.teams.includes(t.team) ? [...p.teams, t.team] : p.teams) : p.teams.filter((x) => x !== t.team),
  };
  set({ pending: next.peers.length || next.teams.length ? next : null });
}

/** Πρόσκληση σε ένα δωμάτιο που τρέχει ήδη (π.χ. «Κάλεσε φίλους» μέσα στην κοινή ανάλυση). */
export function inviteToRoom(t: { peer?: string; team?: string }, kind: Invite['kind'], room: string, info?: InviteInfo): boolean {
  const ok = t.team
    ? socialSend({ t: 'team_analysis', team: t.team, room, ...(info?.title ? { title: info.title } : {}) })
    : Boolean(t.peer) && socialSend({ t: 'invite', peer: t.peer ?? '', kind, room, ...info });
  if (ok) sentToast({ peers: t.peer ? [t.peer] : [], teams: t.team ? [t.team] : [] });
  return ok;
}

/** Οι Φίλοι δουλεύουν μόνο στο κύριο παράθυρο (εκεί είναι η σύνδεση)· όχι στα ξεχωριστά παράθυρα. */
export const SOCIAL_HERE = SOCIAL && !OPEN_KEY;

/** Κοινή ανάλυση για όλη την ομάδα: το παράθυρο «Κοινή ανάλυση με…» (τι θα αναλύσετε). */
export function inviteTeamAnalysis(team: string): void {
  set({ teamView: null, analysisDialog: { team } });
}

/** Οι κοινές αναλύσεις που τρέχουν τώρα (στον server των Φίλων), η πιο πρόσφατη πρώτη. */
export function runningAnalyses(): Array<{ room: string; title?: string; tab?: string }> {
  const out: Array<{ room: string; title?: string; tab?: string }> = [];
  for (const a of [...sources.values()].reverse())
    if (a.s === 'analysis' && a.room && sameServer(a.server) && !out.some((x) => x.room === a.room)) out.push({ room: a.room, title: a.info?.title, tab: a.tab });
  return out;
}

/** Κοινή ανάλυση στην παρτίδα μιας ανοιχτής καρτέλας· η πρόσκληση φεύγει μόλις ξεκινήσει. */
export function shareOpenGame(tabId: string, t: { peer?: string; team?: string }): void {
  togglePending(t, true);
  set({ analysisDialog: null });
  if (useApp.getState().tabs.some((x) => x.id === tabId)) {
    set({ shareTab: tabId });
    useApp.getState().activate(tabId);
    return;
  }
  // σε ξεχωριστό παράθυρο: εκείνο ξεκινά την ανάλυση, και η πρόσκληση φεύγει από εδώ μόλις ξεκινήσει
  chan?.postMessage({ t: 'share', tab: tabId });
  toast(L('Η κοινή ανάλυση ξεκινά στο παράθυρο της παρτίδας.', 'The shared analysis starts in the game’s window.'), 'info');
}

/** Οι ανοιχτές παρτίδες: στις καρτέλες του κύριου παραθύρου και στα ξεχωριστά παράθυρα. */
export function openGames(tabs: Array<{ id: string; kind: string; title: string }>, remote: OpenGame[]): OpenGame[] {
  return [...tabs.flatMap((t) => (t.kind === 'game' ? [{ id: t.id, title: t.title }] : [])), ...remote];
}

/**
 * Κοινή ανάλυση από την καρτέλα «Κοινή ανάλυση»: `how` = ξεκίνα αμέσως (άδεια σκακιέρα / η τελευταία ανάλυση)
 * ή null = διάλεξε εκεί παρτίδα. Ο φίλος (ή η ομάδα) είναι ήδη επιλεγμένος.
 */
export function startShareFrom(t: { peer?: string; team?: string }, how: 'empty' | 'resume' | null): void {
  togglePending(t, true);
  set({ shareStart: how, analysisDialog: null });
  useApp.getState().activate('share');
}

function sentToast(p: { peers: string[]; teams: string[] }): void {
  const names = [...p.peers.map((id) => friendOf(id)?.name), ...p.teams.map((id) => teamOf(id)?.name)].filter(Boolean) as string[];
  const list = names.join(', ');
  const el = !names.length ? '' : names.length === 1 && !p.teams.length ? ` στον/στην ${list}` : ` σε: ${list}`;
  toast(L(`Η πρόσκληση στάλθηκε${el}.`, `Invitation sent${list ? ` to ${list}` : ''}.`), 'ok');
}

export function cancelPending(): void {
  set({ pending: null });
}

/** Παρτίδα σε εξέλιξη (με αντίπαλο) στην «Παίξε με φίλο». */
export function gameInProgress(): boolean {
  const a = sources.get('friend');
  return Boolean(a && a.s === 'game' && !a.open);
}

/**
 * Πρόσκληση σε παρτίδα ή κοινή ανάλυση.
 *  - παρτίδα: αν περιμένει ήδη μια παρτίδα αντίπαλο, η πρόσκληση φεύγει αμέσως· αλλιώς το μικρό παράθυρο
 *    «Παρτίδα με…» (χρώμα, ρολόι, «Στείλε πρόσκληση»).
 *  - ανάλυση: το παράθυρο «Κοινή ανάλυση με…»: η ανάλυση που τρέχει, μια ανοιχτή παρτίδα, άδεια σκακιέρα,
 *    η τελευταία ανάλυση ή «διάλεξε παρτίδα» (καρτέλα «Κοινή ανάλυση» με τον φίλο επιλεγμένο).
 */
export function inviteFriend(peer: string, kind: Invite['kind']): void {
  if (kind === 'game') {
    const waiting = [...sources.values()].find((x) => x.s === 'game' && x.open && x.room && sameServer(x.server));
    if (waiting?.room && socialSend({ t: 'invite', peer, kind: 'game', room: waiting.room, ...waiting.info })) {
      sentToast({ peers: [peer], teams: [] });
      useApp.getState().activate('friend');
      return;
    }
    set({ gameDialog: peer });
    return;
  }
  set({ analysisDialog: { peer } });
}

/** Νέα παρτίδα (χρώμα, ρολόι) και αμέσως η πρόσκληση στον φίλο. Επιστρέφει μήνυμα λάθους ή null. */
export async function inviteToGame(peer: string, opts: { color: 'white' | 'black' | 'random'; tc: string }): Promise<string | null> {
  const a = acc;
  const f = friendOf(peer);
  if (!a || !f || get().status !== 'open') return L('Δεν υπάρχει σύνδεση με τους Φίλους· δοκίμασε σε λίγο.', 'Not connected to Friends; try again shortly.');
  let room: { id: string; token: string };
  try {
    const res = await fetch(`${a.server}/api/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: get().me?.name ?? a.name,
        color: opts.color,
        tc: opts.tc ? { base: Number(opts.tc.split('+')[0]) * 60, inc: Number(opts.tc.split('+')[1]) } : null,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    room = (await res.json()) as { id: string; token: string };
  } catch {
    return serverDown(a.server);
  }
  const color = opts.color === 'white' ? 'black' : opts.color === 'black' ? 'white' : 'random';
  if (!socialSend({ t: 'invite', peer, kind: 'game', room: room.id, tc: opts.tc, color })) return L('Χάθηκε η σύνδεση με τους Φίλους· δοκίμασε ξανά.', 'The connection to Friends was lost; try again.');
  set({ hostGame: { server: a.server, id: room.id, token: room.token, invited: f.name }, gameDialog: null });
  useApp.getState().activate('friend');
  return null;
}

/** Συμμετοχή ως καλεσμένος (πρόσκληση ή «Μπες» / «Παρακολούθηση» από την παρουσία ενός φίλου). */
export function joinRoom(kind: Invite['kind'], room: string, watch = false): void {
  if (!acc) return;
  const name = get().me?.name ?? acc.name;
  const j: RoomJoin = { server: acc.server, id: room, name, ...(watch ? { watch } : {}) };
  if (kind === 'game') set({ joinGame: j });
  else set({ joinAnalysis: j });
  useApp.getState().activate(kind === 'game' ? 'friend' : 'share');
}

/** ✓ σε πρόσκληση: μπαίνουμε, και ο φίλος το μαθαίνει (στην ομάδα το «μπήκε» το βλέπουν όλοι στην ανάλυση). */
export function acceptInvite(m: DmMsg, team?: string): void {
  const inv = parseInvite(m);
  dropInvites(m, team);
  if (!inv) return;
  if (!team) socialSend({ t: 'reply', peer: m.from, mid: m.id, kind: inv.kind, ok: true });
  joinRoom(inv.kind, inv.room);
}

// ---------------------------------------------------------------------------
// αποστολή παρτίδων (φάση 3): μόνο PGN σε απλό κείμενο → έλεγχος → server (έως 1 MB, 7 μέρες) → μήνυμα-αρχείο στο chat

/** Ο λογαριασμός: στο κύριο παράθυρο από τη σύνδεση, στα ξεχωριστά από τις ρυθμίσεις. */
const account = (): SocialAccount | null => acc ?? accountOf(useApp.getState().settings?.ui as Record<string, unknown> | undefined);

/** Το παράθυρο «Αποστολή σε φίλο ή ομάδα» (χρειάζεται λογαριασμό στους Φίλους). */
export function openSend(req: SendRequest): void {
  if (!account()) {
    toast(L('Φτιάξε πρώτα το όνομά σου στη στήλη «Φίλοι» (Βάσεις, δεξιά).', 'First choose your name in the “Friends” column (Databases, right).'), 'info');
    return;
  }
  // ξεχωριστό παράθυρο (π.χ. μιας βάσης): οι φίλοι και οι ομάδες από το κύριο, η αποστολή από εδώ
  if (OPEN_KEY) chan?.postMessage({ t: 'lists?' });
  set({ sendDialog: req });
}

const SEND_ERR: Record<string, () => string> = {
  rate: () => L('Έως 10 αποστολές τη μέρα· δοκίμασε αύριο.', 'Up to 10 sends a day; try again tomorrow.'),
  large: () => L('Το αρχείο ξεπερνά το 1 MB.', 'The file is over 1 MB.'),
  notpgn: () => L('Δεν στάλθηκε: επιτρέπεται μόνο PGN σε απλό κείμενο, χωρίς εικόνες ή άλλα αρχεία μέσα του.', 'Not sent: only plain-text PGN is allowed, with no images or other files inside it.'),
  notfriend: () => ERR.notfriend(),
  notmember: () => ERR.notmember(),
  auth: () => L('Ο server δεν δέχτηκε το κλειδί αυτού του υπολογιστή.', 'The server rejected this computer’s key.'),
};

/**
 * Στέλνει τη βάση (ή τις παρτίδες `ids`) σε φίλο ή ομάδα. Το PGN το δίνει το Ruru, η σελίδα το ελέγχει
 * (pgnFile.ts) και το ανεβάζει ασυμπίεστο. Επιστρέφει μήνυμα λάθους ή null.
 */
export async function sendDatabase(
  to: { peer?: string; team?: string },
  src: { dbId: string; ids?: number[]; name: string; games: number; stripClocks?: boolean },
  stage: (s: 'pack' | 'upload') => void,
): Promise<string | null> {
  const a = account();
  if (!a || get().status !== 'open') return L('Δεν υπάρχει σύνδεση με τους Φίλους· δοκίμασε σε λίγο.', 'Not connected to Friends; try again shortly.');
  const tooBig = src.stripClocks
    ? L(
        'Σε PGN ξεπερνά το 1 MB (ακόμη και χωρίς ρολόγια). Στείλε λιγότερες παρτίδες (διάλεξέ τες στη λίστα της βάσης → δεξί κλικ → «Αποστολή επιλεγμένων»).',
        'As PGN it is over 1 MB (even without clocks). Send fewer games (select them in the database list → right-click → “Send selected”).',
      )
    : L(
        'Σε PGN ξεπερνά το 1 MB. Δοκίμασε «Χωρίς ρολόγια κινήσεων» παραπάνω ή στείλε λιγότερες παρτίδες (δεξί κλικ στη λίστα → «Αποστολή επιλεγμένων»).',
        'As PGN it is over 1 MB. Try “Without move clocks” above, or send fewer games (right-click in the list → “Send selected”).',
      );
  if (src.games > FILE_MAX_GAMES) return tooBig;
  stage('pack');
  let blob: Blob;
  try {
    const res = await fetch(`/api/db/${encodeURIComponent(src.dbId)}/pgn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(src.ids ? { ids: src.ids } : {}), ...(src.stripClocks ? { stripClocks: true } : {}) }),
    });
    if (res.status === 413) return tooBig;
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    // μόλις περάσει το 1 MB σταματά (και το Ruru σταματά να γράφει)
    const data = await readCapped(res.body, FILE_MAX);
    if (!data) return tooBig;
    const checked = checkPgnFile(data);
    if ('error' in checked) return SEND_ERR[checked.error]();
    blob = new Blob([data as BlobPart], { type: PGN_MIME });
  } catch {
    return L('Δεν έγινε η εξαγωγή της βάσης σε PGN.', 'Could not export the database to PGN.');
  }
  stage('upload');
  const q = new URLSearchParams({ u: a.userId, name: src.name, ...(to.team ? { team: to.team } : { to: to.peer ?? '' }) });
  try {
    const r = await fetch(`${a.server}/api/social/file?${q}`, { method: 'POST', headers: { Authorization: `Bearer ${a.key}`, 'Content-Type': PGN_MIME }, body: blob });
    if (r.ok) return null;
    const e = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? '';
    return SEND_ERR[e]?.() ?? L(`Δεν έγινε η αποστολή (HTTP ${r.status}).`, `The file could not be sent (HTTP ${r.status}).`);
  } catch {
    return serverDown(a.server);
  }
}

export function dismissFile(m: DmMsg, team?: string): void {
  set((s) => ({ files: s.files.filter((i) => !sameInvite(i, m, team)) }));
}

/** «Εισαγωγή»: κατέβασμα, έλεγχος ότι είναι PGN, νέα βάση στο Ruru (ανοίγει μόλις τελειώσει η εισαγωγή). */
export async function importShared(m: DmMsg, team?: string): Promise<void> {
  const f = parseFile(m);
  const a = account();
  dismissFile(m, team);
  if (!f || !a) return;
  if (Date.now() > f.exp) return toast(L('Το αρχείο έληξε (μένει 7 μέρες στον server).', 'The file has expired (it stays 7 days on the server).'), 'error');
  toast(L(`Λήψη «${f.name}»…`, `Downloading “${f.name}”…`), 'info');
  try {
    const r = await fetch(`${a.server}/api/social/file/${f.id}?u=${encodeURIComponent(a.userId)}`, { headers: { Authorization: `Bearer ${a.key}` } });
    if (r.status === 404) return toast(L('Το αρχείο δεν υπάρχει πια (έληξε).', 'The file no longer exists (expired).'), 'error');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // και στον παραλήπτη: ο server μπορεί να είναι άλλος από τον δικό μας
    const data = await readCapped(r.body, FILE_MAX);
    if (!data) return toast(L('Το αρχείο ξεπερνά το 1 MB· δεν εισάγεται.', 'The file is over 1 MB; it is not imported.'), 'error');
    const checked = checkPgnFile(data);
    if ('error' in checked) return toast(L('Το αρχείο δεν είναι καθαρό PGN· δεν εισάγεται.', 'The file is not plain PGN; it is not imported.'), 'error');
    const res = await api.post<{ entry: DbInfo; job: JobInfo | null }>('/api/library/receive', { name: f.name, pgn: checked.text });
    await useApp.getState().refreshLibrary();
    if (res.job) {
      // η Βιβλιοθήκη ανοίγει τη βάση μόλις τελειώσει η εισαγωγή (όπως με το «Άνοιγμα αρχείου»)
      sessionStorage.setItem(`open-${res.job.id}`, '1');
      toast(L(`Εισαγωγή «${res.entry.name}»… θα ανοίξει όταν τελειώσει.`, `Importing “${res.entry.name}”… it will open when done.`), 'info');
    } else useApp.getState().openTab({ id: `db-${res.entry.id}`, kind: 'db', dbId: res.entry.id, title: res.entry.name });
  } catch {
    toast(L('Δεν έγινε η λήψη του αρχείου.', 'The file could not be downloaded.'), 'error');
  }
}
