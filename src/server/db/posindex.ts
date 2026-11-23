/**
 * Ευρετήριο θέσεων, για γρήγορη αναζήτηση θέσης.
 *
 * .pos  — ταξινομημένες εγγραφές (hashHi, hashLo, gameId), 12 bytes η καθεμία:
 *         «ποιες παρτίδες περνούν από αυτή τη θέση»
 * .tree — προϋπολογισμένα στατιστικά δέντρου ανοιγμάτων για θέσεις με
 *         τουλάχιστον TREE_THRESHOLD παρτίδες (επόμενη κίνηση, +/=/-, Elo, έτος)
 *
 * Η κατασκευή γίνεται με ταξινόμηση radix σε κομμάτια (runs) και συγχώνευση,
 * ώστε να χωράνε και βάσεις δεκάδων εκατομμυρίων θέσεων.
 */
import fs from 'node:fs';

export const TREE_THRESHOLD = 24;
const POS_MAGIC = 0x534b5031; // "SKP1"
const TREE_MAGIC = 0x534b5431; // "SKT1"
const HEADER = 32;
const CHUNK = 4 * 1024 * 1024; // εγγραφές ανά run

export interface GameInfo {
  /** αποτέλεσμα ανά id: 0 *, 1 1-0, 2 ½, 3 0-1 */
  result: Uint8Array;
  welo: Uint16Array;
  belo: Uint16Array;
  year: Uint16Array;
}

export function createGameInfo(maxId: number): GameInfo {
  return {
    result: new Uint8Array(maxId + 1),
    welo: new Uint16Array(maxId + 1),
    belo: new Uint16Array(maxId + 1),
    year: new Uint16Array(maxId + 1),
  };
}

export function growGameInfo(info: GameInfo, maxId: number): GameInfo {
  if (info.result.length > maxId) return info;
  let n = info.result.length;
  while (n <= maxId) n *= 2;
  const out = createGameInfo(n - 1);
  out.result.set(info.result);
  out.welo.set(info.welo);
  out.belo.set(info.belo);
  out.year.set(info.year);
  return out;
}

// ---------------------------------------------------------------------------
// Ταξινόμηση radix (LSD, ψηφία 16 bit) σε παράλληλους πίνακες

function radixSort(n: number, hi: Uint32Array, lo: Uint32Array, game: Uint32Array, aux: Uint32Array): void {
  let a: Uint32Array[] = [hi, lo, game, aux];
  let b: Uint32Array[] = [new Uint32Array(n), new Uint32Array(n), new Uint32Array(n), new Uint32Array(n)];
  const counts = new Uint32Array(65536);
  // ψηφία: lo χαμηλό, lo υψηλό, hi χαμηλό, hi υψηλό
  for (let pass = 0; pass < 4; pass++) {
    const keyArr = pass < 2 ? a[1] : a[0];
    const shift = pass % 2 === 0 ? 0 : 16;
    counts.fill(0);
    for (let i = 0; i < n; i++) counts[(keyArr[i] >>> shift) & 0xffff]++;
    let sum = 0;
    for (let d = 0; d < 65536; d++) {
      const c = counts[d];
      counts[d] = sum;
      sum += c;
    }
    const [ah, al, ag, ax] = a;
    const [bh, bl, bg, bx] = b;
    for (let i = 0; i < n; i++) {
      const d = (keyArr[i] >>> shift) & 0xffff;
      const j = counts[d]++;
      bh[j] = ah[i];
      bl[j] = al[i];
      bg[j] = ag[i];
      bx[j] = ax[i];
    }
    const t = a;
    a = b;
    b = t;
  }
  // μετά από 4 περάσματα τα δεδομένα είναι πάλι στους αρχικούς πίνακες
}

// ---------------------------------------------------------------------------
// Κατασκευή

export class IndexBuilder {
  private hi = new Uint32Array(CHUNK);
  private lo = new Uint32Array(CHUNK);
  private game = new Uint32Array(CHUNK);
  private aux = new Uint32Array(CHUNK);
  private n = 0;
  private runs: string[] = [];
  readonly base: string;
  total = 0;

  constructor(base: string) {
    this.base = base;
  }

  /** Προσθήκη εγγραφής: θέση, παρτίδα, επόμενη κίνηση (token) και πλευρά που παίζει. */
  add(hashHi: number, hashLo: number, gameId: number, next: number, stm: number): void {
    const n = this.n;
    this.hi[n] = hashHi;
    this.lo[n] = hashLo;
    this.game[n] = gameId;
    this.aux[n] = next | (stm << 16);
    this.n = n + 1;
    this.total++;
    if (this.n === CHUNK) this.flushRun();
  }

  private flushRun(): void {
    const n = this.n;
    if (!n) return;
    radixSort(n, this.hi, this.lo, this.game, this.aux);
    const inter = new Uint32Array(n * 4);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      inter[j] = this.hi[i];
      inter[j + 1] = this.lo[i];
      inter[j + 2] = this.game[i];
      inter[j + 3] = this.aux[i];
    }
    const file = `${this.base}.run${this.runs.length}`;
    fs.writeFileSync(file, new Uint8Array(inter.buffer));
    this.runs.push(file);
    this.n = 0;
  }

  /** Γράφει το τελευταίο κομμάτι· επιστρέφει τα runs για συγχώνευση (π.χ. σε worker). */
  seal(): { runs: string[]; total: number } {
    this.flushRun();
    // απελευθέρωση μνήμης των κομματιών
    this.hi = this.lo = this.game = this.aux = new Uint32Array(0);
    const runs = this.runs;
    this.runs = [];
    return { runs, total: this.total };
  }

  /** Τελική συγχώνευση: γράφει .pos και .tree. */
  finish(info: GameInfo, meta: { maxPly: number; games: number }, onProgress?: (done: number, total: number) => void): { entries: number; treePositions: number } {
    const { runs, total } = this.seal();
    return mergeRuns(this.base, runs, total, info, meta, onProgress);
  }

  /** Ακύρωση: σβήνει τα προσωρινά αρχεία. */
  abort(): void {
    for (const f of this.runs) fs.rmSync(f, { force: true });
    this.runs = [];
  }
}

/** Συγχώνευση των ταξινομημένων κομματιών σε .pos και .tree (μπορεί να τρέξει σε worker). */
export function mergeRuns(
  base: string,
  runs: string[],
  total: number,
  info: GameInfo,
  meta: { maxPly: number; games: number },
  onProgress?: (done: number, total: number) => void,
): { entries: number; treePositions: number } {
  const posFile = `${base}.pos`;
  const treeFile = `${base}.tree`;
  const posTmp = posFile + '.tmp';
  const treeTmp = treeFile + '.tmp';
  const readers = runs.map((f) => new RunReader(f));
  const posOut = new BufferedWriter(posTmp, HEADER);
  const treeIdx: number[] = [];
  const treeData = new BufferedWriter(treeTmp + '.data', 0);
  let dataRecords = 0;

  // σωρός (heap) για συγχώνευση k δρόμων
  const heap: RunReader[] = readers.filter((r) => r.valid);
  const less = (a: RunReader, b: RunReader) =>
    a.hi !== b.hi ? a.hi < b.hi : a.lo !== b.lo ? a.lo < b.lo : a.game < b.game;
  const siftDown = (i: number) => {
    const n = heap.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && less(heap[l], heap[m])) m = l;
      if (r < n && less(heap[r], heap[m])) m = r;
      if (m === i) return;
      const t = heap[i];
      heap[i] = heap[m];
      heap[m] = t;
      i = m;
    }
  };
  for (let i = (heap.length >> 1) - 1; i >= 0; i--) siftDown(i);

  // συσσώρευση στατιστικών ανά ομάδα θέσης
  let gHi = -1;
  let gLo = -1;
  let gCount = 0;
  let gStm = 0;
  const moves = new Map<number, MoveAgg>();
  const flushGroup = () => {
    if (gCount >= TREE_THRESHOLD) {
      const list = [...moves.entries()].sort((a, b) => b[1].games - a[1].games);
      treeIdx.push(gHi >>> 0, gLo >>> 0, dataRecords, list.length | (gStm << 16));
      for (const [token, m] of list) {
        const rec = Buffer.allocUnsafe(24);
        rec.writeUInt16LE(token, 0);
        rec.writeUInt16LE(m.year, 2);
        rec.writeUInt32LE(m.games, 4);
        rec.writeUInt32LE(m.w, 8);
        rec.writeUInt32LE(m.d, 12);
        rec.writeUInt32LE(m.l, 16);
        rec.writeUInt16LE(m.eloN ? Math.round(m.eloSum / m.eloN) : 0, 20);
        rec.writeUInt16LE(m.oppN ? Math.round(m.oppSum / m.oppN) : 0, 22);
        treeData.write(rec);
        dataRecords++;
      }
    }
    moves.clear();
    gCount = 0;
  };

  let done = 0;
    const entry = Buffer.allocUnsafe(12);
  while (heap.length) {
    const r = heap[0];
    const hi = r.hi;
    const lo = r.lo;
    const game = r.game;
    const aux = r.aux;
    if (hi !== gHi || lo !== gLo) {
      if (gCount) flushGroup();
      gHi = hi;
      gLo = lo;
      gStm = (aux >>> 16) & 1;
    }
    gCount++;
    const token = aux & 0xffff;
    if (token !== 0xffff) {
      let m = moves.get(token);
      if (!m) moves.set(token, (m = { games: 0, w: 0, d: 0, l: 0, eloSum: 0, eloN: 0, oppSum: 0, oppN: 0, year: 0 }));
      m.games++;
      const res = game < info.result.length ? info.result[game] : 0;
      if (res === 1) m.w++;
      else if (res === 2) m.d++;
      else if (res === 3) m.l++;
      const we = game < info.welo.length ? info.welo[game] : 0;
      const be = game < info.belo.length ? info.belo[game] : 0;
      const own = gStm === 0 ? we : be;
      const opp = gStm === 0 ? be : we;
      if (own) {
        m.eloSum += own;
        m.eloN++;
      }
      if (opp) {
        m.oppSum += opp;
        m.oppN++;
      }
      const y = game < info.year.length ? info.year[game] : 0;
      if (y > m.year) m.year = y;
    }
    entry.writeUInt32LE(hi >>> 0, 0);
    entry.writeUInt32LE(lo >>> 0, 4);
    entry.writeUInt32LE(game >>> 0, 8);
    posOut.write(entry);
    done++;
    if (onProgress && (done & 0xfffff) === 0) onProgress(done, total);
    if (r.next()) siftDown(0);
    else {
      heap[0] = heap[heap.length - 1];
      heap.pop();
      if (heap.length) siftDown(0);
    }
  }
  if (gCount) flushGroup();
  for (const r of readers) r.close();
  for (const f of runs) fs.rmSync(f, { force: true });

  // κεφαλίδα .pos
  const ph = Buffer.alloc(HEADER);
  ph.writeUInt32LE(POS_MAGIC, 0);
  ph.writeUInt32LE(1, 4);
  ph.writeDoubleLE(done, 8);
  ph.writeUInt32LE(meta.maxPly, 16);
  ph.writeUInt32LE(meta.games, 20);
  posOut.close(ph);

  // .tree: κεφαλίδα + ευρετήριο + δεδομένα
  treeData.close(null);
  const positions = treeIdx.length / 4;
  const th = Buffer.alloc(HEADER);
  th.writeUInt32LE(TREE_MAGIC, 0);
  th.writeUInt32LE(1, 4);
  th.writeUInt32LE(positions, 8);
  th.writeUInt32LE(TREE_THRESHOLD, 12);
  const idxBuf = Buffer.from(new Uint32Array(treeIdx).buffer);
  const fd = fs.openSync(treeTmp, 'w');
  fs.writeSync(fd, th);
  fs.writeSync(fd, idxBuf);
  const dataFd = fs.openSync(treeTmp + '.data', 'r');
  const chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
  for (;;) {
    const k = fs.readSync(dataFd, chunk, 0, chunk.length, null);
    if (!k) break;
    fs.writeSync(fd, chunk, 0, k);
  }
  fs.closeSync(dataFd);
  fs.closeSync(fd);
  fs.rmSync(treeTmp + '.data', { force: true });
  fs.renameSync(posTmp, posFile);
  fs.renameSync(treeTmp, treeFile);
  return { entries: done, treePositions: positions };
}

interface MoveAgg {
  games: number;
  w: number;
  d: number;
  l: number;
  eloSum: number;
  eloN: number;
  oppSum: number;
  oppN: number;
  year: number;
}

class RunReader {
  private fd: number;
  private buf = new Uint32Array(65536 * 4);
  private bytes = new Uint8Array(this.buf.buffer);
  private len = 0;
  private i = 0;
  hi = 0;
  lo = 0;
  game = 0;
  aux = 0;
  valid = false;

  constructor(file: string) {
    this.fd = fs.openSync(file, 'r');
    this.fill();
    this.load();
  }

  private fill(): void {
    const k = fs.readSync(this.fd, this.bytes, 0, this.bytes.length, null);
    this.len = Math.floor(k / 16);
    this.i = 0;
  }

  private load(): void {
    if (this.i >= this.len) {
      this.fill();
      if (!this.len) {
        this.valid = false;
        return;
      }
    }
    const j = this.i * 4;
    this.hi = this.buf[j];
    this.lo = this.buf[j + 1];
    this.game = this.buf[j + 2];
    this.aux = this.buf[j + 3];
    this.valid = true;
  }

  next(): boolean {
    this.i++;
    this.load();
    return this.valid;
  }

  close(): void {
    fs.closeSync(this.fd);
  }
}

class BufferedWriter {
  private fd: number;
  private buf = Buffer.allocUnsafe(4 * 1024 * 1024);
  private n = 0;
  private reserve: number;

  constructor(file: string, reserve: number) {
    this.fd = fs.openSync(file, 'w');
    this.reserve = reserve;
    if (reserve) fs.writeSync(this.fd, Buffer.alloc(reserve));
  }

  write(b: Buffer): void {
    if (this.n + b.length > this.buf.length) this.flush();
    b.copy(this.buf, this.n);
    this.n += b.length;
  }

  private flush(): void {
    if (this.n) fs.writeSync(this.fd, this.buf, 0, this.n);
    this.n = 0;
  }

  close(header: Buffer | null): void {
    this.flush();
    if (header && this.reserve) fs.writeSync(this.fd, header, 0, header.length, 0);
    fs.closeSync(this.fd);
  }
}

// ---------------------------------------------------------------------------
// Ανάγνωση

export interface TreeMove {
  token: number;
  games: number;
  w: number;
  d: number;
  l: number;
  elo: number;
  oppElo: number;
  year: number;
}

export class PositionIndex {
  readonly entries: number;
  readonly maxPly: number;
  readonly games: number;
  private posFd: number;
  private treeFd: number | null = null;
  private treeIdx: Uint32Array = new Uint32Array(0);
  private treeDataStart = 0;
  private entryBuf = Buffer.allocUnsafe(12);

  static exists(base: string): boolean {
    return fs.existsSync(`${base}.pos`) && fs.existsSync(`${base}.tree`);
  }

  constructor(base: string) {
    this.posFd = fs.openSync(`${base}.pos`, 'r');
    const h = Buffer.alloc(HEADER);
    fs.readSync(this.posFd, h, 0, HEADER, 0);
    if (h.readUInt32LE(0) !== POS_MAGIC) throw new Error('Άκυρο αρχείο ευρετηρίου θέσεων');
    this.entries = h.readDoubleLE(8);
    this.maxPly = h.readUInt32LE(16);
    this.games = h.readUInt32LE(20);
    if (fs.existsSync(`${base}.tree`)) {
      this.treeFd = fs.openSync(`${base}.tree`, 'r');
      const th = Buffer.alloc(HEADER);
      fs.readSync(this.treeFd, th, 0, HEADER, 0);
      if (th.readUInt32LE(0) === TREE_MAGIC) {
        const positions = th.readUInt32LE(8);
        const idx = Buffer.allocUnsafe(positions * 16);
        fs.readSync(this.treeFd, idx, 0, idx.length, HEADER);
        this.treeIdx = new Uint32Array(idx.buffer, idx.byteOffset, positions * 4);
        this.treeDataStart = HEADER + positions * 16;
      }
    }
  }

  close(): void {
    fs.closeSync(this.posFd);
    if (this.treeFd !== null) fs.closeSync(this.treeFd);
  }

  private readEntry(i: number): void {
    fs.readSync(this.posFd, this.entryBuf, 0, 12, HEADER + i * 12);
  }

  /** Πρώτη εγγραφή ≥ (hi, lo). */
  private lowerBound(hi: number, lo: number): number {
    let a = 0;
    let b = this.entries;
    const H = hi >>> 0;
    const L = lo >>> 0;
    while (a < b) {
      const m = Math.floor((a + b) / 2);
      this.readEntry(m);
      const eh = this.entryBuf.readUInt32LE(0);
      const el = this.entryBuf.readUInt32LE(4);
      if (eh < H || (eh === H && el < L)) a = m + 1;
      else b = m;
    }
    return a;
  }

  /** Εύρος εγγραφών [start, end) για τη θέση. */
  range(hi: number, lo: number): [number, number] {
    const start = this.lowerBound(hi, lo);
    // επόμενο κλειδί: (hi, lo + 1)
    let nlo = (lo >>> 0) + 1;
    let nhi = hi >>> 0;
    if (nlo > 0xffffffff) {
      nlo = 0;
      nhi++;
    }
    const end = nhi > 0xffffffff ? this.entries : this.lowerBound(nhi, nlo);
    return [start, end];
  }

  count(hi: number, lo: number): number {
    const [s, e] = this.range(hi, lo);
    return e - s;
  }

  /** Παρτίδες (id) που περνούν από τη θέση, χωρίς διπλότυπα. */
  gameIds(hi: number, lo: number, limit = 1_000_000): { ids: Int32Array; total: number } {
    const [s, e] = this.range(hi, lo);
    const n = Math.min(e - s, limit);
    const buf = Buffer.allocUnsafe(n * 12);
    if (n) fs.readSync(this.posFd, buf, 0, n * 12, HEADER + s * 12);
    const ids = new Int32Array(n);
    let k = 0;
    let prev = -1;
    for (let i = 0; i < n; i++) {
      const g = buf.readUInt32LE(i * 12 + 8);
      if (g !== prev) ids[k++] = g;
      prev = g;
    }
    return { ids: ids.slice(0, k), total: e - s };
  }

  /** Οι `n` πρώτες ή (με `fromEnd`) οι `n` τελευταίες κατά id παρτίδες της θέσης. */
  edgeGameIds(hi: number, lo: number, n: number, fromEnd: boolean): { ids: Int32Array; total: number } {
    const [s, e] = this.range(hi, lo);
    const k = Math.min(e - s, n);
    const buf = Buffer.allocUnsafe(k * 12);
    if (k) fs.readSync(this.posFd, buf, 0, k * 12, HEADER + (fromEnd ? e - k : s) * 12);
    const out: number[] = [];
    for (let i = 0; i < k; i++) {
      const g = buf.readUInt32LE(i * 12 + 8);
      if (g !== out[out.length - 1]) out.push(g);
    }
    return { ids: Int32Array.from(out), total: e - s };
  }

  /** Προϋπολογισμένα στατιστικά (ή null αν η θέση έχει λίγες παρτίδες). */
  tree(hi: number, lo: number): { moves: TreeMove[]; stm: number } | null {
    const idx = this.treeIdx;
    let a = 0;
    let b = idx.length / 4;
    const H = hi >>> 0;
    const L = lo >>> 0;
    while (a < b) {
      const m = (a + b) >> 1;
      const eh = idx[m * 4];
      const el = idx[m * 4 + 1];
      if (eh < H || (eh === H && el < L)) a = m + 1;
      else b = m;
    }
    if (a >= idx.length / 4 || idx[a * 4] !== H || idx[a * 4 + 1] !== L || this.treeFd === null) return null;
    const offset = idx[a * 4 + 2];
    const count = idx[a * 4 + 3] & 0xffff;
    const stm = (idx[a * 4 + 3] >>> 16) & 1;
    const buf = Buffer.allocUnsafe(count * 24);
    fs.readSync(this.treeFd, buf, 0, buf.length, this.treeDataStart + offset * 24);
    const moves: TreeMove[] = [];
    for (let i = 0; i < count; i++) {
      const o = i * 24;
      moves.push({
        token: buf.readUInt16LE(o),
        year: buf.readUInt16LE(o + 2),
        games: buf.readUInt32LE(o + 4),
        w: buf.readUInt32LE(o + 8),
        d: buf.readUInt32LE(o + 12),
        l: buf.readUInt32LE(o + 16),
        elo: buf.readUInt16LE(o + 20),
        oppElo: buf.readUInt16LE(o + 22),
      });
    }
    return { moves, stm };
  }
}
