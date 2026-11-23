/** Βοηθητικά για τα τεστ της Τακτικής: προσωρινός φάκελος, συνθετικά puzzles, πλαστό JobContext. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Position } from '../../src/core/chess.ts';
import { Tactics } from '../../src/server/tactics/context.ts';
import type { JobContext, TacticsJob } from '../../src/server/tactics/jobs.ts';
import { packLine, packPosition } from '../../src/server/tactics/pack.ts';
import { F_PRE, F_WHITE } from '../../src/server/tactics/store.ts';
import { maskOf } from '../../src/server/tactics/themes.ts';
import { validateLine } from '../../src/core/puzzle.ts';

export function tempTactics(): { t: Tactics; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcb-tactics-'));
  const t = new Tactics(dir);
  return {
    t,
    dir,
    cleanup: () => {
      t.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const FEN = 'r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24';
const LINE = ['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1'];
const V = validateLine(FEN, LINE, { pre: true });
const POS = packPosition(V.start ?? Position.fromFen(FEN));
const LINEBUF = packLine(V.moves);

export interface SynthPuzzle {
  id: number;
  rating: number;
  rd?: number;
  themes?: string[];
  white?: boolean;
  flags?: number;
  source?: number;
  opening?: number | null;
}

/** Συνθετικά puzzles (ίδια θέση/γραμμή, διαφορετικοί βαθμοί/θέματα/χρώματα) για τεστ επιλογής. */
export function addPuzzles(t: Tactics, rows: SynthPuzzle[]): void {
  const st = t.puzzles.prep('INSERT OR REPLACE INTO puzzle(id, source_id, pos, line, rating, rd, pop, plays, th1, th2, opening_id, flags) VALUES (?, ?, ?, ?, ?, ?, 90, 1000, ?, ?, ?, ?)');
  t.puzzles.tx(() => {
    for (const r of rows) {
      const m = maskOf(r.themes ?? []);
      st.run(r.id, r.source ?? 1, POS, LINEBUF, r.rating, r.rd ?? 75, m.m1, m.m2, r.opening ?? null, r.flags ?? F_PRE | (r.white === false ? 0 : F_WHITE));
    }
  });
}

export function fakeContext(source = 'test'): JobContext & { events: Array<Partial<TacticsJob>> } {
  const events: Array<Partial<TacticsJob>> = [];
  const job: TacticsJob = { id: 'job', source, title: source, status: 'running', phase: '', done: 0, total: 0, bytes: 0, totalBytes: 0, imported: 0, rejected: 0, filtered: 0, started: Date.now() };
  return { job, signal: new AbortController().signal, progress: (p) => events.push(p), events };
}

/** JSON αίτημα στον τοπικό server των δοκιμών. */
export async function apiJson(port: number, method: string, p: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}
