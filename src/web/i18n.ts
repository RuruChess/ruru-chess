/** Δύο γλώσσες: αγγλικά (προεπιλογή) και ελληνικά. Χρήση: L('Βάσεις', 'Databases'). */
let lang: 'el' | 'en' = 'en';

export function setLanguage(l: 'el' | 'en'): void {
  lang = l;
  document.documentElement.lang = l;
}

export function language(): 'el' | 'en' {
  return lang;
}

export function L(el: string, en: string): string {
  return lang === 'el' ? el : en;
}

const nf = () => new Intl.NumberFormat(lang === 'el' ? 'el-GR' : 'en-US');

export function fmtNum(n: number): string {
  return nf().format(n);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 20040500 → «2004.05.??» */
export function fmtDate(d: number): string {
  if (!d) return '';
  const y = Math.floor(d / 10000);
  const m = Math.floor(d / 100) % 100;
  const day = d % 100;
  if (!m) return String(y);
  if (!day) return `${y}.${String(m).padStart(2, '0')}`;
  return `${y}.${String(m).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
}

export const RESULTS = ['*', '1-0', '½-½', '0-1'];

export function resultText(r: number): string {
  return RESULTS[r] ?? '*';
}
