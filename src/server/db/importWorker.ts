/**
 * Worker εισαγωγής: μετατρέπει κομμάτια PGN (ή εύρη παρτίδων ChessBase) σε
 * εγγραφές του Ruru + εγγραφές ευρετηρίου θέσεων.
 */
import { parentPort } from 'node:worker_threads';
import { Position, START_FEN } from '../../core/chess.ts';
import { createIndexSink, encodeMovetext, replayMainline, GF_ERROR } from '../../core/codec.ts';
import { EcoBook } from '../../core/eco.ts';
import { findGameStarts, parseHeaderBlock } from '../../core/pgn.ts';
import { CbhDatabase } from '../formats/cbh.ts';
import { ScidDatabase } from '../formats/scid.ts';
import { packJson } from './pack.ts';

export interface WorkerGame {
  headers: Record<string, string>;
  fen: string | null;
  flags: number;
  plies: number;
  error: string | null;
  comments: string[] | null;
  packedComments: Uint8Array | null;
  tokOff: number;
  tokLen: number;
  idxOff: number;
  idxLen: number;
}

export interface BatchResult {
  seq: number;
  games: WorkerGame[];
  tokens: Uint16Array;
  idxHi: Int32Array;
  idxLo: Int32Array;
  idxNext: Uint16Array;
  idxStm: Uint8Array;
  bytes: number;
  skipped: number;
}

let eco: EcoBook | null = null;
const pos = new Position();
let cbh: CbhDatabase | null = null;
let cbhFile = '';
let scid: ScidDatabase | null = null;
let scidFile = '';

class Collector {
  games: WorkerGame[] = [];
  tokens = new Uint16Array(1 << 20);
  tokLen = 0;
  hi = new Int32Array(1 << 18);
  lo = new Int32Array(1 << 18);
  next = new Uint16Array(1 << 18);
  stm = new Uint8Array(1 << 18);
  idxLen = 0;

  addTokens(t: Uint16Array): number {
    const off = this.tokLen;
    if (off + t.length > this.tokens.length) {
      let n = this.tokens.length * 2;
      while (n < off + t.length) n *= 2;
      const b = new Uint16Array(n);
      b.set(this.tokens.subarray(0, off));
      this.tokens = b;
    }
    this.tokens.set(t, off);
    this.tokLen += t.length;
    return off;
  }

  addIndex(hi: number, lo: number, next: number, stm: number): void {
    const k = this.idxLen;
    if (k === this.hi.length) {
      const n = k * 2;
      const h = new Int32Array(n);
      h.set(this.hi);
      this.hi = h;
      const l = new Int32Array(n);
      l.set(this.lo);
      this.lo = l;
      const x = new Uint16Array(n);
      x.set(this.next);
      this.next = x;
      const s = new Uint8Array(n);
      s.set(this.stm);
      this.stm = s;
    }
    this.hi[k] = hi;
    this.lo[k] = lo;
    this.next[k] = next;
    this.stm[k] = stm;
    this.idxLen = k + 1;
  }

  result(seq: number, bytes: number, skipped: number): { msg: BatchResult; transfer: ArrayBuffer[] } {
    const msg: BatchResult = {
      seq,
      games: this.games,
      tokens: this.tokens.slice(0, this.tokLen),
      idxHi: this.hi.slice(0, this.idxLen),
      idxLo: this.lo.slice(0, this.idxLen),
      idxNext: this.next.slice(0, this.idxLen),
      idxStm: this.stm.slice(0, this.idxLen),
      bytes,
      skipped,
    };
    return {
      msg,
      transfer: [msg.tokens.buffer, msg.idxHi.buffer, msg.idxLo.buffer, msg.idxNext.buffer, msg.idxStm.buffer] as ArrayBuffer[],
    };
  }
}

const isStandardVariant = (v: string | undefined) => !v || /^(standard|chess|normal|from position)$/i.test(v.trim());

function processPgn(seq: number, bytes: Uint8Array, encoding: string, maxPly: number): { msg: BatchResult; transfer: ArrayBuffer[] } {
  const text = new TextDecoder(encoding).decode(bytes);
  const starts = findGameStarts(text);
  const out = new Collector();
  const sink = createIndexSink(maxPly);
  let skipped = 0;
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    const e = k + 1 < starts.length ? starts[k + 1] : text.length;
    try {
    const { headers, bodyStart } = parseHeaderBlock(text, s, e);
    if (!Object.keys(headers).length) {
      skipped++;
      continue;
    }
    if (!isStandardVariant(headers.Variant)) {
      skipped++;
      continue;
    }
    let fen: string | null = null;
    if (headers.FEN && headers.SetUp !== '0') {
      try {
        pos.setFen(headers.FEN);
        fen = pos.fen();
        if (fen === START_FEN) fen = null;
      } catch {
        skipped++;
        continue;
      }
    }
    const enc = encodeMovetext(text, bodyStart, e, fen, pos, sink);
    if (!headers.Result || headers.Result === '?') headers.Result = enc.result || '*';
    if (!headers.ECO && eco && !fen) {
      const o = eco.classifyHashes(sink.hashHi, sink.hashLo, sink.count);
      if (o) headers.ECO = o.eco;
    }
    const tokOff = out.addTokens(enc.tokens);
    const idxOff = out.idxLen;
    const startTurn = fen ? (fen.split(' ')[1] === 'b' ? 1 : 0) : 0;
    for (let i = 0; i < sink.count; i++) out.addIndex(sink.hashHi[i], sink.hashLo[i], sink.next[i], (startTurn + i) & 1);
    out.games.push({
      headers,
      fen,
      flags: enc.flags,
      plies: enc.plies,
      error: enc.error,
      comments: null,
      packedComments: enc.comments ? packJson(enc.comments) : null,
      tokOff,
      tokLen: enc.tokens.length,
      idxOff,
      idxLen: out.idxLen - idxOff,
    });
    } catch {
      // χαλασμένη παρτίδα: παραλείπεται
      skipped++;
    }
  }
  return out.result(seq, bytes.length, skipped);
}

function processCbh(seq: number, file: string, from: number, to: number, maxPly: number): { msg: BatchResult; transfer: ArrayBuffer[] } {
  if (!cbh || cbhFile !== file) {
    cbh?.close();
    cbh = new CbhDatabase(file);
    cbhFile = file;
  }
  const out = new Collector();
  let skipped = 0;
  for (let i = from; i < to; i++) {
    const r = cbh.record(i);
    if (r.kind !== 'game') {
      skipped++;
      continue;
    }
    const headers = cbh.headers(r);
    const g = cbh.decodeGame(r);
    if (g.error && !g.tokens.length && g.flags & GF_ERROR && /Chess960|κωδικοποίηση|κειμένου/.test(g.error)) {
      skipped++;
      continue;
    }
    const tokOff = out.addTokens(g.tokens);
    const idxOff = out.idxLen;
    let count = 0;
    const startTurn = g.startFen ? (g.startFen.split(' ')[1] === 'b' ? 1 : 0) : 0;
    replayMainline(g.tokens, pos, g.startFen, (p, ply, next) => {
      if (count >= maxPly) return true;
      out.addIndex(p.hashHi, p.hashLo, next, (startTurn + ply) & 1);
      count++;
      return false;
    });
    if (!headers.ECO && eco && !g.startFen) {
      const o = eco.classifyHashes(out.hi.subarray(idxOff, out.idxLen), out.lo.subarray(idxOff, out.idxLen), out.idxLen - idxOff);
      if (o) headers.ECO = o.eco;
    }
    out.games.push({
      headers,
      fen: g.startFen,
      flags: g.flags | (r.deleted ? 0x100 : 0),
      plies: g.plies,
      error: g.error,
      comments: null,
      packedComments: g.comments ? packJson(g.comments) : null,
      tokOff,
      tokLen: g.tokens.length,
      idxOff,
      idxLen: out.idxLen - idxOff,
    });
  }
  return out.result(seq, 0, skipped);
}

/** Εύρος παρτίδων βάσης Scid (.si4): όπως στο .cbh, οι κινήσεις γίνονται κατευθείαν tokens. */
function processScid(seq: number, file: string, from: number, to: number, maxPly: number): { msg: BatchResult; transfer: ArrayBuffer[] } {
  if (!scid || scidFile !== file) {
    scid?.close();
    scid = new ScidDatabase(file);
    scidFile = file;
  }
  const out = new Collector();
  let skipped = 0;
  for (let i = from; i < to; i++) {
    const r = scid.record(i);
    const g = scid.decodeGame(r);
    if (g.error && !g.tokens.length && !g.plies) {
      skipped++;
      continue;
    }
    const headers = { ...scid.headers(r), ...g.tags };
    if (g.startFen) {
      headers.SetUp = '1';
      headers.FEN = g.startFen;
    }
    const tokOff = out.addTokens(g.tokens);
    const idxOff = out.idxLen;
    let count = 0;
    const startTurn = g.startFen ? (g.startFen.split(' ')[1] === 'b' ? 1 : 0) : 0;
    replayMainline(g.tokens, pos, g.startFen, (p, ply, next) => {
      if (count >= maxPly) return true;
      out.addIndex(p.hashHi, p.hashLo, next, (startTurn + ply) & 1);
      count++;
      return false;
    });
    if (!headers.ECO && eco && !g.startFen) {
      const o = eco.classifyHashes(out.hi.subarray(idxOff, out.idxLen), out.lo.subarray(idxOff, out.idxLen), out.idxLen - idxOff);
      if (o) headers.ECO = o.eco;
    }
    out.games.push({
      headers,
      fen: g.startFen,
      flags: g.flags | (r.deleted ? 0x100 : 0),
      plies: g.plies,
      error: g.error,
      comments: null,
      packedComments: g.comments ? packJson(g.comments) : null,
      tokOff,
      tokLen: g.tokens.length,
      idxOff,
      idxLen: out.idxLen - idxOff,
    });
  }
  return out.result(seq, 0, skipped);
}

parentPort!.on('message', (msg: { type: string; [k: string]: unknown }) => {
  try {
    if (msg.type === 'init') {
      eco = msg.ecoTsv ? new EcoBook(msg.ecoTsv as string) : null;
      parentPort!.postMessage({ type: 'ready' });
      return;
    }
    if (msg.type === 'pgn') {
      const { msg: res, transfer } = processPgn(msg.seq as number, msg.bytes as Uint8Array, msg.encoding as string, msg.maxPly as number);
      parentPort!.postMessage({ type: 'result', ...res }, transfer);
      return;
    }
    if (msg.type === 'scid') {
      const { msg: res, transfer } = processScid(msg.seq as number, msg.file as string, msg.from as number, msg.to as number, msg.maxPly as number);
      parentPort!.postMessage({ type: 'result', ...res }, transfer);
      return;
    }
    if (msg.type === 'cbh') {
      const { msg: res, transfer } = processCbh(msg.seq as number, msg.file as string, msg.from as number, msg.to as number, msg.maxPly as number);
      parentPort!.postMessage({ type: 'result', ...res }, transfer);
      return;
    }
  } catch (e) {
    parentPort!.postMessage({ type: 'error', seq: msg.seq, message: (e as Error).stack ?? String(e) });
  }
});
