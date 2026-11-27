// Προαιρετικό πακέτο αναγνώρισης θέσης διαγραμμάτων (chess-diagram-net, AGPL-3.0): ξεχωριστό πρόγραμμα, αμετάβλητο, με
// την άδειά του, που τρέχει σε δική του διεργασία (`diagramnet-worker.ts`). Ο δικός μας αναγνώστης (vision.ts + pieces.ts)
// βρίσκει τις σκακιέρες σωστά αλλά σε σκαναρισμένα διαγράμματα μπερδεύει τα ονόματα των κομματιών· με το πακέτο οι
// θέσεις των διαγραμμάτων-εικόνων έρχονται από αυτό.
// Πακέτο: φάκελος με `diagram/recognize.js` (και `LICENSE`), στο `%LOCALAPPDATA%\Ruru\diagram\cdn` ή στο
// `KNIGHTBASE_CDN_DIR` (δοκιμές). Χωρίς πακέτο δεν αλλάζει τίποτα.
import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Gray } from './vision.ts';
import { appLocalDir } from '../rename.ts';

/** Το πακέτο, αν είναι εγκατεστημένο: η διαδρομή του `recognize.js`. */
export function findDiagramNet(): string | null {
  const dir = process.env.KNIGHTBASE_CDN_DIR || path.join(appLocalDir(), 'diagram', 'cdn');
  const entry = path.join(dir, 'diagram', 'recognize.js');
  return fs.existsSync(entry) ? entry : null;
}

export interface NetBoard {
  /** πρώτο πεδίο του FEN, από την πλευρά των λευκών */
  placement: string;
  confidence: number;
}

type Reply = { id: number; ok?: boolean; error?: string; placement?: string; confidence?: number };

export class DiagramNet {
  private p: ChildProcess;
  private next = 1;
  private waiting = new Map<number, (r: Reply) => void>();
  private dead = false;

  constructor(entry: string) {
    this.p = fork(fileURLToPath(new URL('./diagramnet-worker.ts', import.meta.url)), [entry], { serialization: 'advanced', execArgv: [], stdio: ['ignore', 'ignore', process.env.KNIGHTBASE_CDN_STDERR ? 'inherit' : 'ignore', 'ipc'], windowsHide: true });
    const fail = () => {
      this.dead = true;
      for (const w of this.waiting.values()) w({ id: 0, error: 'stopped' });
      this.waiting.clear();
    };
    this.p.on('message', (r: Reply) => {
      const w = this.waiting.get(r.id);
      this.waiting.delete(r.id);
      w?.(r);
    });
    this.p.on('error', fail);
    this.p.on('exit', fail);
  }

  /** Η θέση ενός αποκόμματος με τη σκακιέρα (και λίγο περιθώριο γύρω της)· null αν δεν βρέθηκε. */
  read(img: Gray): Promise<NetBoard | null> {
    if (this.dead) return Promise.resolve(null);
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, (r) => resolve(r.ok && r.placement ? { placement: r.placement, confidence: r.confidence ?? 0 } : null));
      this.p.send({ id, w: img.w, h: img.h, px: img.px }, (e) => {
        if (!e) return;
        this.waiting.delete(id);
        resolve(null);
      });
    });
  }

  close(): void {
    this.dead = true;
    if (this.p.exitCode === null) this.p.kill();
  }
}

/**
 * Οι θέσεις όλων των αποκομμάτων, σε έως 3 διεργασίες (≈ 1″ ανά διάγραμμα η καθεμιά). `null` στη θέση ενός αποκόμματος:
 * δεν βρέθηκε ή δεν υπάρχει απόκομμα.
 */
export async function readDiagrams(entry: string, crops: Array<Gray | null>, signal?: AbortSignal): Promise<Array<NetBoard | null>> {
  const out: Array<NetBoard | null> = crops.map(() => null);
  const todo = crops.flatMap((c, i) => (c ? [i] : []));
  if (!todo.length) return out;
  const lanes = Math.max(1, Math.min(3, Math.floor(os.cpus().length / 4), todo.length));
  const nets = Array.from({ length: lanes }, () => new DiagramNet(entry));
  const abort = () => nets.forEach((n) => n.close());
  signal?.addEventListener('abort', abort);
  try {
    let next = 0;
    await Promise.all(
      nets.map(async (net) => {
        for (let k = next++; k < todo.length; k = next++) {
          if (signal?.aborted) return;
          out[todo[k]] = await net.read(crops[todo[k]]!);
        }
      }),
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    abort();
  }
  return out;
}
