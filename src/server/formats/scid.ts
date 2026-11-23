// SPDX-License-Identifier: GPL-3.0-or-later AND MIT
// Derived from Scid, https://github.com/benini/scid (codec_scid4.cpp, game.cpp, position.cpp and bytebuf.h):
// Copyright (C) 1999-2003 Shane Hudson
// Copyright (C) 2006-2009 Pascal Georges
// Copyright (C) 2014-2017 Fulvio Benini
//   index, names, comments and piece lists: GNU GPL, no version number in the original headers (see NOTICES)
// Copyright (C) 2019 Fulvio Benini, bytebuf.h (MIT): move and tag decoding
// Translated to TypeScript and modified for Ruru Chess: 2026-11-16 to 2026-11-22.
// License texts: LICENSE, licenses/NOTICES.txt
/**
 * Βάσεις Scid, μορφή 4 (Scid, Scid vs PC): .si4 (ευρετήριο), .sn4 (ονόματα), .sg4 (παρτίδες).
 * Η ανάγνωση προέρχεται από τον κώδικα του Scid (δες την κεφαλίδα και το licenses/NOTICES.txt).
 * Οι κινήσεις γίνονται tokens του Ruru όπως στο cbh.ts, με τη σειρά της PGN.
 */
import fs from 'node:fs';
import { BISHOP, F_CASTLE, F_EP, KING, KNIGHT, NULL_MOVE, PAWN, Position, QUEEN, ROOK, START_FEN, WHITE, castleRookSquare } from '../../core/chess.ts';
import { TK_COMMENT, TK_NAG, TK_PRE, TK_VEND, TK_VSTART, GF_COMMENTS, GF_NAGS, GF_SETUP, GF_VARIATIONS, GF_ERROR, moveToToken } from '../../core/codec.ts';

const HEADER_SIZE = 182;
const NAME_TYPES = 4; // παίκτες, τουρνουά, τόποι, γύροι

/** Κοινά tags που αποθηκεύονται ως ένα byte (241…250). */
const COMMON_TAGS = ['WhiteCountry', 'BlackCountry', 'Annotator', 'PlyCount', 'EventDate', 'Opening', 'Variation', 'Setup', 'Source', 'SetUp'];
/** Tags που τα βάζουμε εμείς ή που περιγράφουν την αρχική θέση (αυτή έρχεται χωριστά). */
const SKIP_TAGS = new Set(['PlyCount', 'Setup', 'SetUp', 'FEN']);
const RESULTS = ['*', '1-0', '0-1', '1/2-1/2'];

export interface ScidRecord {
  index: number;
  offset: number;
  length: number;
  deleted: boolean;
  white: number;
  black: number;
  event: number;
  site: number;
  round: number;
  result: number;
  eco: number;
  date: number;
  whiteElo: number;
  blackElo: number;
  plies: number;
}

export interface DecodedScidGame {
  startFen: string | null;
  tokens: Uint16Array;
  comments: string[] | null;
  flags: number;
  plies: number;
  error: string | null;
  tags: Record<string, string>;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
/** Κείμενο: UTF-8 αν είναι έγκυρο, αλλιώς Latin-1 (οι παλιές βάσεις). */
function text(b: Uint8Array): string {
  try {
    return utf8.decode(b);
  } catch {
    return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('latin1');
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Ημερομηνία Scid (έτος << 9 | μήνας << 5 | μέρα) σε PGN. */
export function scidDateToPgn(d: number): string {
  const y = d >> 9;
  const m = (d >> 5) & 15;
  const day = d & 31;
  return `${y ? String(y).padStart(4, '0') : '????'}.${m ? pad2(m) : '??'}.${day ? pad2(day) : '??'}`;
}

/** ECO του Scid (0 = κανένα, A00 = 1, κάθε βασικός κωδικός +131) σε «B12». */
export function scidEcoToString(eco: number): string {
  if (!eco) return '';
  const basic = Math.floor((eco - 1) / 131);
  const letter = Math.floor(basic / 100);
  if (letter > 4) return '';
  return String.fromCharCode(65 + letter) + pad2(basic % 100);
}

// διαφορές τετραγώνων (a1 = 0 … h8 = 63)
const PAWN_DIFF = [7, 8, 9, 7, 8, 9, 7, 8, 9, 7, 8, 9, 7, 8, 9, 16];
const PAWN_PROMO = [0, 0, 0, QUEEN, QUEEN, QUEEN, ROOK, ROOK, ROOK, BISHOP, BISHOP, BISHOP, KNIGHT, KNIGHT, KNIGHT, 0];
const KNIGHT_DIFF = [0, -17, -15, -10, -6, 6, 10, 15, 17];
const KING_DIFF = [0, -9, -8, -7, -1, 1, 7, 8, 9];

const ENCODE_NAG = 11;
const ENCODE_COMMENT = 12;
const ENCODE_START_MARKER = 13;
const ENCODE_END_MARKER = 14;
const ENCODE_END_GAME = 15;

const to88 = (sq: number) => (sq >> 3) * 16 + (sq & 7);
const to64 = (sq: number) => (sq >> 4) * 8 + (sq & 7);

/** Λίστες κομματιών του Scid: σε κάθε κίνηση το byte λέει «κομμάτι νούμερο Ν» (ο βασιλιάς είναι πάντα 0). */
interface Lists {
  sq: Int8Array; // [χρώμα * 16 + αριθμός] → τετράγωνο 0–63
  at: Int8Array; // τετράγωνο → αριθμός
  count: Int8Array; // [χρώμα]
}
const cloneLists = (l: Lists): Lists => ({ sq: l.sq.slice(), at: l.at.slice(), count: l.count.slice() });

const STD_ORDER = [4, 0, 1, 2, 3, 5, 6, 7]; // e, a, b, c, d, f, g, h (ο βασιλιάς πρώτος)

/** Η αρχή: όπως το Position::StdStart του Scid, ή για FEN από αριστερά προς τα δεξιά με τον βασιλιά στο 0. */
function initLists(pos: Position, standard: boolean): Lists {
  const l: Lists = { sq: new Int8Array(32).fill(-1), at: new Int8Array(64).fill(-1), count: new Int8Array(2) };
  const add = (c: number, sq: number) => {
    const i = l.count[c]++;
    if (i >= 16) throw new Error('Πάνω από 16 κομμάτια');
    l.sq[c * 16 + i] = sq;
    l.at[sq] = i;
    return i;
  };
  if (standard) {
    for (const f of STD_ORDER) {
      add(WHITE, f);
      add(1, 56 + f);
    }
    for (let f = 0; f < 8; f++) {
      add(WHITE, 8 + f);
      add(1, 48 + f);
    }
    return l;
  }
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const p = pos.board[rank * 16 + file];
      if (!p) continue;
      const c = p >> 3;
      const sq = rank * 8 + file;
      const i = add(c, sq);
      if ((p & 7) === KING && i !== 0) {
        // ο βασιλιάς ανταλλάσσει θέση με το κομμάτι 0
        const s0 = l.sq[c * 16];
        l.sq[c * 16] = sq;
        l.at[sq] = 0;
        l.sq[c * 16 + i] = s0;
        l.at[s0] = i;
      }
    }
  }
  return l;
}

/** Ανοιχτή βάση Scid (μορφή 4· και η παλιά 3 με εγγραφές 46 bytes). */
export class ScidDatabase {
  readonly count: number;
  readonly version: number;
  readonly missing: string[] = [];
  private readonly entrySize: number;
  private readonly idx: number;
  private readonly games: number;
  private readonly names: string[][] = [[], [], [], []];
  private block: Buffer | null = null;
  private blockFirst = -1;
  private readonly pos = new Position();

  constructor(file: string) {
    const base = file.replace(/\.si4$/i, '');
    this.idx = fs.openSync(file, 'r');
    const h = Buffer.alloc(HEADER_SIZE);
    fs.readSync(this.idx, h, 0, HEADER_SIZE, 0);
    if (h.toString('latin1', 0, 8) !== 'Scid.si\0') {
      fs.closeSync(this.idx);
      throw new Error('Δεν είναι βάση Scid (.si4)');
    }
    this.version = h.readUInt16BE(8);
    if (this.version < 300 || this.version > 400) {
      fs.closeSync(this.idx);
      throw new Error(`Άγνωστη έκδοση βάσης Scid (${this.version})`);
    }
    this.entrySize = this.version >= 400 ? 47 : 46;
    const headerSize = this.version >= 400 ? HEADER_SIZE : HEADER_SIZE - 54;
    const fromHeader = h.readUIntBE(14, 3);
    // μισό αρχείο: όσες εγγραφές χωράνε
    const fit = Math.floor((fs.fstatSync(this.idx).size - headerSize) / this.entrySize);
    this.count = Math.max(0, Math.min(fromHeader, fit));
    this.headerSize = headerSize;
    if (!fs.existsSync(`${base}.sn4`)) this.missing.push('.sn4');
    if (!fs.existsSync(`${base}.sg4`)) this.missing.push('.sg4');
    this.games = this.missing.includes('.sg4') ? -1 : fs.openSync(`${base}.sg4`, 'r');
    if (!this.missing.includes('.sn4')) this.readNames(`${base}.sn4`);
  }

  private readonly headerSize: number;

  /** Τα ονόματα (.sn4): ταξινομημένα, με front-coding, και το id τους στο ευρετήριο. */
  private readNames(file: string): void {
    const b = fs.readFileSync(file);
    if (b.toString('latin1', 0, 8) !== 'Scid.sn\0') throw new Error('Χαλασμένο αρχείο ονομάτων (.sn4)');
    let at = 12;
    const num: number[] = [];
    const maxFreq: number[] = [];
    for (let t = 0; t < NAME_TYPES; t++, at += 3) num.push(b.readUIntBE(at, 3));
    for (let t = 0; t < NAME_TYPES; t++, at += 3) maxFreq.push(b.readUIntBE(at, 3));
    const prev = Buffer.alloc(256);
    for (let t = 0; t < NAME_TYPES; t++) {
      const list: string[] = new Array(num[t]);
      const idBytes = num[t] >= 65536 ? 3 : 2;
      const freqBytes = maxFreq[t] >= 65536 ? 3 : maxFreq[t] >= 256 ? 2 : 1;
      for (let i = 0; i < num[t]; i++) {
        if (at + idBytes + freqBytes + 1 > b.length) throw new Error('Κομμένο αρχείο ονομάτων (.sn4)');
        const id = b.readUIntBE(at, idBytes);
        at += idBytes + freqBytes;
        const length = b[at++];
        const prefix = i > 0 ? b[at++] : 0;
        if (prefix > length || at + length - prefix > b.length) throw new Error('Χαλασμένο αρχείο ονομάτων (.sn4)');
        b.copy(prev, prefix, at, at + length - prefix);
        at += length - prefix;
        if (id < num[t]) list[id] = text(prev.subarray(0, length));
      }
      this.names[t] = list;
    }
  }

  /** Εγγραφή του ευρετηρίου (0 = πρώτη παρτίδα). */
  record(i: number): ScidRecord {
    const per = 4096;
    const first = i - (i % per);
    if (first !== this.blockFirst || !this.block) {
      const n = Math.min(per, this.count - first);
      this.block = Buffer.alloc(n * this.entrySize);
      fs.readSync(this.idx, this.block, 0, this.block.length, this.headerSize + first * this.entrySize);
      this.blockFirst = first;
    }
    const b = this.block;
    let at = (i - first) * this.entrySize;
    const offset = b.readUInt32BE(at);
    const lenLow = b.readUInt16BE(at + 4);
    at += 6;
    const lenFlags = this.version >= 400 ? b[at++] : 0;
    const flags = ((lenFlags & 0x3f) << 16) | b.readUInt16BE(at);
    at += 2;
    const wb = b[at];
    const white = ((wb & 0xf0) << 12) | b.readUInt16BE(at + 1);
    const black = ((wb & 0x0f) << 16) | b.readUInt16BE(at + 3);
    const esr = b[at + 5];
    const event = ((esr & 0xe0) << 11) | b.readUInt16BE(at + 6);
    const site = ((esr & 0x1c) << 14) | b.readUInt16BE(at + 8);
    const round = ((esr & 0x03) << 16) | b.readUInt16BE(at + 10);
    const varCounts = b.readUInt16BE(at + 12);
    const eco = b.readUInt16BE(at + 14);
    const date = b.readUInt32BE(at + 16) & 0xfffff;
    const whiteElo = b.readUInt16BE(at + 20) & 0xfff;
    const blackElo = b.readUInt16BE(at + 22) & 0xfff;
    const plies = ((b[at + 29] & 0xc0) << 2) | b[at + 28];
    return {
      index: i,
      offset,
      length: ((lenFlags & 0x80) << 9) | lenLow,
      deleted: Boolean(flags & (1 << 3)),
      white,
      black,
      event,
      site,
      round,
      result: (varCounts >> 12) & 0x0f,
      eco,
      date,
      whiteElo,
      blackElo,
      plies,
    };
  }

  private name(t: number, id: number): string {
    return this.names[t][id] ?? '';
  }

  /** Τα βασικά tags από το ευρετήριο και τα ονόματα. */
  headers(r: ScidRecord): Record<string, string> {
    const h: Record<string, string> = {};
    h.Event = this.name(1, r.event) || '?';
    h.Site = this.name(2, r.site) || '?';
    h.Date = scidDateToPgn(r.date);
    h.Round = this.name(3, r.round) || '?';
    h.White = this.name(0, r.white) || '?';
    h.Black = this.name(0, r.black) || '?';
    h.Result = RESULTS[r.result] ?? '*';
    if (r.whiteElo) h.WhiteElo = String(r.whiteElo);
    if (r.blackElo) h.BlackElo = String(r.blackElo);
    const eco = scidEcoToString(r.eco);
    if (eco) h.ECO = eco;
    return h;
  }

  /** Η παρτίδα (.sg4): tags, αρχική θέση, κινήσεις με βαριάντες / NAG / σχόλια. */
  decodeGame(r: ScidRecord): DecodedScidGame {
    const fail = (error: string): DecodedScidGame => ({ startFen: null, tokens: new Uint16Array(0), comments: null, flags: GF_ERROR, plies: 0, error, tags: {} });
    if (this.games < 0) return fail('Λείπει το αρχείο παρτίδων (.sg4)');
    if (!r.length) return fail('Κενή εγγραφή');
    const buf = Buffer.alloc(r.length);
    const got = fs.readSync(this.games, buf, 0, r.length, r.offset);
    if (got < r.length) return fail('Κομμένο αρχείο παρτίδων (.sg4)');
    return decodeScidGame(buf, this.pos);
  }

  close(): void {
    try {
      fs.closeSync(this.idx);
      if (this.games >= 0) fs.closeSync(this.games);
    } catch {
      // ήδη κλειστά
    }
  }
}

// είδη γεγονότων στη σειρά της PGN
const EV_MOVE = 0;
const EV_NAG = 1;
const EV_VSTART = 2;
const EV_VEND = 3;

/** Αποκωδικοποίηση μιας εγγραφής .sg4 (εξάγεται για τα τεστ). */
export function decodeScidGame(buf: Buffer, pos: Position = new Position()): DecodedScidGame {
  const n = buf.length;
  let at = 0;
  const tags: Record<string, string> = {};
  const fail = (error: string, startFen: string | null = null): DecodedScidGame => ({ startFen, tokens: new Uint16Array(0), comments: null, flags: GF_ERROR | (startFen ? GF_SETUP : 0), plies: 0, error, tags });

  // 1. επιπλέον tags
  for (;;) {
    if (at >= n) return fail('Κομμένα tags');
    const tl = buf[at++];
    if (tl === 0) break;
    let tag = '';
    if (tl > 240) tag = COMMON_TAGS[tl - 241] ?? '';
    else {
      tag = buf.toString('latin1', at, at + tl);
      at += tl;
    }
    const vl = tl !== 255 ? buf[at++] : 3;
    const value = buf.subarray(at, at + vl);
    at += vl;
    if (at >= n) return fail('Κομμένα tags');
    if (tl === 255) {
      const d = (value[0] << 16) | (value[1] << 8) | value[2];
      if (d) tags.EventDate = scidDateToPgn(d);
    } else if (tag && !SKIP_TAGS.has(tag)) tags[tag] = text(value);
  }

  // 2. αρχική θέση
  const gameFlags = buf[at++];
  let startFen: string | null = null;
  if (gameFlags & 1) {
    const z = buf.indexOf(0, at);
    if (z < 0) return fail('Κομμένη αρχική θέση');
    startFen = buf.toString('latin1', at, z).trim();
    at = z + 1;
  }
  try {
    pos.setFen(startFen ?? START_FEN);
  } catch (e) {
    return fail(`Άκυρη αρχική θέση: ${(e as Error).message}`, startFen);
  }
  let lists: Lists;
  try {
    lists = initLists(pos, !startFen);
  } catch (e) {
    return fail((e as Error).message, startFen);
  }

  // 3. κινήσεις: γεγονότα με τη σειρά της PGN (τα σχόλια έρχονται στο τέλος)
  const evKind: number[] = [];
  const evVal: number[] = [];
  // όποιο μπορεί να έχει σχόλιο: η αρχή (-1), μια κίνηση ή η αρχή μιας βαριάντας, με τη σειρά της PGN
  const receivers: number[] = [-1];
  const marks: number[] = [];
  let lastReceiver = -1;
  let prevSnap: { pos: Position; lists: Lists } | null = null;
  const stack: Array<{ pos: Position; lists: Lists; prevSnap: { pos: Position; lists: Lists } | null; lastReceiver: number }> = [];
  let mainPlies = 0;
  let error: string | null = null;

  const push = (k: number, v: number) => {
    evKind.push(k);
    evVal.push(v);
    return evKind.length - 1;
  };

  for (;;) {
    if (at >= n) {
      error = 'Λείπει το τέλος της παρτίδας';
      break;
    }
    const b = buf[at++];
    if (b === ENCODE_NAG) {
      if (at >= n) {
        error = 'Κομμένο NAG';
        break;
      }
      push(EV_NAG, buf[at++]);
      continue;
    }
    if (b === ENCODE_COMMENT) {
      marks.push(lastReceiver);
      continue;
    }
    if (b === ENCODE_START_MARKER) {
      if (!prevSnap) {
        error = 'Βαριάντα χωρίς κίνηση';
        break;
      }
      stack.push({ pos: pos.clone(), lists: cloneLists(lists), prevSnap, lastReceiver });
      pos.copyFrom(prevSnap.pos);
      lists = cloneLists(prevSnap.lists);
      prevSnap = null;
      const id = push(EV_VSTART, 0);
      receivers.push(id);
      lastReceiver = id;
      continue;
    }
    if (b === ENCODE_END_MARKER) {
      const back = stack.pop();
      if (!back) {
        error = 'Τέλος βαριάντας στην κύρια γραμμή';
        break;
      }
      push(EV_VEND, 0);
      pos.copyFrom(back.pos);
      lists = back.lists;
      prevSnap = back.prevSnap;
      lastReceiver = back.lastReceiver;
      continue;
    }
    if (b === ENCODE_END_GAME) {
      if (stack.length) error = 'Τέλος παρτίδας μέσα σε βαριάντα';
      break;
    }

    // κίνηση: κομμάτι νούμερο (4 bits) + κωδικός (4 bits)
    const us = pos.turn;
    const num = b >> 4;
    const code = b & 15;
    const from = num < lists.count[us] ? lists.sq[us * 16 + num] : -1;
    if (from < 0) {
      error = 'Αναφορά σε κομμάτι που δεν υπάρχει';
      break;
    }
    const piece = pos.board[to88(from)];
    if (!piece || piece >> 3 !== us) {
      error = 'Λάθος κομμάτι στη λίστα';
      break;
    }
    const type = piece & 7;
    let to = -1;
    let promo = 0;
    let isNull = false;
    switch (type) {
      case PAWN:
        to = us === WHITE ? from + PAWN_DIFF[code] : from - PAWN_DIFF[code];
        promo = PAWN_PROMO[code];
        break;
      case BISHOP: {
        const fd = (code & 7) - (from & 7);
        to = code >= 8 ? from - 7 * fd : from + 9 * fd;
        break;
      }
      case KNIGHT:
        to = code >= 1 && code <= 8 ? from + KNIGHT_DIFF[code] : -1;
        break;
      case QUEEN:
        // διαγώνια κίνηση βασίλισσας: δεύτερο byte = 64 + προορισμός· αλλιώς όπως ο πύργος
        if (code === (from & 7)) to = at < n ? buf[at++] - 64 : -1;
        else to = code >= 8 ? (code - 8) * 8 + (from & 7) : (from & 56) + code;
        break;
      case ROOK:
        to = code >= 8 ? (code - 8) * 8 + (from & 7) : (from & 56) + code;
        break;
      case KING:
        if (code === 0) isNull = true;
        else if (code <= 8) to = from + KING_DIFF[code];
        else if (code === 9) to = from - 2;
        else if (code === 10) to = from + 2;
        break;
    }

    // κοιτάμε μπροστά: αν ακολουθεί βαριάντα, κρατάμε τη θέση πριν από την κίνηση
    let j = at;
    while (j < n && (buf[j] === ENCODE_NAG || buf[j] === ENCODE_COMMENT)) j += buf[j] === ENCODE_NAG ? 2 : 1;
    const snap = j < n && buf[j] === ENCODE_START_MARKER ? { pos: pos.clone(), lists: cloneLists(lists) } : null;

    let m: number;
    if (isNull) {
      m = NULL_MOVE;
    } else {
      if (to < 0 || to > 63 || to === from) {
        error = 'Άκυρη κίνηση';
        break;
      }
      const f88 = to88(from);
      const t88 = to88(to);
      m = pos.buildMove(f88, t88, promo);
      const target = pos.board[t88];
      if ((target && target >> 3 === us && !(m & F_CASTLE)) || !pos.isLegalPseudo(m)) {
        error = 'Άκυρη κίνηση';
        break;
      }
      // λίστες: πρώτα η αιχμαλωσία (το τελευταίο κομμάτι παίρνει τη θέση του), μετά η κίνηση
      const them = us ^ 1;
      const cap = m & F_EP ? to + (us === WHITE ? -8 : 8) : m & F_CASTLE ? -1 : target ? to : -1;
      if (cap >= 0) {
        const ci = lists.at[cap];
        const last = --lists.count[them];
        const lastSq = lists.sq[them * 16 + last];
        lists.sq[them * 16 + ci] = lastSq;
        lists.at[lastSq] = ci;
        lists.sq[them * 16 + last] = -1;
      }
      if (m & F_CASTLE) {
        const kingTo = to64((m >> 7) & 0x7f);
        const rookFrom = to64(castleRookSquare(m));
        const rookTo = kingTo > from ? kingTo - 1 : kingTo + 1;
        const ri = lists.at[rookFrom];
        lists.sq[us * 16] = kingTo;
        lists.at[kingTo] = 0;
        lists.sq[us * 16 + ri] = rookTo;
        lists.at[rookTo] = ri;
      } else {
        lists.sq[us * 16 + num] = to;
        lists.at[to] = num;
      }
    }
    pos.makeMove(m);
    prevSnap = snap;
    const id = push(EV_MOVE, moveToToken(m));
    receivers.push(id);
    lastReceiver = id;
    if (!stack.length) mainPlies++;
  }
  // βαριάντες που έμειναν ανοιχτές από σφάλμα
  for (let k = stack.length; k > 0; k--) push(EV_VEND, 0);

  // 4. σχόλια: όσα έχουν σημάδι με τη σειρά τους· τα υπόλοιπα στις επόμενες κινήσεις (βάσεις «όλα σχολιασμένα»)
  const commentFor = new Map<number, string>();
  if (!error) {
    let k = 0;
    let rIdx = 0;
    while (at < n) {
      const z = buf.indexOf(0, at);
      if (z < 0) break;
      const s = text(buf.subarray(at, z));
      at = z + 1;
      let target: number;
      if (k < marks.length) {
        target = marks[k++];
        rIdx = receivers.indexOf(target) + 1;
      } else {
        if (rIdx >= receivers.length) break;
        target = receivers[rIdx++];
      }
      if (s.trim()) commentFor.set(target, commentFor.has(target) ? `${commentFor.get(target)} ${s}` : s);
    }
  }

  // 5. tokens
  const out: number[] = [];
  const comments: string[] = [];
  let flags = startFen ? GF_SETUP : 0;
  if (error) flags |= GF_ERROR;
  const addComment = (s: string | undefined, pre: boolean) => {
    if (!s || comments.length >= 0x1fff) return;
    out.push((pre ? TK_PRE : TK_COMMENT) | comments.length);
    comments.push(s.trim());
    flags |= GF_COMMENTS;
  };
  addComment(commentFor.get(-1), false);
  let post: string | undefined;
  let pre: string | undefined;
  for (let i = 0; i < evKind.length; i++) {
    const k = evKind[i];
    if (k === EV_NAG) {
      out.push(TK_NAG | evVal[i]);
      flags |= GF_NAGS;
      continue;
    }
    addComment(post, false);
    post = undefined;
    if (k === EV_MOVE) {
      addComment(pre, true);
      pre = undefined;
      out.push(evVal[i]);
      post = commentFor.get(i);
    } else if (k === EV_VSTART) {
      out.push(TK_VSTART);
      flags |= GF_VARIATIONS;
      pre = commentFor.get(i);
    } else {
      addComment(pre, false);
      pre = undefined;
      out.push(TK_VEND);
    }
  }
  addComment(post, false);
  return { startFen, tokens: Uint16Array.from(out), comments: comments.length ? comments : null, flags, plies: mainPlies, error, tags };
}
