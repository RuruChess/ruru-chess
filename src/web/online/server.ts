/**
 * Ο server της «Παίξε με φίλο» και της «Κοινής ανάλυσης» (relay/, Cloudflare Workers, `npm run deploy`).
 * Για τοπική δοκιμή: `npm run dev` στον φάκελο relay/ και «Για προχωρημένους» → http://localhost:8787 (ui.playServer).
 */
import { L } from '../i18n.ts';

export const DEFAULT_PLAY_SERVER = 'https://play.ruruchess.com';
export const LOCAL_PLAY_SERVER = 'http://localhost:8787';

export function playServer(ui: Record<string, unknown> | undefined): string {
  return (((ui?.playServer as string | undefined) || DEFAULT_PLAY_SERVER).trim()).replace(/\/+$/, '');
}

/** Μήνυμα όταν ο server κόβει από το όριο ρυθμού (429). */
export const serverBusy = () => L('Πολλά νέα δωμάτια σε λίγη ώρα. Δοκίμασε ξανά σε ένα λεπτό.', 'Too many new rooms in a short time. Try again in a minute.');

/** Μήνυμα όταν δεν απαντά ο server. */
export function serverDown(server: string): string {
  return server === LOCAL_PLAY_SERVER
    ? L('Δεν απαντά ο τοπικός server. Ξεκίνα τον με «npm run dev» στον φάκελο relay.', 'The local server does not respond. Start it with “npm run dev” in the relay folder.')
    : L('Δεν απαντά ο server. Έλεγξε τη σύνδεσή σου στο internet.', 'The server does not respond. Check your internet connection.');
}
