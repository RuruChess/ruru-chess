/**
 * Ταξινόμηση ανοιγμάτων (ECO) με αναζήτηση θέσης — έτσι πιάνει και τις
 * μεταθέσεις. Τα δεδομένα: lichess-org/chess-openings (CC0).
 */
import { Position, START_FEN } from './chess.ts';

export interface OpeningInfo {
  eco: string;
  name: string;
  /** κινήσεις της γραμμής αναφοράς (SAN, «1. e4 e5 ...») */
  pgn: string;
}

export class EcoBook {
  readonly entries: OpeningInfo[] = [];
  private keysHi: Int32Array;
  private keysLo: Int32Array;
  private vals: Int32Array;
  private mask: number;

  constructor(tsv: string) {
    const lines = tsv.split(/\r?\n/);
    const tmp: Array<[number, number, number]> = [];
    const pos = new Position();
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const [eco, name, pgn] = line.split('\t');
      if (!eco || !pgn) continue;
      pos.setFen(START_FEN);
      let ok = true;
      for (const tok of pgn.split(/\s+/)) {
        if (!tok || /^\d+\.+$/.test(tok)) continue;
        const m = pos.parseSan(tok);
        if (!m) {
          ok = false;
          break;
        }
        pos.makeMove(m);
      }
      if (!ok) continue;
      this.entries.push({ eco, name, pgn });
      tmp.push([pos.hashHi, pos.hashLo, this.entries.length - 1]);
    }
    let size = 1;
    while (size < tmp.length * 2) size <<= 1;
    this.mask = size - 1;
    this.keysHi = new Int32Array(size);
    this.keysLo = new Int32Array(size);
    this.vals = new Int32Array(size).fill(-1);
    for (const [hi, lo, v] of tmp) {
      let s = lo & this.mask;
      while (this.vals[s] >= 0) {
        if (this.keysHi[s] === hi && this.keysLo[s] === lo) break;
        s = (s + 1) & this.mask;
      }
      if (this.vals[s] >= 0) continue; // η πρώτη καταχώριση κερδίζει
      this.keysHi[s] = hi;
      this.keysLo[s] = lo;
      this.vals[s] = v;
    }
  }

  /** Βρίσκει το άνοιγμα μιας θέσης (ή null). */
  lookup(hi: number, lo: number): OpeningInfo | null {
    let s = lo & this.mask;
    while (this.vals[s] >= 0) {
      if (this.keysHi[s] === hi && this.keysLo[s] === lo) return this.entries[this.vals[s]];
      s = (s + 1) & this.mask;
    }
    return null;
  }

  /** Το βαθύτερο άνοιγμα που συναντά μια σειρά θέσεων (hashes). */
  classifyHashes(hi: Int32Array, lo: Int32Array, count: number): OpeningInfo | null {
    let best: OpeningInfo | null = null;
    for (let i = 0; i < count; i++) {
      const o = this.lookup(hi[i], lo[i]);
      if (o) best = o;
    }
    return best;
  }

  /** Ταξινόμηση από λίστα κινήσεων SAN. */
  classifySan(sans: string[], startFen = START_FEN): OpeningInfo | null {
    const pos = Position.fromFen(startFen);
    let best = this.lookup(pos.hashHi, pos.hashLo);
    for (const s of sans) {
      const m = pos.parseSan(s);
      if (!m) break;
      pos.makeMove(m);
      best = this.lookup(pos.hashHi, pos.hashLo) ?? best;
    }
    return best;
  }
}
