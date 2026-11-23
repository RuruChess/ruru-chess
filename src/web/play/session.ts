/**
 * Παιχνίδι με bot: ρυθμίσεις, η κίνηση του bot (βιβλίο από τη βάση αναφοράς ή μηχανή με προσωπικότητα),
 * βοήθειες και αποτέλεσμα. Από το RealChessBase (Λάζαρος Μπατσής, GPL-3.0), προσαρμοσμένο στο Ruru.
 */
import { Position, START_FEN } from '../../core/chess.ts';
import { api, type PvLine, type TreeMoveInfo } from '../api.ts';
import { L } from '../i18n.ts';
import { deadLine } from '../../core/pressure.ts';
import { avoidRepetition, chooseBotMove, keepAlive, lineScore, pickBookMove, repetitionKey, sampleHuman, thinkMs, thinkStyle, type BotSpec, type GameOutcome, type ThinkContext } from './bots.ts';

export interface PlayHints {
  /** βέλος με την καλύτερη κίνηση */
  best: boolean;
  /** βέλος με την απειλή του αντιπάλου */
  threat: boolean;
  /** μπάρα αξιολόγησης */
  evalBar: boolean;
}

export const NO_HINTS: PlayHints = { best: false, threat: false, evalBar: false };

export interface PlaySettings {
  color: 'white' | 'black';
  bot: BotSpec;
  /** η μηχανή ('' = η προεπιλογή) */
  engineId: string;
  /** ρολόι σε δευτερόλεπτα (βάση + προσαύξηση)· χωρίς ρολόι το bot σκέφτεται τον χρόνο του */
  clock: { base: number; inc: number } | null;
  hints: PlayHints;
  /**
   * «Με κίνητρο» (Παίξε τη θέση): η μηχανή στο φουλ διαλέγει από τις ισάξιες κινήσεις αυτή που δυσκολεύει
   * περισσότερο τον αντίπαλο (`/api/engine/pressure`), και κανένα bot δεν απλουστεύει σε νεκρή ισοπαλία.
   */
  pressure?: boolean;
}

export type EndReason = 'checkmate' | 'stalemate' | 'insufficient' | 'repetition' | 'fifty' | 'resign' | 'agreement' | 'flag';

export interface PlayResult {
  /** «1-0», «0-1», «1/2-1/2» */
  result: string;
  reason: EndReason;
  outcome: GameOutcome;
  /** ημικινήσεις που παίχτηκαν */
  plies: number;
  takebacks: number;
  /** κινήσεις του χρήστη με ανοιχτές βοήθειες */
  hinted: number;
  /** πέτυχε τον στόχο της θέσης (null: παρτίδα χωρίς στόχο) */
  success: boolean | null;
  /** κινήσεις που έχασαν τον στόχο (με τον έλεγχο κάθε κίνησης) */
  mistakes: number;
}

/** Το αποτέλεσμα σε λέξεις («Ματ», «Εγκατάλειψη»…). */
export function reasonText(r: EndReason, loserIsUser: boolean): string {
  switch (r) {
    case 'checkmate':
      return L('Ματ', 'Checkmate');
    case 'stalemate':
      return L('Πατ', 'Stalemate');
    case 'insufficient':
      return L('Ανεπαρκές υλικό', 'Insufficient material');
    case 'repetition':
      return L('Τριπλή επανάληψη', 'Threefold repetition');
    case 'fifty':
      return L('Κανόνας των 50 κινήσεων', 'Fifty-move rule');
    case 'resign':
      return loserIsUser ? L('Εγκατέλειψες', 'You resigned') : L('Το bot εγκατέλειψε', 'The bot resigned');
    case 'agreement':
      return L('Ισοπαλία με συμφωνία', 'Draw by agreement');
    case 'flag':
      return loserIsUser ? L('Έπεσε η σημαία σου', 'Your flag fell') : L('Έπεσε η σημαία του bot', 'The bot’s flag fell');
  }
}

export interface BotMoveContext {
  fen: string;
  /** η αρχική θέση της παρτίδας και οι κινήσεις (UCI) ως εδώ, για το δέντρο */
  startFen: string;
  moves: string[];
  /** βάση για το «βιβλίο» του bot */
  refDb: string | null;
  /** χρόνος σκέψης (ms), από το ρολόι ή το bot */
  movetime: number;
  /** όλες οι θέσεις της παρτίδας ως εδώ (FEN), για την αποφυγή επανάληψης */
  fens?: string[];
  /** η αξιολόγηση της προηγούμενης κίνησης του bot (για τον χρόνο σκέψης) */
  prevScore?: number | null;
  /** με ρολόι: ο χρόνος που μένει στο bot και η προσαύξηση (ms) */
  clock?: { left: number; inc: number };
}

export interface BotMove {
  uci: string | null;
  /** αξιολόγηση από την πλευρά του bot (εκατοστά), αν υπάρχει */
  score: number | null;
  source: 'book' | 'engine' | 'blunder';
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Μια τυχαία νόμιμη κίνηση (το «χοντρό λάθος» των αδύναμων bots). */
function randomMove(fen: string, rng: () => number = Math.random): string | null {
  const p = Position.fromFen(fen);
  const moves = p.legalMoves();
  if (!moves.length) return null;
  return p.moveToUci(moves[Math.floor(rng() * moves.length)]);
}

/**
 * Η κίνηση του bot: στις πρώτες ημικινήσεις από το δέντρο της βάσης αναφοράς (αν υπάρχει και η παρτίδα
 * ξεκινά από την αρχική θέση), αλλιώς μηχανή με πολλές γραμμές και το στυλ του bot· τα αδύναμα bots κάνουν
 * καμιά φορά και μια τυχαία κίνηση. Παίζει με ανθρώπινο ρυθμό: περιμένει όσο θα σκεφτόταν ο χαρακτήρας του
 * σε αυτή τη θέση (`thinkMs`).
 */
export async function requestBotMove(s: PlaySettings, ctx: BotMoveContext): Promise<BotMove> {
  const bot = s.bot;
  const pos = Position.fromFen(ctx.fen);
  const whiteToMove = pos.turn === 0;
  const started = Date.now();
  const pieces = (f: string) => f.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
  const prevFen = ctx.fens && ctx.fens.length >= 2 ? ctx.fens[ctx.fens.length - 2] : null;
  const lastTo = ctx.moves.length ? ctx.moves[ctx.moves.length - 1].slice(2, 4) : '';
  const captured = Boolean(prevFen && pieces(prevFen) > pieces(ctx.fen));
  // ο ανθρώπινος ρυθμός: η κίνηση φεύγει όταν περάσει ο χρόνος σκέψης του χαρακτήρα (μαζί με της μηχανής)
  const pace = async (uci: string | null, extra: Partial<ThinkContext> = {}) => {
    const ms = thinkMs(thinkStyle(bot), {
      legal: pos.legalMoves().length,
      ply: ctx.moves.length,
      inCheck: pos.inCheck(),
      recapture: captured && Boolean(uci) && uci!.slice(2, 4) === lastTo,
      prevScore: ctx.prevScore ?? null,
      clock: ctx.clock,
      ...extra,
    });
    await wait(Math.max(0, ms - (Date.now() - started)));
  };
  const history = ctx.moves.length ? { startFen: ctx.startFen, moves: ctx.moves } : {};
  // Maia: οι πιθανότητες του δικτύου (ένας κόμβος) και μια «ανθρώπινη» επιλογή ανάμεσά τους
  if (bot.kind === 'maia') {
    const r = await api.post<{ moves: Array<{ uci: string; p: number }>; bestmove?: string }>('/api/engine/human', { elo: bot.maiaElo, fen: ctx.fen, ...history });
    const uci = sampleHuman(r.moves) ?? r.bestmove ?? null;
    await pace(uci);
    return { uci, score: null, source: 'engine' };
  }
  if (bot.book > 0 && ctx.refDb && ctx.startFen === START_FEN && ctx.moves.length < bot.book) {
    try {
      const tree = await api.post<{ indexed: boolean; moves: TreeMoveInfo[] }>(`/api/db/${encodeURIComponent(ctx.refDb)}/tree`, { fen: ctx.fen });
      const uci = tree.indexed ? pickBookMove(tree.moves, bot.style) : null;
      if (uci && pos.parseUci(uci)) {
        await pace(uci, { book: true });
        return { uci, score: null, source: 'book' };
      }
    } catch {
      // χωρίς βιβλίο: παίζει η μηχανή
    }
  }
  if (bot.blunder > 0 && Math.random() < bot.blunder) {
    const uci = randomMove(ctx.fen);
    if (uci) {
      await pace(uci);
      return { uci, score: null, source: 'blunder' };
    }
  }
  const strength = bot.strength.elo ? { elo: bot.strength.elo } : bot.strength.skill !== undefined ? { skill: bot.strength.skill } : {};
  // με κίνητρο: η μηχανή στο φουλ στριμώχνει τον αντίπαλο αντί να παίζει την πρώτη από πολλές ισάξιες κινήσεις
  if (s.pressure && (bot.kind ?? 'engine') === 'engine' && !Object.keys(strength).length && !bot.nodes) {
    const r = await api.post<{ bestmove: string | null; score: number | null; ranked: Array<{ score: number }> }>('/api/engine/pressure', {
      engineId: s.engineId || undefined,
      fen: ctx.fen,
      movetime: Math.max(ctx.movetime, 2000),
      ...history,
    });
    await pace(r.bestmove, { scores: r.ranked.map((x) => x.score).sort((a, b) => b - a) });
    return { uci: r.bestmove, score: r.score, source: 'engine' };
  }
  const limits = bot.nodes ? { nodes: bot.nodes } : { movetime: ctx.movetime };
  // με ιστορικό: τουλάχιστον 4 γραμμές, για να υπάρχουν εναλλακτικές όταν η πρώτη κίνηση ξαναφέρνει θέση
  const varied = (ctx.fens?.length ?? 0) > 1;
  const multipv = varied ? Math.max(bot.multipv, 4) : bot.multipv;
  const r = await api.post<{ bestmove?: string; line: PvLine | null; lines?: PvLine[] }>('/api/engine/move', {
    engineId: s.engineId || undefined,
    fen: ctx.fen,
    multipv,
    ...limits,
    ...strength,
    // η μηχανή βλέπει την παρτίδα, άρα και τις επαναλήψεις
    ...history,
    // η Leela παίζει με τις επιλογές παιχνιδιού (contempt), όχι ανάλυσης
    ...(bot.kind === 'leela' ? { play: true } : {}),
  });
  let lines = r.lines ?? (r.line ? [r.line] : []);
  // με κίνητρο: όχι γραμμές που καταλήγουν αμέσως σε νεκρή ισοπαλία, όσο το bot έχει κάτι να παίξει
  if (s.pressure) lines = keepAlive(ctx.fen, lines, whiteToMove);
  const picked = bot.multipv > 1 ? chooseBotMove(lines, bot, whiteToMove) : null;
  let uci = picked ?? r.bestmove ?? null;
  if (varied && lines.length > 1 && ctx.fens) {
    const seen = new Map<string, number>();
    for (const f of ctx.fens) seen.set(repetitionKey(f), (seen.get(repetitionKey(f)) ?? 0) + 1);
    const after = (u: string) => {
      const p = Position.fromFen(ctx.fen);
      const m = p.parseUci(u);
      if (!m) return -1;
      p.makeMove(m);
      return seen.get(repetitionKey(p.fen())) ?? 0;
    };
    const cands = lines
      .filter((l) => l.uci.length)
      .map((l) => ({ uci: l.uci[0], score: lineScore(l, whiteToMove), seen: after(l.uci[0]), dead: deadLine(ctx.fen, l.uci) }))
      .filter((c) => c.seen >= 0);
    // ανοχή: οι δυνατοί σχεδόν μόνο ισοδύναμες κινήσεις, τα πιο αδύναμα bots λίγο πιο πλατιά
    const alt = avoidRepetition(cands, Math.max(12, Math.min(40, bot.window / 2)));
    const pickedSeen = uci ? (cands.find((c) => c.uci === uci)?.seen ?? 0) : 0;
    // η επιλογή του στυλ μένει, εκτός αν ξαναφέρνει θέση ή αν η θέση είναι «επίπεδη» για την πλήρη μηχανή
    if (alt && (pickedSeen > 0 || bot.multipv === 1)) uci = alt;
  }
  const line = lines.find((l) => l.uci[0] === uci) ?? lines[0];
  // η μηχανή απαντά συχνά αμέσως (όριο κόμβων): ο χαρακτήρας «σκέφτεται» όσο θα σκεφτόταν άνθρωπος
  await pace(uci, { scores: lines.map((l) => lineScore(l, whiteToMove)).sort((a, b) => b - a) });
  return { uci, score: line ? lineScore(line, whiteToMove) : null, source: 'engine' };
}

/** Η θέση με τον αντίπαλο να ξαναπαίζει (για την «απειλή»)· null αν η πλευρά που παίζει είναι σε σαχ. */
export function threatFen(fen: string): string | null {
  try {
    const p = Position.fromFen(fen);
    if (p.inCheck()) return null;
    const parts = p.fen().split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-';
    const out = parts.join(' ');
    Position.fromFen(out);
    return out;
  } catch {
    return null;
  }
}

/** Χρόνος σκέψης του bot με ρολόι: λίγο από τον χρόνο που του μένει, συν την προσαύξηση. */
export function clockMovetime(leftMs: number, incMs: number, own: number): number {
  return Math.round(Math.max(100, Math.min(own * 1.5, leftMs * 0.3, leftMs / 30 + incMs * 0.8)));
}
