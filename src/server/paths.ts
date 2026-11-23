/** Φάκελοι του Ruru στον υπολογιστή. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_SUBDIR, OLD_APP_SUBDIR, OLD_NAME, appFolder, documentsDir } from './rename.ts';

const home = os.homedir();

/** Φάκελος της εφαρμογής: εκεί είναι το package.json και, από τον εγκαταστάτη, το preset.json. */
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Επιλογές του εγκαταστάτη για την πρώτη εκκίνηση: αυτόματες λήψεις και γλώσσα. */
export interface Preset {
  engine?: string;
  language?: 'el' | 'en';
}

export function readPreset(): Preset {
  try {
    return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'preset.json'), 'utf8')) as Preset;
  } catch {
    return {};
  }
}

/** Παλιός φάκελος ρυθμίσεων (%APPDATA%\SkakiBase, πριν από τα Έγγραφα): μεταφέρεται μία φορά στον νέο. */
const LEGACY_APP_DIR = path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), OLD_NAME);

/** Ο φάκελος βάσεων πριν από τη μετονομασία (Έγγραφα\SkakiBase, βλ. rename.ts). */
const OLD_DATA_DIR = path.join(documentsDir(), OLD_NAME);

/** Οι βάσεις του χρήστη (Έγγραφα\Ruru ή, από παλιότερη έκδοση, Έγγραφα\KnightBase· ο παλιός Έγγραφα\SkakiBase όσο δεν έχει μετονομαστεί). */
export function defaultDatabasesDir(): string {
  const dir = appFolder(documentsDir());
  return !fs.existsSync(dir) && fs.existsSync(OLD_DATA_DIR) ? OLD_DATA_DIR : dir;
}

/**
 * Ρυθμίσεις, κατάλογος βάσεων και πρόοδος εκπαίδευσης: <φάκελος βάσεων>\.knightbase.
 * Όχι στο %APPDATA%: όταν ο server ξεκινά μέσα από εφαρμογή-πακέτο (MSIX, π.χ. το Claude),
 * τα Windows ανακατευθύνουν σιωπηλά τις εγγραφές του %APPDATA% σε ιδιωτικό φάκελο του
 * πακέτου, και η εφαρμογή από τη συντόμευση έβλεπε άλλον κατάλογο βάσεων.
 */
export const APP_DIR = (() => {
  const dir = defaultDatabasesDir();
  const old = !fs.existsSync(path.join(dir, APP_SUBDIR)) && fs.existsSync(path.join(dir, OLD_APP_SUBDIR));
  return path.join(dir, old ? OLD_APP_SUBDIR : APP_SUBDIR);
})();

/** Μία φορά: αντιγραφή από τον παλιό φάκελο, αν ο νέος δεν έχει ακόμη κατάλογο βάσεων. */
export function migrateAppDir(): void {
  if (fs.existsSync(path.join(APP_DIR, 'library.json')) || !fs.existsSync(path.join(LEGACY_APP_DIR, 'library.json'))) return;
  fs.mkdirSync(APP_DIR, { recursive: true });
  fs.cpSync(LEGACY_APP_DIR, APP_DIR, { recursive: true });
}

/**
 * Μετά τη μετονομασία του φακέλου βάσεων: οι διαδρομές που γράφτηκαν πριν (κατάλογος, φάκελος βάσεων,
 * μηχανές, βιβλίο ανοιγμάτων) δείχνουν ακόμη στο Έγγραφα\SkakiBase\…· εδώ γίνονται Έγγραφα\KnightBase\…
 * (και ο .skakibase γίνεται .knightbase). Ψάχνει σε όλα τα κείμενα ενός αντικειμένου JSON.
 */
export function relocateLegacy<T>(value: T): { value: T; changed: boolean } {
  const to = defaultDatabasesDir();
  if (path.resolve(to).toLowerCase() === path.resolve(OLD_DATA_DIR).toLowerCase()) return { value, changed: false };
  const from = OLD_DATA_DIR.split(/[\\/]+/);
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const segs = v.split(/[\\/]+/);
      if (segs.length < from.length || !from.every((s, k) => segs[k].toLowerCase() === s.toLowerCase())) return v;
      const rest = segs.slice(from.length).filter(Boolean);
      if (rest[0]?.toLowerCase() === OLD_APP_SUBDIR) rest[0] = path.basename(APP_DIR);
      changed = true;
      return path.join(to, ...rest);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(value) as T;
  return changed ? { value: out, changed } : { value, changed };
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Γνωστοί φάκελοι για γρήγορη πρόσβαση στο παράθυρο «Άνοιγμα». */
export function quickFolders(): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = [];
  const add = (name: string, p: string) => {
    if (fs.existsSync(p)) out.push({ name, path: p });
  };
  const desktop = [path.join(home, 'OneDrive', 'Υπολογιστής'), path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'Desktop')].find((p) => fs.existsSync(p));
  if (desktop) {
    add('Επιφάνεια εργασίας', desktop);
    for (const name of ['Σκακι', 'Σκάκι', 'Chess', 'Lumbras']) add(name, path.join(desktop, name));
  }
  add('Λήψεις', path.join(home, 'Downloads'));
  add('Έγγραφα', path.join(home, 'Documents'));
  add('Βάσεις Ruru', defaultDatabasesDir());
  return out;
}
