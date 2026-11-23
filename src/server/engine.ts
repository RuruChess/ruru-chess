/**
 * Μηχανές UCI (π.χ. Stockfish): εκκίνηση, επιλογές, ανάλυση με πολλές γραμμές
 * (MultiPV), μετατροπή των γραμμών σε SAN και ανάλυση ολόκληρης παρτίδας.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Position } from '../core/chess.ts';

export interface UciOption {
  name: string;
  type: string;
  default?: string;
  min?: number;
  max?: number;
  vars?: string[];
}

export interface EngineIdentity {
  name: string;
  author: string;
  options: UciOption[];
}

export interface PvLine {
  multipv: number;
  depth: number;
  seldepth: number;
  /** αξιολόγηση από την πλευρά των λευκών, σε εκατοστά πιονιού */
  cp: number | null;
  /** ματ σε n (θετικό: κερδίζουν τα λευκά) */
  mate: number | null;
  bound: '' | 'lower' | 'upper';
  nodes: number;
  nps: number;
  time: number;
  tbhits: number;
  uci: string[];
  san: string[];
}

export interface AnalysisUpdate {
  fen: string;
  lines: PvLine[];
  depth: number;
  nodes: number;
  nps: number;
  hashfull: number;
  done: boolean;
  bestmove?: string;
}

function parseOption(line: string): UciOption | null {
  const m = /^option name (.+?) type (\w+)(.*)$/.exec(line);
  if (!m) return null;
  const opt: UciOption = { name: m[1], type: m[2] };
  const rest = m[3];
  const def = /\bdefault ?(.*?)(?= min | max | var |$)/.exec(rest);
  if (def) opt.default = def[1].trim();
  const min = /\bmin (-?\d+)/.exec(rest);
  if (min) opt.min = Number(min[1]);
  const max = /\bmax (-?\d+)/.exec(rest);
  if (max) opt.max = Number(max[1]);
  const vars = [...rest.matchAll(/\bvar (.+?)(?= var |$)/g)].map((v) => v[1].trim());
  if (vars.length) opt.vars = vars;
  return opt;
}

/** Μία διεργασία μηχανής UCI. */
export class UciEngine {
  readonly exe: string;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private listeners = new Set<(line: string) => void>();
  identity: EngineIdentity = { name: '', author: '', options: [] };
  private searching = false;
  private stopWaiters: Array<() => void> = [];
  /** αυξάνεται σε κάθε stop() και analyse(): μια analyse που περιμένει ακόμα δεν στέλνει «go» μετά από αυτά */
  private gen = 0;
  exited = false;
  /** ορίσματα γραμμής εντολών (π.χ. Lc0: --weights=…, ώστε τα βάρη να υπάρχουν πριν από το isready) */
  readonly args: string[];

  constructor(exe: string, args: string[] = []) {
    this.exe = exe;
    this.args = args;
  }

  /** Κάθε γραμμή της μηχανής (π.χ. τα «info string» του Lc0)· επιστρέφει τη συνάρτηση που σταματά την ακρόαση. */
  onLine(fn: (line: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start(): Promise<EngineIdentity> {
    if (!fs.existsSync(this.exe)) throw new Error(`Δεν βρέθηκε η μηχανή: ${this.exe}`);
    const proc = spawn(this.exe, this.args, { cwd: path.dirname(this.exe), windowsHide: true });
    this.proc = proc;
    proc.on('exit', () => {
      this.exited = true;
      this.searching = false;
      for (const w of this.stopWaiters.splice(0)) w();
    });
    proc.on('error', () => {
      this.exited = true;
    });
    proc.stdin.on('error', () => {});
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      if (line.startsWith('bestmove')) {
        this.searching = false;
        for (const w of this.stopWaiters.splice(0)) w();
      }
      for (const l of this.listeners) l(line);
    });
    const id: EngineIdentity = { name: path.basename(this.exe, '.exe'), author: '', options: [] };
    await this.request('uci', (line) => {
      if (line.startsWith('id name ')) id.name = line.slice(8).trim();
      else if (line.startsWith('id author ')) id.author = line.slice(10).trim();
      else if (line.startsWith('option ')) {
        const o = parseOption(line);
        if (o) id.options.push(o);
      }
      return line === 'uciok';
    }, 10000);
    this.identity = id;
    await this.ready();
    return id;
  }

  private send(cmd: string): void {
    if (this.proc && !this.exited) this.proc.stdin.write(cmd + '\n');
  }

  private request(cmd: string, until: (line: string) => boolean, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(l);
        reject(new Error(`Η μηχανή δεν απάντησε στο «${cmd}»`));
      }, timeout);
      const l = (line: string) => {
        if (until(line)) {
          clearTimeout(timer);
          this.listeners.delete(l);
          resolve();
        }
      };
      this.listeners.add(l);
      this.send(cmd);
    });
  }

  ready(): Promise<void> {
    return this.request('isready', (l) => l === 'readyok', 30000);
  }

  setOption(name: string, value: string | number | boolean): void {
    const opt = this.identity.options.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (!opt) return;
    if (opt.type === 'button') this.send(`setoption name ${opt.name}`);
    else this.send(`setoption name ${opt.name} value ${value}`);
  }

  async stop(): Promise<void> {
    this.gen++;
    await this.halt();
  }

  private async halt(): Promise<void> {
    if (!this.searching) return;
    const done = new Promise<void>((r) => this.stopWaiters.push(r));
    this.send('stop');
    await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
    this.searching = false;
  }

  /**
   * Ανάλυση θέσης. Το onUpdate καλείται (με περιορισμό συχνότητας) με όλες τις
   * γραμμές· επιστρέφει όταν τελειώσει η αναζήτηση.
   */
  async analyse(
    fen: string,
    limits: { infinite?: boolean; movetime?: number; depth?: number; nodes?: number },
    multipv: number,
    onUpdate: (u: AnalysisUpdate) => void,
    throttleMs = 150,
    /** η παρτίδα ως εδώ (αρχική θέση και κινήσεις UCI): η μηχανή βλέπει τις επαναλήψεις */
    history?: { startFen: string; moves: string[] },
  ): Promise<AnalysisUpdate> {
    const gen = ++this.gen;
    await this.halt();
    const pos = Position.fromFen(fen);
    const whiteToMove = pos.turn === 0;
    const lines = new Map<number, PvLine>();
    let hashfull = 0;
    let last = 0;
    let pending: NodeJS.Timeout | null = null;
    const snapshot = (done: boolean, bestmove?: string): AnalysisUpdate => {
      const ls = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
      const top = ls[0];
      return { fen, lines: ls, depth: top?.depth ?? 0, nodes: top?.nodes ?? 0, nps: top?.nps ?? 0, hashfull, done, bestmove };
    };
    const emit = () => {
      pending = null;
      last = Date.now();
      onUpdate(snapshot(false));
    };
    this.setOption('MultiPV', multipv);
    await this.ready();
    // ενδιάμεσα ήρθε stop() ή νεότερη analyse (π.χ. «Στάση» ενώ άλλαζε η θέση): χωρίς «go», αλλιώς η μηχανή τρέχει αθέατη
    if (gen !== this.gen) return snapshot(true);
    // Chess960: η μηχανή θέλει X-FEN και δίνει το ροκέ ως «βασιλιάς πάνω στον πύργο»
    this.setOption('UCI_Chess960', pos.chess960);
    this.send(history?.moves.length ? `position fen ${history.startFen} moves ${history.moves.join(' ')}` : `position fen ${fen}`);
    let resolveDone!: (u: AnalysisUpdate) => void;
    const done = new Promise<AnalysisUpdate>((r) => (resolveDone = r));
    const listener = (line: string) => {
      if (line.startsWith('info ') && line.includes(' pv ')) {
        const pv = parseInfo(line, pos, whiteToMove);
        if (!pv) return;
        if (pv.bound && lines.has(pv.multipv)) return;
        lines.set(pv.multipv, pv);
        // όταν αλλάζει το βάθος, οι γραμμές με μεγαλύτερο multipv είναι παλιές· κρατιούνται ως έχουν
        if (Date.now() - last > throttleMs) emit();
        else if (!pending) pending = setTimeout(emit, throttleMs);
      } else if (line.startsWith('info ')) {
        const h = /\bhashfull (\d+)/.exec(line);
        if (h) hashfull = Number(h[1]);
      } else if (line.startsWith('bestmove')) {
        if (pending) clearTimeout(pending);
        this.listeners.delete(listener);
        const u = snapshot(true, line.split(/\s+/)[1]);
        onUpdate(u);
        resolveDone(u);
      }
    };
    this.listeners.add(listener);
    let go = 'go';
    if (limits.infinite) go += ' infinite';
    else {
      if (limits.movetime) go += ` movetime ${limits.movetime}`;
      if (limits.depth) go += ` depth ${limits.depth}`;
      if (limits.nodes) go += ` nodes ${limits.nodes}`;
      if (go === 'go') go += ' infinite';
    }
    this.searching = true;
    this.send(go);
    return done;
  }

  quit(): void {
    if (!this.proc || this.exited) return;
    this.send('quit');
    const p = this.proc;
    setTimeout(() => {
      if (!this.exited) p.kill();
    }, 1500);
  }
}

function parseInfo(line: string, pos: Position, whiteToMove: boolean): PvLine | null {
  const t = line.split(/\s+/);
  const pv: PvLine = { multipv: 1, depth: 0, seldepth: 0, cp: null, mate: null, bound: '', nodes: 0, nps: 0, time: 0, tbhits: 0, uci: [], san: [] };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        pv.depth = Number(t[++i]);
        break;
      case 'seldepth':
        pv.seldepth = Number(t[++i]);
        break;
      case 'multipv':
        pv.multipv = Number(t[++i]);
        break;
      case 'nodes':
        pv.nodes = Number(t[++i]);
        break;
      case 'nps':
        pv.nps = Number(t[++i]);
        break;
      case 'time':
        pv.time = Number(t[++i]);
        break;
      case 'tbhits':
        pv.tbhits = Number(t[++i]);
        break;
      case 'score': {
        const kind = t[++i];
        const v = Number(t[++i]);
        if (kind === 'cp') pv.cp = whiteToMove ? v : -v;
        else if (kind === 'mate') pv.mate = whiteToMove ? v : -v;
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') {
          pv.bound = t[++i] === 'lowerbound' ? 'lower' : 'upper';
        }
        break;
      }
      case 'pv':
        pv.uci = t.slice(i + 1);
        i = t.length;
        break;
      default:
        break;
    }
  }
  if (!pv.uci.length) return null;
  // μετατροπή σε SAN
  let k = 0;
  for (const u of pv.uci) {
    const m = pos.parseUci(u);
    if (!m) break;
    pv.san.push(pos.san(m));
    pos.makeMove(m);
    k++;
  }
  for (let j = 0; j < k; j++) pos.unmakeMove();
  return pv;
}

/** Εύρεση μηχανών UCI που υπάρχουν ήδη στον υπολογιστή. */
export function discoverEngines(): string[] {
  const roots = [
    'C:/Program Files (x86)/Common Files/ChessBase/Engines.uci',
    'C:/Program Files/Common Files/ChessBase/Engines.uci',
    'C:/ProgramData/ChessBase/Engines.uci',
    path.join(process.env.USERPROFILE ?? '', 'Downloads'),
    path.join(process.env.USERPROFILE ?? '', 'Documents', 'ChessBase', 'Engines.uci'),
  ];
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory() && depth > 0) walk(p, depth - 1);
      else if (it.isFile() && /^(stockfish|lc0|komodo|berserk|dragon|obsidian|torch).*\.exe$/i.test(it.name)) out.push(p);
    }
  };
  for (const r of roots) walk(r, 2);
  return out;
}
