/**
 * Κοινή ανάλυση live: τα μηνύματα ανάμεσα στους συμμετέχοντες και τον server (relay/, AnalysisRoom) και η
 * διεύθυνση ενός κόμβου του δέντρου ως σειρά κινήσεων UCI από την αρχή (ίδια σε όλους τους browsers).
 * Ο server κρατά το τελευταίο PGN (με βαριάντες, σχόλια, σύμβολα, βέλη) και το chat· όποιος αλλάζει κάτι
 * στέλνει το νέο PGN και το παίρνουν όλοι οι άλλοι.
 */
import { Position } from './chess.ts';
import type { Game, GameNode } from './game.ts';

/** Ταυτότητα συμμετέχοντα μέσα στο δωμάτιο: «h» ο οικοδεσπότης, «g1», «g2»… οι καλεσμένοι. */
export type Pid = string;

export interface ChatMsg {
  by: Pid;
  name: string;
  text: string;
  at: number;
}

/** Οι καλύτερες γραμμές της μηχανής του οικοδεσπότη για μία θέση. */
export interface EngineInfo {
  fen: string;
  depth: number;
  lines: Array<{ cp: number | null; mate: number | null; san: string[] }>;
}

/** Κατάσταση ζωντανής παρτίδας (Watch Live) που μοιράζεται ο οικοδεσπότης με το δωμάτιο. */
export interface ShareLiveInfo {
  status: 'connecting' | 'live' | 'ended' | 'error';
  w: number | null;
  b: number | null;
  turn: 'w' | 'b';
  at: number;
  plies: number;
}

export interface Presence {
  online: Pid[];
  names: Record<Pid, string>;
}

/**
 * Τι επιτρέπει ο οικοδεσπότης (δωμάτια από KnightBase ≥ 2.4.0· στα παλιά δεν υπάρχει και αλλάζουν όλοι):
 * ποιοι καλεσμένοι αλλάζουν την ανάλυση και ποιων το μικρόφωνο έκλεισε για όλους.
 */
export interface ShareRules {
  editors: Pid[];
  silenced: Pid[];
  /** ποιοι καλεσμένοι ανοίγουν κάμερα (λείπει σε δωμάτια από πριν από την κάμερα) */
  cams?: Pid[];
  /** κλειδωμένο: δεν μπαίνει νέος καλεσμένος. Κλειδώνει μόνο του σε αποβολή, αλλιώς ο αποβλημένος ξαναμπαίνει με το link */
  locked?: boolean;
}

/**
 * Κάποιος μέσα στη φωνή: `sid` αλλάζει σε κάθε νέα είσοδο (π.χ. ανανέωση σελίδας), ώστε να ξαναστηθεί η σύνδεση.
 * `cam`: η κάμερά του είναι ανοιχτή· `watch`: ποιου την κάμερα βλέπει (του στέλνει βίντεο μόνο εκείνος).
 */
export interface VoiceState {
  sid: string;
  mic: boolean;
  deaf: boolean;
  cam?: boolean;
  watch?: Pid;
}

/** Σήμα WebRTC από άτομο σε άτομο (το relay απλώς το προωθεί). `gen`: αύξων αριθμός προσπάθειας (αποφυγή σύγκρουσης ICE σε retry). */
export type RtcSignal =
  | { sid: string; gen?: number; sdp: { type: 'offer' | 'answer'; sdp: string } }
  | { sid: string; gen?: number; ice: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } };

export type ShareClientMsg =
  | { t: 'pgn'; pgn: string }
  | { t: 'cursor'; path: string[] }
  | { t: 'chat'; text: string }
  | { t: 'engine'; info: EngineInfo | null }
  | { t: 'live'; info: ShareLiveInfo | null }
  | { t: 'video'; id: string | null }
  | { t: 'name'; name: string }
  | { t: 'voice'; state: VoiceState | null }
  | { t: 'rtc'; to: Pid; data: RtcSignal }
  | { t: 'perm'; pid: Pid | '*'; edit: boolean }
  | { t: 'silence'; pid: Pid; on: boolean }
  /** ο οικοδεσπότης δίνει ή παίρνει την άδεια για κάμερα */
  | { t: 'cam'; pid: Pid; on: boolean }
  | { t: 'kick'; pid: Pid }
  | { t: 'lock'; on: boolean }
  | { t: 'ping' };

export type ShareServerMsg =
  /** `v` 2: το relay ξέρει φωνή, δικαιώματα και αποβολή· 3: και κάμερα */
  | { t: 'welcome'; pid: Pid; role: 'host' | 'guest'; token?: string; v?: number }
  | { t: 'init'; pgn: string; seq: number; chat: ChatMsg[]; presence: Presence; cursors: Record<Pid, string[]>; engine: EngineInfo | null; live?: ShareLiveInfo | null; video?: string | null; rules?: ShareRules; voice?: Record<Pid, VoiceState> }
  | { t: 'pgn'; pgn: string; seq: number; by: Pid }
  | { t: 'cursor'; by: Pid; path: string[] }
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'presence'; presence: Presence }
  | { t: 'engine'; info: EngineInfo | null }
  | { t: 'live'; info: ShareLiveInfo | null }
  | { t: 'video'; id: string | null }
  | { t: 'rules'; rules: ShareRules }
  | { t: 'voice'; by: Pid; state: VoiceState | null }
  | { t: 'rtc'; by: Pid; data: RtcSignal }
  | { t: 'pong' };

/** Ο κωδικός κλεισίματος του WebSocket όταν ο οικοδεσπότης βγάζει κάποιον. */
export const SHARE_KICKED = 4403;
/** …και όταν νέος καλεσμένος βρίσκει το δωμάτιο κλειδωμένο. */
export const SHARE_LOCKED = 4423;
/** Φωνή: ο καθένας στέλνει σε όλους, άρα ως 8 άτομα μαζί. */
export const VOICE_MAX = 8;
export const RTC_MAX = 32_000;

/** Αλλάζει την ανάλυση; Ο οικοδεσπότης πάντα· χωρίς κανόνες (παλιό δωμάτιο) όλοι. */
export const canEdit = (rules: ShareRules | null | undefined, pid: Pid | null | undefined): boolean => !rules || pid === 'h' || (!!pid && rules.editors.includes(pid));

/** Ανοίγει κάμερα; Ο οικοδεσπότης πάντα, οι καλεσμένοι με την άδειά του· χωρίς κανόνες (παλιό δωμάτιο) όλοι. */
export const canCam = (rules: ShareRules | null | undefined, pid: Pid | null | undefined): boolean => !rules || pid === 'h' || (!!pid && !!rules.cams?.includes(pid));

/** Μια ενέργεια του οικοδεσπότη πάνω στους κανόνες (`guests`: όσοι είναι τώρα μέσα, για το «όλοι»). */
export function applyRule(
  rules: ShareRules,
  m: { t: 'perm'; pid: Pid | '*'; edit: boolean } | { t: 'silence'; pid: Pid; on: boolean } | { t: 'cam'; pid: Pid; on: boolean } | { t: 'kick'; pid: Pid } | { t: 'lock'; on: boolean },
  guests: readonly Pid[],
): ShareRules {
  const set = (list: Pid[], pids: readonly Pid[], on: boolean) => (on ? [...new Set([...list, ...pids])] : list.filter((p) => !pids.includes(p)));
  if (m.t === 'lock') return { ...rules, locked: m.on };
  if (m.t === 'perm') return { ...rules, editors: set(rules.editors, m.pid === '*' ? guests : [m.pid], m.edit) };
  if (m.t === 'silence') return { ...rules, silenced: set(rules.silenced, [m.pid], m.on) };
  if (m.t === 'cam') return { ...rules, cams: set(rules.cams ?? [], [m.pid], m.on) };
  return { editors: set(rules.editors, [m.pid], false), silenced: set(rules.silenced, [m.pid], false), cams: set(rules.cams ?? [], [m.pid], false), locked: true };
}

const SID_RE = /^[a-z0-9]{6,24}$/;
const PID_RE = /^(?:h|g\d{1,6})$/;
/** Καθαρή κατάσταση φωνής από το δίκτυο (ή null). */
export function cleanVoice(v: unknown): VoiceState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.sid !== 'string' || !SID_RE.test(o.sid)) return null;
  return { sid: o.sid, mic: o.mic === true, deaf: o.deaf === true, cam: o.cam === true, ...(typeof o.watch === 'string' && PID_RE.test(o.watch) ? { watch: o.watch } : {}) };
}

const LIVE_STATUS = new Set(['connecting', 'live', 'ended', 'error']);
/** Καθαρή κατάσταση Watch Live από το δίκτυο (ή null). */
export function cleanLive(v: unknown): ShareLiveInfo | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.status !== 'string' || !LIVE_STATUS.has(o.status)) return null;
  const ms = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(x, 86_400_000) : null);
  return {
    status: o.status as ShareLiveInfo['status'],
    w: ms(o.w),
    b: ms(o.b),
    turn: o.turn === 'b' ? 'b' : 'w',
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now(),
    plies: typeof o.plies === 'number' && Number.isFinite(o.plies) && o.plies >= 0 ? Math.floor(o.plies) : 0,
  };
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const TW_CH_RE = /^[a-z0-9_]{2,32}$/i;
const TW_VOD_RE = /^\d{4,16}$/;
const KICK_CH_RE = /^[a-z0-9_-]{2,32}$/i;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be']);
const TW_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'player.twitch.tv']);
const KICK_HOSTS = new Set(['kick.com', 'www.kick.com', 'player.kick.com']);
const TW_RESERVED = new Set(['directory', 'downloads', 'jobs', 'p', 'settings', 'subscriptions', 'wallet', 'inventory', 'drops', 'search', 'videos', 'clip', 'moderator', 'u']);
const KICK_RESERVED = new Set(['categories', 'browse', 'following', 'search', 'about', 'terms', 'privacy', 'video', 'videos', 'transactions', 'dashboard']);

export interface VideoInfo {
  provider: 'youtube' | 'twitch' | 'kick';
  label: string;
  embedUrl: string;
  watchUrl: string;
}

/** Καθαρό αναγνωριστικό βίντεο από το δίκτυο (`yt:…`, `tw:…`, `twv:…`, `kick:…` ή παλιό 11-ψήφιο YouTube ID), ή null. */
export function cleanVideoId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (YT_ID_RE.test(v)) return `yt:${v}`;
  if (v.startsWith('yt:')) return YT_ID_RE.test(v.slice(3)) ? v : null;
  if (v.startsWith('tw:')) {
    const ch = v.slice(3).toLowerCase();
    return TW_CH_RE.test(ch) && !TW_RESERVED.has(ch) ? `tw:${ch}` : null;
  }
  if (v.startsWith('twv:')) return TW_VOD_RE.test(v.slice(4)) ? v : null;
  if (v.startsWith('kick:')) {
    const ch = v.slice(5).toLowerCase();
    return KICK_CH_RE.test(ch) && !KICK_RESERVED.has(ch) ? `kick:${ch}` : null;
  }
  return null;
}

/** Εξάγει το 11-ψήφιο YouTube ID από URL (watch, youtu.be, live, embed, shorts) ή null. */
export function parseYouTubeId(raw: string): string | null {
  const ref = parseVideoUrl(raw);
  return ref?.startsWith('yt:') ? ref.slice(3) : null;
}

/** Εξάγει καθαρό αναγνωριστικό βίντεο από σύνδεσμο YouTube, Twitch (κανάλι ή VOD) ή Kick. */
export function parseVideoUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  if (YT_HOSTS.has(host)) {
    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const id = parts[0] ?? '';
      return YT_ID_RE.test(id) ? `yt:${id}` : null;
    }
    const v = u.searchParams.get('v');
    if (v && YT_ID_RE.test(v)) return `yt:${v}`;
    if (parts.length >= 2 && (parts[0] === 'live' || parts[0] === 'embed' || parts[0] === 'shorts') && YT_ID_RE.test(parts[1])) {
      return `yt:${parts[1]}`;
    }
    return null;
  }

  if (TW_HOSTS.has(host)) {
    if (host === 'player.twitch.tv') {
      const ch = (u.searchParams.get('channel') ?? '').toLowerCase();
      if (TW_CH_RE.test(ch) && !TW_RESERVED.has(ch)) return `tw:${ch}`;
      const vid = u.searchParams.get('video') ?? '';
      if (TW_VOD_RE.test(vid)) return `twv:${vid}`;
      return null;
    }
    if (parts[0]?.toLowerCase() === 'videos' && parts[1] && TW_VOD_RE.test(parts[1])) return `twv:${parts[1]}`;
    const ch = (parts[0] ?? '').toLowerCase();
    if (TW_CH_RE.test(ch) && !TW_RESERVED.has(ch)) return `tw:${ch}`;
    return null;
  }

  if (KICK_HOSTS.has(host)) {
    const ch = (parts[0] ?? '').toLowerCase();
    if (KICK_CH_RE.test(ch) && !KICK_RESERVED.has(ch)) return `kick:${ch}`;
    return null;
  }

  return null;
}

/** URLs ενσωμάτωσης και εξωτερικού ανοίγματος για ένα έγκυρο αναγνωριστικό βίντεο. */
export function videoInfo(raw: string | null | undefined, parentHost = '127.0.0.1'): VideoInfo | null {
  const ref = cleanVideoId(raw);
  if (!ref) return null;
  if (ref.startsWith('yt:')) {
    const id = ref.slice(3);
    return { provider: 'youtube', label: 'YouTube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0`, watchUrl: `https://www.youtube.com/watch?v=${id}` };
  }
  const host = /^[a-z0-9.-]+$/i.test(parentHost) ? parentHost : '127.0.0.1';
  if (ref.startsWith('tw:')) {
    const ch = ref.slice(3);
    return { provider: 'twitch', label: 'Twitch', embedUrl: `https://player.twitch.tv/?channel=${ch}&parent=${host}`, watchUrl: `https://www.twitch.tv/${ch}` };
  }
  if (ref.startsWith('twv:')) {
    const id = ref.slice(4);
    return { provider: 'twitch', label: 'Twitch', embedUrl: `https://player.twitch.tv/?video=${id}&parent=${host}`, watchUrl: `https://www.twitch.tv/videos/${id}` };
  }
  const ch = ref.slice(5);
  return { provider: 'kick', label: 'Kick', embedUrl: `https://player.kick.com/${ch}`, watchUrl: `https://kick.com/${ch}` };
}

/**
 * Ποια κάμερα φαίνεται στο ένα παράθυρο: όποιον καρφίτσωσες, αλλιώς ο οικοδεσπότης, αλλιώς ο πρώτος άλλος με
 * ανοιχτή κάμερα, και τελευταία η δική σου. Μετρούν μόνο όσοι έχουν κάμερα ανοιχτή και άδεια· null: καμία.
 */
export function pickCamera(o: { me: Pid | null; pinned: Pid | null; voices: Record<Pid, VoiceState>; rules: ShareRules | null; order: readonly Pid[] }): Pid | null {
  const on = (p: Pid | null): p is Pid => !!p && !!o.voices[p]?.cam && canCam(o.rules, p);
  if (on(o.pinned)) return o.pinned;
  if (o.me !== 'h' && on('h')) return 'h';
  const other = o.order.find((p) => p !== o.me && on(p));
  if (other) return other;
  return on(o.me) ? o.me : null;
}

/** Όρια: PGN (μεγάλες σχολιασμένες παρτίδες χωράνε άνετα), μήνυμα chat, ιστορικό chat, καλεσμένοι. */
export const SHARE_MAX_PGN = 400_000;
export const SHARE_MAX_CHAT = 500;
export const SHARE_CHAT_KEEP = 200;
export const SHARE_MAX_GUESTS = 30;

/** Ο κόμβος ως σειρά κινήσεων UCI από την αρχή. */
export function pathOf(node: GameNode): string[] {
  const out: string[] = [];
  for (let n: GameNode | null = node; n && n.parent; n = n.parent) out.push(Position.fromFen(n.parent.fen).moveToUci(n.move));
  return out.reverse();
}

/** Ο κόμβος στη διεύθυνση `path` (ή ο βαθύτερος που υπάρχει στη διαδρομή). */
export function nodeAt(game: Game, path: readonly string[]): GameNode {
  let n = game.root;
  for (const uci of path) {
    const p = Position.fromFen(n.fen);
    const m = p.parseUci(uci);
    const c = m ? n.children.find((x) => x.move === m) : undefined;
    if (!c) break;
    n = c;
  }
  return n;
}

export const samePath = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
