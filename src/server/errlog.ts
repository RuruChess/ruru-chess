/**
 * Αρχείο καταγραφής σφαλμάτων: Έγγραφα\Ruru\.knightbase\errors.log (ως ~1 MB, μετά γίνεται errors.log.old).
 * Η εφαρμογή τρέχει χωρίς κονσόλα, άρα χωρίς αυτό τα σφάλματα του server χάνονται· ο χρήστης το στέλνει όταν κάτι
 * πάει στραβά.
 */
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from './paths.ts';

export const ERROR_LOG = path.join(APP_DIR, 'errors.log');

export function logError(err: unknown, where = ''): void {
  console.error('Σφάλμα:', err);
  try {
    if (fs.existsSync(ERROR_LOG) && fs.statSync(ERROR_LOG).size > 1_000_000) fs.renameSync(ERROR_LOG, `${ERROR_LOG}.old`);
    const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
    fs.appendFileSync(ERROR_LOG, `${new Date().toISOString()}${where ? ` ${where}` : ''} ${text}\n`);
  } catch {
    // (χωρίς φάκελο ή δικαίωμα εγγραφής: μόνο στην κονσόλα)
  }
}
