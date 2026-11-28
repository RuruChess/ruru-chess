/**
 * Πακέτο σκαναρισμένων βιβλίων: προαιρετική λήψη για το «Βιβλίο σε βάση», με τον αναγνώστη εικόνας (PP-OCRv6 +
 * onnxruntime, `ppocr.ts`) και το πακέτο διαγραμμάτων (chess-diagram-net, `diagramnet.ts`). Χωρίς αυτό οι σκαναρισμένες
 * σελίδες διαβάζονται με το OCR των Windows, πολύ πιο αδύναμο. Το αρχείο φτιάχνεται με το `scripts/make-scan-pack.mjs`,
 * ανεβαίνει μία φορά, στην έκδοση v3.2.0 στο GitHub (και οι επόμενες εκδόσεις το παίρνουν από εκεί), ελέγχεται εδώ με
 * SHA-256 και ανοίγει με το 7-Zip της εφαρμογής εκεί όπου το βρίσκουν τα `findPpocr` / `findDiagramNet`. Νέο αρχείο =
 * νέο SHA-256, άρα και νέα διεύθυνση εδώ.
 *
 * Το onnxruntime.dll θέλει το Visual C++ Redistributable της Microsoft: χωρίς αυτό η λήψη δεν ξεκινά και ο χρήστης βλέπει
 * τι λείπει. Μετά την εγκατάσταση ο αναγνώστης ξεκινά μία φορά για έλεγχο· αν δεν ξεκινά, το πακέτο φεύγει ξανά.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Router } from '../http.ts';
import { HttpError } from '../library.ts';
import { download } from '../downloads.ts';
import { sevenZipPath } from '../db/importer.ts';
import { appLocalDir } from '../rename.ts';
import { findDiagramNet } from './diagramnet.ts';
import { findPpocr, PpOcr } from './ppocr.ts';

export interface PackSource {
  url: string;
  bytes: number;
  sha256: string;
}

/** Το πακέτο (`KNIGHTBASE_SCANPACK_URL`: το ίδιο αρχείο από άλλη διεύθυνση, για δοκιμές). */
export const SCAN_PACK: PackSource = {
  url: process.env.KNIGHTBASE_SCANPACK_URL || 'https://github.com/RuruChess/ruru-chess/releases/download/v3.2.0/Ruru-Chess-Scan-Pack-win-x64.zip',
  bytes: 37_676_101,
  sha256: '6dff300d9eee20119b4e68b692c80a086d0f32b353d09e336a6b0a9e874e283d',
};

/** Οι φάκελοι του πακέτου, μέσα στον φάκελο της εφαρμογής στο %LOCALAPPDATA%. */
const PARTS = ['ocr/ppocr', 'diagram/cdn'];

/** Η σελίδα της Microsoft με το Visual C++ Redistributable. */
export const VC_REDIST_URL = 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist';
const VC_DLLS = ['msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_atomic_wait.dll', 'vcruntime140.dll', 'vcruntime140_1.dll'];

/** Τα αρχεία του Visual C++ Redistributable (x64) που θέλει το onnxruntime.dll και λείπουν. */
export function vcRuntimeMissing(system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')): string[] {
  return VC_DLLS.filter((f) => !fs.existsSync(path.join(system32, f)));
}

export const scanPackInstalled = (): boolean => Boolean(findPpocr() && findDiagramNet());

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** Λήψη στο `<dir>\_downloads` (με συνέχεια, όπως οι βάσεις) και έλεγχος SHA-256. Επιστρέφει το αρχείο. */
export async function fetchScanPack(src: PackSource, dir: string, progress: (got: number, total: number) => void, signal: AbortSignal): Promise<string> {
  const zip = path.join(dir, '_downloads', path.basename(new URL(src.url).pathname));
  fs.mkdirSync(path.dirname(zip), { recursive: true });
  await download(src.url, zip, signal, progress);
  if ((await sha256(zip)) !== src.sha256) {
    fs.rmSync(zip, { force: true });
    throw new Error('Το αρχείο που κατέβηκε δεν είναι το σωστό (έλεγχος SHA-256) — δοκίμασε ξανά');
  }
  return zip;
}

/** Άνοιγμα στο `dir`: οι φάκελοι του πακέτου αντικαθιστούν όποιους υπάρχουν. Το αρχείο σβήνεται πάντα. */
export function unpackScanPack(zip: string, dir: string): void {
  const tmp = path.join(dir, '_scanpack');
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    execFileSync(sevenZipPath(), ['x', '-y', `-o${tmp}`, zip], { stdio: 'ignore', windowsHide: true });
    for (const p of PARTS) if (!fs.existsSync(path.join(tmp, p))) throw new Error(`Το πακέτο δεν έχει τον φάκελο ${p}`);
    for (const p of PARTS) {
      const dest = path.join(dir, p);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(path.join(tmp, p), dest);
    }
  } finally {
    fs.rmSync(zip, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Ξεκινά ο αναγνώστης σε αυτόν τον υπολογιστή; (φορτώνει τα μοντέλα και κλείνει· `null` = ναι, αλλιώς το σφάλμα) */
async function readerError(): Promise<string | null> {
  const pack = findPpocr();
  if (!pack) return 'δεν βρέθηκε μετά την εγκατάσταση';
  const pp = new PpOcr(pack, 1);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('δεν απάντησε σε 2 λεπτά')), 120_000);
  });
  try {
    await Promise.race([pp.ready, late]);
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    clearTimeout(timer);
    pp.close();
  }
}

interface PackState {
  status: 'downloading' | 'installing' | 'done' | 'error';
  got: number;
  total: number;
  error?: string;
  /** λείπει το Visual C++ Redistributable: ο χρήστης βλέπει τον σύνδεσμο της Microsoft */
  vcRedist?: boolean;
}

export function registerScanPack(r: Router): void {
  let state: PackState | null = null;
  const emit = () => r.broadcast('scanPack', state);
  const supported = process.platform === 'win32' && process.arch === 'x64';

  // (ramGB: η μνήμη του υπολογιστή, για την προειδοποίηση στο κουμπί· ο αναγνώστης θέλει ~1 GB)
  r.get('/api/book/scanpack', () => ({ supported, installed: scanPackInstalled(), bytes: SCAN_PACK.bytes, vcRedistUrl: VC_REDIST_URL, ramGB: Math.round(os.totalmem() / 2 ** 30), state }));

  r.post('/api/book/scanpack/install', () => {
    if (!supported) throw new HttpError(409, 'Το πακέτο υπάρχει μόνο για Windows 64-bit');
    if (state?.status === 'downloading' || state?.status === 'installing') throw new HttpError(409, 'Γίνεται ήδη η λήψη');
    const missing = vcRuntimeMissing();
    if (missing.length) {
      state = {
        status: 'error',
        got: 0,
        total: 0,
        vcRedist: true,
        error: `Ο αναγνώστης χρειάζεται το δωρεάν «Microsoft Visual C++ Redistributable» (x64), που λείπει (${missing.join(', ')}). Εγκατέστησέ το από τη Microsoft και πάτα ξανά τη λήψη.`,
      };
      emit();
      return state;
    }
    const st: PackState = { status: 'downloading', got: 0, total: SCAN_PACK.bytes };
    state = st;
    let last = 0;
    void (async () => {
      const dir = appLocalDir();
      try {
        const zip = await fetchScanPack(SCAN_PACK, dir, (got, total) => {
          st.got = got;
          st.total = total || SCAN_PACK.bytes;
          if (Date.now() - last > 400) {
            last = Date.now();
            emit();
          }
        }, new AbortController().signal);
        st.status = 'installing';
        emit();
        unpackScanPack(zip, dir);
        const err = await readerError();
        if (err) {
          for (const p of PARTS) fs.rmSync(path.join(dir, p), { recursive: true, force: true });
          throw new Error(`Ο αναγνώστης δεν ξεκινά σε αυτόν τον υπολογιστή (${err}). Τα σκαναρισμένα συνεχίζουν με το OCR των Windows.`);
        }
        st.status = 'done';
      } catch (e) {
        st.status = 'error';
        st.error = (e as Error).message;
      }
      emit();
    })();
    emit();
    return st;
  });
}
