// SPDX-License-Identifier: AGPL-3.0-or-later AND AGPL-3.0-only AND GPL-3.0-or-later
// Copyright (c) 2012-2026 the lila authors (AGPL-3.0-or-later), https://github.com/lichess-org/lila
//   from lila: moveTest, PracticeGoal, practiceSuccess
// Copyright (c) ornicar (Thibault Duplessis) and the lichess-puzzler contributors (AGPL-3.0),
//   https://github.com/ornicar/lichess-puzzler: theme rules of tagger/cook.py
// Adapted through RealChessBase by Lazaros Batsis (GPL-3.0-or-later).
// Translated to TypeScript and modified for Ruru Chess: 2026-10-27.
// License texts: LICENSE, licenses/AGPL-3.0.txt, licenses/NOTICES.txt
/** Λύτης puzzles: επικύρωση, έλεγχος απάντησης (κάθε ματ γίνεται δεκτό), υποδείξεις, θέματα από τη θέση και στόχοι εξάσκησης. */
import { BISHOP, BLACK, F_CASTLE, F_EP, KING, KNIGHT, PAWN, PIECE_LETTERS, Position, QUEEN, ROOK, WHITE, parseSquare, squareName } from './chess.ts';

// Κοινός buffer κινήσεων (ο κώδικας είναι σύγχρονος, άρα ασφαλής σε κάθε νήμα χωριστά).
const BUF = new Int32Array(256);

/**
 * Νόμιμη κίνηση από UCI, χωρίς δέσμευση μνήμης (γρήγορη επικύρωση εκατομμυρίων puzzles).
 * Δέχεται ροκέ και ως «βασιλιάς παίρνει πύργο» (e1h1). Επιστρέφει 0 αν η κίνηση δεν είναι νόμιμη.
 */
export function legalUci(pos: Position, uci: string): number {
  if (uci.length < 4 || uci.length > 5) return 0;
  const from = parseSquare(uci, 0);
  const to = parseSquare(uci, 2);
  if (from < 0 || to < 0 || from === to) return 0;
  const p = pos.board[from];
  if (!p || p >> 3 !== pos.turn) return 0;
  let promo = 0;
  if (uci.length === 5) {
    promo = ' pnbrqk'.indexOf(uci[4].toLowerCase());
    if (promo < KNIGHT || promo > QUEEN || (p & 7) !== PAWN) return 0;
  }
  const m = pos.buildMove(from, to, promo);
  const n = pos.generatePseudo(BUF, 0);
  for (let i = 0; i < n; i++) if (BUF[i] === m) return pos.isLegalPseudo(m) ? m : 0;
  return 0;
}

/** UCI κίνησης στην κλασική μορφή (ροκέ ως e1g1). */
export function standardUci(m: number): string {
  const from = m & 0x7f;
  const to = (m >> 7) & 0x7f;
  const pr = (m >> 14) & 7;
  return squareName(from) + squareName(to) + (pr ? ' pnbrqk'[pr] : '');
}

/**
 * Πρόσθετοι έλεγχοι FEN που δεν κάνει το `setFen` (ανεκτικό για τις βάσεις): ένας βασιλιάς ανά
 * χρώμα, κανένα πιόνι στην 1η/8η γραμμή, ο παίκτης που δεν παίζει δεν είναι σε σαχ, όχι Chess960.
 * Ένα en passant που δεν ταιριάζει στη θέση σβήνεται. Επιστρέφει μήνυμα σφάλματος ή null.
 */
export function fenProblem(pos: Position, fen: string): string | null {
  const placement = fen.trim().split(/\s+/)[0] ?? '';
  let wk = 0;
  let bk = 0;
  for (const ch of placement) {
    if (ch === 'K') wk++;
    else if (ch === 'k') bk++;
  }
  if (wk !== 1 || bk !== 1) return 'πλήθος βασιλιάδων';
  const rows = placement.split('/');
  if (/[pP]/.test(rows[0] ?? '') || /[pP]/.test(rows[7] ?? '')) return 'πιόνι στην πρώτη/τελευταία γραμμή';
  if (pos.chess960) return 'Chess960';
  if (pos.isAttacked(pos.kingSq[pos.turn ^ 1], pos.turn)) return 'σαχ στον παίκτη που δεν παίζει';
  if (pos.ep >= 0) {
    const ep = pos.ep;
    const white = pos.turn === WHITE;
    const ok = white
      ? ep >> 4 === 5 && pos.board[ep] === 0 && pos.board[ep + 16] === 0 && pos.board[ep - 16] === (PAWN | 8)
      : ep >> 4 === 2 && pos.board[ep] === 0 && pos.board[ep - 16] === 0 && pos.board[ep + 16] === PAWN;
    if (!ok) {
      pos.ep = -1;
      pos.computeHash();
    }
  }
  return null;
}

/** FEN με μόνο τα δικαιώματα ροκέ της κλασικής διάταξης (βασιλιάς στο e, πύργος στη γωνία). */
export function standardCastling(fen: string): string {
  const t = fen.trim().split(/\s+/);
  const rows = (t[0] ?? '').split('/');
  const expand = (row: string) => row.replace(/\d/g, (d) => '.'.repeat(Number(d)));
  const r1 = expand(rows[7] ?? '');
  const r8 = expand(rows[0] ?? '');
  let c = '';
  if (r1[4] === 'K' && r1[7] === 'R' && /K/.test(t[2] ?? '')) c += 'K';
  if (r1[4] === 'K' && r1[0] === 'R' && /Q/.test(t[2] ?? '')) c += 'Q';
  if (r8[4] === 'k' && r8[7] === 'r' && /k/.test(t[2] ?? '')) c += 'k';
  if (r8[4] === 'k' && r8[0] === 'r' && /q/.test(t[2] ?? '')) c += 'q';
  t[2] = c || '-';
  return t.join(' ');
}

export type ValidationError = 'fen' | 'empty' | 'illegal' | 'notMate' | 'length';

export interface LineValidation {
  ok: boolean;
  error?: ValidationError;
  detail?: string;
  /** κωδικοί κινήσεων (όλης της γραμμής) */
  moves: number[];
  /** αν η τελική θέση είναι ματ */
  mate: boolean;
  /** αν ο λύτης παίζει με τα λευκά */
  solverWhite: boolean;
  /** η αρχική θέση (πριν από την πρώτη κίνηση) */
  start: Position | null;
}

export interface ValidateOptions {
  /** η πρώτη κίνηση είναι του αντιπάλου (μορφή Lichess) */
  pre?: boolean;
  /** η τελική θέση πρέπει να είναι ματ */
  requireMate?: boolean;
  /** δεκτές θέσεις χωρίς λύση (εξάσκηση με μηχανή) */
  allowEmpty?: boolean;
  /** θέση για επαναχρησιμοποίηση (μαζική επικύρωση χωρίς δεσμεύσεις μνήμης)· τότε δεν κρατιέται το `start` */
  pos?: Position;
  /** καλείται με την αρχική θέση, αφού ελεγχθεί το FEN και πριν από τις κινήσεις */
  onStart?: (pos: Position) => void;
}

/**
 * Επικύρωση γραμμής puzzle: σωστό FEN, κάθε κίνηση νόμιμη, και (`requireMate`) τελική θέση ματ.
 */
export function validateLine(fen: string, line: readonly string[], opts: ValidateOptions = {}): LineValidation {
  const out: LineValidation = { ok: false, moves: [], mate: false, solverWhite: true, start: null };
  const pos = opts.pos ?? new Position();
  try {
    pos.setFen(fen);
    // δικαιώματα ροκέ που δεν ταιριάζουν στην κλασική διάταξη (συλλογές): κρατούνται μόνο τα έγκυρα
    if (pos.chess960) pos.setFen(standardCastling(fen));
  } catch (e) {
    out.error = 'fen';
    out.detail = (e as Error).message;
    return out;
  }
  const bad = fenProblem(pos, fen);
  if (bad) {
    out.error = 'fen';
    out.detail = bad;
    return out;
  }
  if (!opts.pos) out.start = pos.clone();
  opts.onStart?.(pos);
  out.solverWhite = (pos.turn === WHITE) !== !!opts.pre;
  if (!line.length || (opts.pre && line.length < 2)) {
    if (opts.allowEmpty && !line.length) {
      out.ok = true;
      return out;
    }
    out.error = 'empty';
    return out;
  }
  for (let i = 0; i < line.length; i++) {
    const m = legalUci(pos, line[i]);
    if (!m) {
      out.error = 'illegal';
      out.detail = `${i + 1}: ${line[i]}`;
      return out;
    }
    out.moves.push(m);
    pos.makeMove(m);
  }
  out.mate = pos.inCheck() && !pos.hasLegalMove();
  if (opts.requireMate && !out.mate) {
    out.error = 'notMate';
    return out;
  }
  out.ok = true;
  return out;
}

// ---------------------------------------------------------------------------
// Έλεγχος απάντησης

export type AnswerResult = 'correct' | 'solved' | 'incorrect';

export interface AnswerCheck {
  result: AnswerResult;
  /** η κίνηση του λύτη σε SAN (κενό αν ήταν παράνομη) */
  san: string;
  /** η κίνηση του λύτη σε κλασικό UCI */
  uci: string;
  /** αν η κίνηση έκανε ματ (κάθε ματ λύνει το puzzle) */
  mate: boolean;
  /** απάντηση του αντιπάλου όταν η λύση συνεχίζει */
  reply?: string;
  replySan?: string;
  /** δείκτης (στη γραμμή) της επόμενης κίνησης του λύτη */
  next: number;
  /** η κίνηση της λύσης όταν η απάντηση ήταν λάθος */
  expected?: string;
  expectedSan?: string;
  /** FEN μετά την κίνηση του λύτη (και την απάντηση, αν υπάρχει) */
  fen: string;
  illegal?: boolean;
}

/** Θέση μετά από `count` κινήσεις της γραμμής (UCI). Πετά σφάλμα σε άκυρη κίνηση. */
export function positionAt(fen: string, line: readonly string[], count: number): Position {
  const pos = Position.fromFen(fen);
  for (let i = 0; i < count && i < line.length; i++) {
    const m = legalUci(pos, line[i]);
    if (!m) throw new Error(`Άκυρη κίνηση στη λύση: ${line[i]}`);
    pos.makeMove(m);
  }
  return pos;
}

/**
 * Ελέγχει την κίνηση `uci` του λύτη στη θέση μετά από `ply` κινήσεις της γραμμής.
 * Κανόνες του Lichess (moveTest.ts): οποιοδήποτε ματ λύνει το puzzle σε κάθε σημείο· το ροκέ
 * γίνεται δεκτό και ως «βασιλιάς παίρνει πύργο»· αλλιώς η κίνηση πρέπει να είναι αυτή της λύσης.
 */
export function checkAnswer(fen: string, line: readonly string[], ply: number, uci: string): AnswerCheck {
  const pos = positionAt(fen, line, ply);
  const m = legalUci(pos, uci);
  const sol = ply < line.length ? legalUci(pos, line[ply]) : 0;
  const expected = sol ? standardUci(sol) : undefined;
  const expectedSan = sol ? pos.san(sol) : undefined;
  if (!m) return { result: 'incorrect', san: '', uci, mate: false, next: ply, expected, expectedSan, fen: pos.fen(), illegal: true };
  const san = pos.san(m);
  pos.makeMove(m);
  const mate = pos.inCheck() && !pos.hasLegalMove();
  if (mate) return { result: 'solved', san, uci: standardUci(m), mate, next: ply + 1, fen: pos.fen() };
  if (m !== sol) return { result: 'incorrect', san, uci: standardUci(m), mate, next: ply, expected, expectedSan, fen: pos.fen() };
  if (ply + 1 >= line.length) return { result: 'solved', san, uci: standardUci(m), mate, next: ply + 1, fen: pos.fen() };
  const r = legalUci(pos, line[ply + 1]);
  if (!r) throw new Error(`Άκυρη κίνηση στη λύση: ${line[ply + 1]}`);
  const replySan = pos.san(r);
  pos.makeMove(r);
  // γραμμή που τελειώνει με κίνηση του αντιπάλου: λυμένο μετά την απάντηση
  const done = ply + 2 >= line.length;
  return { result: done ? 'solved' : 'correct', san, uci: standardUci(m), mate, reply: standardUci(r), replySan, next: ply + 2, fen: pos.fen() };
}

/** Γραμμή σε SAN (για εμφάνιση της λύσης). */
export function lineSan(fen: string, line: readonly string[]): string[] {
  const pos = Position.fromFen(fen);
  const out: string[] = [];
  for (const u of line) {
    const m = legalUci(pos, u);
    if (!m) break;
    out.push(pos.san(m));
    pos.makeMove(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Υποδείξεις

const PIECE_NAMES: Record<number, { el: string; en: string }> = {
  [PAWN]: { el: 'Πιόνι', en: 'Pawn' },
  [KNIGHT]: { el: 'Ίππος', en: 'Knight' },
  [BISHOP]: { el: 'Αξιωματικός', en: 'Bishop' },
  [ROOK]: { el: 'Πύργος', en: 'Rook' },
  [QUEEN]: { el: 'Βασίλισσα', en: 'Queen' },
  [KING]: { el: 'Βασιλιάς', en: 'King' },
};

export interface Hint {
  level: 1 | 2 | 3;
  /** κομμάτι που κινείται (γράμμα SAN και όνομα) */
  piece: { letter: string; el: string; en: string };
  /** τετράγωνο αφετηρίας */
  from: string;
  /** τετράγωνο προορισμού (από το επίπεδο 2) */
  to?: string;
  /** ολόκληρη η κίνηση (επίπεδο 3) */
  uci?: string;
  san?: string;
}

/** Κλίμακα υποδείξεων: 1 κομμάτι (και τετράγωνο αφετηρίας), 2 τετράγωνο προορισμού, 3 η κίνηση. */
export function hint(fen: string, line: readonly string[], ply: number, level: 1 | 2 | 3): Hint | null {
  if (ply >= line.length) return null;
  const pos = positionAt(fen, line, ply);
  const m = legalUci(pos, line[ply]);
  if (!m) return null;
  const from = m & 0x7f;
  const t = pos.board[from] & 7;
  const h: Hint = { level, piece: { letter: PIECE_LETTERS[t].trim() || 'P', ...PIECE_NAMES[t] }, from: squareName(from) };
  if (level >= 2) h.to = squareName((m >> 7) & 0x7f);
  if (level >= 3) {
    h.uci = standardUci(m);
    h.san = pos.san(m);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Τεστ (EPD): πολλές σωστές κινήσεις και βαθμοί ανά κίνηση (STS)

export interface TestGoal {
  kind: 'test';
  /** καλύτερες κινήσεις (UCI) */
  bm: string[];
  /** κινήσεις που πρέπει να αποφευχθούν */
  am?: string[];
  /** βαθμοί ανά κίνηση (STS: c8/c9), μέγιστο συνήθως 10 */
  points?: Record<string, number>;
}

/** Βαθμολογεί μια απάντηση σε θέση τεστ: σωστή αν είναι μία από τις bm (και όχι am)· βαθμοί STS αν υπάρχουν. */
export function scoreTestAnswer(fen: string, goal: TestGoal, uci: string): { correct: boolean; points: number; max: number; san: string } {
  const pos = Position.fromFen(fen);
  const m = legalUci(pos, uci);
  const same = (u: string) => {
    const x = legalUci(pos, u);
    return x !== 0 && x === m;
  };
  const max = goal.points ? Math.max(...Object.values(goal.points), 0) : 1;
  if (!m) return { correct: false, points: 0, max, san: '' };
  const san = pos.san(m);
  const avoided = (goal.am ?? []).some(same);
  const best = goal.bm.length ? goal.bm.some(same) : !avoided;
  let points = best && !avoided ? (goal.points ? max : 1) : 0;
  if (goal.points) for (const [u, p] of Object.entries(goal.points)) if (same(u)) points = p;
  return { correct: best && !avoided, points, max, san };
}

// ---------------------------------------------------------------------------
// Στόχοι εξάσκησης απέναντι στη μηχανή (Lichess Practice, PracticeGoal.scala)

export type PracticeGoal =
  | { kind: 'mate' }
  | { kind: 'mateIn'; moves: number }
  | { kind: 'drawIn'; moves: number }
  | { kind: 'equalIn'; moves: number }
  | { kind: 'evalIn'; cp: number; moves: number }
  | { kind: 'promotion'; cp: number }
  /** θέση χωρίς λύση: «παίξε την καλύτερη συνέχεια» (κρίνει η μηχανή) */
  | { kind: 'play'; result?: 'win' | 'draw' };

/** Διαβάζει τον στόχο από το [Termination] ενός κεφαλαίου Practice (προεπιλογή: ματ, όπως στο lila). */
export function parsePracticeGoal(text: string | undefined | null): PracticeGoal {
  const s = (text ?? '').trim().replace(/\s{2,}/g, ' ');
  let m: RegExpExecArray | null;
  if ((m = /^(?:check)?mate in (\d+)$/i.exec(s))) return { kind: 'mateIn', moves: Number(m[1]) };
  if (/^(?:check)?mate$/i.test(s)) return { kind: 'mate' };
  if ((m = /^draw in (\d+)$/i.exec(s))) return { kind: 'drawIn', moves: Number(m[1]) };
  if ((m = /^equal(?:ize)? in (\d+)$/i.exec(s))) return { kind: 'equalIn', moves: Number(m[1]) };
  if ((m = /^([+-]?\d+)cp in (\d+)$/i.exec(s))) return { kind: 'evalIn', cp: Number(m[1]), moves: Number(m[2]) };
  if ((m = /^promotion with ([+-]?\d+)cp$/i.exec(s))) return { kind: 'promotion', cp: Number(m[1]) };
  return { kind: 'mate' };
}

export interface PracticeState {
  /** κινήσεις του λύτη που έχουν παιχτεί */
  solverMoves: number;
  /** κατάσταση μετά την τελευταία κίνηση */
  status: 'ongoing' | 'checkmate' | 'stalemate' | 'draw';
  /** ποιος έκανε ματ (αν έγινε) */
  matedSolver?: boolean;
  /** αξιολόγηση από τη σκοπιά του λύτη (centipawns) ή ματ σε n (θετικό: υπέρ του λύτη) */
  cp?: number | null;
  mate?: number | null;
  /** αν η τελευταία κίνηση του λύτη ήταν προαγωγή */
  promoted?: boolean;
}

/** Πότε ένας στόχος εξάσκησης πέτυχε (true), απέτυχε (false) ή συνεχίζεται (null) — όπως το practiceSuccess του Lichess. */
export function practiceOutcome(goal: PracticeGoal, s: PracticeState): boolean | null {
  if (s.status === 'checkmate') return !s.matedSolver;
  const drawish = s.mate == null && s.cp != null && Math.abs(s.cp) < 150;
  const winning = (cp: number) => (s.mate != null ? s.mate > 0 : s.cp != null && s.cp >= cp);
  switch (goal.kind) {
    case 'mate':
      return s.status === 'stalemate' || s.status === 'draw' ? false : null;
    case 'mateIn':
      return s.solverMoves >= goal.moves || s.status !== 'ongoing' ? false : null;
    case 'drawIn':
    case 'equalIn':
      if (s.status === 'stalemate' || s.status === 'draw') return true;
      if (s.mate != null && s.mate < 0) return false;
      if (s.solverMoves >= goal.moves) return s.cp == null && s.mate == null ? null : drawish;
      return null;
    case 'evalIn':
      if (s.status !== 'ongoing') return false;
      return s.solverMoves >= goal.moves ? winning(goal.cp) : null;
    case 'promotion':
      if (!s.promoted) return null;
      return winning(goal.cp);
    case 'play':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Θέματα από τη θέση (για συλλογές χωρίς ετικέτες· κανόνες του lichess-puzzler/cook.py)

function pieceSet(pos: Position): { counts: Int32Array; minorsMajors: number } {
  const counts = new Int32Array(16);
  let mm = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = pos.board[sq];
    if (!p) continue;
    counts[p]++;
    const t = p & 7;
    if (t !== PAWN && t !== KING) mm++;
  }
  return { counts, minorsMajors: mm };
}

/** Φινάλε με μόνο ένα είδος κομματιού (εκτός βασιλιάδων και πιονιών). */
function pieceEndgame(pos: Position, t: number): boolean {
  const { counts } = pieceSet(pos);
  if (!counts[t] && !counts[t | 8]) return false;
  for (const x of [KNIGHT, BISHOP, ROOK, QUEEN]) if (x !== t && (counts[x] || counts[x | 8])) return false;
  return true;
}

function queenRookEndgame(pos: Position): boolean {
  const { counts } = pieceSet(pos);
  return counts[QUEEN] + counts[QUEEN | 8] === 1 && counts[ROOK] + counts[ROOK | 8] > 0 && !counts[KNIGHT] && !counts[KNIGHT | 8] && !counts[BISHOP] && !counts[BISHOP | 8];
}

/** Φάση της θέσης: φινάλε με ≤ 6 κομμάτια (χωρίς πιόνια/βασιλιάδες), άνοιγμα στις πρώτες 12 κινήσεις με σχεδόν όλα τα κομμάτια. */
export function phaseOf(pos: Position): 'opening' | 'middlegame' | 'endgame' {
  const { minorsMajors } = pieceSet(pos);
  if (minorsMajors <= 6) return 'endgame';
  if (pos.fullmove <= 12 && minorsMajors >= 12) return 'opening';
  return 'middlegame';
}

/**
 * Θέματα που βγαίνουν με βεβαιότητα από τη γραμμή: ματ/ματ σε N, μήκος, φάση, τύπος φινάλε,
 * ειδικές κινήσεις (ροκέ, en passant, προαγωγή, υποπροαγωγή), διπλό σαχ.
 * `moves`: κωδικοί κινήσεων από τη θέση `start`· `pre`: η πρώτη είναι του αντιπάλου.
 */
export function deriveThemes(start: Position, moves: readonly number[], pre: boolean): string[] {
  const tags = new Set<string>();
  const pos = start.clone();
  const solverMoves = pre ? Math.floor(moves.length / 2) : Math.ceil(moves.length / 2);
  const positions: Position[] = [];
  if (!pre) positions.push(pos.clone());
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const solver = pre ? i % 2 === 1 : i % 2 === 0;
    if (solver) {
      const t = pos.board[m & 0x7f] & 7;
      if (m & F_CASTLE) tags.add('castling');
      if (m & F_EP) tags.add('enPassant');
      const pr = (m >> 14) & 7;
      if (pr && t === PAWN) {
        tags.add('promotion');
        if (pr !== QUEEN) tags.add('underPromotion');
      }
    }
    pos.makeMove(m);
    if (solver && pos.checkers().length > 1) tags.add('doubleCheck');
    if (positions.length < 2) positions.push(pos.clone());
  }
  const mate = moves.length > 0 && pos.inCheck() && !pos.hasLegalMove();
  const lastBySolver = pre ? moves.length % 2 === 0 : moves.length % 2 === 1;
  if (mate && lastBySolver) {
    tags.add('mate');
    tags.add(`mateIn${Math.min(5, Math.max(1, solverMoves))}`);
  }
  if (solverMoves > 0) tags.add(solverMoves === 1 ? 'oneMove' : solverMoves === 2 ? 'short' : solverMoves >= 4 ? 'veryLong' : 'long');
  const ref = positions[0] ?? start;
  tags.add(phaseOf(ref));
  if (positions.length) {
    const both = (f: (p: Position) => boolean) => positions.every(f);
    if (both((p) => pieceEndgame(p, PAWN))) tags.add('pawnEndgame');
    else if (both((p) => pieceEndgame(p, QUEEN))) tags.add('queenEndgame');
    else if (both((p) => pieceEndgame(p, ROOK))) tags.add('rookEndgame');
    else if (both((p) => pieceEndgame(p, BISHOP))) tags.add('bishopEndgame');
    else if (both((p) => pieceEndgame(p, KNIGHT))) tags.add('knightEndgame');
    else if (both(queenRookEndgame)) tags.add('queenRookEndgame');
  }
  return [...tags];
}

/** Αριθμός κινήσεων του λύτη σε μια γραμμή. */
export function solverMoveCount(lineLength: number, pre: boolean): number {
  return pre ? Math.floor(lineLength / 2) : Math.ceil(lineLength / 2);
}

/** Χρώμα του λύτη από το FEN της αρχικής θέσης. */
export function solverColor(fen: string, pre: boolean): 'white' | 'black' {
  const black = /\sb(\s|$)/.test(fen);
  return black !== pre ? 'black' : 'white';
}

// ---------------------------------------------------------------------------
// Βαθμός επανάληψης (FSRS) από την προσπάθεια

/** 1 Again, 2 Hard, 3 Good, 4 Easy */
export type ReviewGrade = 1 | 2 | 3 | 4;

/**
 * Αντιστοίχιση προσπάθειας σε βαθμό FSRS (πρόταση της έρευνας): αποτυχία → Again· λύση με
 * υπόδειξη ή πιο αργή από 2× τον διάμεσο χρόνο → Hard· λύση → Good· λύση πιο γρήγορη από 0,5×
 * τον διάμεσο → Easy. `medianMs` null: χωρίς ιστορικό χρόνων (μόνο Again/Hard/Good).
 */
export function reviewGrade(a: { win: boolean; hints: number; ms: number; medianMs: number | null }): ReviewGrade {
  if (!a.win) return 1;
  const med = a.medianMs && a.medianMs > 0 ? a.medianMs : null;
  if (a.hints > 0 || (med !== null && a.ms > 2 * med)) return 2;
  if (med !== null && a.ms < 0.5 * med) return 4;
  return 3;
}

/** Το χρώμα (`white`/`black`) που παίζει στη θέση. */
export const turnOf = (pos: Position): 'white' | 'black' => (pos.turn === BLACK ? 'black' : 'white');
