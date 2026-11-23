/**
 * Ελεγκτής παρτίδας για το παράθυρο σκακιέρας: τρέχουσα κίνηση, πλοήγηση,
 * επεξεργασία (βαριάντες, σχόλια, σύμβολα, γραφικά), ιστορικό αναίρεσης.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { NULL_MOVE, Position, START_FEN } from '../core/chess.ts';
import { Game, GameNode, type Shape } from '../core/game.ts';
import { parseGames, writeGame } from '../core/pgn.ts';
import { nagGroup } from '../core/nag.ts';
import { playMoveSound } from './sounds.ts';

export class GameController {
  game: Game;
  node: GameNode;
  version = 0;
  dirty = false;
  /** Κοινή ανάλυση χωρίς άδεια αλλαγών: μόνο πλοήγηση· κάθε απόπειρα αλλαγής καλεί το `onLocked`. */
  locked = false;
  onLocked: (() => void) | null = null;
  private listeners = new Set<() => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(game?: Game) {
    this.game = game ?? new Game();
    this.node = this.game.root;
  }

  static fromPgn(pgn: string): { ctrl: GameController; error: string | null } {
    const parsed = parseGames(pgn);
    if (!parsed.length) return { ctrl: new GameController(), error: 'Δεν βρέθηκε παρτίδα' };
    return { ctrl: new GameController(parsed[0].game), error: parsed[0].error };
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Αποθηκεύει την κατάσταση για αναίρεση πριν από αλλαγή. */
  private snapshot(): void {
    this.undoStack.push(this.serialize());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private serialize(): string {
    // διαδρομή τρέχοντος κόμβου ως δείκτες παιδιών
    const path: number[] = [];
    let n: GameNode = this.node;
    while (n.parent) {
      path.unshift(n.parent.children.indexOf(n));
      n = n.parent;
    }
    return JSON.stringify({ pgn: writeGame(this.game, { maxLine: 0 }), path });
  }

  private restore(s: string): void {
    const { pgn, path } = JSON.parse(s) as { pgn: string; path: number[] };
    const parsed = parseGames(pgn)[0];
    if (!parsed) return;
    this.game = parsed.game;
    let n = this.game.root;
    for (const i of path) {
      if (!n.children[i]) break;
      n = n.children[i];
    }
    this.node = n;
  }

  private blocked(): boolean {
    if (this.locked) this.onLocked?.();
    return this.locked;
  }

  undo(): void {
    if (this.blocked()) return;
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.serialize());
    this.restore(s);
    this.dirty = true;
    this.emit();
  }

  redo(): void {
    if (this.blocked()) return;
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.serialize());
    this.restore(s);
    this.dirty = true;
    this.emit();
  }

  get canUndo(): boolean {
    return !this.locked && this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return !this.locked && this.redoStack.length > 0;
  }

  // -------------------------------------------------------------------------

  load(game: Game, keepDirty = false): void {
    this.game = game;
    this.node = game.root;
    this.dirty = keepDirty;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  loadPgn(pgn: string): string | null {
    const parsed = parseGames(pgn);
    if (!parsed.length) return 'Δεν βρέθηκε παρτίδα';
    this.load(parsed[0].game);
    return parsed[0].error;
  }

  /**
   * Κοινή ανάλυση: το δέντρο άλλαξε από άλλον συμμετέχοντα. Η θέση μας μένει ίδια (ή όσο πιο κοντά γίνεται)·
   * η αλλαγή μπαίνει στην αναίρεση και η παρτίδα θέλει αποθήκευση.
   */
  applyRemote(game: Game, locate: (game: Game) => GameNode): void {
    this.snapshot();
    this.game = game;
    this.node = locate(game);
    this.dirty = true;
    this.emit();
  }

  newGame(fen: string = START_FEN): void {
    this.load(new Game(fen));
  }

  position(): Position {
    return Position.fromFen(this.node.fen);
  }

  goTo(node: GameNode): void {
    if (node === this.node) return;
    this.node = node;
    this.emit();
  }

  forward(variation = 0): void {
    const c = this.node.children[variation] ?? this.node.children[0];
    if (c) this.goTo(c);
  }

  back(): void {
    if (this.node.parent) this.goTo(this.node.parent);
  }

  toStart(): void {
    this.goTo(this.game.root);
  }

  toEnd(): void {
    let n = this.node;
    while (n.children.length) n = n.children[0];
    this.goTo(n);
  }

  /** Παίζει κίνηση: ακολουθεί υπάρχουσα ή προσθέτει νέα βαριάντα. */
  play(move: number, opts: { replaceMainline?: boolean } = {}): GameNode {
    const existing = this.node.children.find((c) => c.move === move);
    if (existing) {
      this.goTo(existing);
      return existing;
    }
    // κίνηση από παλιά θέση (π.χ. δεύτερο συμβάν δείκτη ή απάντηση μηχανής που άργησε): αγνοείται
    const pos = Position.fromFen(this.node.fen);
    if (move === NULL_MOVE ? pos.inCheck() : !pos.legalMoves().includes(move)) return this.node;
    if (this.blocked()) return this.node;
    this.snapshot();
    if (opts.replaceMainline) this.node.children = [];
    const node = this.game.addMove(this.node, move);
    this.node = node;
    this.dirty = true;
    this.emit();
    return node;
  }

  /** Προσθέτει μια σειρά κινήσεων (π.χ. γραμμή μηχανής) ως βαριάντα. */
  addLine(start: GameNode, moves: number[]): GameNode {
    if (this.blocked()) return start;
    this.snapshot();
    let n = start;
    const pos = Position.fromFen(start.fen);
    for (const m of moves) {
      n = this.game.addMove(n, m, pos);
      pos.makeMove(m);
    }
    this.dirty = true;
    this.emit();
    return n;
  }

  edit(fn: () => void): void {
    if (this.blocked()) return;
    this.snapshot();
    fn();
    this.dirty = true;
    this.emit();
  }

  deleteVariation(node: GameNode = this.node): void {
    this.edit(() => {
      const stay = this.game.deleteVariation(node);
      if (!this.game.findNode(this.node.id)) this.node = stay;
    });
  }

  deleteRemaining(node: GameNode = this.node): void {
    this.edit(() => {
      this.game.deleteRemaining(node);
      if (!this.game.findNode(this.node.id)) this.node = node;
    });
  }

  deletePrevious(node: GameNode = this.node): void {
    this.edit(() => {
      this.game.deletePrevious(node);
      this.node = this.game.root;
    });
  }

  promote(node: GameNode = this.node): void {
    this.edit(() => this.game.promoteVariation(node));
  }

  makeMainline(node: GameNode = this.node): void {
    this.edit(() => this.game.makeMainline(node));
  }

  setComment(node: GameNode, text: string, before = false): void {
    this.edit(() => {
      if (before) node.preComment = text.trim();
      else node.comment = text.trim();
    });
  }

  toggleNag(node: GameNode, nag: number, group: number[]): void {
    if (node.isRoot) return;
    this.edit(() => {
      const had = node.nags.includes(nag);
      node.nags = node.nags.filter((n) => !group.includes(n));
      if (!had) node.nags.push(nag);
      node.nags.sort((a, b) => a - b);
    });
  }

  /** Βάζει σύμβολο στη θέση όποιου άλλου της ομάδας του (0 = κανένα της ομάδας). */
  setNag(node: GameNode, nag: number, group: number[] = nagGroup(nag)): void {
    if (node.isRoot) return;
    const next = node.nags.filter((n) => !group.includes(n));
    if (nag) next.push(nag);
    next.sort((a, b) => a - b);
    if (next.join() === node.nags.join()) return;
    this.edit(() => {
      node.nags = next;
    });
  }

  clearNags(node: GameNode): void {
    this.edit(() => {
      node.nags = [];
    });
  }

  toggleShape(node: GameNode, shape: Shape): void {
    this.edit(() => {
      const i = node.shapes.findIndex((s) => s.from === shape.from && s.to === shape.to);
      if (i >= 0) {
        if (node.shapes[i].color === shape.color) node.shapes.splice(i, 1);
        else node.shapes[i] = shape;
      } else node.shapes.push(shape);
    });
  }

  clearShapes(node: GameNode): void {
    this.edit(() => {
      node.shapes = [];
    });
  }

  setHeaders(h: Record<string, string>): void {
    this.edit(() => {
      this.game.headers = { ...h };
    });
  }

  strip(opts: { variations?: boolean; comments?: boolean; nags?: boolean; shapes?: boolean }): void {
    this.edit(() => {
      this.game.strip(opts);
      if (!this.game.findNode(this.node.id)) this.node = this.game.root;
    });
  }

  pgn(): string {
    return writeGame(this.game);
  }

  markSaved(): void {
    this.dirty = false;
    this.emit();
  }
}

/** Επανασχεδίαση React όταν αλλάζει ο ελεγκτής. */
export function useController(ctrl: GameController): number {
  return useSyncExternalStore(ctrl.subscribe, ctrl.getVersion);
}

/** Ήχος σε κάθε βήμα μπροστά (κίνηση στη σκακιέρα, απάντηση της μηχανής, →): όχι σε άλματα ή σε φόρτωση παρτίδας. */
export function useMoveSounds(ctrl: GameController): void {
  useEffect(() => {
    let prev = ctrl.node;
    return ctrl.subscribe(() => {
      const n = ctrl.node;
      if (n !== prev && n.parent === prev && n.san) playMoveSound(n.san);
      prev = n;
    });
  }, [ctrl]);
}

/** Μητρώο ελεγκτών ανά καρτέλα (επιβιώνουν όταν αλλάζουμε καρτέλα). */
const registry = new Map<string, GameController>();

export function controllerFor(tabId: string, init: () => GameController): GameController {
  let c = registry.get(tabId);
  if (!c) registry.set(tabId, (c = init()));
  return c;
}

export function dropController(tabId: string): void {
  registry.delete(tabId);
}
