/**
 * Συμπαγής δυαδική κωδικοποίηση παρτίδων για τη βάση του Ruru.
 *
 * Κάθε παρτίδα είναι μια σειρά από tokens των 16 bit (little endian):
 *   0x0000-0x4FFF  κίνηση: from(6) | to(6)<<6 | προαγωγή(3)<<12 (1=N,2=B,3=R,4=Q)
 *   0x7FFF         κενή κίνηση (null move)
 *   0x8001 / 0x8002 αρχή / τέλος βαριάντας (όπως οι παρενθέσεις του PGN)
 *   0x8100 + n     σύμβολο NAG n
 *   0xA000 + i     σχόλιο i πριν από την επόμενη κίνηση
 *   0xC000 + i     σχόλιο i μετά από την τελευταία κίνηση (στην αρχή: σχόλιο παρτίδας)
 * Τα σχόλια αποθηκεύονται χωριστά ως κείμενα PGN (με [%cal] κλπ).
 */
import { F_C960, F_NULL, NULL_MOVE, Position, START_FEN, castleRookSquare, to64, to88 } from './chess.ts';
import { Game, GameNode } from './game.ts';
import { MovetextTokenizer, T_COMMENT, T_EOF, T_NAG, T_RESULT, T_SAN, T_VEND, T_VSTART, composeComment, parseComment } from './pgn.ts';

export const TK_NULL = 0x7fff;
export const TK_VSTART = 0x8001;
export const TK_VEND = 0x8002;
export const TK_NAG = 0x8100;
export const TK_PRE = 0xa000;
export const TK_COMMENT = 0xc000;

/** Σημαίες παρτίδας */
export const GF_VARIATIONS = 1;
export const GF_COMMENTS = 2;
export const GF_NAGS = 4;
export const GF_SETUP = 8;
export const GF_SHAPES = 16;
export const GF_ERROR = 32;

export function moveToToken(m: number): number {
  if (m & F_NULL) return TK_NULL;
  const pr = (m >> 14) & 7;
  // ροκέ Chess960 ως «βασιλιάς πάνω στον πύργο»: αδιαμφισβήτητο ακόμη κι όταν ο βασιλιάς μένει στη θέση του
  const to = m & F_C960 ? castleRookSquare(m) : (m >> 7) & 0x7f;
  return to64(m & 0x7f) | (to64(to) << 6) | ((pr ? pr - 1 : 0) << 12);
}

/** Μετατρέπει token σε κίνηση στη δεδομένη θέση (χωρίς έλεγχο νομιμότητας). */
export function tokenToMove(pos: Position, tk: number): number {
  if (tk === TK_NULL) return NULL_MOVE;
  const pc = (tk >> 12) & 7;
  return pos.buildMove(to88(tk & 63), to88((tk >> 6) & 63), pc ? pc + 1 : 0);
}

export function tokenToUci(tk: number): string {
  if (tk === TK_NULL) return '0000';
  const f = tk & 63;
  const t = (tk >> 6) & 63;
  const pc = (tk >> 12) & 7;
  const sq = (i: number) => 'abcdefgh'[i & 7] + String((i >> 3) + 1);
  return sq(f) + sq(t) + (pc ? ' nbrq'[pc] : '');
}

export interface EncodedGame {
  tokens: Uint16Array;
  comments: string[];
  flags: number;
}

/** Κωδικοποιεί δέντρο παρτίδας. */
export function encodeGame(game: Game): EncodedGame {
  const out: number[] = [];
  const comments: string[] = [];
  let flags = game.isStandardStart ? 0 : GF_SETUP;
  const addComment = (raw: string, pre: boolean) => {
    if (comments.length >= 0x1fff) return;
    out.push((pre ? TK_PRE : TK_COMMENT) | comments.length);
    comments.push(raw);
    flags |= GF_COMMENTS;
  };
  const emitNode = (n: GameNode) => {
    if (n.preComment) addComment(n.preComment, true);
    out.push(moveToToken(n.move));
    for (const g of n.nags) {
      out.push(TK_NAG | (g & 0xff));
      flags |= GF_NAGS;
    }
    if (n.shapes.length) flags |= GF_SHAPES;
    const c = composeComment(n);
    if (c) addComment(c, false);
  };
  const emitLine = (parent: GameNode) => {
    let n = parent;
    while (n.children.length) {
      const main = n.children[0];
      emitNode(main);
      for (let k = 1; k < n.children.length; k++) {
        flags |= GF_VARIATIONS;
        out.push(TK_VSTART);
        emitNode(n.children[k]);
        emitLine(n.children[k]);
        out.push(TK_VEND);
      }
      n = main;
    }
  };
  const rc = composeComment(game.root);
  if (rc) addComment(rc, false);
  emitLine(game.root);
  return { tokens: Uint16Array.from(out), comments, flags };
}

/** Αποκωδικοποιεί σε δέντρο παρτίδας. */
export function decodeGame(tokens: Uint16Array, comments: string[] | null, startFen: string = START_FEN): Game {
  const game = new Game(startFen);
  let cur: GameNode = game.root;
  let pos = Position.fromFen(game.startFen);
  const stack: GameNode[] = [];
  let pendingPre = '';
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk < 0x8000) {
      const m = tokenToMove(pos, tk);
      if (!(m & F_NULL) && (pos.board[m & 0x7f] === 0 || !pos.isLegalPseudo(m))) break;
      const node = game.addMove(cur, m, pos);
      pos.makeMove(m);
      cur = node;
      if (pendingPre) {
        const c = parseComment(pendingPre);
        node.preComment = c.text;
        pendingPre = '';
      }
    } else if (tk === TK_VSTART) {
      if (!cur.parent) break;
      stack.push(cur);
      cur = cur.parent;
      pos = cur.position();
    } else if (tk === TK_VEND) {
      const back = stack.pop();
      if (!back) break;
      cur = back;
      pos = cur.position();
    } else if ((tk & 0xff00) === TK_NAG) {
      if (!cur.isRoot) cur.nags.push(tk & 0xff);
    } else if (tk >= TK_COMMENT) {
      const raw = comments?.[tk & 0x3fff];
      if (raw) applyRaw(cur, raw);
    } else if (tk >= TK_PRE) {
      pendingPre = comments?.[tk & 0x1fff] ?? '';
    }
  }
  return game;
}

function applyRaw(node: GameNode, raw: string): void {
  const c = parseComment(raw);
  if (c.text) node.comment = node.comment ? node.comment + ' ' + c.text : c.text;
  if (c.shapes.length) node.shapes.push(...c.shapes);
  if (c.clock) node.clock = c.clock;
  if (c.emt) node.emt = c.emt;
  if (c.evalText) node.evalText = c.evalText;
}

// ---------------------------------------------------------------------------
// Γρήγορη εισαγωγή από PGN (χωρίς δέντρο)

export interface IndexSink {
  /** μέγιστο πλήθος ημικινήσεων κύριας γραμμής προς ευρετηρίαση */
  maxPlies: number;
  hashHi: Int32Array;
  hashLo: Int32Array;
  /** token της επόμενης κίνησης (0xFFFF = τέλος παρτίδας) */
  next: Uint16Array;
  count: number;
}

export function createIndexSink(maxPlies: number): IndexSink {
  return {
    maxPlies,
    hashHi: new Int32Array(maxPlies + 1),
    hashLo: new Int32Array(maxPlies + 1),
    next: new Uint16Array(maxPlies + 1),
    count: 0,
  };
}

export interface MovetextEncoding {
  tokens: Uint16Array;
  comments: string[] | null;
  flags: number;
  /** ημικινήσεις κύριας γραμμής */
  plies: number;
  error: string | null;
  /** αποτέλεσμα από το κείμενο κινήσεων (αν υπάρχει) */
  result: string;
  /** τελική θέση κύριας γραμμής: υλικό ανά κομμάτι (για αναζήτηση υλικού) */
  finalMaterial: string;
}

let tokBuf = new Uint16Array(4096);
let tokLen = 0;
function pushTok(t: number): void {
  if (tokLen === tokBuf.length) {
    const n = new Uint16Array(tokBuf.length * 2);
    n.set(tokBuf);
    tokBuf = n;
  }
  tokBuf[tokLen++] = t;
}

const startPosition = Position.start();

/**
 * Κωδικοποιεί το κείμενο κινήσεων μιας παρτίδας PGN κατευθείαν σε tokens.
 * Η θέση pos ξαναχρησιμοποιείται (για ταχύτητα).
 */
export function encodeMovetext(
  text: string,
  start: number,
  end: number,
  startFen: string | null,
  pos: Position,
  sink: IndexSink | null,
): MovetextEncoding {
  tokLen = 0;
  if (startFen) pos.setFen(startFen);
  else pos.copyFrom(startPosition);
  let flags = startFen ? GF_SETUP : 0;
  let comments: string[] | null = null;
  const tk = new MovetextTokenizer(text, start, end);
  let depth = 0;
  let mainPlies = 0;
  let lastMove = 0;
  let levelMoves = 0;
  const stackLast: number[] = [];
  const stackCount: number[] = [];
  let skipDepth = 0;
  /** αν η παράλειψη πρέπει να κλείσει την τρέχουσα βαριάντα όταν τελειώσει */
  let skipClose = false;
  let fresh = false;
  let error: string | null = null;
  let result = '';
  if (sink) sink.count = 0;

  const restoreLevel = () => {
    for (let k = 0; k < levelMoves; k++) pos.unmakeMove();
    lastMove = stackLast.pop()!;
    levelMoves = stackCount.pop()!;
    pos.makeMove(lastMove);
    depth--;
  };

  loop: for (;;) {
    const t = tk.next();
    if (t === T_EOF) break;
    if (skipDepth > 0) {
      if (t === T_VSTART) skipDepth++;
      else if (t === T_VEND && --skipDepth === 0 && skipClose) {
        // το TK_VSTART έχει ήδη γραφτεί: κλείνουμε τη (μισή) βαριάντα
        pushTok(TK_VEND);
        restoreLevel();
      }
      continue;
    }
    switch (t) {
      case T_SAN: {
        const m = pos.parseSan(tk.value);
        if (!m) {
          if (depth > 0) {
            skipDepth = 1;
            skipClose = true;
            fresh = false;
            continue;
          }
          error = `Άκυρη κίνηση «${tk.value}» στην ημικίνηση ${mainPlies + 1}`;
          flags |= GF_ERROR;
          break loop;
        }
        const token = moveToToken(m);
        if (depth === 0 && sink && sink.count < sink.maxPlies) {
          sink.hashHi[sink.count] = pos.hashHi;
          sink.hashLo[sink.count] = pos.hashLo;
          sink.next[sink.count] = token;
          sink.count++;
        }
        pushTok(token);
        pos.makeMove(m);
        lastMove = m;
        levelMoves++;
        if (depth === 0) mainPlies++;
        fresh = false;
        break;
      }
      case T_NAG:
        if (levelMoves > 0 && !fresh && tk.nag > 0 && tk.nag < 256) {
          pushTok(TK_NAG | tk.nag);
          flags |= GF_NAGS;
        }
        break;
      case T_COMMENT: {
        const raw = tk.value.trim();
        if (!raw) break;
        comments ??= [];
        if (comments.length >= 0x1fff) break;
        pushTok((fresh ? TK_PRE : TK_COMMENT) | comments.length);
        comments.push(raw);
        flags |= GF_COMMENTS;
        if (raw.indexOf('[%c') >= 0) flags |= GF_SHAPES;
        break;
      }
      case T_VSTART:
        if (levelMoves === 0 || fresh) {
          // βαριάντα χωρίς κίνηση αναφοράς: παραλείπεται ολόκληρη
          skipDepth = 1;
          skipClose = false;
          break;
        }
        pushTok(TK_VSTART);
        flags |= GF_VARIATIONS;
        stackLast.push(lastMove);
        stackCount.push(levelMoves);
        pos.unmakeMove();
        levelMoves = 0;
        depth++;
        fresh = true;
        break;
      case T_VEND:
        if (depth === 0) break;
        pushTok(TK_VEND);
        restoreLevel();
        fresh = false;
        break;
      case T_RESULT:
        if (depth === 0) {
          result = tk.value;
          break loop;
        }
        break;
    }
  }
  // κλείσιμο ανοιχτών βαριαντών
  while (depth > 0) {
    pushTok(TK_VEND);
    restoreLevel();
  }
  if (sink && sink.count < sink.maxPlies && !error) {
    // τελική θέση (χωρίς επόμενη κίνηση)
    sink.hashHi[sink.count] = pos.hashHi;
    sink.hashLo[sink.count] = pos.hashLo;
    sink.next[sink.count] = 0xffff;
    sink.count++;
  }
  return {
    tokens: tokBuf.slice(0, tokLen),
    comments,
    flags,
    plies: mainPlies,
    error,
    result,
    finalMaterial: pos.materialKey(),
  };
}

// ---------------------------------------------------------------------------
// Αναπαραγωγή κύριας γραμμής από tokens (για ευρετήρια και αναζητήσεις)

/**
 * Παίζει την κύρια γραμμή και καλεί το visit(pos, ply, nextToken) πριν από κάθε
 * κίνηση και μία φορά στο τέλος (nextToken = 0xFFFF). Αν το visit επιστρέψει
 * true η αναπαραγωγή σταματά.
 */
export function replayMainline(
  tokens: Uint16Array,
  pos: Position,
  startFen: string | null,
  visit: (pos: Position, ply: number, next: number) => boolean | void,
): number {
  if (startFen) pos.setFen(startFen);
  else pos.copyFrom(startPosition);
  let ply = 0;
  let depth = 0;
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk === TK_VSTART) {
      depth++;
      continue;
    }
    if (tk === TK_VEND) {
      depth--;
      continue;
    }
    if (depth > 0 || tk >= 0x8000) continue;
    if (visit(pos, ply, tk)) return ply;
    const m = tokenToMove(pos, tk);
    pos.makeMove(m);
    ply++;
  }
  visit(pos, ply, 0xffff);
  return ply;
}
