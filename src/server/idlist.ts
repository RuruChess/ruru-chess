/** Λίστες παρτίδων (id) για τις προβολές: πίνακας ή συνεχόμενο εύρος χωρίς μνήμη. */

export interface IdList {
  readonly length: number;
  at(i: number): number;
  slice(start: number, end: number): Int32Array;
  indexOf(id: number): number;
  [Symbol.iterator](): Iterator<number>;
}

export class ArrayIds implements IdList {
  readonly a: Int32Array;

  constructor(a: Int32Array) {
    this.a = a;
  }

  get length(): number {
    return this.a.length;
  }

  at(i: number): number {
    return this.a[i];
  }

  slice(start: number, end: number): Int32Array {
    return this.a.subarray(start, end);
  }

  indexOf(id: number): number {
    return this.a.indexOf(id);
  }

  [Symbol.iterator](): Iterator<number> {
    return this.a[Symbol.iterator]();
  }
}

/** Τα id first … first+n−1 (ή ανάποδα) — η βασική λίστα μιας βάσης χωρίς κενά. */
export class RangeIds implements IdList {
  readonly first: number;
  readonly n: number;
  readonly desc: boolean;

  constructor(first: number, n: number, desc: boolean) {
    this.first = first;
    this.n = n;
    this.desc = desc;
  }

  get length(): number {
    return this.n;
  }

  at(i: number): number {
    return this.desc ? this.first + this.n - 1 - i : this.first + i;
  }

  slice(start: number, end: number): Int32Array {
    const s = Math.max(0, start);
    const e = Math.min(end, this.n);
    const out = new Int32Array(Math.max(0, e - s));
    for (let k = 0; k < out.length; k++) out[k] = this.at(s + k);
    return out;
  }

  indexOf(id: number): number {
    const i = this.desc ? this.first + this.n - 1 - id : id - this.first;
    return i >= 0 && i < this.n ? i : -1;
  }

  *[Symbol.iterator](): Iterator<number> {
    for (let i = 0; i < this.n; i++) yield this.at(i);
  }
}
