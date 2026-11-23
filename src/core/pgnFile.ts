/**
 * Αποστολή αρχείων στους Φίλους: μόνο PGN σε απλό κείμενο UTF-8, έως FILE_MAX. Ο ίδιος έλεγχος γίνεται στη σελίδα
 * πριν από την αποστολή, στον server πριν από την αποθήκευση και στον παραλήπτη πριν από την εισαγωγή.
 *
 * Δεκτή είναι η μορφή που γράφει το writeGame: σε κάθε παρτίδα ετικέτες, κινήσεις, σχόλια { }, NAG, βαριάντες και
 * αποτέλεσμα στο τέλος. Οτιδήποτε άλλο απορρίπτεται (και τα «;» και «%», που το Ruru δεν τα γράφει). Ελέγχεται η
 * μορφή: όχι αν οι κινήσεις είναι νόμιμες, ούτε το νόημα των σχολίων.
 *
 * Γρήγορος έλεγχος με πίνακα χαρακτήρων και `indexOf` για σχόλια, ώστε 1 MB να ελέγχεται σε λίγα ms
 * (εντός του ορίου 10 ms CPU του δωρεάν πλάνου Cloudflare Workers/Durable Objects).
 */
import type { Game, GameNode } from './game.ts';
import { writeGame } from './pgn.ts';
import { FILE_MAX } from './social.ts';

export const PGN_MIME = 'application/x-chess-pgn';

export type PgnFileCheck = { games: number; text: string } | { error: 'large' | 'notpgn' };

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
// eslint-disable-next-line no-control-regex
const CONTROL_FAST = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;
const CONTROL_G = /(?![\t\n\r])\p{Cc}/gu;
/** εικόνα ή άλλο αρχείο γραμμένο ως κείμενο: data URI ή μεγάλο base64 χωρίς κενό */
const HAS_BASE64_URI = /;base64,/i;
const DATA_URI = /data:[\w.+-]{1,40}\/[\w.+-]{1,80};base64,/i;
const BASE64_BLOB = /[A-Za-z0-9+/=]{256}/;
const TAG_NAME = /^[\p{L}\p{N}_-]{1,64}$/u;
const TAG_CHAR_U = /[\p{L}\p{N}]/u;
const FEN_START = /^[1-8pnbrqkPNBRQK]+(?:\/[1-8pnbrqkPNBRQK]+){7} [wb]( |$)/;
const TAG_VALUE_MAX = 2000;
const MAX_DEPTH = 512;
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

// μάσκες χαρακτήρων ASCII (0..127) για γρήγορο έλεγχο χωρίς διακλαδώσεις
const F_SPACE = 1;
const F_DIGIT = 2;
const F_FILE = 4;
const F_RANK = 8;
const F_PIECE = 16;
const F_PROMO = 32;
const F_TAG = 64;
const F_DELIM = 128;

const TBL = new Uint8Array(128);
for (const c of [32, 9, 10, 13]) TBL[c] |= F_SPACE | F_DELIM;
for (const c of [40, 41, 123, 125, 36]) TBL[c] |= F_DELIM;
for (let c = 48; c <= 57; c++) TBL[c] |= F_DIGIT | F_TAG;
for (let c = 49; c <= 56; c++) TBL[c] |= F_RANK;
for (let c = 65; c <= 90; c++) TBL[c] |= F_TAG;
for (let c = 97; c <= 122; c++) TBL[c] |= F_TAG;
for (let c = 97; c <= 104; c++) TBL[c] |= F_FILE;
for (const c of [75, 81, 82, 66, 78]) TBL[c] |= F_PIECE;
for (const c of [81, 82, 66, 78]) TBL[c] |= F_PROMO;
TBL[95] |= F_TAG; // _
TBL[45] |= F_TAG; // -

const flagsOf = (c: number) => (c < 128 ? TBL[c] : 0);

/** Διαβάζει κίνηση SAN από τη θέση `start`· επιστρέφει τη νέα θέση ή -1. */
function matchSan(text: string, start: number, end: number): number {
  let i = start;
  const c0 = text.charCodeAt(i);
  const f0 = flagsOf(c0);
  if (f0 & F_PIECE) {
    i++;
    if (i >= end) return -1;
    const c1 = text.charCodeAt(i);
    const f1 = flagsOf(c1);
    if (f1 & F_FILE) {
      if (i + 1 < end && flagsOf(text.charCodeAt(i + 1)) & F_RANK) {
        const after = i + 2;
        if (after < end && (text.charCodeAt(after) === 120 || (flagsOf(text.charCodeAt(after)) & F_FILE))) {
          i = after + (text.charCodeAt(after) === 120 ? 1 : 0);
          if (i + 1 >= end || !(flagsOf(text.charCodeAt(i)) & F_FILE) || !(flagsOf(text.charCodeAt(i + 1)) & F_RANK)) return -1;
          i += 2;
        } else {
          i = after;
        }
      } else {
        i++;
        if (i < end && text.charCodeAt(i) === 120) i++;
        if (i + 1 >= end || !(flagsOf(text.charCodeAt(i)) & F_FILE) || !(flagsOf(text.charCodeAt(i + 1)) & F_RANK)) return -1;
        i += 2;
      }
    } else if (f1 & F_RANK) {
      i++;
      if (i < end && text.charCodeAt(i) === 120) i++;
      if (i + 1 >= end || !(flagsOf(text.charCodeAt(i)) & F_FILE) || !(flagsOf(text.charCodeAt(i + 1)) & F_RANK)) return -1;
      i += 2;
    } else if (c1 === 120) {
      i++;
      if (i + 1 >= end || !(flagsOf(text.charCodeAt(i)) & F_FILE) || !(flagsOf(text.charCodeAt(i + 1)) & F_RANK)) return -1;
      i += 2;
    } else {
      return -1;
    }
  } else if (f0 & F_FILE) {
    i++;
    if (i < end && text.charCodeAt(i) === 120) {
      i++;
      if (i >= end || !(flagsOf(text.charCodeAt(i)) & F_FILE)) return -1;
      i++;
    }
    if (i >= end || !(flagsOf(text.charCodeAt(i)) & F_RANK)) return -1;
    i++;
    if (i < end) {
      const cp = text.charCodeAt(i);
      if (cp === 61) {
        i++;
        if (i >= end || !(flagsOf(text.charCodeAt(i)) & F_PROMO)) return -1;
        i++;
      } else if (flagsOf(cp) & F_PROMO) {
        i++;
      }
    }
  } else if (c0 === 79 || c0 === 48) {
    // O-O / O-O-O / 0-0 / 0-0-0
    if (i + 2 < end && text.charCodeAt(i + 1) === 45 && text.charCodeAt(i + 2) === c0) {
      i += 3;
      if (i + 1 < end && text.charCodeAt(i) === 45 && text.charCodeAt(i + 1) === c0) i += 2;
    } else {
      return -1;
    }
  } else if (c0 === 45 && i + 1 < end && text.charCodeAt(i + 1) === 45) {
    i += 2;
  } else if (c0 === 90 && i + 1 < end && text.charCodeAt(i + 1) === 48) {
    i += 2;
  } else {
    return -1;
  }

  if (i < end) {
    const ch = text.charCodeAt(i);
    if (ch === 43 || ch === 35) i++;
  }
  for (let n = 0; n < 2 && i < end; n++) {
    const ch = text.charCodeAt(i);
    if (ch === 33 || ch === 63) i++;
    else break;
  }
  return i >= end || (flagsOf(text.charCodeAt(i)) & F_DELIM) ? i : -1;
}

/** Είναι PGN που επιτρέπεται να σταλεί; Γραμμικό στο μήκος. */
export function checkPgnFile(data: Uint8Array): PgnFileCheck {
  if (data.byteLength > FILE_MAX) return { error: 'large' };
  const bad = { error: 'notpgn' } as const;
  let text: string;
  try {
    text = UTF8.decode(data);
  } catch {
    return bad; // όχι UTF-8: εικόνα, συμπιεσμένο ή άλλο δυαδικό αρχείο
  }
  if (CONTROL_FAST.test(text)) return bad;
  if (HAS_BASE64_URI.test(text) && DATA_URI.test(text)) return bad;

  const end = text.length;
  let i = 0;
  let games = 0;
  let chess = false; // τουλάχιστον μία κίνηση ή μία θέση σε όλο το αρχείο

  for (;;) {
    while (i < end && (flagsOf(text.charCodeAt(i)) & F_SPACE)) i++;
    if (i >= end) break;

    let tags = 0;
    while (i < end && text.charCodeAt(i) === 91) {
      // [Tag "Value"]
      i++;
      while (i < end && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i++;
      const nameStart = i;
      let nameLen = 0;
      while (i < end) {
        const c = text.charCodeAt(i);
        if (c < 128 && (TBL[c] & F_TAG)) {
          i++;
          nameLen++;
        } else if (c >= 128) {
          const cp = text.codePointAt(i)!;
          const ch = String.fromCodePoint(cp);
          if (!TAG_CHAR_U.test(ch)) break;
          i += ch.length;
          nameLen++;
        } else {
          break;
        }
        if (nameLen > 64) return bad;
      }
      if (!nameLen) return bad;
      const nameEnd = i;
      let sawSep = false;
      while (i < end && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) {
        i++;
        sawSep = true;
      }
      if (!sawSep || i >= end || text.charCodeAt(i) !== 34) return bad;
      i++; // "
      const valStart = i;
      let valCount = 0;
      while (i < end) {
        const c = text.charCodeAt(i);
        if (c === 34) break;
        if (c === 10 || c === 13) return bad;
        if (c === 92) {
          i++;
          if (i >= end) return bad;
          const next = text.charCodeAt(i);
          if (next !== 34 && next !== 92) return bad;
        }
        if (++valCount > TAG_VALUE_MAX) return bad;
        i++;
      }
      if (i >= end || text.charCodeAt(i) !== 34) return bad;
      const valEnd = i;
      if (valEnd - valStart >= 256 && BASE64_BLOB.test(text.slice(valStart, valEnd))) return bad;
      i++; // "
      while (i < end && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i++;
      if (i >= end || text.charCodeAt(i) !== 93) return bad;
      i++; // ]
      if (!chess && nameEnd - nameStart === 3 && text.charCodeAt(nameStart) === 70 && text.charCodeAt(nameStart + 1) === 69 && text.charCodeAt(nameStart + 2) === 78) {
        if (FEN_START.test(text.slice(valStart, valEnd))) chess = true;
      }
      tags++;
      while (i < end && (flagsOf(text.charCodeAt(i)) & F_SPACE)) i++;
    }
    if (!tags) return bad;

    let depth = 0;
    for (;;) {
      while (i < end && (flagsOf(text.charCodeAt(i)) & F_SPACE)) i++;
      if (i >= end) return bad; // χωρίς αποτέλεσμα: μισό αρχείο
      const c = text.charCodeAt(i);
      if (c === 123) {
        // { σχόλιο } — indexOf σε C++ SIMD
        const close = text.indexOf('}', i + 1);
        if (close < 0) return bad;
        if (close - (i + 1) >= 256 && BASE64_BLOB.test(text.slice(i + 1, close))) return bad;
        i = close + 1;
      } else if (c === 40) {
        if (++depth > MAX_DEPTH) return bad;
        i++;
      } else if (c === 41) {
        if (--depth < 0) return bad;
        i++;
      } else if (c === 36) {
        i++;
        let digits = 0;
        while (i < end && (flagsOf(text.charCodeAt(i)) & F_DIGIT) && digits < 4) {
          i++;
          digits++;
        }
        if (!digits || (i < end && !(flagsOf(text.charCodeAt(i)) & F_DELIM))) return bad;
      } else if (!depth && c === 42 && (i + 1 >= end || (flagsOf(text.charCodeAt(i + 1)) & F_SPACE))) {
        i++;
        break;
      } else if (
        !depth &&
        ((c === 49 && text.startsWith('1-0', i) && (i + 3 >= end || (flagsOf(text.charCodeAt(i + 3)) & F_SPACE))) ||
          (c === 48 && text.startsWith('0-1', i) && (i + 3 >= end || (flagsOf(text.charCodeAt(i + 3)) & F_SPACE))))
      ) {
        i += 3;
        break;
      } else if (!depth && c === 49 && text.startsWith('1/2-1/2', i) && (i + 7 >= end || (flagsOf(text.charCodeAt(i + 7)) & F_SPACE))) {
        i += 7;
        break;
      } else {
        const next = matchSan(text, i, end);
        if (next >= 0) {
          i = next;
          chess = true;
        } else if (c < 128 && (TBL[c] & F_DIGIT)) {
          let d = 0;
          while (i < end && (flagsOf(text.charCodeAt(i)) & F_DIGIT) && d < 4) {
            i++;
            d++;
          }
          let dots = 0;
          while (i < end && text.charCodeAt(i) === 46 && dots < 3) {
            i++;
            dots++;
          }
          if (!dots) return bad;
        } else {
          return bad;
        }
      }
    }
    games++;
  }
  return games && chess ? { games, text } : bad;
}

function clearClocks(node: GameNode): void {
  node.clock = '';
  for (const c of node.children) clearClocks(c);
}

/** Μια παρτίδα όπως τη δέχεται το checkPgnFile: από παλιές εισαγωγές μπορεί να έχει χαρακτήρες ελέγχου ή περίεργες ετικέτες. */
export function pgnForSending(game: Game, opts?: { stripClocks?: boolean }): string {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(game.headers)) {
    if (v === undefined || v === null || !TAG_NAME.test(k)) continue;
    headers[k] = String(v).replace(/[\r\n\t]+/g, ' ').slice(0, TAG_VALUE_MAX);
  }
  if (!RESULTS.has(headers.Result)) headers.Result = '*';
  game.headers = headers;
  if (opts?.stripClocks) clearClocks(game.root);
  return writeGame(game).replace(CONTROL_G, ' ');
}

/** Διαβάζει έως `max` bytes και σταματά: null αν είναι περισσότερα (δεν φορτώνεται ποτέ ολόκληρο στη μνήμη). */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
