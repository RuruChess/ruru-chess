/**
 * Ανάγνωση σκαναρισμένων σελίδων με μοντέλο εικόνας-κειμένου (VLM, π.χ. PaddleOCR-VL) μέσα από το llama.cpp
 * (`llama-server`, τοπικά στο 127.0.0.1). Είναι προαιρετικό πακέτο: αν δεν υπάρχει, μένει μόνο το OCR των Windows.
 *
 * Το πακέτο είναι ένας φάκελος με `vlm.json` ({ server, model, mmproj, prompt? }, διαδρομές σχετικές με τον φάκελο):
 * `%LOCALAPPDATA%\Ruru\ocr`, ή όποιος δίνεται στο `KNIGHTBASE_VLM_DIR` (δοκιμές).
 *
 * Το μοντέλο διαβάζει το κείμενο πολύ καλύτερα από το OCR των Windows (ψηφία, τίτλοι, σειρά στηλών) αλλά δεν δίνει
 * θέσεις λέξεων· τις θέσεις τις δίνει το OCR των Windows και τα δύο ενώνονται στο `retext.ts`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Gray } from './vision.ts';
import { appLocalDir } from '../rename.ts';

export interface VlmPack {
  dir: string;
  server: string;
  model: string;
  mmproj: string;
  prompt: string;
}

/** Το πακέτο, αν είναι εγκατεστημένο (όλα τα αρχεία του υπάρχουν). */
export function findVlm(): VlmPack | null {
  const dir = process.env.KNIGHTBASE_VLM_DIR || path.join(appLocalDir(), 'ocr');
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'vlm.json'), 'utf8')) as Partial<VlmPack>;
    if (!m.server || !m.model || !m.mmproj) return null;
    const pack = { dir, server: path.resolve(dir, m.server), model: path.resolve(dir, m.model), mmproj: path.resolve(dir, m.mmproj), prompt: m.prompt ?? 'OCR:' };
    return [pack.server, pack.model, pack.mmproj].every((f) => fs.existsSync(f)) ? pack : null;
  } catch {
    return null;
  }
}

/** PNG σε γκρι (8 bit), για να σταλεί η σελίδα στο μοντέλο. */
export function grayPng(img: Gray): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((img.w + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w + 1)] = 0;
    raw.set(img.px.subarray(y * img.w, (y + 1) * img.w), y * (img.w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; // 8 bit
  ihdr[9] = 0; // γκρι
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 3 })), chunk('IEND', Buffer.alloc(0))]);
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });

/**
 * Ένας `llama-server` με το μοντέλο, για όλο το βιβλίο· μία σελίδα τη φορά (με κάρτα γραφικών ~10″, χωρίς πολύ
 * περισσότερο). Τα αποτελέσματα κρατιούνται στο `cache` (αν δοθεί), ανά περιεχόμενο εικόνας: μια δεύτερη εισαγωγή του
 * ίδιου βιβλίου δεν ξαναδιαβάζει τίποτα.
 */
export class VlmOcr {
  private proc: ChildProcess | null = null;
  private port = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private log = '';
  private pack: VlmPack;
  private cache: string | null;
  readonly ready: Promise<void>;

  constructor(pack: VlmPack, cache: string | null = null) {
    this.pack = pack;
    this.cache = cache;
    this.ready = this.start();
    // (ένα σφάλμα εκκίνησης φαίνεται στο `read`· όχι «unhandled rejection» εδώ)
    this.ready.catch(() => {});
  }

  private async start(): Promise<void> {
    this.port = await freePort();
    // όλα τα επίπεδα στην κάρτα γραφικών αν υπάρχει (Vulkan), αλλιώς στον επεξεργαστή· σταθερό κείμενο (temp 0)
    const args = ['-m', this.pack.model, '--mmproj', this.pack.mmproj, '--host', '127.0.0.1', '--port', String(this.port), '--temp', '0', '-ngl', '99', '-c', '16384', '-np', '1', '--no-webui'];
    this.proc = spawn(this.pack.server, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc.stderr?.on('data', (d: Buffer) => (this.log = (this.log + d.toString()).slice(-4000)));
    const t0 = Date.now();
    for (;;) {
      if (this.proc.exitCode !== null) throw new Error(`Το μοντέλο ανάγνωσης δεν ξεκίνησε: ${this.log.trim().split('\n').pop() ?? ''}`);
      try {
        if ((await fetch(`http://127.0.0.1:${this.port}/health`)).ok) return;
      } catch {
        // ακόμη φορτώνει
      }
      if (Date.now() - t0 > 180_000) throw new Error('Το μοντέλο ανάγνωσης δεν ξεκίνησε σε 3 λεπτά');
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  /** Το κείμενο μιας σελίδας (εικόνα σε γκρι)· σε σφάλμα, κενό (η σελίδα μένει με το OCR των Windows). */
  read(img: Gray, signal?: AbortSignal): Promise<string> {
    const png = grayPng(img);
    const key = this.cache ? path.join(this.cache, crypto.createHash('sha1').update(this.pack.model).update(png).digest('hex') + '.txt') : null;
    if (key && fs.existsSync(key)) return Promise.resolve(fs.readFileSync(key, 'utf8'));
    const job = this.queue.then(async () => {
      await this.ready;
      if (signal?.aborted) throw new Error('aborted');
      const content = [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }, { type: 'text', text: this.pack.prompt }];
      const r = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content }], temperature: 0, max_tokens: 6000 }),
        signal,
      });
      const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = j.choices?.[0]?.message?.content ?? '';
      if (key && text) {
        fs.mkdirSync(path.dirname(key), { recursive: true });
        fs.writeFileSync(key, text, 'utf8');
      }
      return text;
    });
    this.queue = job.catch(() => {});
    return job.catch((e: unknown) => {
      if (signal?.aborted) throw e;
      return '';
    });
  }

  close(): void {
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
  }
}
