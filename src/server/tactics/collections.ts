/** Εισαγωγή των άλλων συλλογών: Lucas Chess (.fns/.lst) και τεστ EPD (Bratko–Kopec, STS, Arasan). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Position } from '../../core/chess.ts';
import { parseGames } from '../../core/pgn.ts';
import { deriveThemes, standardUci, validateLine, type PracticeGoal, type TestGoal } from '../../core/puzzle.ts';
import { dbTask, OTHER_SOURCE, refreshCountsAsync, saveSource } from './catalog.ts';
import type { Tactics } from './context.ts';
import { fetchText, type JobContext } from './jobs.ts';
import { otherId, packLine, packPosition } from './pack.ts';
import { LUCAS_RAW, type LucasFile, type SourceDef } from './sources.ts';
import { F_INACTIVE, F_MATE, F_PRACTICE, F_PRE, F_STALE, F_TEST, F_UNRATED, F_WHITE } from './store.ts';
import { maskOf } from './themes.ts';

/** Ένα puzzle πριν από την επικύρωση. */
export interface RawPuzzle {
  /** αύξων αριθμός μέσα στην πηγή (σταθερός: σειρά αρχείων και γραμμών της καρφωμένης έκδοσης) */
  seq: number;
  fen: string;
  /** γραμμή σε UCI */
  line: string[];
  pre?: boolean;
  themes: string[];
  rating: number;
  requireMate?: boolean;
  /** θέση χωρίς (πλήρη) λύση: εξάσκηση ή τεστ */
  allowEmpty?: boolean;
  goal?: PracticeGoal | TestGoal;
  meta?: Record<string, unknown>;
  flags?: number;
  /** λόγος απόρριψης πριν από την επικύρωση (π.χ. λύση που δεν διαβάζεται) */
  invalid?: string;
}

/** Η ίδια γραμμή με τις προαγωγές χωρίς κομμάτι σε `pr` (n/r/b) αντί για βασίλισσα. */
export function underPromote(fen: string, line: readonly string[], pr: string): string[] {
  const out: string[] = [];
  const pos = new Position();
  try {
    pos.setFen(fen);
  } catch {
    return [...line];
  }
  for (const u of line) {
    const from = (u.charCodeAt(0) - 97) | ((u.charCodeAt(1) - 49) << 4);
    const rank = u.charCodeAt(3) - 49;
    const pawn = (pos.board[from] & 7) === 1;
    const v = u.length === 4 && pawn && (rank === 0 || rank === 7) ? u + pr : u;
    out.push(v);
    const m = pos.parseUci(v);
    if (!m) return out.concat(line.slice(out.length));
    pos.makeMove(m);
  }
  return out;
}

/** Βαθμός κατά προσέγγιση ανά επίπεδο δυσκολίας 1–5. */
export const LEVEL_RATING = [1000, 1300, 1600, 1900, 2200];
const levelRating = (level: number | undefined, base = 1500) => (level ? LEVEL_RATING[Math.min(5, Math.max(1, level)) - 1] : base);

// ---------------------------------------------------------------------------
// Βοηθητικά ανάγνωσης

/** FEN από συλλογές (π.χ. «w  - 0 1» χωρίς πεδίο ροκέ ή μόνο τοποθέτηση) σε πλήρη μορφή. */
export function normalizeFen(fen: string): string {
  const t = fen.trim().split(/\s+/);
  const placement = t[0] ?? '';
  const turn = t[1] === 'b' ? 'b' : 'w';
  const rest = t.slice(2);
  let castling = '-';
  let ep = '-';
  const nums: string[] = [];
  for (const x of rest) {
    if (/^\d+$/.test(x)) nums.push(x);
    else if (/^[a-h][36]$/.test(x)) ep = x;
    else if (/^[KQkqA-Ha-h]+$/.test(x)) castling = x;
  }
  return `${placement} ${turn} ${castling} ${ep} ${nums[0] ?? '0'} ${nums[1] ?? '1'}`;
}

/** Κινήσεις SAN από κείμενο λύσης («1. Bh7+ $1 Kxh7 2. Qxe6 $18 1-0», «38... Qf2++ 39.Kh1 Qf1# (2. Nf2#)»). */
export function sanTokens(text: string): string[] {
  let s = text.replace(/\{[^}]*\}/g, ' ');
  // βαριάντες (και φωλιασμένες)
  for (let k = 0; k < 10 && s.includes('('); k++) s = s.replace(/\([^()]*\)/g, ' ');
  s = s.replace(/\$\d+/g, ' ');
  const out: string[] = [];
  // σύμβολα αξιολόγησης («+-», «-+», «=», «±», «+/-»…), κολλημένα στην κίνηση ή μόνα τους
  const EVAL = /(\+\/-|-\/\+|\+\/=|=\/\+|\+-|-\+|\+=|=\+|±|∓|⩲|⩱|∞|=)$/;
  for (let tok of s.split(/\s+/)) {
    tok = tok.replace(/^\d+\.(\.\.)?/, '').replace(/^\.+/, '');
    if (!tok || /^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(tok) || tok === 'e.p.') continue;
    tok = tok.replace(/[!?]+$/, '');
    for (let k = 0; k < 2 && EVAL.test(tok) && !/=[QRBN]$/i.test(tok); k++) tok = tok.replace(EVAL, '').replace(/[!?]+$/, '');
    if (!tok || /^[-+=]+$/.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

/** SAN → UCI στη θέση· σταματά στην πρώτη κίνηση που δεν διαβάζεται. */
export function sanLineToUci(fen: string, sans: readonly string[]): { uci: string[]; failed?: string } {
  const pos = Position.fromFen(fen);
  const uci: string[] = [];
  for (const s of sans) {
    const m = pos.parseSan(s);
    if (!m) return { uci, failed: s };
    uci.push(standardUci(m));
    pos.makeMove(m);
  }
  return { uci };
}

/** Κείμενο της ετικέτας του Lucas (HTML με <br>) σε γραμμές. */
export function labelLines(html: string): string[] {
  return html
    .split(/<br\s*\/?>/i)
    .map((x) =>
      x
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/·/g, ': ')
        .trim(),
    )
    .filter(Boolean);
}

/** Μία γραμμή .fns: «FEN|ετικέτα|λύση SAN[|PGN]». */
export function parseFnsLine(raw: string): { fen: string; label: string[]; solution: string; headers: Record<string, string>; stars: number; result: string | null } | null {
  const line = raw.replace(/\r$/, '');
  if (!line.trim()) return null;
  const parts = line.split('|');
  const fen = normalizeFen(parts[0]);
  const labelRaw = parts[1] ?? '';
  const headers: Record<string, string> = {};
  for (const m of (parts[3] ?? '').matchAll(/\[(\w+)\s+"([^"]*)"\]/g)) headers[m[1]] = m[2];
  const stars = /Difficulty\s+(\*+)/.exec(labelRaw)?.[1].length ?? 0;
  const result = /Result[·:]\s*(1-0|0-1|1\/2-1\/2)/.exec(labelRaw)?.[1] ?? headers.Result ?? null;
  return { fen, label: labelLines(labelRaw), solution: parts[2] ?? '', headers, stars, result };
}

// ---------------------------------------------------------------------------
// Αναγνώστες ανά είδος πηγής

async function readLucas(def: SourceDef, ctx: JobContext): Promise<RawPuzzle[]> {
  const out: RawPuzzle[] = [];
  let seq = 0;
  const files = def.files ?? [];
  for (let k = 0; k < files.length; k++) {
    const f: LucasFile = files[k];
    ctx.progress({ phase: 'download', done: k, total: files.length, message: f.path.split('/').slice(-2).join('/') });
    const text = await fetchText(LUCAS_RAW + f.path.split('/').map(encodeURIComponent).join('/'), ctx.signal, { latin1Fallback: true });
    const file = f.path.split('/').pop()!.replace(/\.(fns|lst)$/, '');
    if (f.lst) {
      // «τοποθέτηση,uci|τοποθέτηση,uci|…» (Lucas: «Training mates»· μόνο η πρώτη κίνηση)
      for (const ln of text.split('\n')) {
        for (const item of ln.split('|')) {
          const [placement, uci] = item.trim().split(',');
          if (!placement || !uci) continue;
          seq++;
          const fen = lstFen(placement, uci);
          const mateIn = Number(/mateIn(\d)/.exec((f.themes ?? []).join(' '))?.[1] ?? 1);
          out.push(
            mateIn === 1
              ? { seq, fen, line: [uci], themes: f.themes ?? [], rating: levelRating(f.level), requireMate: true, meta: { file } }
              : { seq, fen, line: [uci], themes: f.themes ?? [], rating: levelRating(f.level), allowEmpty: true, goal: { kind: 'test', bm: [uci] }, flags: F_TEST, meta: { file, keyMoveOnly: true } },
          );
        }
      }
      continue;
    }
    for (const ln of text.split('\n')) {
      const p = parseFnsLine(ln);
      if (!p) continue;
      seq++;
      const sans = sanTokens(p.solution);
      let uci: string[] = [];
      let invalid: string | undefined;
      if (sans.length) {
        try {
          const r = sanLineToUci(p.fen, sans);
          uci = r.uci;
          if (r.failed) invalid = `${r.failed} (${p.solution.slice(0, 60)})`;
        } catch (e) {
          // άκυρο FEN: θα απορριφθεί στην επικύρωση
          void e;
        }
      }
      const level = f.level ?? (p.stars || undefined);
      const isPractice = def.mode === 'practice' && !sans.length;
      // οι ετικέτες κρατούν μόνο κείμενο: χωρίς συνδέσμους (π.χ. των online παρτίδων)
      const meta: Record<string, unknown> = { file, label: p.label.filter((x) => !/^https?:\/\//i.test(x)) };
      // η λύση της πηγής όπως γράφεται, όταν έχει υποβαριάντες ή σχόλια (για το «Από την πηγή»)
      if (/[({]/.test(p.solution)) meta.solution = p.solution;
      for (const k of ['Event', 'Site', 'Date', 'White', 'Black', 'Result', 'WhiteElo', 'BlackElo', 'ECO']) if (p.headers[k]) meta[k.toLowerCase()] = p.headers[k];
      const mateSet = (f.themes ?? []).includes('mate');
      let goal: PracticeGoal | undefined;
      if (isPractice) {
        const turnWhite = / w /.test(p.fen);
        const res = p.result === '1/2-1/2' ? 'draw' : p.result === (turnWhite ? '1-0' : '0-1') ? 'win' : undefined;
        goal = { kind: 'play', result: res };
      }
      out.push({
        seq,
        fen: p.fen,
        line: uci,
        themes: f.themes ?? [],
        rating: levelRating(level, def.baseRating),
        requireMate: mateSet && uci.length > 0,
        allowEmpty: isPractice,
        goal,
        flags: isPractice ? F_PRACTICE : 0,
        meta,
        invalid,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ενσωματωμένες συλλογές: τα μαθήματα της εφαρμογής (src/data/lessons)

/** Ένα μάθημα: θέση, στόχος, λύση με σχόλια (ίδιες κινήσεις στις δύο γλώσσες), τι κρατάς, πηγή. */
export interface Lesson {
  /** σταθερός αύξων (μπαίνει στο αναγνωριστικό) */
  seq: number;
  /** η θέση στη σειρά του μαθήματος (από τα εύκολα στα δύσκολα· αλλιώς ο αύξων) */
  order?: number;
  /** το επίπεδο (ενότητα) του μαθήματος */
  part: { el: string; en: string };
  fen: string;
  /** η πρώτη κίνηση της λύσης είναι του αντιπάλου */
  pre?: boolean;
  goal: 'win' | 'draw';
  rating: number;
  themes?: string[];
  title: { el: string; en: string };
  intro?: { el: string; en: string };
  summary: { el: string; en: string };
  /** κινήσεις σε PGN με {σχόλια} και (υποβαριάντες) */
  solution: { el: string; en: string };
  /** άρθρο της Wikipedia (με την έκδοσή του) ή βιβλίο κοινού κτήματος· χωρίς πηγή: μάθημα του Ruru */
  source?: { article: string; oldid: number; url: string } | { book: string; author: string; year: number; chapter?: string };
}

const LESSONS_DIR = new URL('../../data/lessons/', import.meta.url);

export function readLessons(file: string): Lesson[] {
  return (JSON.parse(fs.readFileSync(new URL(file, LESSONS_DIR), 'utf8')) as { items: Lesson[] }).items;
}

/** Μάθημα στρατηγικής: μια παρτίδα με τα σχόλια του σχολιαστή και ερωτήσεις «τι θα έπαιζες;». */
export interface GameLesson {
  id: string;
  seq: number;
  white: string;
  black: string;
  event: string;
  year: number;
  result: string;
  opening: { el: string; en: string };
  title: { el: string; en: string };
  theme: { el: string; en: string };
  intro: { el: string; en: string };
  summary: { el: string; en: string };
  annotator: string;
  /** lang: η γλώσσα του βιβλίου, αν δεν είναι τα αγγλικά (τότε και τα αγγλικά είναι μετάφραση) */
  source: { book: string; author: string; year: number; game: number; lang?: 'de' };
  /** κινήσεις σε PGN με {σχόλια} και (βαριάντες), ίδιες κινήσεις στις δύο γλώσσες */
  pgn: { el: string; en: string };
  /** πριν από την ημικίνηση `ply` της κύριας γραμμής: «τι θα έπαιζες;» (best: όσες προτείνει ο σχολιαστής) */
  questions: Array<{ ply: number; ask: { el: string; en: string }; best: string[]; criticised?: boolean }>;
}

let gameLessons: GameLesson[] | null = null;
export function readGameLessons(): GameLesson[] {
  gameLessons ??= (JSON.parse(fs.readFileSync(new URL('games.json', LESSONS_DIR), 'utf8')) as { items: GameLesson[] }).items;
  return gameLessons;
}

/** Αλλάζει όταν αλλάζει ο τρόπος που μπαίνουν τα μαθήματα στη βάση (όχι τα δεδομένα τους). */
const BUNDLED_REV = 1;

/** Έκδοση μιας ενσωματωμένης συλλογής (αλλάζει με κάθε αλλαγή του αρχείου ή της εισαγωγής: ξαναμπαίνει μόνη της). */
export function bundledVersion(def: SourceDef): string {
  return crypto.createHash('sha1').update(`${BUNDLED_REV}:`).update(fs.readFileSync(new URL(def.data!, LESSONS_DIR))).digest('hex').slice(0, 12);
}

/** Η κύρια γραμμή μιας λύσης σε PGN (με σχόλια και υποβαριάντες), σε UCI. */
export function mainLine(fen: string, movetext: string): { uci: string[]; error: string | null } {
  const r = parseGames(`[Event "?"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n${movetext}\n`)[0];
  if (!r) return { uci: [], error: 'empty' };
  const uci: string[] = [];
  for (let n = r.game.root.children[0]; n; n = n.children[0]) uci.push(standardUci(n.move));
  return { uci, error: r.error };
}

function readBundled(def: SourceDef): RawPuzzle[] {
  return readLessons(def.data!).map((x) => {
    const m = mainLine(x.fen, x.solution.el);
    return {
      seq: x.seq,
      fen: x.fen,
      line: m.uci,
      pre: x.pre,
      themes: ['endgame', ...(x.themes ?? [])],
      rating: x.rating,
      meta: {
        lesson: true,
        order: x.order ?? x.seq,
        file: x.part.el,
        fileEn: x.part.en,
        goal: x.goal,
        title: x.title,
        intro: x.intro,
        summary: x.summary,
        solution: x.solution.el,
        solutionEn: x.solution.en,
        ...(x.source && 'article' in x.source ? { article: x.source.article, oldid: x.source.oldid, url: x.source.url } : {}),
        ...(x.source && 'book' in x.source ? { book: x.source.book, author: x.source.author, year: x.source.year } : {}),
      },
      invalid: m.error ?? undefined,
    };
  });
}

/** Ενσωματωμένη συλλογή: από τα δεδομένα της εφαρμογής κατευθείαν στη βάση (χωρίς λήψη). */
export async function importBundled(t: Tactics, def: SourceDef, ctx?: JobContext): Promise<CollectionReport> {
  const rep = await storeCollection(t, def, readBundled(def), ctx);
  saveSource(t.puzzles, def, { version: bundledVersion(def), info: { report: { ...rep, samples: undefined } } });
  return rep;
}

/** FEN από τοποθέτηση .lst: παίζει το χρώμα του κομματιού στο τετράγωνο αφετηρίας. */
function lstFen(placement: string, uci: string): string {
  const pos = new Position();
  try {
    pos.setFen(`${placement} w - - 0 1`);
    const from = (uci.charCodeAt(0) - 97) | ((uci.charCodeAt(1) - 49) << 4);
    if (pos.board[from] >> 3 === 1) return `${placement} b - - 0 1`;
  } catch {
    // άκυρη θέση: θα απορριφθεί στην επικύρωση
  }
  return `${placement} w - - 0 1`;
}

/** Μία γραμμή EPD → FEN και πράξεις (bm, am, id, c0…c9). */
export function parseEpdLine(raw: string): { fen: string; ops: Record<string, string> } | null {
  const line = raw.trim();
  if (!line || line.startsWith('#')) return null;
  const t = line.split(/\s+/);
  if (t.length < 4) return null;
  const fen = `${t[0]} ${t[1]} ${t[2]} ${t[3]} 0 1`;
  let rest = line.slice(line.indexOf(t[3], t[0].length + t[1].length + t[2].length + 3) + t[3].length);
  const ops: Record<string, string> = {};
  while (rest.trim()) {
    rest = rest.trimStart();
    const m = /^(\w+)\s*/.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
    let operand = '';
    while (rest.length && rest[0] !== ';') {
      if (rest[0] === '"') {
        const end = rest.indexOf('"', 1);
        operand += rest.slice(1, end < 0 ? undefined : end);
        rest = end < 0 ? '' : rest.slice(end + 1);
      } else {
        operand += rest[0];
        rest = rest.slice(1);
      }
    }
    rest = rest.slice(1);
    ops[m[1]] = operand.trim();
  }
  return { fen, ops };
}

async function readEpd(def: SourceDef, ctx: JobContext): Promise<RawPuzzle[]> {
  ctx.progress({ phase: 'download', message: def.url.split('/').pop() });
  const text = await fetchText(def.url, ctx.signal, { latin1Fallback: true });
  const out: RawPuzzle[] = [];
  let seq = 0;
  for (const ln of text.split('\n')) {
    const e = parseEpdLine(ln);
    if (!e) continue;
    seq++;
    const toUci = (sans: string) => sans.split(/\s+/).filter(Boolean).map((s) => sanLineToUci(e.fen, [s]).uci[0]).filter((x): x is string => !!x);
    const bm = e.ops.bm ? toUci(e.ops.bm) : [];
    const am = e.ops.am ? toUci(e.ops.am) : [];
    const goal: TestGoal = { kind: 'test', bm };
    if (am.length) goal.am = am;
    if (e.ops.c9 && e.ops.c8) {
      const moves = e.ops.c9.split(/\s+/);
      const pts = e.ops.c8.split(/\s+/).map(Number);
      goal.points = {};
      moves.forEach((u, i) => {
        if (Number.isFinite(pts[i])) goal.points![u] = pts[i];
      });
    }
    const id = e.ops.id ?? `${def.key}.${seq}`;
    const category = /^STS[^ ]* (.+)\.\d+$/.exec(id)?.[1];
    const line = bm.length ? [bm[0]] : [];
    out.push({ seq, fen: e.fen, line, themes: [], rating: def.baseRating ?? 2000, allowEmpty: true, goal, flags: F_TEST, meta: { id, ...(category ? { category } : {}), ...(e.ops.c0 ? { comment: e.ops.c0 } : {}), bmSan: e.ops.bm, amSan: e.ops.am } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Επικύρωση και εγγραφή

export interface CollectionReport {
  source: string;
  read: number;
  imported: number;
  rejected: Record<string, number>;
  samples: Array<{ seq: number; reason: string; detail?: string }>;
  removed: number;
  deactivated: number;
  ms: number;
}

/**
 * Επικυρώνει και γράφει τα puzzles μιας πηγής (upsert με σταθερά ids· όσα χάθηκαν σβήνονται ή
 * γίνονται ανενεργά). Μία συναλλαγή, με ανάσες στο event loop ώστε ο server να απαντά στις μεγάλες
 * συλλογές (Sadier: 180.000 θέσεις). Οι εισαγωγές τρέχουν μία μία, άρα καμία άλλη εγγραφή στο μεταξύ.
 */
export async function storeCollection(t: Tactics, def: SourceDef, items: RawPuzzle[], ctx?: JobContext): Promise<CollectionReport> {
  const db = t.puzzles;
  const t0 = Date.now();
  const rep: CollectionReport = { source: def.key, read: items.length, imported: 0, rejected: {}, samples: [], removed: 0, deactivated: 0, ms: 0 };
  const reject = (seq: number, reason: string, detail?: string) => {
    rep.rejected[reason] = (rep.rejected[reason] ?? 0) + 1;
    if (rep.samples.filter((s) => s.reason === reason).length < 5) rep.samples.push({ seq, reason, detail });
  };
  const ins = db.prep(
    `INSERT INTO puzzle(id, source_id, pos, line, rating, rd, pop, plays, th1, th2, opening_id, game, ply, goal, meta, flags) VALUES (?, ?, ?, ?, ?, 350, NULL, NULL, ?, ?, NULL, NULL, NULL, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET source_id = excluded.source_id, pos = excluded.pos, line = excluded.line, rating = excluded.rating, rd = excluded.rd,
       th1 = excluded.th1, th2 = excluded.th2, goal = excluded.goal, meta = excluded.meta, flags = excluded.flags`,
  );
  db.db.exec('BEGIN');
  try {
    db.prep(`UPDATE puzzle SET flags = flags | ${F_STALE} WHERE ${OTHER_SOURCE}`).run(def.id);
    const seen = new Set<number>();
    let k = 0;
    for (const it of items) {
      if ((++k & 4095) === 0) {
        if (ctx?.signal.aborted) throw new Error('Ακυρώθηκε');
        ctx?.progress({ phase: 'import', done: k, total: items.length });
        await new Promise((r) => setImmediate(r));
      }
      if (it.seq < 0 || it.seq >= 10_000_000 || seen.has(it.seq)) {
        reject(it.seq, 'id');
        continue;
      }
      seen.add(it.seq);
      if (it.invalid) {
        reject(it.seq, 'solution', it.invalid);
        continue;
      }
      let vv = validateLine(it.fen, it.line, { pre: it.pre, requireMate: it.requireMate, allowEmpty: it.allowEmpty });
      // λύση ματ με προαγωγή γραμμένη χωρίς κομμάτι (π.χ. Polgár «e7-e8»): δοκιμή με υποπροαγωγή
      if (!vv.ok && vv.error === 'notMate') {
        for (const pr of ['n', 'r', 'b']) {
          const x = validateLine(it.fen, underPromote(it.fen, it.line, pr), { pre: it.pre, requireMate: true });
          if (x.ok) {
            vv = x;
            break;
          }
        }
      }
      if (!vv.ok || !vv.start) {
        reject(it.seq, vv.error ?? 'fen', vv.detail);
        continue;
      }
      const derived = deriveThemes(vv.start, vv.moves, !!it.pre);
      // στα τεστ μίας κίνησης και στα μαθήματα το μήκος δεν λέει τίποτα: μόνο φάση και τύπος φινάλε
      const keep = (it.flags ?? 0) & F_TEST || it.meta?.lesson ? derived.filter((x) => !['oneMove', 'short', 'long', 'veryLong'].includes(x)) : derived;
      const themes = [...new Set([...it.themes, ...keep])];
      const mask = maskOf(themes);
      const flags = (it.flags ?? 0) | F_UNRATED | (it.pre ? F_PRE : 0) | (vv.solverWhite ? F_WHITE : 0) | (vv.mate ? F_MATE : 0);
      ins.run(otherId(def.id, it.seq), def.id, packPosition(vv.start), packLine(vv.moves), Math.round(it.rating), mask.m1, mask.m2, it.goal ? JSON.stringify(it.goal) : null, it.meta ? JSON.stringify(it.meta) : null, flags);
      rep.imported++;
    }
    const referenced = t.user.referencedIds();
    const stale = (db.prep(`SELECT id FROM puzzle WHERE ${OTHER_SOURCE} AND (flags & ${F_STALE}) != 0`).all(def.id) as Array<{ id: number }>).map((r) => r.id);
    for (const id of stale) {
      if (referenced.has(id)) {
        db.prep(`UPDATE puzzle SET flags = (flags & ~${F_STALE}) | ${F_INACTIVE} WHERE id = ?`).run(id);
        rep.deactivated++;
      } else {
        db.prep('DELETE FROM puzzle WHERE id = ?').run(id);
        rep.removed++;
      }
    }
    db.db.exec('COMMIT');
  } catch (e) {
    db.db.exec('ROLLBACK');
    throw e;
  }
  rep.ms = Date.now() - t0;
  ctx?.progress({ imported: rep.imported, rejected: Object.values(rep.rejected).reduce((a, b) => a + b, 0) });
  return rep;
}

/** Λήψη, ανάγνωση και εγγραφή μιας συλλογής (όχι Lichess). */
export async function importCollection(t: Tactics, def: SourceDef, ctx: JobContext): Promise<CollectionReport> {
  if (def.kind === 'bundled') return importBundled(t, def, ctx);
  const t0 = Date.now();
  const items = def.kind === 'lucas' ? await readLucas(def, ctx) : def.kind === 'epd' ? await readEpd(def, ctx) : [];
  if (ctx.signal.aborted) throw new Error('Ακυρώθηκε');
  ctx.progress({ phase: 'import', message: `${def.name.el}: επικύρωση ${items.length} θέσεων` });
  const rep = await storeCollection(t, def, items, ctx);
  const total = Date.now() - t0;
  saveSource(t.puzzles, def, { version: def.version ?? new Date().toISOString().slice(0, 10), info: { report: { ...rep, samples: undefined, ms: total } } });
  return { ...rep, ms: total };
}

/** Μετά από μια σειρά εισαγωγών: μετρήσεις θεμάτων/ανοιγμάτων και ANALYZE (σε worker). */
export async function finishImports(t: Tactics): Promise<{ ms: number }> {
  const t0 = Date.now();
  await refreshCountsAsync(t.puzzles);
  await dbTask(t.puzzles.file, 'analyze');
  t.puzzlesChanged();
  return { ms: Date.now() - t0 };
}
