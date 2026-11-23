/**
 * Σκακιέρα (SVG): μετακίνηση με σύρσιμο ή κλικ, προαγωγή, βέλη / τετράγωνα με
 * δεξί κλικ (Shift = κόκκινο, Alt = κίτρινο, Ctrl = μπλε), βέλη μηχανής, προ-κίνηση όσο παίζει ο αντίπαλος.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { BLACK_BIT, F_C960, F_CASTLE, KING, PAWN, Position, QUEEN, ROOK, BISHOP, KNIGHT, castleRookSquare, moveFrom, moveTo, squareName } from '../../core/chess.ts';
import type { Shape } from '../../core/game.ts';
import { oneClickFroms, premoveTargets, type Premove } from './quickMove.ts';

export interface BoardTheme {
  light: string;
  dark: string;
  lastFrom: string;
  highlight: string;
}

export const BOARD_THEMES: Record<string, BoardTheme> = {
  classic: { light: '#f0d9b5', dark: '#b58863', lastFrom: 'rgba(205, 210, 106, 0.75)', highlight: 'rgba(20, 85, 30, 0.5)' },
  blue: { light: '#dee3e6', dark: '#8ca2ad', lastFrom: 'rgba(155, 199, 0, 0.55)', highlight: 'rgba(20, 85, 30, 0.5)' },
  green: { light: '#ffffdd', dark: '#86a666', lastFrom: 'rgba(255, 255, 0, 0.4)', highlight: 'rgba(20, 85, 30, 0.5)' },
  slate: { light: '#e8ebef', dark: '#7d93b2', lastFrom: 'rgba(255, 222, 102, 0.6)', highlight: 'rgba(30, 60, 120, 0.45)' },
  wood: { light: '#e6c99b', dark: '#a8784a', lastFrom: 'rgba(240, 220, 90, 0.55)', highlight: 'rgba(20, 85, 30, 0.5)' },
  gray: { light: '#d9d9d9', dark: '#9e9e9e', lastFrom: 'rgba(255, 210, 80, 0.6)', highlight: 'rgba(20, 85, 30, 0.5)' },
};

const SHAPE_COLORS: Record<string, string> = {
  G: 'rgba(21, 120, 27, 0.8)',
  R: 'rgba(200, 30, 30, 0.8)',
  Y: 'rgba(230, 160, 0, 0.85)',
  B: 'rgba(0, 48, 136, 0.8)',
  E: 'rgba(30, 100, 220, 0.55)',
};

const PIECE_NAMES = ' PNBRQK';

/** προ-κίνηση: τα δύο τετράγωνα και οι στόχοι όσο διαλέγεται */
const PREMOVE_FILL = 'rgba(214, 80, 20, 0.5)';
const PREMOVE_DOT = 'rgba(200, 70, 15, 0.55)';

export interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  /** ποιος μπορεί να μετακινήσει */
  movable: 'white' | 'black' | 'both' | 'none';
  lastMove?: number;
  shapes?: Shape[];
  /** βέλη μηχανής (δεν αποθηκεύονται) */
  hintArrows?: Shape[];
  theme?: string;
  pieceSet?: string;
  coordinates?: boolean;
  onMove?: (from: number, to: number, promo: number) => void;
  onShape?: (shape: Shape) => void;
  onClearShapes?: () => void;
  /** επεξεργασία θέσης: κλικ σε τετράγωνο */
  onSquareClick?: (sq: number, button: number) => void;
  /** διάρκεια της κίνησης των κομματιών σε ms (0 = χωρίς) */
  animationMs?: number;
  /** κίνηση με ένα κλικ στο τετράγωνο-προορισμό, όταν πάει εκεί ένα μόνο κομμάτι */
  oneClick?: boolean;
  /** προ-κίνηση: τα κομμάτια αυτού του χρώματος παίζουν και όταν δεν είναι η σειρά τους */
  premovable?: 'white' | 'black';
  /** η προ-κίνηση που περιμένει (πορτοκαλί τετράγωνα) */
  premove?: Premove | null;
  /** νέα προ-κίνηση ή ακύρωση (null: δεξί κλικ ή κλικ αλλού) */
  onPremove?: (pm: Premove | null) => void;
}

/**
 * Κίνηση από τη μία θέση στην άλλη: για κάθε τετράγωνο με κομμάτι που ήρθε, από πού
 * ξεκινά (σε μονάδες σκακιέρας)· κομμάτια που φεύγουν (σβήνουν) ή εμφανίζονται.
 */
interface Anim {
  moves: Map<number, { fx: number; fy: number }>;
  fading: Array<{ piece: number; x: number; y: number }>;
  appearing: Set<number>;
  start: number;
  dur: number;
}

/**
 * Σύγκριση δύο τοποθετήσεων: κάθε κομμάτι που εμφανίστηκε ταιριάζει με το πιο κοντινό
 * ίδιο που χάθηκε (ροκέ: βασιλιάς και πύργος· προαγωγή: από το πιόνι). Πολλές αλλαγές
 * μαζί (νέα παρτίδα, άλμα στην αρχή / στο τέλος) δεν κινούνται.
 */
function diffBoards(prev: ArrayLike<number>, next: ArrayLike<number>, flipped: boolean): Omit<Anim, 'start' | 'dur'> | null {
  const gone: number[] = [];
  const came: number[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f;
      if (prev[sq] === next[sq]) continue;
      if (prev[sq]) gone.push(sq);
      if (next[sq]) came.push(sq);
    }
  }
  if (!came.length || gone.length + came.length > 8) return null;
  const moves = new Map<number, { fx: number; fy: number }>();
  const used = new Set<number>();
  const appearing = new Set<number>();
  const dist = (a: number, b: number) => Math.hypot((a & 7) - (b & 7), (a >> 4) - (b >> 4));
  for (const to of came) {
    let best = -1;
    for (const from of gone) {
      if (used.has(from) || prev[from] !== next[to]) continue;
      if (best < 0 || dist(from, to) < dist(best, to)) best = from;
    }
    // προαγωγή: το νέο κομμάτι ξεκινά από το πιόνι του ίδιου χρώματος
    if (best < 0) best = gone.find((from) => !used.has(from) && (prev[from] & 7) === PAWN && (prev[from] & BLACK_BIT) === (next[to] & BLACK_BIT)) ?? -1;
    if (best < 0) {
      appearing.add(to);
      continue;
    }
    used.add(best);
    const [fx, fy] = sqXY(best, flipped);
    moves.set(to, { fx, fy });
  }
  const fading = gone.filter((sq) => !used.has(sq)).map((sq) => {
    const [x, y] = sqXY(sq, flipped);
    return { piece: prev[sq], x, y };
  });
  return moves.size || fading.length || appearing.size ? { moves, fading, appearing } : null;
}

/** Ομαλή επιτάχυνση και επιβράδυνση. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Drag {
  from: number;
  piece: number;
  x: number;
  y: number;
  moved: boolean;
  /** το κομμάτι ήταν ήδη επιλεγμένο: δεύτερο κλικ = αποεπιλογή */
  again: boolean;
}

function sqXY(sq: number, flipped: boolean): [number, number] {
  const f = sq & 7;
  const r = sq >> 4;
  return flipped ? [7 - f, r] : [f, 7 - r];
}

/** Μόνο η τοποθέτηση των κομματιών από FEN (0x88), χωρίς έλεγχο εγκυρότητας. */
function placement(fen: string): Int8Array {
  const b = new Int8Array(128);
  fen.split(' ')[0].split('/').slice(0, 8).forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') f += Number(ch);
      else {
        const idx = ' PNBRQK  pnbrqk'.indexOf(ch);
        if (idx > 0 && f < 8) b[(7 - r) * 16 + f] = idx;
        f++;
      }
    }
  });
  return b;
}

export function pieceUrl(set: string, piece: number): string {
  return `/pieces/${set}/${piece & BLACK_BIT ? 'b' : 'w'}${PIECE_NAMES[piece & 7]}.svg`;
}

export function Board(props: BoardProps) {
  const { fen, orientation, movable, lastMove, shapes = [], hintArrows = [], coordinates = true } = props;
  const theme = BOARD_THEMES[props.theme ?? 'classic'] ?? BOARD_THEMES.classic;
  const pieceSet = props.pieceSet ?? 'cburnett';
  const flipped = orientation === 'black';
  const svgRef = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const [drawFrom, setDrawFrom] = useState<{ sq: number; color: string } | null>(null);
  const [drawTo, setDrawTo] = useState<number | null>(null);

  const { pos, board, valid } = useMemo(() => {
    try {
      const p = Position.fromFen(fen);
      return { pos: p, board: p.board, valid: true };
    } catch {
      // άκυρο FEN (π.χ. χωρίς βασιλιά στον διάλογο θέσης): μόνο τα κομμάτια, χωρίς κινήσεις
      return { pos: Position.start(), board: placement(fen), valid: false };
    }
  }, [fen]);
  const legal = useMemo(() => (valid ? pos.legalMoves() : []), [pos, valid]);
  const checkSq = valid && pos.inCheck() ? pos.kingSq[pos.turn] : -1;

  // κίνηση των κομματιών όταν αλλάζει η θέση (π.χ. με τα βελάκια), πριν ζωγραφιστεί η νέα
  const prevBoard = useRef<Int8Array | null>(null);
  const prevFlipped = useRef(flipped);
  /** τετράγωνο όπου μόλις αφέθηκε κομμάτι με σύρσιμο: αυτό δεν ξανακινείται */
  const dropped = useRef<{ sq: number; at: number } | null>(null);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [, setFrame] = useState(0);
  useLayoutEffect(() => {
    const prev = prevBoard.current;
    prevBoard.current = Int8Array.from(board);
    const dur = props.animationMs ?? 200;
    const turned = prevFlipped.current !== flipped;
    prevFlipped.current = flipped;
    const drop = dropped.current && performance.now() - dropped.current.at < 1000 ? dropped.current.sq : -1;
    dropped.current = null;
    const d = prev && dur > 0 && !turned ? diffBoards(prev, board, flipped) : null;
    if (d) d.moves.delete(drop);
    setAnim(d ? { ...d, start: performance.now(), dur } : null);
  }, [board]);
  useEffect(() => {
    if (!anim) return;
    let id = 0;
    const tick = () => {
      if (performance.now() - anim.start >= anim.dur) return setAnim(null);
      setFrame((f) => f + 1);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    // χωρίς frames (κρυφό παράθυρο) η κίνηση τελειώνει έτσι κι αλλιώς
    const done = setTimeout(() => setAnim(null), anim.dur + 50);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(done);
    };
  }, [anim]);
  const t = anim ? ease(Math.min(1, (performance.now() - anim.start) / anim.dur)) : 1;

  const canMove = (piece: number) => {
    if (!piece || movable === 'none' || !props.onMove) return false;
    const color = piece & BLACK_BIT ? 'black' : 'white';
    if (movable !== 'both' && movable !== color) return false;
    return (color === 'white' ? 0 : 1) === pos.turn;
  };
  // προ-κίνηση: δεν είναι η σειρά του `premovable`, αλλά τα κομμάτια του διαλέγονται
  const preSide = valid && props.premovable && props.onPremove ? (props.premovable === 'white' ? 0 : 1) : -1;
  const pre = preSide >= 0 && pos.turn !== preSide;
  const canPre = (piece: number) => pre && piece !== 0 && (piece & BLACK_BIT ? 1 : 0) === preSide;

  // δρομέας: χέρι πάνω σε κομμάτι που έχει νόμιμη κίνηση (όχι καρφωμένο, όχι σε σαχ χωρίς
  // διέξοδο) και στους στόχους του επιλεγμένου· «πιασμένο» χέρι όσο κρατιέται κομμάτι
  const [hover, setHover] = useState(-1);
  const fromSquares = useMemo(() => new Set(legal.map((m) => moveFrom(m))), [legal]);

  const targets = useMemo(() => {
    const from = drag?.from ?? selected;
    if (from === null || from === undefined) return new Set<number>();
    if (canPre(board[from])) return premoveTargets(pos, from);
    // ροκέ Chess960: στόχος είναι ο πύργος (ο βασιλιάς «πάνω στον πύργο»)
    return new Set(legal.filter((m) => moveFrom(m) === from).map((m) => (m & F_C960 ? castleRookSquare(m) : moveTo(m))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, selected, legal, pre]);

  const pointToSquare = (clientX: number, clientY: number): { sq: number; x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * 8;
    const y = ((clientY - r.top) / r.height) * 8;
    if (x < 0 || y < 0 || x >= 8 || y >= 8) return { sq: -1, x, y };
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const file = flipped ? 7 - fx : fx;
    const rank = flipped ? fy : 7 - fy;
    return { sq: rank * 16 + file, x, y };
  };

  const tryMove = (from: number, to: number) => {
    if (from === to) return false;
    if (canPre(board[from])) {
      if (!premoveTargets(pos, from).has(to)) return false;
      props.onPremove?.({ from, to });
      return true;
    }
    // το ροκέ Chess960 γίνεται μόνο πάνω στον πύργο (αλλιώς μπερδεύεται με απλή κίνηση του βασιλιά)
    const candidates = legal.filter((m) => moveFrom(m) === from && moveTo(m) === to && !(m & F_C960));
    if (!candidates.length) {
      // ροκέ με κλικ στον πύργο (κλασικό και Chess960): η θέση το λύνει με findMove
      const p = board[from];
      if ((p & 7) === KING && board[to] === (ROOK | (p & BLACK_BIT)) && legal.some((m) => moveFrom(m) === from && m & F_CASTLE && castleRookSquare(m) === to)) {
        props.onMove?.(from, to, 0);
        return true;
      }
      return false;
    }
    if (candidates.length > 1) {
      setPromo({ from, to });
      return true;
    }
    props.onMove?.(from, to, 0);
    return true;
  };

  const shapeColor = (e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }) => (e.shiftKey ? 'R' : e.altKey ? 'Y' : e.ctrlKey || e.metaKey ? 'B' : 'G');

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const p = pointToSquare(e.clientX, e.clientY);
    if (!p || p.sq < 0) return;
    if (promo) return;
    if (props.onSquareClick) {
      props.onSquareClick(p.sq, e.button);
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      // δεξί κλικ με προ-κίνηση: μόνο την ακυρώνει (δεν σχεδιάζει)
      if (props.premove) {
        props.onPremove?.(null);
        setSelected(null);
        return;
      }
      setDrawFrom({ sq: p.sq, color: shapeColor(e) });
      setDrawTo(p.sq);
      return;
    }
    if (e.button !== 0) return;
    // κάθε αριστερό κλικ ακυρώνει την προ-κίνηση που περιμένει· σε δικό μας κομμάτι αρχίζει νέα
    if (props.premove) props.onPremove?.(null);
    const piece = board[p.sq];
    // (σε προ-κίνηση το κλικ σε δικό μας κομμάτι το διαλέγει· το «ξαναπαίρνω εκεί» γίνεται με σύρσιμο)
    if (selected !== null && selected !== p.sq && targets.has(p.sq) && !canPre(piece)) {
      tryMove(selected, p.sq);
      setSelected(null);
      setDrag(null);
      return;
    }
    if (canMove(piece) || canPre(piece)) {
      setSelected(p.sq);
      setDrag({ from: p.sq, piece, x: p.x, y: p.y, moved: false, again: selected === p.sq });
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } else {
      if (selected === null && props.oneClick && props.onMove && movable !== 'none') oneClickMove(p.sq);
      setSelected(null);
    }
  };

  /**
   * Κίνηση με ένα κλικ στον προορισμό: αν πάει εκεί ένα μόνο κομμάτι (π.χ. e4 στην αρχή), αν είναι
   * φάγωμα με ένα φθηνότερο κομμάτι από τα άλλα (exd5 πριν από Nxd5) ή αν ανάμεσα στους υποψήφιους
   * είναι το ροκέ (κλικ στο g1 / c1), γίνεται η κίνηση. Αλλιώς δείχνονται για λίγο τα κομμάτια
   * ανάμεσα στα οποία διαλέγει ο χρήστης.
   */
  const [pickHint, setPickHint] = useState<number[]>([]);
  const oneClickMove = (sq: number) => {
    const color = pos.turn === 0 ? 'white' : 'black';
    if (movable !== 'both' && movable !== color) return;
    const cands = legal.filter((m) => moveTo(m) === sq);
    if (!cands.length) return;
    const castle = cands.find((m) => m & F_CASTLE);
    const froms = oneClickFroms(cands, board);
    if (castle || froms.length === 1) {
      const mine = castle ? [castle] : cands.filter((m) => moveFrom(m) === froms[0]);
      const m = mine[0];
      // προαγωγή: επιλογή κομματιού όπως στη μεταφορά με το ποντίκι
      if (mine.length > 1) setPromo({ from: moveFrom(m), to: sq });
      else props.onMove?.(moveFrom(m), m & F_C960 ? castleRookSquare(m) : sq, 0);
      return;
    }
    setPickHint(froms);
    setTimeout(() => setPickHint([]), 1200);
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (drag) {
      const p = pointToSquare(e.clientX, e.clientY);
      if (p) setDrag({ ...drag, x: p.x, y: p.y, moved: true });
    } else if (drawFrom) {
      const p = pointToSquare(e.clientX, e.clientY);
      if (p && p.sq >= 0) setDrawTo(p.sq);
    } else {
      const p = pointToSquare(e.clientX, e.clientY);
      const sq = p && p.sq >= 0 ? p.sq : -1;
      if (sq !== hover) setHover(sq);
    }
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (drawFrom) {
      const p = pointToSquare(e.clientX, e.clientY);
      const to = p && p.sq >= 0 ? p.sq : drawFrom.sq;
      props.onShape?.({ color: drawFrom.color, from: drawFrom.sq, to });
      setDrawFrom(null);
      setDrawTo(null);
      return;
    }
    if (!drag) return;
    const p = pointToSquare(e.clientX, e.clientY);
    const d = drag;
    setDrag(null);
    if (!p || p.sq < 0) return;
    if (p.sq === d.from) {
      // απλό κλικ: μένει επιλεγμένο· δεύτερο κλικ στο ίδιο κομμάτι: σβήνουν η επιλογή και οι κινήσεις του
      if (d.again && !d.moved) setSelected(null);
      return;
    }
    // (η προ-κίνηση δεν αλλάζει τη θέση: το κομμάτι γυρίζει πίσω ως την ώρα του)
    if (d.moved && !canPre(d.piece)) dropped.current = { sq: p.sq, at: performance.now() };
    if (tryMove(d.from, p.sq)) setSelected(null);
  };

  const squares = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f;
      const [x, y] = sqXY(sq, flipped);
      const light = (r + f) % 2 === 1;
      squares.push(<rect key={`s${sq}`} x={x} y={y} width={1} height={1} fill={light ? theme.light : theme.dark} />);
    }
  }

  const highlights = [];
  if (lastMove) {
    for (const sq of [moveFrom(lastMove), moveTo(lastMove)]) {
      const [x, y] = sqXY(sq, flipped);
      highlights.push(<rect key={`l${sq}`} x={x} y={y} width={1} height={1} fill={theme.lastFrom} />);
    }
  }
  if (props.premove) {
    for (const sq of [props.premove.from, props.premove.to]) {
      const [x, y] = sqXY(sq, flipped);
      highlights.push(<rect key={`pm${sq}`} className="premove-sq" x={x} y={y} width={1} height={1} fill={PREMOVE_FILL} />);
    }
  }
  if (selected !== null) {
    const [x, y] = sqXY(selected, flipped);
    highlights.push(<rect key="sel" x={x} y={y} width={1} height={1} fill={theme.highlight} />);
  }
  if (checkSq >= 0) {
    const [x, y] = sqXY(checkSq, flipped);
    highlights.push(<rect key="check" x={x} y={y} width={1} height={1} fill="url(#checkGrad)" />);
  }

  const coloredSquares = shapes
    .filter((s) => s.from === s.to)
    .map((s, i) => {
      const [x, y] = sqXY(s.from, flipped);
      return <circle key={`c${i}`} cx={x + 0.5} cy={y + 0.5} r={0.46} fill="none" stroke={SHAPE_COLORS[s.color] ?? SHAPE_COLORS.G} strokeWidth={0.07} />;
    });

  const pieceAt = (key: string, piece: number, x: number, y: number, opacity = 1) => (
    <image key={key} href={pieceUrl(pieceSet, piece)} x={x} y={y} width={1} height={1} opacity={opacity} style={{ pointerEvents: 'none' }} />
  );

  // κάτω τα κομμάτια που σβήνουν, μετά τα ακίνητα, πάνω αυτά που κινούνται
  const pieces = (anim?.fading ?? []).map((g, i) => pieceAt(`g${i}`, g.piece, g.x, g.y, 1 - t));
  const moving = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = r * 16 + f;
      const p = board[sq];
      if (!p) continue;
      if (drag && drag.moved && drag.from === sq) continue;
      const [x, y] = sqXY(sq, flipped);
      const m = anim?.moves.get(sq);
      if (m) moving.push(pieceAt(`p${sq}`, p, m.fx + (x - m.fx) * t, m.fy + (y - m.fy) * t));
      else pieces.push(pieceAt(`p${sq}`, p, x, y, anim?.appearing.has(sq) ? t : 1));
    }
  }
  pieces.push(...moving);

  // κίνηση με ένα κλικ χωρίς μοναδικό κομμάτι: κύκλοι στα κομμάτια που μπορούν να πάνε εκεί
  const picks = pickHint.map((sq) => {
    const [x, y] = sqXY(sq, flipped);
    return <circle key={`k${sq}`} cx={x + 0.5} cy={y + 0.5} r={0.46} fill="none" stroke="rgba(230,160,0,0.9)" strokeWidth={0.08} />;
  });

  const dotColor = selected !== null && canPre(board[selected]) ? PREMOVE_DOT : 'rgba(20,85,30,0.45)';
  const dots = [...targets].map((sq) => {
    const [x, y] = sqXY(sq, flipped);
    const occupied = board[sq] !== 0;
    return occupied ? (
      <circle key={`t${sq}`} cx={x + 0.5} cy={y + 0.5} r={0.46} fill="none" stroke={dotColor} strokeWidth={0.08} />
    ) : (
      <circle key={`t${sq}`} cx={x + 0.5} cy={y + 0.5} r={0.16} fill={dotColor} />
    );
  });

  const arrow = (s: Shape, key: string, width: number, opacity = 1) => {
    const [x1, y1] = sqXY(s.from, flipped);
    const [x2, y2] = sqXY(s.to, flipped);
    const ax = x1 + 0.5;
    const ay = y1 + 0.5;
    const bx = x2 + 0.5;
    const by = y2 + 0.5;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (!len) return null;
    const ux = dx / len;
    const uy = dy / len;
    const head = 0.35;
    const ex = bx - ux * head * 0.95;
    const ey = by - uy * head * 0.95;
    const color = SHAPE_COLORS[s.color] ?? SHAPE_COLORS.G;
    return (
      <g key={key} opacity={opacity} style={{ pointerEvents: 'none' }}>
        <line x1={ax + ux * 0.18} y1={ay + uy * 0.18} x2={ex} y2={ey} stroke={color} strokeWidth={width} strokeLinecap="round" />
        <polygon points={`${bx},${by} ${ex - uy * head * 0.6},${ey + ux * head * 0.6} ${ex + uy * head * 0.6},${ey - ux * head * 0.6}`} fill={color} />
      </g>
    );
  };

  const arrows = shapes.filter((s) => s.from !== s.to).map((s, i) => arrow(s, `a${i}`, 0.15));
  const hints = hintArrows.map((s, i) => arrow(s, `h${i}`, i === 0 ? 0.13 : 0.08, i === 0 ? 0.9 : 0.55));
  if (drawFrom && drawTo !== null && drawTo !== drawFrom.sq) arrows.push(arrow({ color: drawFrom.color, from: drawFrom.sq, to: drawTo }, 'drawing', 0.15, 0.7));

  const coords = [];
  if (coordinates) {
    for (let i = 0; i < 8; i++) {
      const file = flipped ? 7 - i : i;
      const rank = flipped ? i : 7 - i;
      coords.push(
        <text key={`f${i}`} x={i + 0.94} y={7.95} fontSize={0.2} textAnchor="end" fill={i % 2 === 0 ? theme.light : theme.dark} style={{ pointerEvents: 'none', fontWeight: 600 }}>
          {'abcdefgh'[file]}
        </text>,
      );
      coords.push(
        <text key={`r${i}`} x={0.05} y={i + 0.22} fontSize={0.2} fill={i % 2 === 0 ? theme.dark : theme.light} style={{ pointerEvents: 'none', fontWeight: 600 }}>
          {rank + 1}
        </text>,
      );
    }
  }

  const promoChoices = promo
    ? (() => {
        const white = pos.turn === 0;
        const [x, y0] = sqXY(promo.to, flipped);
        const down = y0 === 0;
        return [QUEEN, KNIGHT, ROOK, BISHOP].map((t, i) => {
          const y = down ? y0 + i : y0 - i;
          const piece = t | (white ? 0 : BLACK_BIT);
          return (
            <g
              key={t}
              className="promo-choice"
              onPointerDown={(e) => {
                e.stopPropagation();
                props.onMove?.(promo.from, promo.to, t);
                setPromo(null);
                setSelected(null);
              }}
            >
              <rect x={x} y={y} width={1} height={1} fill="#fafafa" stroke="#888" strokeWidth={0.02} />
              <image href={pieceUrl(pieceSet, piece)} x={x + 0.05} y={y + 0.05} width={0.9} height={0.9} />
            </g>
          );
        });
      })()
    : null;

  const pickable = hover >= 0 && ((canMove(board[hover]) && fromSquares.has(hover)) || canPre(board[hover]) || (selected !== null && targets.has(hover)));
  const cursor = props.onSquareClick ? 'pointer' : drag ? 'grabbing' : pickable ? 'pointer' : 'default';

  return (
    <svg
      ref={svgRef}
      className="board"
      viewBox="0 0 8 8"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(-1)}
      onContextMenu={(e) => e.preventDefault()}
      role="img"
      aria-label={`Σκακιέρα: ${fen}`}
    >
      <defs>
        <radialGradient id="checkGrad">
          <stop offset="0%" stopColor="rgba(255,0,0,1)" />
          <stop offset="25%" stopColor="rgba(231,0,0,1)" />
          <stop offset="89%" stopColor="rgba(169,0,0,0)" />
          <stop offset="100%" stopColor="rgba(158,0,0,0)" />
        </radialGradient>
      </defs>
      {squares}
      {highlights}
      {coords}
      {coloredSquares}
      {pieces}
      {dots}
      {picks}
      {hints}
      {arrows}
      {drag && drag.moved && (
        <image href={pieceUrl(pieceSet, drag.piece)} x={drag.x - 0.5} y={drag.y - 0.5} width={1} height={1} style={{ pointerEvents: 'none' }} />
      )}
      {promo && <rect x={0} y={0} width={8} height={8} fill="rgba(0,0,0,0.35)" onPointerDown={(e) => { e.stopPropagation(); setPromo(null); }} />}
      {promoChoices}
    </svg>
  );
}

/** Τετράγωνο σε όνομα (για προσβασιμότητα / δοκιμές). */
export const sqName = squareName;
