/**
 * PGN: ανάγνωση (με βαριάντες, σχόλια, NAG, [%cal]/[%csl]/[%clk]/[%eval]) και εγγραφή.
 * Ο tokenizer είναι κοινός για το δέντρο παρτίδας (UI) και για τη γρήγορη
 * εισαγωγή μεγάλων αρχείων (server).
 */
import { Position, START_FEN, parseSquare, squareName } from './chess.ts';
import { Game, GameNode, SEVEN_TAG_ROSTER, type Shape } from './game.ts';
import { textToNag } from './nag.ts';

export const T_EOF = 0;
export const T_SAN = 1;
export const T_NAG = 2;
export const T_COMMENT = 3;
export const T_VSTART = 4;
export const T_VEND = 5;
export const T_RESULT = 6;

function isSpace(c: number): boolean {
  return c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0xfeff || c === 0xa0;
}

/** Χαρακτήρες που τερματίζουν ένα SAN token. */
function isDelim(c: number): boolean {
  return isSpace(c) || c === 123 || c === 125 || c === 40 || c === 41 || c === 91 || c === 59 || c === 36 || c === 33 || c === 63;
}

export class MovetextTokenizer {
  value = '';
  nag = 0;
  private s: string;
  private i: number;
  private end: number;

  constructor(s: string, start = 0, end = s.length) {
    this.s = s;
    this.i = start;
    this.end = end;
  }

  get offset(): number {
    return this.i;
  }

  next(): number {
    const s = this.s;
    const end = this.end;
    for (;;) {
      let i = this.i;
      while (i < end && isSpace(s.charCodeAt(i))) i++;
      if (i >= end) {
        this.i = i;
        return T_EOF;
      }
      const c = s.charCodeAt(i);
      if (c === 123) {
        // { σχόλιο }
        let j = s.indexOf('}', i + 1);
        if (j < 0 || j > end) j = end;
        this.value = s.slice(i + 1, j);
        this.i = j + 1;
        return T_COMMENT;
      }
      if (c === 59) {
        // ; σχόλιο ως το τέλος γραμμής
        let j = s.indexOf('\n', i + 1);
        if (j < 0 || j > end) j = end;
        this.value = s.slice(i + 1, j).trim();
        this.i = j;
        return T_COMMENT;
      }
      if (c === 40) {
        this.i = i + 1;
        return T_VSTART;
      }
      if (c === 41) {
        this.i = i + 1;
        return T_VEND;
      }
      if (c === 36) {
        // $n
        let j = i + 1;
        let n = 0;
        while (j < end) {
          const d = s.charCodeAt(j);
          if (d < 48 || d > 57) break;
          n = n * 10 + (d - 48);
          j++;
        }
        this.i = j;
        if (j === i + 1) continue;
        this.nag = n;
        return T_NAG;
      }
      if (c === 33 || c === 63) {
        // ! ? !! ?? !? ?!
        let j = i + 1;
        while (j < end && (s.charCodeAt(j) === 33 || s.charCodeAt(j) === 63)) j++;
        this.i = j;
        const n = textToNag(s.slice(i, j));
        if (!n) continue;
        this.nag = n;
        return T_NAG;
      }
      if (c === 37 && (i === 0 || s.charCodeAt(i - 1) === 10)) {
        // % γραμμή διαφυγής
        const j = s.indexOf('\n', i);
        this.i = j < 0 ? end : j;
        continue;
      }
      if (c === 91) {
        // αρχή επόμενης παρτίδας μέσα στο κείμενο κινήσεων
        this.i = end;
        return T_EOF;
      }
      if (c === 42) {
        this.i = i + 1;
        this.value = '*';
        return T_RESULT;
      }
      // γενικό token
      let j = i;
      while (j < end && !isDelim(s.charCodeAt(j))) j++;
      if (j === i) {
        // μεμονωμένος διαχωριστής (π.χ. «}» ή «]»)
        this.i = i + 1;
        continue;
      }
      let tok = s.slice(i, j);
      this.i = j;
      if (c >= 48 && c <= 57) {
        if (tok === '1-0' || tok === '0-1' || tok === '1/2-1/2' || tok === '1/2' || tok === '½-½') {
          this.value = tok === '1/2' || tok === '½-½' ? '1/2-1/2' : tok;
          return T_RESULT;
        }
        if (tok.startsWith('0-0')) {
          this.value = tok;
          return T_SAN;
        }
        // αριθμός κίνησης «12.» ή «12...» ή κολλητό «12.e4»
        let k = 0;
        while (k < tok.length && tok.charCodeAt(k) >= 48 && tok.charCodeAt(k) <= 57) k++;
        while (k < tok.length && (tok[k] === '.' || tok[k] === '…')) k++;
        if (k >= tok.length) continue;
        tok = tok.slice(k);
      }
      if (tok === '..' || tok === '...' || tok === '…') continue;
      const nag = textToNag(tok);
      if (nag && !/^[a-hNBRQKO]/.test(tok)) {
        this.nag = nag;
        return T_NAG;
      }
      if (tok === 'N') {
        this.nag = 146;
        return T_NAG;
      }
      this.value = tok;
      return T_SAN;
    }
  }
}

// ---------------------------------------------------------------------------
// Κεφαλίδες

const HEADER_RE = /^\s*\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/;
/** ετικέτα με μη λατινικό όνομα (π.χ. `[Σχόλιο "x"]`)· μόνο όταν αποτύχει η γρήγορη */
const HEADER_RE_U = /^\s*\[\s*([\p{L}\p{N}_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/u;

export interface HeaderBlock {
  headers: Record<string, string>;
  /** θέση όπου αρχίζουν οι κινήσεις */
  bodyStart: number;
}

export function unescapePgn(v: string): string {
  return v.indexOf('\\') < 0 ? v : v.replace(/\\(["\\])/g, '$1');
}

export function parseHeaderBlock(text: string, start = 0, end = text.length): HeaderBlock {
  const headers: Record<string, string> = {};
  let i = start;
  while (i < end) {
    // παράλειψη κενών γραμμών
    while (i < end && isSpace(text.charCodeAt(i))) i++;
    if (i >= end || text.charCodeAt(i) !== 91) break;
    let j = text.indexOf('\n', i);
    if (j < 0 || j > end) j = end;
    const line = text.slice(i, j);
    const m = HEADER_RE.exec(line) ?? HEADER_RE_U.exec(line);
    if (m) {
      headers[m[1]] = unescapePgn(m[2]);
    } else if (line.indexOf(']') < 0) {
      // χαλασμένη κεφαλίδα — σταματάμε εδώ
      break;
    }
    i = j + 1;
  }
  return { headers, bodyStart: Math.min(i, end) };
}

/**
 * Βρίσκει τις αρχές των παρτίδων σε κείμενο PGN (λαμβάνει υπόψη σχόλια { }
 * που περιέχουν αγκύλες στην αρχή γραμμής).
 */
export function findGameStarts(text: string, start = 0, end = text.length): number[] {
  const starts: number[] = [];
  let i = start;
  let inComment = false;
  let inHeaders = false;
  while (i < end) {
    let j = text.indexOf('\n', i);
    if (j < 0 || j > end) j = end;
    // πρώτος μη κενός χαρακτήρας της γραμμής
    let k = i;
    while (k < j && (text.charCodeAt(k) === 32 || text.charCodeAt(k) === 9 || text.charCodeAt(k) === 0xfeff)) k++;
    if (!inComment && k < j && text.charCodeAt(k) === 91) {
      if (!inHeaders) {
        starts.push(i);
        inHeaders = true;
      }
    } else {
      if (k < j && text.charCodeAt(k) !== 13) inHeaders = false;
      // παρακολούθηση σχολίων
      for (let p = k; p < j; p++) {
        const c = text.charCodeAt(p);
        if (inComment) {
          if (c === 125) inComment = false;
        } else if (c === 123) {
          inComment = true;
        } else if (c === 59) {
          break;
        }
      }
    }
    i = j + 1;
  }
  return starts;
}

// ---------------------------------------------------------------------------
// Εντολές μέσα σε σχόλια

export interface CommentParts {
  text: string;
  shapes: Shape[];
  clock: string;
  emt: string;
  evalText: string;
}

const CMD_RE = /\[%(\w+)\s+([^\]]*)\]/g;

export function parseComment(raw: string): CommentParts {
  const out: CommentParts = { text: '', shapes: [], clock: '', emt: '', evalText: '' };
  if (raw.indexOf('[%') < 0) {
    out.text = raw.replace(/\s+/g, ' ').trim();
    return out;
  }
  const text = raw.replace(CMD_RE, (_all, cmd: string, arg: string) => {
    const a = arg.trim();
    switch (cmd) {
      case 'cal':
        for (const it of a.split(',')) {
          const t = it.trim();
          if (t.length < 5) continue;
          const from = parseSquare(t, 1);
          const to = parseSquare(t, 3);
          if (from >= 0 && to >= 0) out.shapes.push({ color: t[0].toUpperCase(), from, to });
        }
        return ' ';
      case 'csl':
        for (const it of a.split(',')) {
          const t = it.trim();
          if (t.length < 3) continue;
          const sq = parseSquare(t, 1);
          if (sq >= 0) out.shapes.push({ color: t[0].toUpperCase(), from: sq, to: sq });
        }
        return ' ';
      case 'clk':
        out.clock = a;
        return ' ';
      case 'emt':
        out.emt = a;
        return ' ';
      case 'eval':
        out.evalText = a;
        return ' ';
      default:
        return _all;
    }
  });
  out.text = text.replace(/\s+/g, ' ').trim();
  return out;
}

/** Συνθέτει σχόλιο PGN από τα μέρη του. */
export function composeComment(node: GameNode, includeText = true): string {
  const parts: string[] = [];
  const arrows = node.shapes.filter((s) => s.from !== s.to);
  const squares = node.shapes.filter((s) => s.from === s.to);
  if (squares.length) parts.push(`[%csl ${squares.map((s) => s.color + squareName(s.from)).join(',')}]`);
  if (arrows.length) parts.push(`[%cal ${arrows.map((s) => s.color + squareName(s.from) + squareName(s.to)).join(',')}]`);
  if (node.evalText) parts.push(`[%eval ${node.evalText}]`);
  if (node.emt) parts.push(`[%emt ${node.emt}]`);
  if (node.clock) parts.push(`[%clk ${node.clock}]`);
  if (includeText && node.comment) parts.push(node.comment.replace(/[{}]/g, (c) => (c === '{' ? '(' : ')')));
  return parts.join(' ');
}

function applyComment(node: GameNode, raw: string, pre: boolean): void {
  const c = parseComment(raw);
  if (pre) {
    if (c.text) node.preComment = node.preComment ? node.preComment + ' ' + c.text : c.text;
  } else if (c.text) {
    node.comment = node.comment ? node.comment + ' ' + c.text : c.text;
  }
  if (c.shapes.length) node.shapes.push(...c.shapes);
  if (c.clock) node.clock = c.clock;
  if (c.emt) node.emt = c.emt;
  if (c.evalText) node.evalText = c.evalText;
}

// ---------------------------------------------------------------------------
// Ανάγνωση παρτίδας σε δέντρο

export interface ParseResult {
  game: Game;
  /** μήνυμα σφάλματος αν οι κινήσεις σταμάτησαν πρόωρα */
  error: string | null;
}

export function startFenOf(headers: Record<string, string>): string {
  const fen = headers.FEN;
  if (fen && headers.SetUp !== '0') return fen;
  return START_FEN;
}

/** Διαβάζει μία παρτίδα PGN (κεφαλίδες + κινήσεις). */
export function parseGame(text: string, start = 0, end = text.length): ParseResult {
  const { headers, bodyStart } = parseHeaderBlock(text, start, end);
  let game: Game;
  let error: string | null = null;
  try {
    game = new Game(startFenOf(headers));
  } catch (e) {
    game = new Game();
    error = `Άκυρο FEN: ${(e as Error).message}`;
  }
  game.headers = { ...game.headers, ...headers };
  if (!game.headers.Result) game.headers.Result = '*';
  if (error) return { game, error };
  error = parseMovetextInto(game, text, bodyStart, end);
  return { game, error };
}

/** Διαβάζει κείμενο κινήσεων στο δέντρο της παρτίδας. */
export function parseMovetextInto(game: Game, text: string, start: number, end: number): string | null {
  const tk = new MovetextTokenizer(text, start, end);
  let cur: GameNode = game.root;
  let pos = Position.fromFen(game.startFen);
  const stack: GameNode[] = [];
  let pendingPre = '';
  /** ακριβώς μετά από «(» χωρίς κίνηση ακόμη */
  let fresh = false;
  let skipDepth = 0;
  for (;;) {
    const t = tk.next();
    if (t === T_EOF) break;
    if (skipDepth > 0) {
      // παράλειψη βαριάντας μετά από άκυρη κίνηση
      if (t === T_VSTART) skipDepth++;
      else if (t === T_VEND) skipDepth--;
      continue;
    }
    switch (t) {
      case T_SAN: {
        const m = pos.parseSan(tk.value);
        if (!m) {
          if (stack.length) {
            // άκυρη κίνηση σε βαριάντα: αγνοούμε το υπόλοιπό της
            skipDepth = 1;
            cur = stack.pop()!;
            pos = cur.position();
            pendingPre = '';
            fresh = false;
            break;
          }
          const where = game.moveLabel(cur, true);
          if (pendingPre) applyComment(cur, pendingPre, false);
          return `Άκυρη κίνηση «${tk.value}»${where ? ' μετά το ' + where : ''}`;
        }
        const node = game.addMove(cur, m, pos);
        pos.makeMove(m);
        cur = node;
        if (pendingPre) {
          applyComment(node, pendingPre, true);
          pendingPre = '';
        }
        fresh = false;
        break;
      }
      case T_NAG:
        if (!cur.isRoot && !fresh && !cur.nags.includes(tk.nag)) cur.nags.push(tk.nag);
        break;
      case T_COMMENT:
        if (fresh) pendingPre = pendingPre ? pendingPre + ' ' + tk.value : tk.value;
        else applyComment(cur, tk.value, false);
        break;
      case T_VSTART:
        if (cur.isRoot || fresh) {
          // βαριάντα χωρίς κίνηση αναφοράς: αγνοείται
          skipDepth = 1;
          break;
        }
        stack.push(cur);
        cur = cur.parent!;
        pos = cur.position();
        fresh = true;
        break;
      case T_VEND:
        if (!stack.length) break;
        if (pendingPre) {
          applyComment(cur, pendingPre, false);
          pendingPre = '';
        }
        cur = stack.pop()!;
        pos = cur.position();
        fresh = false;
        break;
      case T_RESULT:
        if (!stack.length) {
          if (!game.headers.Result || game.headers.Result === '*') game.headers.Result = tk.value;
          if (pendingPre) applyComment(cur, pendingPre, false);
          return null;
        }
        break;
    }
  }
  if (pendingPre) applyComment(cur, pendingPre, false);
  return null;
}

/** Διαβάζει όλες τις παρτίδες ενός κειμένου PGN. */
export function parseGames(text: string): ParseResult[] {
  const starts = findGameStarts(text);
  const out: ParseResult[] = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : text.length;
    out.push(parseGame(text, starts[k], end));
  }
  if (!starts.length && text.trim()) out.push(parseGame(text));
  return out;
}

// ---------------------------------------------------------------------------
// Εγγραφή PGN

export function escapePgn(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export interface WriteOptions {
  /** μέγιστο μήκος γραμμής (0 = χωρίς αναδίπλωση) */
  maxLine?: number;
  comments?: boolean;
  variations?: boolean;
  nags?: boolean;
}

export function writeHeaders(headers: Record<string, string>): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const t of SEVEN_TAG_ROSTER) {
    const v = headers[t] ?? (t === 'Result' ? '*' : t === 'Date' ? '????.??.??' : '?');
    lines.push(`[${t} "${escapePgn(v)}"]`);
    seen.add(t);
  }
  for (const [k, v] of Object.entries(headers)) {
    if (seen.has(k) || v === undefined || v === null) continue;
    lines.push(`[${k} "${escapePgn(String(v))}"]`);
  }
  return lines.join('\n');
}

export function writeMovetext(game: Game, opts: WriteOptions = {}): string {
  const withComments = opts.comments !== false;
  const withVariations = opts.variations !== false;
  const withNags = opts.nags !== false;
  const tokens: string[] = [];
  const rootComment = withComments ? composeComment(game.root) : '';
  if (rootComment) tokens.push(`{${rootComment}}`);

  const emitMove = (node: GameNode, forceNumber: boolean) => {
    if (withComments && node.preComment) tokens.push(`{${node.preComment.replace(/[{}]/g, '')}}`);
    const num = node.moveNumber(game.startFullmove, game.startTurn);
    if (node.whiteMoved(game.startTurn)) tokens.push(`${num}.`);
    else if (forceNumber || (withComments && node.preComment)) tokens.push(`${num}...`);
    tokens.push(node.san);
    if (withNags) for (const n of node.nags) tokens.push(`$${n}`);
    const c = withComments ? composeComment(node) : '';
    if (c) tokens.push(`{${c}}`);
    return Boolean(c);
  };

  const emitLine = (parent: GameNode, firstForce: boolean) => {
    let n = parent;
    let force = firstForce;
    while (n.children.length) {
      const main = n.children[0];
      const hadComment = emitMove(main, force);
      force = hadComment;
      if (withVariations && n.children.length > 1) {
        for (const alt of n.children.slice(1)) {
          tokens.push('(');
          emitMove(alt, true);
          emitLine(alt, false);
          tokens.push(')');
        }
        force = true;
      }
      n = main;
    }
  };
  emitLine(game.root, true);
  tokens.push(game.headers.Result || '*');

  // οι παρενθέσεις κολλάνε στο διπλανό token
  const atoms: string[] = [];
  let open = '';
  for (const t of tokens) {
    if (t === '(') {
      open += '(';
    } else if (t === ')') {
      if (atoms.length) atoms[atoms.length - 1] += ')';
    } else {
      atoms.push(open + t);
      open = '';
    }
  }
  const max = opts.maxLine ?? 80;
  if (!max) return atoms.join(' ');
  // συνένωση με αναδίπλωση (τα μεγάλα σχόλια σπάνε λέξη-λέξη)
  const words: string[] = [];
  for (const a of atoms) {
    if (a.length > max && a.includes(' ')) words.push(...a.split(' '));
    else words.push(a);
  }
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line.length && line.length + 1 + w.length > max) {
      lines.push(line);
      line = w;
    } else {
      line = line ? line + ' ' + w : w;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function writeGame(game: Game, opts: WriteOptions = {}): string {
  const h = { ...game.headers };
  if (!game.isStandardStart) {
    h.SetUp = '1';
    h.FEN = game.startFen;
    // Chess960: χωρίς αυτό άλλα προγράμματα διαβάζουν λάθος το ροκέ
    if (!h.Variant && Position.fromFen(game.startFen).chess960) h.Variant = 'Chess960';
  } else {
    delete h.SetUp;
    delete h.FEN;
  }
  return writeHeaders(h) + '\n\n' + writeMovetext(game, opts) + '\n';
}

/** Κινήσεις της κύριας γραμμής ως απλό κείμενο SAN («1. e4 e5 2. Nf3»). */
export function mainlineText(game: Game, maxPlies = Infinity): string {
  const out: string[] = [];
  let k = 0;
  for (const n of game.mainline()) {
    if (k++ >= maxPlies) break;
    out.push(n.whiteMoved(game.startTurn) || k === 1 ? game.moveLabel(n) : n.san);
  }
  return out.join(' ');
}
