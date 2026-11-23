/**
 * Ανάγνωση σελίδων από την εικόνα τους (σκαναρισμένα βιβλία, βιβλία με χαλασμένο κείμενο) με το PP-OCRv6 του PaddleOCR
 * (Apache-2.0) πάνω στο onnxruntime-node (MIT). Διαβάζει το κείμενο πολύ καλύτερα από το OCR των Windows και δίνει θέση
 * και σιγουριά ανά χαρακτήρα· τα σύμβολα των κομματιών, που δεν τα ξέρει, βρίσκονται από το σχήμα τους (`figurines.ts`).
 *
 * Είναι προαιρετικό πακέτο: αν δεν υπάρχει, μένει το OCR των Windows (`ocr.ts`). Το πακέτο είναι ένας φάκελος με
 * `ppocr.json` ({ runtime, det, rec, dict }, διαδρομές σχετικές με τον φάκελο: το onnxruntime-node, τα δύο μοντέλα
 * .onnx και το inference.yml με το λεξικό): `%LOCALAPPDATA%\Ruru\ocr\ppocr`, ή όποιος δίνεται στο
 * `KNIGHTBASE_PPOCR_DIR` (δοκιμές).
 *
 * Το μοντέλο τρέχει σε δική του διεργασία (`ppocr-worker.ts`), που τερματίζεται με `kill`: με φορτωμένο το onnxruntime
 * η κανονική έξοδος μιας διεργασίας κόλλησε (10/11/2026), και έτσι η μνήμη του επιστρέφει μόλις τελειώσει το βιβλίο.
 */
import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Cand, PLine } from './figurines.ts';
import type { Gray } from './vision.ts';
import { appLocalDir } from '../rename.ts';

export interface PpPack {
  dir: string;
  runtime: string;
  det: string;
  rec: string;
  dict: string;
}

/** Το πακέτο, αν είναι εγκατεστημένο (όλα τα αρχεία του υπάρχουν). */
export function findPpocr(): PpPack | null {
  const dir = process.env.KNIGHTBASE_PPOCR_DIR || path.join(appLocalDir(), 'ocr', 'ppocr');
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'ppocr.json'), 'utf8')) as Partial<PpPack>;
    if (!m.runtime || !m.det || !m.rec || !m.dict) return null;
    const pack = { dir, runtime: path.resolve(dir, m.runtime), det: path.resolve(dir, m.det), rec: path.resolve(dir, m.rec), dict: path.resolve(dir, m.dict) };
    return [pack.runtime, pack.det, pack.rec, pack.dict].every((f) => fs.existsSync(f)) ? pack : null;
  } catch {
    return null;
  }
}

export interface PpPage {
  lines: PLine[];
  /** τα υποψήφια σύμβολα κομματιών της σελίδας (`line`: δείκτης στο `lines`) */
  cands: Cand[];
  ms: number;
}

type Reply = { id: number; error?: string } & Partial<PpPage>;

export class PpOcr {
  private p: ChildProcess;
  private next = 1;
  private waiting = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  private dead: Error | null = null;
  /** έτοιμο μόλις φορτωθούν τα μοντέλα (αλλιώς το σφάλμα) */
  readonly ready: Promise<void>;

  /** `detSide`: η μεγαλύτερη πλευρά της εικόνας στον εντοπισμό γραμμών (μεγαλύτερη = πιο αργό, περισσότερη μνήμη) */
  constructor(pack: PpPack, threads = Number(process.env.KNIGHTBASE_PPOCR_THREADS) || Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))), detSide = Number(process.env.KNIGHTBASE_PPOCR_DET) || 1600) {
    // (execArgv κενό: όχι τα --watch/--inspect του server· το Node ≥ 24 τρέχει το .ts όπως είναι)
    // (KNIGHTBASE_PPOCR_STDERR: τα σφάλματα της διεργασίας φαίνονται, για δοκιμές· αλλιώς ένα σφάλμα της σημαίνει απλώς
    // «ο αναγνώστης σταμάτησε» και οι σελίδες πέφτουν στο OCR των Windows χωρίς να φαίνεται γιατί)
    this.p = fork(fileURLToPath(new URL('./ppocr-worker.ts', import.meta.url)), [], { serialization: 'advanced', execArgv: [], stdio: ['ignore', 'ignore', process.env.KNIGHTBASE_PPOCR_STDERR ? 'inherit' : 'ignore', 'ipc'], windowsHide: true });
    const fail = (e: Error) => {
      this.dead ??= e;
      for (const w of this.waiting.values()) w.reject(this.dead);
      this.waiting.clear();
    };
    this.p.on('message', (r: Reply) => {
      const w = this.waiting.get(r.id);
      this.waiting.delete(r.id);
      w?.resolve(r);
    });
    this.p.on('error', (e) => fail(new Error(`Ο αναγνώστης δεν ξεκίνησε: ${e.message}`)));
    this.p.on('exit', () => fail(new Error('Ο αναγνώστης σταμάτησε')));
    this.ready = this.send({ init: { runtime: pack.runtime, det: pack.det, rec: pack.rec, dict: pack.dict, threads, detSide } }).then((r) => {
      if (r.error) throw new Error(`Ο αναγνώστης δεν φόρτωσε τα μοντέλα: ${r.error}`);
    });
    // (χωρίς αυτό, ένα σφάλμα φόρτωσης που δεν το περιμένει κανείς ακόμη θα έριχνε τον server)
    this.ready.catch(() => {});
  }

  private send(msg: object): Promise<Reply> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.p.send({ id, ...msg }, (e) => {
        if (!e) return;
        this.waiting.delete(id);
        reject(e);
      });
    });
  }

  /** Οι γραμμές μιας εικόνας σελίδας (γκρι), με τους γλύφους και τα υποψήφια σύμβολα κομματιών. */
  async read(page: number, img: Gray): Promise<PpPage> {
    await this.ready;
    const r = await this.send({ page, w: img.w, h: img.h, px: img.px });
    if (r.error) throw new Error(r.error);
    return { lines: r.lines ?? [], cands: r.cands ?? [], ms: r.ms ?? 0 };
  }

  /** Τερματισμός (πάντα με kill: βλ. την κεφαλίδα). */
  close(): void {
    this.dead ??= new Error('Ο αναγνώστης έκλεισε');
    if (this.p.exitCode === null) this.p.kill();
  }
}
