/**
 * Συνεδρίες ανάλυσης (το «παράθυρο μηχανής» — μία ή περισσότερες μηχανές
 * ταυτόχρονα) και ανάλυση ολόκληρης παρτίδας (έλεγχος λαθών).
 */
import crypto from 'node:crypto';
import { UciEngine, type AnalysisUpdate, type EngineIdentity } from './engine.ts';
import { Position } from '../core/chess.ts';
import os from 'node:os';
import type { EngineConfig, Library } from './library.ts';
import { HttpError } from './library.ts';

interface Session {
  id: string;
  engineId: string;
  engine: UciEngine;
  starting: Promise<EngineIdentity> | null;
  /** αριθμός αιτήματος: οι παλιές αναλύσεις αγνοούνται */
  ticket: number;
}

export interface GameEval {
  ply: number;
  fen: string;
  cp: number | null;
  mate: number | null;
  depth: number;
  best: string[];
  bestUci: string[];
}

export interface GameAnalysisJob {
  id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  evals: GameEval[];
  error?: string;
  cancelled: boolean;
}

/**
 * Επιλογές για ουδέτερη αξιολόγηση. Το contempt του Stockfish (24 στο SF 11) δίνει
 * μπόνους στην πλευρά που παίζει, οπότε οι θέσεις με τα μαύρα να παίζουν έβγαιναν
 * ~0,5 χαμηλότερα. Όποια μηχανή δεν τις έχει τις αγνοεί· οι ρυθμίσεις του χρήστη
 * μπαίνουν μετά και υπερισχύουν.
 */
const ANALYSIS_OPTIONS: Record<string, string | boolean> = { UCI_AnalyseMode: true, 'Analysis Contempt': 'Off' };

/**
 * Η παρτίδα ως εδώ για τη μηχανή (για τις επαναλήψεις): μόνο αν οι κινήσεις είναι νόμιμες από την αρχική θέση
 * και καταλήγουν στη θέση που ζητήθηκε.
 */
export function validHistory(startFen: unknown, moves: unknown, fen: string): { startFen: string; moves: string[] } | undefined {
  if (typeof startFen !== 'string' || !Array.isArray(moves) || !moves.length || moves.length > 1000) return undefined;
  try {
    const p = Position.fromFen(startFen);
    for (const u of moves) {
      const m = typeof u === 'string' ? p.parseUci(u) : 0;
      if (!m) return undefined;
      p.makeMove(m);
    }
    const key = (f: string) => f.split(' ').slice(0, 3).join(' ');
    return key(p.fen()) === key(fen) ? { startFen, moves: moves as string[] } : undefined;
  } catch {
    return undefined;
  }
}

/** Μία πιθανή κίνηση «ανθρώπινης» μηχανής (Maia): η πιθανότητα από το policy του δικτύου. */
export interface HumanMove {
  uci: string;
  san: string;
  /** πιθανότητα 0..1 */
  p: number;
}

/**
 * Οι γραμμές VerboseMoveStats του Lc0 («e2e4  (322 ) N: 0 (+ 0) (P: 12.34%) …») ως κινήσεις με πιθανότητες,
 * η πιο πιθανή πρώτη. Το ροκέ μπορεί να γραφτεί «βασιλιάς πάνω στον πύργο» (e1h1)· η γραμμή της ρίζας και ό,τι
 * δεν είναι νόμιμη κίνηση αγνοούνται. Από το RealChessBase (Λάζαρος Μπατσής, GPL-3.0).
 */
export function parseVerboseStats(lines: string[], fen: string): HumanMove[] {
  const pos = Position.fromFen(fen);
  const seen = new Set<string>();
  const out: HumanMove[] = [];
  for (const line of lines) {
    const m = /^([a-h][1-8][a-h][1-8][qrbn]?)\s.*?\(P:\s*([\d.]+)\s*%\)/.exec(line.trim());
    if (!m) continue;
    const mv = pos.parseUci(m[1]);
    if (!mv) continue;
    const uci = pos.moveToUci(mv);
    if (seen.has(uci)) continue;
    seen.add(uci);
    out.push({ uci, san: pos.san(mv), p: Math.max(0, Math.min(1, Math.round(Number(m[2]) * 100) / 10000)) });
  }
  return out.sort((a, b) => b.p - a.p);
}

export class AnalysisManager {
  private sessions = new Map<string, Session>();
  /** κάθε start/stop ανά session: ένα start που περιμένει την εκκίνηση της μηχανής δεν προσπερνά νεότερο stop/start */
  private seq = new Map<string, number>();
  private bump(sessionId: string): number {
    const n = (this.seq.get(sessionId) ?? 0) + 1;
    this.seq.set(sessionId, n);
    return n;
  }
  readonly jobs = new Map<string, GameAnalysisJob>();
  onUpdate: (sessionId: string, update: AnalysisUpdate & { engine: string }) => void = () => {};
  onJob: (job: GameAnalysisJob) => void = () => {};
  private configs: () => EngineConfig[];

  constructor(configs: () => EngineConfig[]) {
    this.configs = configs;
  }

  private config(engineId: string): EngineConfig {
    const c = this.configs().find((e) => e.id === engineId);
    if (!c) throw new HttpError(404, 'Δεν βρέθηκε η μηχανή — πρόσθεσε μία από τις Ρυθμίσεις → Μηχανές');
    return c;
  }

  private async session(sessionId: string, engineId: string): Promise<Session> {
    let s = this.sessions.get(sessionId);
    if (s && (s.engineId !== engineId || s.engine.exited)) {
      s.engine.quit();
      this.sessions.delete(sessionId);
      s = undefined;
    }
    if (!s) {
      const cfg = this.config(engineId);
      const engine = new UciEngine(cfg.path, cfg.args);
      s = { id: sessionId, engineId, engine, starting: null, ticket: 0 };
      this.sessions.set(sessionId, s);
      s.starting = engine.start().then((idn) => {
        for (const [k, v] of Object.entries({ ...ANALYSIS_OPTIONS, ...(cfg.options ?? {}) })) engine.setOption(k, v);
        return idn;
      });
    }
    if (s.starting) await s.starting;
    return s;
  }

  /** Ξεκινά (ή αλλάζει θέση σε) άπειρη ανάλυση. */
  async start(sessionId: string, engineId: string, fen: string, multipv: number): Promise<{ engine: string }> {
    const my = this.bump(sessionId);
    const s = await this.session(sessionId, engineId);
    const name = s.engine.identity.name;
    if (this.seq.get(sessionId) !== my) return { engine: name };
    const ticket = ++s.ticket;
    void s.engine
      .analyse(fen, { infinite: true }, Math.max(1, Math.min(10, multipv)), (u) => {
        if (ticket === s.ticket) this.onUpdate(sessionId, { ...u, engine: name });
      })
      .catch(() => {});
    return { engine: name };
  }

  async stop(sessionId: string): Promise<void> {
    this.bump(sessionId);
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.ticket++;
    await s.engine.stop();
  }

  close(sessionId: string): void {
    this.seq.delete(sessionId);
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.engine.quit();
    this.sessions.delete(sessionId);
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
    for (const p of this.pool.values()) {
      clearTimeout(p.idle);
      p.engine.quit();
    }
    this.pool.clear();
  }

  /**
   * Μόνιμες μηχανές για τις σύντομες αναζητήσεις (παιχνίδι, έλεγχος ασκήσεων): χωρίς
   * νέα εκκίνηση (~0,2 δευτ.) σε κάθε κίνηση. Μία ανά μηχανή και χρήση, μία αναζήτηση
   * τη φορά· κλείνουν μετά από ένα λεπτό αδράνειας.
   */
  private pool = new Map<string, { engine: UciEngine; ready: Promise<void>; queue: Promise<unknown>; idle?: NodeJS.Timeout }>();

  /** Μία σύντομη ανάλυση (π.χ. για εκτίμηση θέσης)· με `play` (παιχνίδι με μηχανή) χωρίς τις επιλογές ανάλυσης· `multipv` γραμμές· όριο σε χρόνο (ms) ή κόμβους / βάθος. */
  async evaluate(
    engineId: string,
    fen: string,
    limits: number | { movetime?: number; depth?: number; nodes?: number },
    extra: Record<string, string | number> = {},
    play = false,
    multipv = 1,
    history?: { startFen: string; moves: string[] },
    /** κάθε γραμμή της μηχανής όσο ψάχνει (π.χ. τα στατιστικά κινήσεων του Lc0) */
    onLine?: (line: string) => void,
  ): Promise<AnalysisUpdate> {
    const search = typeof limits === 'number' ? { movetime: limits } : limits;
    const cfg = this.config(engineId);
    const key = `${engineId}:${play ? 'play' : 'eval'}`;
    let p = this.pool.get(key);
    if (p?.engine.exited) {
      this.pool.delete(key);
      p = undefined;
    }
    if (!p) {
      const engine = new UciEngine(cfg.path, cfg.args);
      const ready = engine.start().then(() => {
        for (const [k, v] of Object.entries({ ...(play ? {} : ANALYSIS_OPTIONS), ...(cfg.options ?? {}) })) engine.setOption(k, v);
      });
      p = { engine, ready, queue: Promise.resolve() };
      this.pool.set(key, p);
      ready.catch(() => {
        if (this.pool.get(key)?.engine === engine) this.pool.delete(key);
      });
    }
    const entry = p;
    clearTimeout(entry.idle);
    const run = async () => {
      await entry.ready;
      // η μηχανή κρατά τις επιλογές: η δύναμη ορίζεται ξανά σε κάθε κίνηση
      const strength = play ? { 'Skill Level': 20, UCI_LimitStrength: 'false', ...extra } : extra;
      for (const [k, v] of Object.entries(strength)) entry.engine.setOption(k, v);
      const off = onLine ? entry.engine.onLine(onLine) : null;
      try {
        return await entry.engine.analyse(fen, search, multipv, () => {}, 150, history);
      } finally {
        off?.();
      }
    };
    const result = entry.queue.then(run, run);
    entry.queue = result.catch(() => {});
    try {
      return await result;
    } finally {
      clearTimeout(entry.idle);
      entry.idle = setTimeout(() => {
        entry.engine.quit();
        if (this.pool.get(key) === entry) this.pool.delete(key);
      }, 60_000);
      entry.idle.unref();
    }
  }

  /**
   * «Τι θα έπαιζε ένας άνθρωπος;» (Maia): ένας κόμβος (`go nodes 1`) με τα στατιστικά κινήσεων του Lc0, και οι
   * κινήσεις με τις πιθανότητές τους από το policy του δικτύου. Από το RealChessBase (Λάζαρος Μπατσής, GPL-3.0).
   */
  async humanMoves(engineId: string, fen: string, history?: { startFen: string; moves: string[] }): Promise<{ moves: HumanMove[]; bestmove?: string }> {
    const stats: string[] = [];
    const u = await this.evaluate(engineId, fen, { nodes: 1 }, { VerboseMoveStats: 'true' }, true, 1, history, (l) => {
      if (l.startsWith('info string ')) stats.push(l.slice(12));
    });
    const moves = parseVerboseStats(stats, fen);
    // χωρίς στατιστικά (άλλη μηχανή): τουλάχιστον η κίνηση που διάλεξε
    if (!moves.length && u.bestmove) {
      const pos = Position.fromFen(fen);
      const m = pos.parseUci(u.bestmove);
      if (m) moves.push({ uci: pos.moveToUci(m), san: pos.san(m), p: 1 });
    }
    return { moves, bestmove: u.bestmove };
  }

  /** Ανάλυση όλων των θέσεων της κύριας γραμμής (για έλεγχο λαθών / γράφημα). */
  analyzeGame(engineId: string, fens: string[], movetime: number, multipv = 1): GameAnalysisJob {
    const cfg = this.config(engineId);
    const job: GameAnalysisJob = { id: crypto.randomUUID(), status: 'running', done: 0, total: fens.length, evals: [], cancelled: false };
    this.jobs.set(job.id, job);
    const run = async () => {
      const engine = new UciEngine(cfg.path, cfg.args);
      try {
        await engine.start();
        for (const [k, v] of Object.entries({ ...ANALYSIS_OPTIONS, ...(cfg.options ?? {}) })) engine.setOption(k, v);
        for (let i = 0; i < fens.length; i++) {
          if (job.cancelled) {
            job.status = 'cancelled';
            break;
          }
          const u = await engine.analyse(fens[i], { movetime }, multipv, () => {});
          const top = u.lines[0];
          job.evals.push({
            ply: i,
            fen: fens[i],
            cp: top?.cp ?? null,
            mate: top?.mate ?? null,
            depth: top?.depth ?? 0,
            best: top?.san ?? [],
            bestUci: top?.uci ?? [],
          });
          job.done = i + 1;
          this.onJob(job);
        }
        if (job.status === 'running') job.status = 'done';
      } catch (e) {
        job.status = 'error';
        job.error = (e as Error).message;
      } finally {
        engine.quit();
      }
      this.onJob(job);
    };
    void run();
    return job;
  }

  cancelJob(id: string): void {
    const j = this.jobs.get(id);
    if (j) j.cancelled = true;
  }
}

/**
 * Threads / Hash ανάλογα με τον υπολογιστή (και για αδύναμα laptop): οι μισοί πυρήνες, και Hash ως 1/16 της μνήμης
 * (4 GB → 256 MB), ώστε η ανάλυση να μη «βαραίνει» το παράθυρο και τον server.
 */
export function engineLoad(maxThreads = 64, maxHash = 512): { Threads: number; Hash: number } {
  return {
    Threads: Math.max(1, Math.min(maxThreads, Math.floor(os.cpus().length / 2))),
    Hash: Math.max(16, Math.min(maxHash, 512, Math.floor(os.totalmem() / 16 / 2 ** 20))),
  };
}

/**
 * Προσθήκη μηχανής στις ρυθμίσεις με λογικά Threads / Hash. Με σταθερό `id` (π.χ. το Stockfish
 * που κατεβάζει η εφαρμογή) αντικαθιστά την προηγούμενη έκδοση αντί να προσθέτει δεύτερη.
 */
export async function addEngine(lib: Library, exe: string, opts: { id?: string; makeDefault?: boolean } = {}): Promise<{ engine: EngineConfig; identity: EngineIdentity }> {
  const identity = await probeEngine(exe);
  const threads = identity.options.find((o) => o.name === 'Threads');
  const hash = identity.options.find((o) => o.name === 'Hash');
  const options: Record<string, number> = {};
  const load = engineLoad(threads?.max ?? 1, hash?.max ?? 256);
  if (threads) options.Threads = load.Threads;
  if (hash) options.Hash = load.Hash;
  const engine: EngineConfig = { id: opts.id ?? crypto.randomUUID().slice(0, 8), name: identity.name, path: exe, options };
  const engines = [...lib.settings.engines.filter((e) => e.id !== engine.id), engine];
  lib.saveSettings({ engines, defaultEngine: opts.makeDefault ? engine.id : (lib.settings.defaultEngine ?? engine.id) });
  return { engine, identity };
}

/** Ανιχνεύει όνομα/επιλογές μιας μηχανής. */
export async function probeEngine(exe: string, args: string[] = []): Promise<EngineIdentity> {
  const e = new UciEngine(exe, args);
  try {
    return await e.start();
  } finally {
    e.quit();
  }
}
