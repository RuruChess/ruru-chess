/** Ανάγνωση γραμμών του CSV των puzzles του Lichess (11 στήλες· οι στήλες βρίσκονται από την κεφαλίδα). */

export interface LichessRow {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  rd: number;
  popularity: number;
  plays: number;
  themes: string[];
  gameUrl: string;
  openingTags: string;
  /** ms από το 1970 (μόνο για παλιά puzzles της ημέρας), αλλιώς 0 */
  dailyDate: number;
}

/** Οι στήλες που χρειάζονται (ονόματα της κεφαλίδας του Lichess). */
const COLUMNS = ['PuzzleId', 'FEN', 'Moves', 'Rating', 'RatingDeviation', 'Popularity', 'NbPlays', 'Themes', 'GameUrl', 'OpeningTags', 'DailyDate'] as const;
const REQUIRED = 9;

/** Θέση κάθε στήλης στη γραμμή. */
export type ColumnMap = Record<(typeof COLUMNS)[number], number>;

/** Η σημερινή μορφή (2026): 11 στήλες με το DailyDate στο τέλος. */
export const DEFAULT_COLUMNS: ColumnMap = Object.fromEntries(COLUMNS.map((c, i) => [c, i])) as ColumnMap;

/** Χάρτης στηλών από την κεφαλίδα· πετά σφάλμα αν λείπει υποχρεωτική στήλη. */
export function parseHeader(line: string): ColumnMap {
  const names = splitCsv(line.replace(/^﻿/, '').replace(/\r$/, '')).map((s) => s.trim());
  const map = {} as ColumnMap;
  COLUMNS.forEach((c, i) => {
    const k = names.indexOf(c);
    if (k < 0 && i < REQUIRED) throw new Error(`Το αρχείο των puzzles δεν έχει τη στήλη ${c}`);
    map[c] = k;
  });
  return map;
}

/** Χωρισμός γραμμής CSV (με υποστήριξη εισαγωγικών, που το αρχείο του Lichess δεν χρησιμοποιεί). */
export function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const int = (s: string | undefined): number => {
  if (s === undefined || s === '') return NaN;
  const n = Number(s);
  return Number.isInteger(n) ? n : NaN;
};

const words = (s: string | undefined): string[] => (s ? s.split(' ').filter(Boolean) : []);

/**
 * Μία γραμμή → εγγραφή, ή null για κενή γραμμή / κεφαλίδα / γραμμή με λάθος μορφή
 * (το `why` λέει τον λόγο). Δέχεται CRLF.
 */
export function parseLichessLine(raw: string, cols: ColumnMap = DEFAULT_COLUMNS): { row: LichessRow | null; why?: string } {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  if (!line.trim()) return { row: null, why: 'empty' };
  const f = splitCsv(line);
  if (f[cols.PuzzleId] === 'PuzzleId') return { row: null, why: 'header' };
  if (f.length < REQUIRED) return { row: null, why: 'columns' };
  const row: LichessRow = {
    id: f[cols.PuzzleId] ?? '',
    fen: f[cols.FEN] ?? '',
    moves: words(f[cols.Moves]),
    rating: int(f[cols.Rating]),
    rd: int(f[cols.RatingDeviation]),
    popularity: int(f[cols.Popularity]),
    plays: int(f[cols.NbPlays]),
    themes: words(f[cols.Themes]),
    gameUrl: f[cols.GameUrl] ?? '',
    openingTags: cols.OpeningTags >= 0 ? (f[cols.OpeningTags] ?? '').trim() : '',
    dailyDate: cols.DailyDate >= 0 ? int(f[cols.DailyDate]) || 0 : 0,
  };
  if (!row.id || !row.fen) return { row: null, why: 'columns' };
  if (Number.isNaN(row.rating) || Number.isNaN(row.rd) || Number.isNaN(row.popularity) || Number.isNaN(row.plays)) return { row: null, why: 'number' };
  return { row };
}

/** «https://lichess.org/787zsVup/black#48» → { game: '787zsVup', black: true, ply: 48 }. */
export function parseGameUrl(url: string): { game: string; black: boolean; ply: number } | null {
  const m = /lichess\.org\/([A-Za-z0-9]{8})(\/black|\/white)?(?:#(\d+))?/.exec(url);
  if (!m) return null;
  return { game: m[1], black: m[2] === '/black', ply: m[3] ? Number(m[3]) : 0 };
}

/** Ποιότητα εισαγωγής: ελάχιστη δημοτικότητα, ελάχιστες προσπάθειες, μέγιστο RD. */
export interface QualityFilter {
  minPopularity: number;
  minPlays: number;
  maxRd: number;
}

/** Έτοιμες επιλογές (μετρήσεις της έρευνας, πλήρες αρχείο 2026-10). */
export const QUALITY_PRESETS: Record<string, QualityFilter & { count: number; mb: number; el: string; en: string }> = {
  all: { minPopularity: -100, minPlays: 0, maxRd: 1000, count: 6_157_341, mb: 563, el: 'Όλα', en: 'All' },
  broad: { minPopularity: 70, minPlays: 100, maxRd: 1000, count: 4_707_738, mb: 430, el: 'Ευρύ', en: 'Broad' },
  default: { minPopularity: 80, minPlays: 100, maxRd: 1000, count: 4_433_190, mb: 405, el: 'Προτεινόμενο', en: 'Recommended' },
  strict: { minPopularity: 80, minPlays: 300, maxRd: 100, count: 3_129_129, mb: 286, el: 'Αυστηρό', en: 'Strict' },
  popular: { minPopularity: 90, minPlays: 300, maxRd: 1000, count: 2_704_970, mb: 247, el: 'Δημοφιλή', en: 'Popular' },
  lite: { minPopularity: 90, minPlays: 1000, maxRd: 1000, count: 1_711_830, mb: 157, el: 'Ελαφρύ', en: 'Lite' },
  liteStable: { minPopularity: 90, minPlays: 1000, maxRd: 80, count: 1_339_563, mb: 122, el: 'Ελαφρύ, σταθεροί βαθμοί', en: 'Lite, stable ratings' },
};

/** Φίλτρο από επιλογή του χρήστη: όνομα έτοιμης επιλογής ή αντικείμενο με όρια. */
export function qualityFrom(q: unknown): { key: string; filter: QualityFilter } {
  if (typeof q === 'string' && QUALITY_PRESETS[q]) {
    const { minPopularity, minPlays, maxRd } = QUALITY_PRESETS[q];
    return { key: q, filter: { minPopularity, minPlays, maxRd } };
  }
  if (q && typeof q === 'object') {
    const o = q as Partial<QualityFilter>;
    const filter: QualityFilter = {
      minPopularity: Number.isFinite(o.minPopularity) ? Number(o.minPopularity) : 80,
      minPlays: Number.isFinite(o.minPlays) ? Number(o.minPlays) : 100,
      maxRd: Number.isFinite(o.maxRd) ? Number(o.maxRd) : 1000,
    };
    return { key: `custom:${filter.minPopularity}/${filter.minPlays}/${filter.maxRd}`, filter };
  }
  return qualityFrom('default');
}

export const passesQuality = (r: LichessRow, q: QualityFilter): boolean => r.popularity >= q.minPopularity && r.plays >= q.minPlays && r.rd <= q.maxRd;
