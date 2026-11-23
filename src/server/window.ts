/** Παράθυρα της εφαρμογής: Edge (ή Chrome) σε λειτουργία εφαρμογής. */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { browserArgs, connectBrowser } from './browser.ts';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

export interface AppWindowRequest {
  url: string;
  size: { w: number; h: number };
  pos?: { x: number; y: number };
  maximized: boolean;
}

type WindowDelegate = (req: AppWindowRequest) => boolean;
let windowDelegate: WindowDelegate | null = null;

/** Ορίζει εξωτερικό διαχειριστή παραθύρων (π.χ. Electron host)· επιστρέφει συνάρτηση αποσύνδεσης. */
export function setWindowDelegate(fn: WindowDelegate | null): () => void {
  windowDelegate = fn;
  return () => {
    if (windowDelegate === fn) windowDelegate = null;
  };
}

/** Ανοίγει το `url` σε δικό του παράθυρο (χωρίς γραμμή διεύθυνσης), προαιρετικά σε θέση `pos` ή μεγιστοποιημένο. */
export function openAppWindow(url: string, size: { w: number; h: number } = { w: 1500, h: 950 }, pos?: { x: number; y: number }, opts: { maximized?: boolean } = {}): void {
  const req: AppWindowRequest = { url, size, pos, maximized: Boolean(opts.maximized) };
  if (process.env.RURU_ELECTRON === '1' && process.connected && typeof process.send === 'function') {
    process.send({ type: 'open-window', ...req });
    return;
  }
  if (windowDelegate?.(req)) return;
  const exe = BROWSERS.find((c) => fs.existsSync(c));
  const place = opts.maximized ? ['--start-maximized'] : [`--window-size=${size.w},${size.h}`, ...(pos ? [`--window-position=${pos.x},${pos.y}`] : [])];
  const args = [...browserArgs(), `--app=${url}`, ...place];
  if (exe) {
    spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
    connectBrowser();
  }
  else spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}
