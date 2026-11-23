/** Βοηθητικά κειμένου: κανονικοποίηση για αναζήτηση, ημερομηνίες, αποτελέσματα. */

/** Κλειδί αναζήτησης: πεζά, χωρίς τόνους/διαλυτικά, «ς» → «σ». */
export function searchKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .trim();
}

/** Λέξεις ενός κλειδιού ονόματος: «vachier-lagrave, maxime» → ['vachier', 'lagrave', 'maxime']. */
export function nameWords(key: string): string[] {
  return key.split(/[\s,.\-'’()]+/).filter(Boolean);
}

/** «2004.05.??» → 20040500 (0 για άγνωστα μέρη). */
export function parsePgnDate(s: string | undefined): number {
  if (!s) return 0;
  const m = /^(\d{1,4}|\?+)[.\-/](\d{1,2}|\?+)[.\-/](\d{1,2}|\?+)/.exec(s.trim());
  if (!m) {
    const y = /^(\d{4})/.exec(s.trim());
    return y ? Number(y[1]) * 10000 : 0;
  }
  const y = /^\d+$/.test(m[1]) ? Number(m[1]) : 0;
  const mo = /^\d+$/.test(m[2]) ? Number(m[2]) : 0;
  const d = /^\d+$/.test(m[3]) ? Number(m[3]) : 0;
  if (y > 2999 || mo > 12 || d > 31) return y <= 2999 ? y * 10000 : 0;
  return y * 10000 + mo * 100 + d;
}

export function formatPgnDate(n: number): string {
  if (!n) return '????.??.??';
  const y = Math.floor(n / 10000);
  const m = Math.floor(n / 100) % 100;
  const d = n % 100;
  return `${y ? String(y).padStart(4, '0') : '????'}.${m ? String(m).padStart(2, '0') : '??'}.${d ? String(d).padStart(2, '0') : '??'}`;
}

/** 0 = *, 1 = 1-0, 2 = ½-½, 3 = 0-1 */
export function parseResult(s: string | undefined): number {
  switch ((s ?? '').trim()) {
    case '1-0':
      return 1;
    case '1/2-1/2':
    case '½-½':
    case '1/2':
      return 2;
    case '0-1':
      return 3;
    default:
      return 0;
  }
}

export const RESULT_TEXT = ['*', '1-0', '1/2-1/2', '0-1'];

export function parseElo(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 && n < 4000 ? n : 0;
}

/** Ασφαλές όνομα αρχείου (Windows). */
export function safeFileName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'βάση';
}
