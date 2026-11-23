/** Βιβλίο σε βάση: το PDF φορτώνεται από το παράθυρο (POST /api/book/upload), διαβάζεται και το προσωρινό αντίγραφο σβήνεται. */
import fs from 'node:fs';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerBooks } from '../src/server/books/import.ts';
import { Router } from '../src/server/http.ts';
import type { Library } from '../src/server/library.ts';

/** Ελάχιστο PDF μίας σελίδας με τις βασικές γραμματοσειρές: F1 Helvetica (κείμενο), F2 Helvetica-Bold (κύρια γραμμή). */
function makePdf(lines: Array<{ text: string; bold?: boolean; size?: number }>): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const ops = lines.map((l, i) => `BT /${l.bold ? 'F2' : 'F1'} ${l.size ?? 10} Tf 72 ${740 - i * 30} Td (${esc(l.text)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const BOOK = makePdf([
  { text: 'Chapter 1 \x96 Open Games', size: 16 },
  { text: '1.e4 e5 2.Nf3 Nc6 3.Bb5', bold: true },
  { text: 'A) 3.Bc4 Bc5 4.c3 Nf6 This is the Italian. White will continue with 0-0 and d4.' },
  { text: 'B) 3.Nc3 Nf6 is the Four Knights, a quiet and solid choice for both sides.' },
  { text: '3...a6', bold: true },
]);

let server: http.Server;
let base: string;
const opened: string[] = [];
/** οι εργασίες των τεστ (οι προσωρινοί φάκελοί τους σβήνονται στο τέλος) */
const created: string[] = [];
const jobDir = (id: string) => path.join(os.tmpdir(), 'knightbase-book', id);

beforeAll(async () => {
  const lib = {
    openFile: (p: string) => {
      opened.push(fs.readFileSync(p, 'utf8'));
      fs.rmSync(p, { force: true });
      return { entry: { id: 'db1' }, job: undefined };
    },
  } as unknown as Library;
  const router = new Router();
  registerBooks(router, lib);
  server = await router.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  for (const id of created) fs.rmSync(jobDir(id), { recursive: true, force: true });
});

const upload = (body: Buffer | string, type = 'application/pdf') =>
  fetch(`${base}/api/book/upload?name=${encodeURIComponent('Δοκιμή.pdf')}&shapes=0`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: typeof body === 'string' ? body : new Uint8Array(body),
  });

/** Περιμένει ώσπου η εργασία να τελειώσει (ή να αποτύχει). */
async function finished(id: string): Promise<{ status: string; error?: string; title: string; file: string }> {
  for (let i = 0; i < 200; i++) {
    const { jobs } = (await (await fetch(`${base}/api/book/imports`)).json()) as { jobs: Array<{ id: string; status: string; error?: string; title: string; file: string }> };
    const j = jobs.find((x) => x.id === id);
    if (j && !['reading', 'parsing', 'importing'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('η εργασία δεν τελείωσε');
}

describe('Βιβλίο σε βάση: φόρτωση του PDF από το παράθυρο', () => {
  it('δέχεται μόνο application/pdf και μόνο αρχεία PDF', async () => {
    expect((await upload(BOOK, 'text/plain')).status).toBe(415);
    const r = await upload('δεν είναι PDF');
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/δεν είναι PDF/);
  });

  it('το PDF γίνεται βάση και το προσωρινό αντίγραφο σβήνεται', async () => {
    const r = await upload(BOOK);
    expect(r.status).toBe(200);
    const { job } = (await r.json()) as { job: { id: string; file: string } };
    created.push(job.id);
    expect(job.file).toBe('Δοκιμή.pdf');
    const done = await finished(job.id);
    expect(done.status).toBe('done');
    expect(done.title).toBe('Δοκιμή');
    expect(opened).toHaveLength(1);
    const pgn = opened[0].replace(/\s+/g, ' ');
    expect(pgn).toContain('[White "1. Open Games"]');
    expect(pgn).toContain('1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4 Bc5 4. c3 Nf6');
    expect(pgn).toContain('3... a6');
    expect(fs.existsSync(path.join(jobDir(job.id), 'book.pdf'))).toBe(false);
  });

  it('PDF χωρίς κείμενο (σκαναρισμένες σελίδες): το λέει καθαρά', async () => {
    const r = await upload(makePdf([]));
    const { job } = (await r.json()) as { job: { id: string } };
    created.push(job.id);
    const done = await finished(job.id);
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/σκαναρισμένο βιβλίο/);
  });

  it('χαλασμένο PDF: μήνυμα για τον χρήστη, όχι σφάλμα του pdf.js', async () => {
    const r = await upload('%PDF-1.4\nσκουπίδια χωρίς αντικείμενα\n');
    const { job } = (await r.json()) as { job: { id: string } };
    created.push(job.id);
    const done = await finished(job.id);
    expect(done.status).toBe('error');
    expect(done.error).toMatch(/δεν είναι έγκυρο PDF/);
    expect(fs.existsSync(jobDir(job.id))).toBe(false);
  });
});
