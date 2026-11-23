/**
 * Μοντέλο παρτίδας: δέντρο κινήσεων με βαριάντες, σχόλια (πριν/μετά),
 * σύμβολα (NAG), γραφικά (βέλη / χρωματιστά τετράγωνα), ρολόι και αξιολόγηση.
 */
import { Position, START_FEN, F_NULL } from './chess.ts';

export interface Shape {
  /** R, G, Y, B */
  color: string;
  from: number;
  /** ίδιο με το from σημαίνει χρωματιστό τετράγωνο */
  to: number;
}

let nextNodeId = 1;

export class GameNode {
  id = nextNodeId++;
  parent: GameNode | null = null;
  move = 0;
  san = '';
  children: GameNode[] = [];
  /** σχόλιο μετά την κίνηση (στη ρίζα: σχόλιο πριν την πρώτη κίνηση) */
  comment = '';
  /** σχόλιο πριν την κίνηση */
  preComment = '';
  nags: number[] = [];
  shapes: Shape[] = [];
  clock = '';
  emt = '';
  evalText = '';
  /** FEN μετά την κίνηση */
  fen = '';
  /** αριθμός ημικινήσεων από την αρχή της παρτίδας (ρίζα = 0) */
  ply = 0;

  get isRoot(): boolean {
    return this.parent === null;
  }

  position(): Position {
    return Position.fromFen(this.fen);
  }

  /** Η κίνηση είναι της κύριας γραμμής; */
  isMainline(): boolean {
    let n: GameNode = this;
    while (n.parent) {
      if (n.parent.children[0] !== n) return false;
      n = n.parent;
    }
    return true;
  }

  /** Αριθμός κίνησης (1, 2, ...) για αυτήν την ημικίνηση. */
  moveNumber(startFullmove: number, startTurn: number): number {
    return startFullmove + Math.floor((this.ply - 1 + startTurn) / 2);
  }

  /** Αν η κίνηση έγινε από τα λευκά. */
  whiteMoved(startTurn: number): boolean {
    return (this.ply - 1 + startTurn) % 2 === 0;
  }

  /** Βάθος βαριάντας (0 = κύρια γραμμή). */
  variationDepth(): number {
    let d = 0;
    let n: GameNode = this;
    while (n.parent) {
      if (n.parent.children[0] !== n) d++;
      n = n.parent;
    }
    return d;
  }
}

export const SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

export class Game {
  headers: Record<string, string> = {};
  root: GameNode;
  startFen: string;
  startTurn: number;
  startFullmove: number;

  constructor(fen: string = START_FEN) {
    const pos = Position.fromFen(fen);
    this.startFen = pos.fen();
    this.startTurn = pos.turn;
    this.startFullmove = pos.fullmove;
    this.root = new GameNode();
    this.root.fen = this.startFen;
    for (const t of SEVEN_TAG_ROSTER) this.headers[t] = t === 'Result' ? '*' : '?';
    this.headers.Date = '????.??.??';
    if (fen !== START_FEN && this.startFen !== Position.start().fen()) {
      this.headers.SetUp = '1';
      this.headers.FEN = this.startFen;
      if (pos.chess960) this.headers.Variant = 'Chess960';
    }
  }

  get isStandardStart(): boolean {
    return this.startFen === START_FEN;
  }

  /** Προσθέτει (ή βρίσκει) κίνηση μετά τον κόμβο parent. */
  addMove(parent: GameNode, move: number, pos?: Position): GameNode {
    for (const c of parent.children) if (c.move === move) return c;
    const p = pos ?? parent.position();
    const node = new GameNode();
    node.parent = parent;
    node.move = move;
    node.san = p.san(move);
    p.makeMove(move);
    node.fen = p.fen();
    p.unmakeMove();
    node.ply = parent.ply + 1;
    parent.children.push(node);
    return node;
  }

  mainline(): GameNode[] {
    const out: GameNode[] = [];
    let n = this.root;
    while (n.children.length) {
      n = n.children[0];
      out.push(n);
    }
    return out;
  }

  /** Τελευταίος κόμβος της κύριας γραμμής. */
  mainlineEnd(): GameNode {
    let n = this.root;
    while (n.children.length) n = n.children[0];
    return n;
  }

  /** Όλοι οι κόμβοι σε σειρά «βάθος-πρώτα, κύρια γραμμή πρώτη». */
  allNodes(): GameNode[] {
    const out: GameNode[] = [];
    const walk = (n: GameNode) => {
      out.push(n);
      for (const c of n.children) walk(c);
    };
    walk(this.root);
    return out;
  }

  findNode(id: number): GameNode | null {
    const stack = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === id) return n;
      for (const c of n.children) stack.push(c);
    }
    return null;
  }

  /** Μονοπάτι από τη ρίζα (χωρίς αυτήν) μέχρι τον κόμβο. */
  pathTo(node: GameNode): GameNode[] {
    const out: GameNode[] = [];
    let n: GameNode | null = node;
    while (n && n.parent) {
      out.push(n);
      n = n.parent;
    }
    return out.reverse();
  }

  /** Προώθηση βαριάντας ένα επίπεδο πάνω (όπως «Promote variation»). */
  promoteVariation(node: GameNode): void {
    let n: GameNode = node;
    while (n.parent && n.parent.children[0] === n) n = n.parent;
    const parent = n.parent;
    if (!parent) return;
    const idx = parent.children.indexOf(n);
    parent.children.splice(idx, 1);
    parent.children.splice(idx - 1, 0, n);
  }

  /** Κάνει τη βαριάντα κύρια γραμμή σε όλα τα επίπεδα. */
  makeMainline(node: GameNode): void {
    let n: GameNode = node;
    while (n.parent) {
      const parent = n.parent;
      const idx = parent.children.indexOf(n);
      if (idx > 0) {
        parent.children.splice(idx, 1);
        parent.children.unshift(n);
      }
      n = parent;
    }
  }

  /** Διαγράφει τη βαριάντα στην οποία ανήκει ο κόμβος· επιστρέφει τον κόμβο όπου μένουμε. */
  deleteVariation(node: GameNode): GameNode {
    let n: GameNode = node;
    while (n.parent && n.parent.children[0] === n) n = n.parent;
    const parent = n.parent;
    if (!parent) return node;
    parent.children.splice(parent.children.indexOf(n), 1);
    return parent;
  }

  /** Διαγράφει όλες τις κινήσεις μετά τον κόμβο. */
  deleteRemaining(node: GameNode): void {
    node.children = [];
  }

  /** Διαγράφει τις προηγούμενες κινήσεις: η θέση του κόμβου γίνεται αρχική. */
  deletePrevious(node: GameNode): void {
    if (node.isRoot) return;
    const keepComment = node.comment;
    this.startFen = node.fen;
    const pos = Position.fromFen(node.fen);
    this.startTurn = pos.turn;
    this.startFullmove = pos.fullmove;
    const root = new GameNode();
    root.fen = node.fen;
    root.comment = keepComment;
    root.children = node.children;
    for (const c of root.children) c.parent = root;
    this.root = root;
    const shift = node.ply;
    const walk = (n: GameNode) => {
      for (const c of n.children) {
        c.ply -= shift;
        walk(c);
      }
    };
    walk(root);
    root.ply = 0;
    this.headers.SetUp = '1';
    this.headers.FEN = this.startFen;
  }

  /** Αφαιρεί βαριάντες, σχόλια ή σύμβολα από όλη την παρτίδα. */
  strip(opts: { variations?: boolean; comments?: boolean; nags?: boolean; shapes?: boolean }): void {
    const walk = (n: GameNode) => {
      if (opts.variations) n.children = n.children.slice(0, 1);
      if (opts.comments) {
        n.comment = '';
        n.preComment = '';
        n.evalText = '';
        n.clock = '';
        n.emt = '';
      }
      if (opts.nags) n.nags = [];
      if (opts.shapes) n.shapes = [];
      for (const c of n.children) walk(c);
    };
    walk(this.root);
  }

  /** Αριθμός ημικινήσεων της κύριας γραμμής. */
  plyCount(): number {
    let k = 0;
    let n = this.root;
    while (n.children.length) {
      n = n.children[0];
      k++;
    }
    return k;
  }

  hasVariations(): boolean {
    return this.allNodes().some((n) => n.children.length > 1);
  }

  /** Κείμενο κίνησης για εμφάνιση: «12. Nf3» ή «12... Nf6». */
  moveLabel(node: GameNode, forceNumber = true): string {
    if (node.isRoot) return '';
    const num = node.moveNumber(this.startFullmove, this.startTurn);
    const white = node.whiteMoved(this.startTurn);
    if (white) return `${num}. ${node.san}`;
    return forceNumber ? `${num}... ${node.san}` : node.san;
  }

  isNullMove(node: GameNode): boolean {
    return (node.move & F_NULL) !== 0;
  }

  clone(): Game {
    const g = new Game(this.startFen);
    g.headers = { ...this.headers };
    const copy = (src: GameNode, dst: GameNode) => {
      dst.comment = src.comment;
      dst.preComment = src.preComment;
      dst.nags = [...src.nags];
      dst.shapes = src.shapes.map((s) => ({ ...s }));
      dst.clock = src.clock;
      dst.emt = src.emt;
      dst.evalText = src.evalText;
      for (const c of src.children) {
        const n = new GameNode();
        n.parent = dst;
        n.move = c.move;
        n.san = c.san;
        n.fen = c.fen;
        n.ply = c.ply;
        dst.children.push(n);
        copy(c, n);
      }
    };
    copy(this.root, g.root);
    return g;
  }
}
