/**
 * Ruru Chess (3.0.0, πρώην KnightBase): νέα εγκατάσταση → φάκελοι «Ruru». Όποιος έχει φάκελο «KnightBase» τον
 * κρατά όπως είναι, χωρίς μετακίνηση (βάσεις πολλών GB, διαδρομές στον κατάλογο, συντομεύσεις). Μένουν επίτηδες
 * με το παλιό όνομα: `.knightbase`, `.kbdb`, `X-KnightBase`, το `name` του /api/version (οι παλιές εκδόσεις
 * αναγνωρίζουν με αυτό τον server και δεν ανοίγουν δεύτερο στα ίδια δεδομένα) και οι μεταβλητές `KNIGHTBASE_*`.
 *
 * Μετονομασία SkakiBase → KnightBase (έκδοση 0.9.0). Οι παλιοί φάκελοι μετονομάζονται μία φορά, στην
 * εκκίνηση του server (boot.ts), πριν φορτωθεί οτιδήποτε άλλο:
 * - Έγγραφα\SkakiBase → Έγγραφα\KnightBase (βάσεις) και μέσα του .skakibase → .knightbase (ρυθμίσεις, κατάλογος)
 * - %LOCALAPPDATA%\SkakiBase → %LOCALAPPDATA%\KnightBase (προφίλ των παραθύρων)
 * Στον ίδιο δίσκο η μετονομασία γίνεται αμέσως, χωρίς αντιγραφή. Αν δεν γίνεται (π.χ. τρέχει ακόμη η παλιά
 * έκδοση με ανοιχτά αρχεία), η εφαρμογή συνεχίζει με τους παλιούς φακέλους (paths.ts, browser.ts) και
 * ξαναδοκιμάζει στην επόμενη εκκίνηση. Οι διαδρομές που έχουν γραφτεί στον κατάλογο και στις ρυθμίσεις
 * διορθώνονται κατά τη φόρτωση (paths.ts → relocateLegacy).
 * Χωρίς παρενέργειες στη φόρτωση: το εισάγουν και τα τεστ (μέσω του paths.ts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const APP_NAME = 'Ruru';
export const PREV_NAME = 'KnightBase';
export const OLD_NAME = 'SkakiBase';
/** Ο φάκελος ρυθμίσεων μέσα στον φάκελο βάσεων, και ο παλιός. */
export const APP_SUBDIR = '.knightbase';
export const OLD_APP_SUBDIR = '.skakibase';

/** Ο φάκελος Έγγραφα (ή, αν δεν υπάρχει, ο προσωπικός φάκελος). */
export function documentsDir(): string {
  const home = os.homedir();
  const candidates = [path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Documents'), path.join(home, 'OneDrive', 'Έγγραφα')];
  return candidates.find((c) => fs.existsSync(c)) ?? home;
}

export function localAppDataDir(): string {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

/** Ο φάκελος της εφαρμογής μέσα στο `parent`: ο KnightBase αν υπάρχει, αλλιώς ο Ruru. */
export function appFolder(parent: string): string {
  const prev = path.join(parent, PREV_NAME);
  return fs.existsSync(prev) ? prev : path.join(parent, APP_NAME);
}

/** %LOCALAPPDATA%: προφίλ των παραθύρων και προαιρετικά πακέτα ανάγνωσης βιβλίων. */
export const appLocalDir = (): string => appFolder(localAppDataDir());

/** Τρέχει ήδη server (παλιά ή νέα έκδοση) στη θύρα; Σύγχρονα, με ένα μικρό node, γιατί όλα αυτά γίνονται πριν φορτωθεί οτιδήποτε. */
function serverRunning(port: number): boolean {
  const code = `fetch('http://127.0.0.1:${port}/api/version',{signal:AbortSignal.timeout(1500)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`;
  return spawnSync(process.execPath, ['-e', code], { timeout: 5000, windowsHide: true }).status === 0;
}

function tryRename(from: string, to: string): void {
  try {
    fs.renameSync(from, to);
    console.log(`Μετονομασία: ${from} → ${to}`);
  } catch (e) {
    console.error(`Η μετονομασία ${from} → ${to} δεν έγινε (θα ξαναδοκιμαστεί): ${(e as Error).message}`);
  }
}

/** Οι φάκελοι της SkakiBase γίνονται φάκελοι της KnightBase (μία φορά· μετά δεν υπάρχει τίποτα να γίνει). */
export function migrateFromSkakiBase(port: number): void {
  const docs = documentsDir();
  const local = localAppDataDir();
  const data = path.join(docs, PREV_NAME);
  // με τη σειρά: ο φάκελος ρυθμίσεων μετονομάζεται αφού ο φάκελος βάσεων έχει γίνει Έγγραφα\KnightBase
  const pairs = () => [
    [path.join(docs, OLD_NAME), data],
    [path.join(local, OLD_NAME), path.join(local, PREV_NAME)],
    [path.join(data, OLD_APP_SUBDIR), path.join(data, APP_SUBDIR)],
  ];
  const todo = ([from, to]: string[]) => fs.existsSync(from) && !fs.existsSync(to);
  if (!pairs().some(todo)) return;
  // η παλιά έκδοση τρέχει ακόμη: όχι τώρα (θα έχανε τους φακέλους της ενώ δουλεύει)
  if (serverRunning(port)) return;
  for (let k = 0; k < 3; k++) {
    const pair = pairs()[k];
    if (todo(pair)) tryRename(pair[0], pair[1]);
  }
}
