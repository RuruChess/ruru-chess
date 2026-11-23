/**
 * «Προετοιμασία για αντίπαλο»: κοινά κομμάτια server και περιβάλλοντος (χωρίς εξαρτήσεις).
 * - ρυθμός (bullet / blitz / rapid / κλασικό / daily) και πηγή (Lichess / Chess.com / OTB) μιας παρτίδας
 * - ενιαίο όνομα του αντιπάλου στις παρτίδες (το username του Lichess / Chess.com γίνεται το όνομά του)
 * - δέντρο ρεπερτορίου: οι κινήσεις των παρτίδων του, με σκορ από τη δική του μεριά
 */

export const PREP_SPEEDS = ['bullet', 'blitz', 'rapid', 'classical', 'daily'] as const;
export type PrepSpeed = (typeof PREP_SPEEDS)[number];
export type PrepSource = 'lichess' | 'chesscom' | 'otb';

/** Τα όρια του Lichess: εκτιμώμενη διάρκεια = βάση + 40 × προσθήκη (δευτερόλεπτα). */
export function speedOfTimeControl(tc: string | undefined): PrepSpeed | null {
  const t = (tc ?? '').trim();
  if (!t || t === '?') return null;
  if (t === '-' || /^\d+\/\d+$/.test(t)) return 'daily';
  const m = /^(\d+)(?:\+(\d+))?/.exec(t.split(':')[0].replace(/^\d+\//, ''));
  if (!m) return null;
  const est = Number(m[1]) + 40 * Number(m[2] ?? 0);
  if (est < 180) return 'bullet';
  if (est < 480) return 'blitz';
  if (est < 1500) return 'rapid';
  return 'classical';
}

/** Ρυθμός παρτίδας: από το TimeControl, αλλιώς από το όνομα του τουρνουά (OTB: κλασικό, εκτός αν λέει rapid / blitz). */
export function prepSpeed(h: Record<string, string | undefined>): PrepSpeed {
  const byTc = speedOfTimeControl(h.TimeControl);
  if (byTc) return byTc;
  const ev = (h.Event ?? '').toLowerCase();
  if (/corr|daily|iccf/.test(ev)) return 'daily';
  if (/bullet/.test(ev)) return 'bullet';
  if (/blitz|armageddon/.test(ev)) return 'blitz';
  if (/rapid|active|quick/.test(ev)) return 'rapid';
  return 'classical';
}

/** Πηγή παρτίδας από το Site / Event. */
export function prepSource(h: Record<string, string | undefined>): PrepSource {
  const site = `${h.Site ?? ''} ${h.Link ?? ''}`.toLowerCase();
  if (site.includes('lichess.org')) return 'lichess';
  if (site.includes('chess.com') || /^live chess|^let's play/i.test(h.Event ?? '')) return 'chesscom';
  return 'otb';
}

/** Όνομα για ετικέτα PGN (χωρίς εισαγωγικά και \). */
export function cleanPlayerName(s: string): string {
  return s.replace(/["\\\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Ενιαίο όνομα: σε κάθε παρτίδα του PGN, το White / Black που είναι ο `user` (χωρίς διάκριση πεζών-κεφαλαίων) γίνεται
 * `name`. Ο λογαριασμός μένει στις ετικέτες WhiteAccount / BlackAccount, για να φαίνεται από πού ήρθε.
 */
export function renameInPgn(pgn: string, user: string, name: string): string {
  const u = user.toLowerCase();
  const clean = cleanPlayerName(name);
  if (!clean) return pgn;
  return pgn.replace(/^\[(White|Black) "([^"]*)"\][ \t]*$/gm, (line, side: string, value: string) =>
    value.toLowerCase() === u ? `[${side} "${clean}"]\n[${side}Account "${value}"]` : line,
  );
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ');
const words = (s: string) => fold(s).split(/[\s,.\-'’()]+/).filter(Boolean);

/**
 * Ταιριάζει το όνομα με την αναζήτηση όπως στη βάση: κάθε λέξη της αναζήτησης είναι αρχή μιας λέξης του ονόματος, με
 * οποιαδήποτε σειρά («Magnus Carlsen» = «Carlsen, Magnus», «Carlsen M»).
 */
export function nameMatches(query: string, name: string): boolean {
  const q = words(query);
  const n = words(name);
  return q.length > 0 && q.every((w) => n.some((x) => x.startsWith(w)));
}

/** Ίδιο όνομα (χωρίς τόνους, κεφαλαία και κενά). */
export function sameName(a: string | undefined, b: string): boolean {
  return Boolean(a) && words(a!).join(' ') === words(b).join(' ');
}

// ---------------------------------------------------------------------------
// δέντρο ρεπερτορίου

/** Κόμβος: η κίνηση (SAN), παρτίδες, νίκες / ισοπαλίες / ήττες του αντιπάλου, πιο πρόσφατη ημερομηνία (yyyymmdd). */
export interface PrepNode {
  m: string;
  n: number;
  w: number;
  d: number;
  l: number;
  last: number;
  c?: PrepNode[];
}

export const newRoot = (): PrepNode => ({ m: '', n: 0, w: 0, d: 0, l: 0, last: 0 });

/** Προσθέτει μια παρτίδα: `score` 1 / 0.5 / 0 από τη μεριά του αντιπάλου (null: χωρίς αποτέλεσμα). */
export function addLine(root: PrepNode, sans: string[], score: number | null, date: number): void {
  const bump = (x: PrepNode) => {
    x.n++;
    if (score === 1) x.w++;
    else if (score === 0.5) x.d++;
    else if (score === 0) x.l++;
    if (date > x.last) x.last = date;
  };
  bump(root);
  let node = root;
  for (const m of sans) {
    node.c ??= [];
    let next = node.c.find((x) => x.m === m);
    if (!next) {
      next = { m, n: 0, w: 0, d: 0, l: 0, last: 0 };
      node.c.push(next);
    }
    bump(next);
    node = next;
  }
}

/**
 * Κρατά το δέντρο μικρό για το περιβάλλον: ως `keepAll` ημικινήσεις όλα, πιο βαθιά μόνο όσα παίχτηκαν ≥ 2 φορές· ως
 * `maxChildren` συνέχειες ανά κόμβο, οι συχνότερες πρώτες.
 */
export function pruneTree(node: PrepNode, keepAll = 4, maxChildren = 12, depth = 0): PrepNode {
  if (!node.c) return node;
  node.c = node.c
    .filter((x) => depth < keepAll || x.n >= 2)
    .sort((a, b) => b.n - a.n || b.last - a.last)
    .slice(0, maxChildren);
  for (const x of node.c) pruneTree(x, keepAll, maxChildren, depth + 1);
  if (!node.c.length) delete node.c;
  return node;
}

/** Σκορ του αντιπάλου σε ποσοστό (null χωρίς αποτελέσματα). */
export function scorePct(x: Pick<PrepNode, 'w' | 'd' | 'l'>): number | null {
  const t = x.w + x.d + x.l;
  return t ? Math.round(((x.w + x.d / 2) / t) * 100) : null;
}

/** Γραμμή του δέντρου, για τις λίστες «Συχνότερες γραμμές» και «Αδύνατα σημεία». */
export interface PrepLine {
  sans: string[];
  node: PrepNode;
}

/**
 * Αδύνατα σημεία: θέσεις όπου ο αντίπαλος έχει παίξει ≥ `min` παρτίδες και σκοράρει ≤ `maxPct`%, οι χειρότερες πρώτες
 * (από τη βαθύτερη γραμμή που δεν είναι απλώς συνέχεια μιας ήδη χειρότερης).
 */
export function weakLines(root: PrepNode, min = 3, maxPct = 40, limit = 8): PrepLine[] {
  const out: PrepLine[] = [];
  const walk = (node: PrepNode, path: string[]) => {
    for (const x of node.c ?? []) {
      const p = [...path, x.m];
      const pct = scorePct(x);
      if (p.length >= 2 && x.n >= min && pct !== null && pct <= maxPct) out.push({ sans: p, node: x });
      walk(x, p);
    }
  };
  walk(root, []);
  const under = (a: PrepLine, b: PrepLine) => b.sans.length < a.sans.length && a.sans.slice(0, b.sans.length).join(' ') === b.sans.join(' ');
  // μια γραμμή που απλώς συνεχίζει μια άλλη με τις ίδιες παρτίδες δεν λέει κάτι νέο· και μια γραμμή με πιο
  // συγκεκριμένη συνέχεια εξίσου ή πιο αδύνατη από κάτω της δείχνεται με αυτή τη συνέχεια
  const kept = out.filter(
    (a) => !out.some((b) => b !== a && ((under(a, b) && b.node.n === a.node.n) || (under(b, a) && (scorePct(b.node) ?? 100) <= (scorePct(a.node) ?? 0)))),
  );
  return kept.sort((a, b) => (scorePct(a.node) ?? 0) - (scorePct(b.node) ?? 0) || b.node.n - a.node.n).slice(0, limit);
}

/** Η κύρια γραμμή: από κάθε κόμβο η συχνότερη συνέχεια, όσο έχει ≥ `min` παρτίδες. */
export function mainLine(root: PrepNode, min = 2, maxPlies = 12): string[] {
  const out: string[] = [];
  let node = root;
  while (node.c?.length && out.length < maxPlies) {
    const best = node.c[0];
    if (best.n < min) break;
    out.push(best.m);
    node = best;
  }
  return out;
}

/** Κείμενο γραμμής: «1.e4 c5 2.♘f3» από ημικινήσεις που ξεκινούν από την αρχική θέση. */
export function lineText(sans: string[], fig: (san: string) => string = (s) => s): string {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${fig(s)}` : fig(s))).join(' ');
}

// ---------------------------------------------------------------------------
// η προετοιμασία όπως τη μοιράζονται server και περιβάλλον

/** Οι ρυθμοί της φόρμας (το daily μένει για παλιές προετοιμασίες και την αναφορά). */
export const PREP_PICK_SPEEDS = ['classical', 'rapid', 'blitz', 'bullet'] as const satisfies readonly PrepSpeed[];
/** Οι τρεις πηγές, με τη σειρά των γραμμών της φόρμας. */
export const PREP_SOURCES = ['otb', 'lichess', 'chesscom'] as const satisfies readonly PrepSource[];
export type PrepColor = 'both' | 'white' | 'black';

/** Κοινά φίλτρα για όλες τις πηγές. */
export interface PrepOpts {
  speeds: PrepSpeed[];
  /** μόνο οι παρτίδες των τελευταίων μηνών (0: όλες) */
  months: number;
  /** «Μετά από…» YYYY-MM-DD, αντί για μήνες */
  after?: string;
  /** συνολικά, όχι ανά πηγή (0: όλες) */
  max: number;
  rated: boolean;
  color: PrepColor;
}

export const PREP_DEFAULTS: PrepOpts = { speeds: ['classical', 'rapid', 'blitz'], months: 0, max: 250, rated: true, color: 'both' };

export interface FidePlayer {
  id: number;
  name: string;
  federation: string;
  year?: number | null;
  title?: string | null;
  standard?: number;
  rapid?: number;
  blitz?: number;
}

/** Ο αντίπαλος στις τοπικές βάσεις: τα ονόματά του ξαναβρίσκονται σε κάθε εκτέλεση. */
export interface PrepOtb {
  name: string;
  fideId?: number;
  /** ονόματα που πρόσθεσε ο χρήστης από το «Ίσως και» */
  extra?: string[];
}

/** Πρόταση στο πεδίο FIDE / OTB. */
export interface OtbSuggestion {
  name: string;
  fideId?: number;
  /** όσες έχει η βάση με τις περισσότερες (το σύνολο βγαίνει μετά την επιλογή) */
  games: number;
  maxElo: number;
  first: number;
  last: number;
  /** μόνο όταν η αναζήτηση έγινε με FIDE ID */
  fide?: FidePlayer;
}

/** Ό,τι βρέθηκε στις βάσεις για τον παίκτη που διάλεξε ο χρήστης. */
export interface OtbMatch {
  fideId?: number;
  games: number;
  last: number;
  dbs: string[];
  names: string[];
  /** όμοια ονόματα που δεν μπήκαν μόνα τους */
  maybe: Array<{ name: string; games: number }>;
  /** συνονόματοι: περισσότερα FIDE ID στο ίδιο όνομα */
  namesakes: Array<{ id: number; games: number }>;
}

export interface PrepInfo {
  id: string;
  /** το όνομα του αντιπάλου, όπως γράφεται σε όλες τις παρτίδες της βάσης του */
  name: string;
  dbId: string;
  lichess?: string;
  chesscom?: string;
  otb?: PrepOtb;
  /** ο παίκτης στη FIDE (από το Lichess), με τα Elo της τελευταίας ενημέρωσης */
  fide?: FidePlayer;
  /** παλιές προετοιμασίες: οι βάσεις και τα ακριβή ονόματα που είχε διαλέξει ο χρήστης */
  locals?: Array<{ dbId: string; players: string[] }>;
  opts: PrepOpts;
  counts: { lichess: number; chesscom: number; local: number };
  at: number;
  error?: string | null;
}

export interface PrepSourceProgress {
  state: 'running' | 'done' | 'error' | 'cancelled';
  /** παρτίδες που ταιριάζουν στα φίλτρα */
  found: number;
  /** Chess.com: μήνας που διαβάζεται */
  month?: string;
  /** rate, auth, notfound, net */
  error?: string;
}

export interface PrepProgress {
  id: string;
  phase: 'running' | 'done' | 'error' | 'cancelled';
  /** παρτίδες που μπήκαν σε αυτή την εκτέλεση */
  added: number;
  sources: Partial<Record<PrepSource, PrepSourceProgress>>;
}

/** Αρχή της περιόδου: YYYYMMDD για τις βάσεις και ms για τα sites (0: όλες). */
export function periodStart(o: Pick<PrepOpts, 'months' | 'after'>, now = new Date()): { day: number; ms: number } {
  let y: number;
  let m: number;
  let d: number;
  if (o.after) [y, m, d] = o.after.split('-').map(Number);
  else if (o.months) {
    const at = new Date(now.getFullYear(), now.getMonth() - o.months, now.getDate());
    [y, m, d] = [at.getFullYear(), at.getMonth() + 1, at.getDate()];
  } else return { day: 0, ms: 0 };
  return { day: y * 10000 + m * 100 + d, ms: Date.UTC(y, m - 1, d) };
}

/** Μέσα στην περίοδο; Μισή ημερομηνία (2026.??.??) μετρά αν μπορεί να είναι μέσα· χωρίς έτος μόνο στο «Όλες». */
export function inPeriod(date: number, startDay: number): boolean {
  if (!startDay) return true;
  if (date < 10000) return false;
  const month = Math.floor(date / 100) % 100;
  return Math.floor(date / 10000) * 10000 + (month || 12) * 100 + (date % 100 || 31) >= startDay;
}

/**
 * Μοίρασμα του συνολικού ορίου: ίσα μερίδια, και ό,τι δεν καλύπτει μια πηγή πάει στις άλλες (μία πηγή: όλο δικό της).
 * Έτσι οι λίγες OTB δεν χάνονται κάτω από τις πιο πρόσφατες online.
 */
export function shareLimit(avail: number[], max: number): number[] {
  const out = avail.map(() => 0);
  let left = max;
  while (left > 0) {
    const open = avail.map((_, i) => i).filter((i) => out[i] < avail[i]);
    if (!open.length) break;
    const each = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      const n = Math.min(each, avail[i] - out[i], left);
      out[i] += n;
      left -= n;
    }
  }
  return out;
}

/** Λέξεις ενός ονόματος χωρίς τόνους και κεφαλαία. */
export const nameParts = words;
/** Ίδιο κλειδί για «Carlsen, Magnus», «Carlsen Magnus» και «Magnus Carlsen». */
export const personKey = (name: string): string => words(name).sort().join(' ');

// ---------------------------------------------------------------------------
// διπλές παρτίδες

/** Μια παρτίδα του αντιπάλου, όσο χρειάζεται για να βρεθεί αν είναι η ίδια με άλλη. */
export interface GameId {
  color: 'white' | 'black';
  /** με ποιον έπαιξε */
  opp: string;
  date: number;
  result: number;
  /** κύρια γραμμή, χωρίς σχόλια και βαριάντες */
  moves: number[];
  /** id του site (Lichess / Chess.com), όπου υπάρχει */
  key?: string | null;
}

/** Id παρτίδας του Lichess ή του Chess.com από τις ετικέτες Site / Link. */
export function siteGameKey(h: Record<string, string | undefined>): string | null {
  for (const v of [h.Link, h.Site]) {
    if (!v) continue;
    // και οι δύο μορφές του Lichess: /<id> (παλιά) και /game/<id> (τώρα)
    const li = /lichess\.org\/(?:game\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#]|$)/.exec(v);
    if (li) return `li:${li[1]}`;
    const cc = /chess\.com\/(?:analysis\/)?(?:game\/)?(live|daily)\/(?:game\/)?(\d+)/.exec(v);
    if (cc) return `cc:${cc[1]}:${cc[2]}`;
  }
  return null;
}

const yearOf = (d: number) => Math.floor(d / 10000);
const monthOf = (d: number) => Math.floor(d / 100) % 100;
const dayOf = (d: number) => d % 100;

/**
 * Η ίδια παρτίδα από δύο πηγές. Όχι «ECO + ημερομηνία + κινήσεις»: το ECO και η ημερομηνία αλλάζουν από βάση σε βάση,
 * συχνά λείπει η τελευταία κίνηση, και σύντομες ισοπαλίες με ίδιες κινήσεις είναι διαφορετικές παρτίδες.
 */
export function sameGame(a: GameId, b: GameId): boolean {
  if (a.key && b.key) return a.key === b.key;
  if (a.color !== b.color) return false;
  const n = Math.min(a.moves.length, b.moves.length);
  if (!n) return false;
  let common = 0;
  while (common < n && a.moves[common] === b.moves[common]) common++;
  if (common < n - 2) return false;
  const identical = common === a.moves.length && common === b.moves.length;
  const nearYear = !yearOf(a.date) || !yearOf(b.date) || Math.abs(yearOf(a.date) - yearOf(b.date)) <= 1;
  const sameDate = [yearOf, monthOf, dayOf].every((part) => !part(a.date) || !part(b.date) || part(a.date) === part(b.date));
  // ολόκληρη παρτίδα κίνηση προς κίνηση: το όνομα του αντιπάλου αλλάζει (Gkoumas / Goumas, όνομα γάμου)
  if (identical && nearYear && (n >= 80 || (n >= 40 && sameDate && a.result === b.result))) return true;
  const wa = words(a.opp);
  const wb = words(b.opp);
  // το επώνυμο του ενός μέσα στο όνομα του άλλου («Arnaudov, Petar G» = «Arnaudov, G. Petar»)
  if (wa.length && wb.length && !wb.includes(wa[0]) && !wa.includes(wb[0])) return false;
  if (n >= 40) return nearYear;
  if (identical && n >= 16 && dayOf(a.date) && dayOf(b.date) && Math.abs(a.date - b.date) <= 1) return true;
  return sameDate && (identical || (n >= 12 && a.result === b.result));
}

/** Σύνολο παρτίδων χωρίς διπλές (γρήγορα: συγκρίνονται μόνο όσες αρχίζουν ίδια). */
export class GameSet<T extends GameId> {
  private byKey = new Map<string, T>();
  private byStart = new Map<string, T[]>();

  /** Η ίδια παρτίδα αν υπάρχει ήδη· αλλιώς τη βάζει και επιστρέφει null. */
  add(g: T): T | null {
    const byId = g.key ? this.byKey.get(g.key) : undefined;
    if (byId) return byId;
    const start = `${g.color}:${g.moves.slice(0, 8).join('.')}`;
    let list = this.byStart.get(start);
    const hit = list?.find((x) => sameGame(x, g));
    if (hit) return hit;
    if (!list) this.byStart.set(start, (list = []));
    list.push(g);
    if (g.key) this.byKey.set(g.key, g);
    return null;
  }
}
