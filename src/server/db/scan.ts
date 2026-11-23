/**
 * Παράλληλη σάρωση κινήσεων με workers (αναζήτηση υλικού, θέση πέρα από το βάθος του
 * ευρετηρίου): το εύρος των ids, ή μια λίστα υποψηφίων, μοιράζεται σε κομμάτια.
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import type { MaterialSpec } from '../../core/material.ts';
import type { ManeuverSpec } from '../../core/maneuver.ts';
import type { PawnSpec } from '../../core/pawns.ts';

export type ScanSpec =
  | { kind: 'material'; material: MaterialSpec; anyColor: boolean }
  | { kind: 'position'; fen: string }
  | { kind: 'maneuver'; maneuver: ManeuverSpec }
  | { kind: 'pawns'; pawns: PawnSpec };

export interface ScanJob {
  file: string;
  spec: ScanSpec;
  from?: number;
  to?: number;
  ids?: Int32Array;
}

const WORKER_URL = new URL('./scanWorker.ts', import.meta.url);

export interface ScanOptions {
  /** ακύρωση: οι workers σταματούν και η υπόσχεση απορρίπτεται με το `signal.reason` */
  signal?: AbortSignal;
  /** κομμάτια που τελείωσαν / σύνολο */
  onProgress?: (done: number, total: number) => void;
}

/** Επιστρέφει ταξινομημένα τα ids των παρτίδων που ταιριάζουν. */
export async function scanGames(file: string, spec: ScanSpec, range: { minId: number; maxId: number } | Int32Array, opts: ScanOptions = {}): Promise<Int32Array> {
  const jobs: ScanJob[] = [];
  if (range instanceof Int32Array) for (let i = 0; i < range.length; i += 5000) jobs.push({ file, spec, ids: range.slice(i, i + 5000) });
  else for (let a = range.minId; a <= range.maxId; a += 25_000) jobs.push({ file, spec, from: a, to: Math.min(range.maxId, a + 24_999) });
  if (!jobs.length) return new Int32Array(0);
  opts.signal?.throwIfAborted();
  const workers: Worker[] = [];
  const parts: Int32Array[] = [];
  let next = 0;
  let onAbort: (() => void) | undefined;
  try {
    const all = Promise.all(
      Array.from(
        { length: Math.max(1, Math.min(jobs.length, os.cpus().length - 2, 12)) },
        () =>
          new Promise<void>((resolve, reject) => {
            const w = new Worker(WORKER_URL);
            workers.push(w);
            const send = () => (next < jobs.length ? w.postMessage(jobs[next++]) : resolve());
            w.on('message', (m: { ids?: Int32Array; error?: string }) => {
              if (m.error) return reject(new Error(m.error));
              parts.push(m.ids!);
              opts.onProgress?.(parts.length, jobs.length);
              send();
            });
            w.once('error', reject);
            send();
          }),
      ),
    );
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(opts.signal!.reason);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
    });
    await Promise.race([all, aborted]);
  } finally {
    if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
    for (const w of workers) void w.terminate();
  }
  const out = new Int32Array(parts.reduce((a, p) => a + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out.sort();
}
