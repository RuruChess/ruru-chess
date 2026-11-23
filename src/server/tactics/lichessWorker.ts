/** Worker εισαγωγής Lichess: ανάγνωση και αποσυμπίεση ενός frame zstd, ανάγνωση, φίλτρο, επικύρωση και πακετάρισμα των puzzles του. */
import { parentPort, workerData } from 'node:worker_threads';
import zlib from 'node:zlib';
import type { ColumnMap, QualityFilter } from './csv.ts';
import { batchTransfer, type FrameResult, processText } from './lichessRows.ts';
import { readFrame } from './zstd.ts';

interface Init {
  /** το αρχείο .csv.zst (το frame διαβάζεται εδώ, όχι στο κύριο νήμα) */
  file: string;
  cols: ColumnMap;
  quality: QualityFilter;
  bits: Record<string, number>;
}

const init = workerData as Init;
const decoder = new TextDecoder('utf-8');

parentPort!.on('message', (msg: { index: number; offset: number; length: number }) => {
  try {
    const t0 = performance.now();
    // άνοιγμα και κλείσιμο ανά frame: ο τερματισμός του worker δεν κλείνει αρχεία (στα Windows θα κρατούσε το αρχείο)
    const raw = zlib.zstdDecompressSync(readFrame(init.file, { offset: msg.offset, length: msg.length }));
    const t1 = performance.now();
    const text = decoder.decode(raw);
    const r = processText(text, init.cols, init.quality, init.bits);
    const t2 = performance.now();
    parentPort!.postMessage(
      { index: msg.index, head: r.head, tail: r.tail, newline: r.newline, batch: r.batch, stats: r.stats, bytes: raw.length, msDecompress: t1 - t0, msProcess: t2 - t1 } satisfies FrameResult,
      batchTransfer(r.batch),
    );
  } catch (e) {
    parentPort!.postMessage({ index: msg.index, error: (e as Error).message } satisfies FrameResult);
  }
});
