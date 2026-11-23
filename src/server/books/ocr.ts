/**
 * OCR των Windows 10/11 (Windows.Media.Ocr) και απόδοση σελίδων PDF (Windows.Data.Pdf), χωρίς λήψεις: ένα
 * PowerShell (`ocr.ps1`) που μένει ανοιχτό και παίρνει εντολές μία-μία, άρα πρόοδος ανά σελίδα και ακύρωση με
 * τερματισμό της διεργασίας. Το script περνά ως -EncodedCommand (όπως ο διάλογος αρχείων), ώστε να μην το
 * εμποδίζει η πολιτική εκτέλεσης scripts.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { psQuote } from '../psQuote.ts';

export interface OcrWord {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface OcrPage {
  page: number;
  /** διαστάσεις της εικόνας σε pixel */
  w: number;
  h: number;
  /** γραμμές κειμένου, η καθεμιά με τις λέξεις της (χωρίς OCR: κενό) */
  lines: OcrWord[][];
  error?: string;
}

type Raw = { page?: number; w?: number; h?: number; lines?: Array<Array<[number, number, number, number, string]>>; error?: string; pages?: number; lang?: string };

export class WinOcr {
  private p: ChildProcessWithoutNullStreams;
  private buf = '';
  private waiting: Array<{ resolve: (r: Raw) => void; reject: (e: Error) => void }> = [];
  private dead: Error | null = null;
  /** σελίδες του PDF και γλώσσα του OCR, μόλις ξεκινήσει */
  readonly ready: Promise<{ pages: number; lang: string }>;

  constructor(pdf: string | null, lang = 'en-US') {
    const script = fs.readFileSync(fileURLToPath(new URL('./ocr.ps1', import.meta.url)), 'utf8').replace(/^﻿/, '');
    const command = `& {\n${script}\n} -Pdf ${psQuote(pdf ?? '')} -Lang ${psQuote(lang)}`;
    // (στον προσωρινό φάκελο: το PowerShell γράφει μερικές φορές cache στον τρέχοντα φάκελο)
    this.p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, cwd: os.tmpdir() });
    this.p.stdout.setEncoding('utf8');
    this.p.stdout.on('data', (d: string) => {
      this.buf += d;
      for (let i = this.buf.indexOf('\n'); i >= 0; i = this.buf.indexOf('\n')) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let r: Raw;
        try {
          r = JSON.parse(line) as Raw;
        } catch {
          continue;
        }
        this.waiting.shift()?.resolve(r);
      }
    });
    this.p.stderr.resume();
    const fail = (e: Error) => {
      this.dead ??= e;
      for (const w of this.waiting.splice(0)) w.reject(this.dead);
    };
    this.p.on('error', (e) => fail(new Error(`Το OCR των Windows δεν ξεκίνησε: ${e.message}`)));
    this.p.on('exit', () => fail(new Error('Το OCR των Windows σταμάτησε')));
    this.ready = this.next().then((r) => {
      if (r.error) throw new Error(r.error);
      return { pages: r.pages ?? 0, lang: r.lang ?? '' };
    });
  }

  private next(): Promise<Raw> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  private send(cmd: string[]): Promise<OcrPage> {
    const r = this.next();
    this.p.stdin.write(`${cmd.join('\t')}\n`);
    return r.then((x) => ({
      page: x.page ?? 0,
      w: x.w ?? 0,
      h: x.h ?? 0,
      lines: (x.lines ?? []).map((l) => l.map(([x0, y0, w, h, text]) => ({ x: x0, y: y0, w, h, text }))),
      ...(x.error ? { error: x.error } : {}),
    }));
  }

  /** Σελίδα του PDF σε εικόνα πλάτους `width` (στο `bmp`, αν δοθεί) και, με `ocr`, οι λέξεις της. */
  render(page: number, width: number, bmp: string | null, ocr: boolean): Promise<OcrPage> {
    return this.send(['render', String(page), String(Math.round(width)), bmp ?? '', ocr ? '1' : '0']);
  }

  /** Οι λέξεις μιας εικόνας BMP. */
  ocr(page: number, bmp: string): Promise<OcrPage> {
    return this.send(['ocr', String(page), bmp]);
  }

  close(): void {
    this.p.stdin.end();
    setTimeout(() => this.kill(), 5000).unref();
  }

  kill(): void {
    if (this.p.exitCode === null) this.p.kill();
  }
}
