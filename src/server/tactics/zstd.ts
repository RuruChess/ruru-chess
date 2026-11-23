/** Διαχωρισμός αρχείου zstd σε frames (pzstd: πολλά frames με skippable frames ανάμεσα), για αποσυμπίεση ανά frame. */
import fs from 'node:fs';

export const ZSTD_MAGIC = 0xfd2fb528;
/** Skippable frames: 0x184D2A50–0x184D2A5F (το pzstd γράφει 0x184D2A50 με το μέγεθος του επόμενου frame). */
const SKIP_MIN = 0x184d2a50;
const SKIP_MAX = 0x184d2a5f;

export interface FrameInfo {
  /** θέση του frame στο αρχείο */
  offset: number;
  /** μέγεθος σε bytes (συμπιεσμένο) */
  length: number;
  /** αν είναι skippable frame (μεταδεδομένα, όχι δεδομένα) */
  skippable: boolean;
}

/** Ανάγνωση `len` bytes από τη θέση `pos` (μπορεί να επιστρέψει λιγότερα στο τέλος). */
export type ByteReader = (pos: number, len: number) => Uint8Array;

const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/**
 * Μέγεθος του frame που ξεκινά στο `pos`: για skippable από το πεδίο μεγέθους, για zstd
 * διαβάζοντας την κεφαλίδα και τις κεφαλίδες των blocks (RFC 8878 §3.1.1). −1 αν τελειώνουν τα δεδομένα.
 */
export function frameLength(read: ByteReader, pos: number, size: number): { length: number; skippable: boolean } {
  if (pos + 8 > size) return { length: -1, skippable: false };
  const head = read(pos, 14);
  const magic = u32(head, 0);
  if (magic >= SKIP_MIN && magic <= SKIP_MAX) {
    const len = u32(head, 4);
    return { length: pos + 8 + len > size ? -1 : 8 + len, skippable: true };
  }
  if (magic !== ZSTD_MAGIC) throw new Error(`Άκυρο αρχείο zstd: άγνωστο frame στη θέση ${pos}`);
  const fhd = head[4];
  const fcsFlag = fhd >> 6;
  const single = (fhd >> 5) & 1;
  const checksum = (fhd >> 2) & 1;
  const didFlag = fhd & 3;
  if ((fhd >> 3) & 1) throw new Error('Άκυρο αρχείο zstd: δεσμευμένο bit στην κεφαλίδα');
  const headerSize = 1 + (single ? 0 : 1) + [0, 1, 2, 4][didFlag] + [single ? 1 : 0, 2, 4, 8][fcsFlag];
  let p = pos + 4 + headerSize;
  for (;;) {
    if (p + 3 > size) return { length: -1, skippable: false };
    const bh = read(p, 3);
    const h = bh[0] | (bh[1] << 8) | (bh[2] << 16);
    const last = h & 1;
    const type = (h >> 1) & 3;
    const bsize = h >>> 3;
    if (type === 3) throw new Error('Άκυρο αρχείο zstd: δεσμευμένος τύπος block');
    p += 3 + (type === 1 ? 1 : bsize);
    if (last) break;
  }
  if (checksum) p += 4;
  if (p > size) return { length: -1, skippable: false };
  return { length: p - pos, skippable: false };
}

/** Όλα τα frames ενός buffer (για δοκιμές και μικρά αρχεία). Πετά σφάλμα αν το τελευταίο είναι κομμένο. */
export function splitFrames(buf: Uint8Array): FrameInfo[] {
  const out: FrameInfo[] = [];
  const read: ByteReader = (pos, len) => buf.subarray(pos, Math.min(buf.length, pos + len));
  let pos = 0;
  while (pos < buf.length) {
    const f = frameLength(read, pos, buf.length);
    if (f.length < 0) throw new Error(`Κομμένο frame zstd στη θέση ${pos}`);
    out.push({ offset: pos, length: f.length, skippable: f.skippable });
    pos += f.length;
  }
  return out;
}

/**
 * Frames αρχείου από τη θέση `start` (για συνέχιση εισαγωγής), χωρίς να διαβαστεί όλο το αρχείο:
 * διαβάζονται μόνο οι κεφαλίδες. Τα skippable frames παραλείπονται.
 */
export function* fileFrames(file: string, start = 0): Generator<FrameInfo> {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    // μικρή κρυφή μνήμη: οι κεφαλίδες των blocks απέχουν έως 128 KB
    let cacheStart = -1;
    let cache = new Uint8Array(0);
    const read: ByteReader = (pos, len) => {
      if (cacheStart < 0 || pos < cacheStart || pos + len > cacheStart + cache.length) {
        const n = Math.max(len, 1 << 16);
        const b = Buffer.alloc(Math.min(n, Math.max(0, size - pos)));
        fs.readSync(fd, b, 0, b.length, pos);
        cache = b;
        cacheStart = pos;
      }
      return cache.subarray(pos - cacheStart, pos - cacheStart + len);
    };
    const magicAt = (p: number): number => (p + 4 <= size ? u32(read(p, 4), 0) : -1);
    const isFrame = (m: number): boolean => m === ZSTD_MAGIC || (m >= SKIP_MIN && m <= SKIP_MAX);
    let pos = start;
    // το skippable frame του pzstd λέει το μέγεθος του επόμενου frame: άλμα χωρίς ανάγνωση όλων των blocks
    let hint = -1;
    while (pos < size) {
      if (hint > 0 && magicAt(pos) === ZSTD_MAGIC && (pos + hint === size || isFrame(magicAt(pos + hint)))) {
        yield { offset: pos, length: hint, skippable: false };
        pos += hint;
        hint = -1;
        continue;
      }
      const f = frameLength(read, pos, size);
      if (f.length < 0) throw new Error(`Κομμένο αρχείο zstd (θέση ${pos} από ${size})`);
      if (!f.skippable) yield { offset: pos, length: f.length, skippable: false };
      hint = f.skippable && f.length === 12 && magicAt(pos) === SKIP_MIN ? u32(read(pos, 12), 8) : -1;
      pos += f.length;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Ανάγνωση ενός frame από αρχείο (σε δικό του ArrayBuffer, ώστε να μεταφέρεται σε worker χωρίς αντιγραφή). */
export function readFrame(file: string, f: Pick<FrameInfo, 'offset' | 'length'>): Buffer {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.from(new ArrayBuffer(f.length));
    let got = 0;
    while (got < f.length) {
      const n = fs.readSync(fd, b, got, f.length - got, f.offset + got);
      if (n <= 0) throw new Error('Απρόσμενο τέλος αρχείου zstd');
      got += n;
    }
    return b;
  } finally {
    fs.closeSync(fd);
  }
}
