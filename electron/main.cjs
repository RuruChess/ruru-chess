'use strict';

/**
 * Ruru Chess — Electron desktop wrapper.
 * Ξεκινά (ή συνδέεται αν τρέχει ήδη ίδια/νεότερη έκδοση) τον τοπικό Node 24 server (src/server/main.ts)
 * ως child process και ανοίγει native BrowserWindows με Ruru.ico, χωρίς Edge.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const ICON_PATH = path.join(ROOT, 'Ruru.ico');
const LAUNCHER_EXE = path.join(ROOT, 'Ruru.exe');
const BUNDLED_NODE = path.join(ROOT, 'node', 'node.exe');
const SERVER_ENTRY = path.join(ROOT, 'src', 'server', 'main.ts');
const DEFAULT_PORT = Number(process.env.KNIGHTBASE_PORT || 4747);
const APP_TITLE = 'Ruru Chess';
const APP_USER_MODEL_ID = 'com.ruruchess.ruru';
const APP_VERSION = (() => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '');
  } catch {
    return '';
  }
})();

const ALLOWED_PERMISSIONS = new Set([
  'media',
  'audioCapture',
  'videoCapture',
  'mediaKeySystem',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'notifications',
]);

app.setName(APP_TITLE);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  const localAppData = process.env.LOCALAPPDATA || app.getPath('appData');
  app.setPath('userData', path.join(localAppData, 'Ruru', 'electron'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let serverUrl = '';
let serverOrigin = '';
let serverProc = null;
let ownsServer = false;
let hostReq = null;
let quitting = false;

/** Παρακολούθηση ασφαλούς κλεισίματος (αντί για DevTools CDP σε Edge). */
const lastPrevent = new Map();
const askedAt = new Map();

function hasIcon() {
  return fs.existsSync(ICON_PATH);
}

/** 3.0.0 > 2.6.1 (μόνο οι τρεις αριθμοί, ίδιο με src/server/about.ts). */
function isNewer(a, b) {
  const pa = String(a || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function isLocalOrigin(rawUrl) {
  if (!rawUrl || !serverOrigin) return false;
  try {
    return new URL(rawUrl).origin === serverOrigin;
  } catch {
    return false;
  }
}

function isExternalSafe(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

async function probeServer(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && (data.name === 'KnightBase' || data.name === 'SkakiBase')) {
      return {
        url: `http://127.0.0.1:${port}`,
        name: String(data.name),
        version: data.version ? String(data.version) : '',
        pid: typeof data.pid === 'number' ? data.pid : null,
      };
    }
  } catch {
    // δεν τρέχει ακόμη σε αυτή τη θύρα
  }
  return null;
}

function connectWindowHost(baseUrl) {
  if (hostReq) {
    hostReq.destroy();
    hostReq = null;
  }
  let buf = '';
  const req = http.get(
    `${baseUrl}/api/window/host`,
    { headers: { 'X-KnightBase': 'electron' } },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return;
      }
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg && msg.url) createWindow(msg.url, msg);
          } catch {
            // αγνοούμε μη έγκυρη γραμμή
          }
        }
      });
    },
  );
  req.on('error', () => {
    // ο server έκλεισε ή αποσυνδέθηκε
  });
  hostReq = req;
}

async function startOrConnectServer() {
  const existing = await probeServer(DEFAULT_PORT);
  // Αν τρέχει παλιότερη έκδοση (π.χ. κατά την αναβάθμιση), αφήνουμε το main.ts να την αντικαταστήσει (replaceOlder)
  const existingIsOlder = Boolean(existing && existing.name === 'KnightBase' && existing.version && APP_VERSION && isNewer(APP_VERSION, existing.version));
  if (existing && !existingIsOlder) {
    serverUrl = existing.url;
    serverOrigin = new URL(existing.url).origin;
    ownsServer = false;
    connectWindowHost(existing.url);
    return existing.url;
  }

  const nodeExe = process.env.RURU_NODE || (fs.existsSync(BUNDLED_NODE) ? BUNDLED_NODE : 'node');
  // --idle: αν τρέχει εισαγωγή όταν κλείσουν τα παράθυρα, ο server τελειώνει τη δουλειά και κλείνει μόνος του
  const child = spawn(nodeExe, [SERVER_ENTRY, '--idle'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
    env: { ...process.env, RURU_ELECTRON: '1' },
  });
  serverProc = child;
  ownsServer = true;

  let detectedUrl = '';
  let earlyError = null;
  let exitedCleanly = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    const m = /Ruru:\s*(http:\/\/127\.0\.0\.1:\d+)/.exec(chunk);
    if (m) detectedUrl = m[1];
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  child.on('message', (msg) => {
    if (msg && msg.type === 'open-window' && msg.url) createWindow(msg.url, msg);
  });

  child.on('error', (err) => {
    earlyError = err;
  });
  child.on('exit', (code, signal) => {
    if (!serverUrl) {
      if (code === 0 && !signal) exitedCleanly = true;
      else if (!earlyError) earlyError = new Error(`Ο τοπικός server τερμάτισε πρόωρα (code=${code}, signal=${signal}).`);
    }
    if (serverProc === child) serverProc = null;
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (earlyError) throw earlyError;
    if (exitedCleanly) {
      // Το main.ts έκλεισε με code=0 επειδή ο προηγούμενος server έτρεχε ήδη (π.χ. με ενεργή εισαγωγή)
      const fallback = await probeServer(DEFAULT_PORT);
      if (fallback) {
        serverUrl = fallback.url;
        serverOrigin = new URL(fallback.url).origin;
        ownsServer = false;
        connectWindowHost(fallback.url);
        return fallback.url;
      }
      throw new Error('Ο τοπικός server τερμάτισε χωρίς να ακούει σε θύρα.');
    }
    const candidatePort = detectedUrl ? Number(new URL(detectedUrl).port) : DEFAULT_PORT;
    const ready = await probeServer(candidatePort);
    // Αν αντικαθιστούμε παλιότερη έκδοση, περιμένουμε να απαντήσει ο ΝΕΟΣ server (όχι το παλιό pid)
    const isNewServer = Boolean(ready && (!existingIsOlder || detectedUrl || (existing && ready.pid !== existing.pid)));
    if (isNewServer) {
      serverUrl = ready.url;
      serverOrigin = new URL(ready.url).origin;
      return ready.url;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Ο τοπικός server του Ruru δεν απάντησε έγκαιρα.');
}

async function stopServer() {
  if (hostReq) {
    hostReq.destroy();
    hostReq = null;
  }
  const child = serverProc;
  if (!ownsServer || !child || child.exitCode !== null) return;

  const exited = new Promise((resolve) => {
    child.once('exit', () => resolve(true));
  });

  let busyJob = false;
  if (serverUrl) {
    try {
      const res = await fetch(`${serverUrl}/api/quit`, {
        method: 'POST',
        headers: { 'X-KnightBase': 'quit' },
        signal: AbortSignal.timeout(1500),
      });
      if (res.status === 409) busyJob = true;
    } catch {
      // fallback σε kill παρακάτω
    }
  }

  if (busyJob) {
    // Τρέχει εισαγωγή/εργασία: δεν σκοτώνουμε τον server — τον αφήνουμε να τελειώσει και να κλείσει μόνος του (--idle)
    if (child.connected) child.disconnect();
    if (child.stdout) child.stdout.unref();
    if (child.stderr) child.stderr.unref();
    child.unref();
    serverProc = null;
    return;
  }

  const clean = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), 1500))]);
  if (!clean && child.exitCode === null) {
    try {
      child.kill();
    } catch {
      // ήδη τερματισμένο
    }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1000))]);
  }
  serverProc = null;
}

function setupSession() {
  const ses = session.defaultSession;

  // WebRTC φωνή/κάμερα + πρόχειρο/πλήρης οθόνη μόνο για τον τοπικό Ruru server
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const originUrl = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    callback(ALLOWED_PERMISSIONS.has(permission) && isLocalOrigin(originUrl));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    const originUrl = requestingOrigin || (wc && wc.getURL()) || '';
    return ALLOWED_PERMISSIONS.has(permission) && isLocalOrigin(originUrl);
  });

  // Καταγραφή του πότε η σελίδα εμφάνισε τη δική της ερώτηση «Αποθήκευση;»
  ses.webRequest.onCompleted({ urls: [`${serverOrigin}/api/window/asked`] }, (details) => {
    if (details.webContentsId) askedAt.set(details.webContentsId, Date.now());
  });

  // YouTube embed μέσα από τοπικό 127.0.0.1: αποφυγή Error 153 / unavailable όταν λείπει/είναι τοπικό το Referer
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] }, (details, callback) => {
    const headers = { ...details.requestHeaders };
    const ref = headers.Referer || headers.referer || '';
    if (!ref || ref.startsWith('http://127.0.0.1') || ref.startsWith('http://localhost')) {
      delete headers.referer;
      headers.Referer = 'https://ruruchess.com/';
    }
    callback({ requestHeaders: headers });
  });
}

function applyTaskbarDetails(win) {
  if (process.platform !== 'win32') return;
  const hasLauncher = fs.existsSync(LAUNCHER_EXE);
  win.setAppDetails({
    appId: APP_USER_MODEL_ID,
    appIconPath: hasIcon() ? ICON_PATH : undefined,
    appIconIndex: 0,
    ...(hasLauncher ? { relaunchCommand: `"${LAUNCHER_EXE}"`, relaunchDisplayName: APP_TITLE } : {}),
  });
}

/** Ίδιοι έλεγχοι πλοήγησης & εξωτερικών συνδέσμων σε όλα τα παράθυρα (και όσα ανοίγουν από τη σελίδα, π.χ. εκτύπωση). */
function attachNavigationGuards(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (!url || url === 'about:blank' || isLocalOrigin(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          title: APP_TITLE,
          icon: hasIcon() ? ICON_PATH : undefined,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    if (isExternalSafe(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('did-create-window', (childWin) => {
    applyTaskbarDetails(childWin);
    attachNavigationGuards(childWin.webContents);
  });

  wc.on('will-navigate', (event, url) => {
    if (url === 'about:blank' || isLocalOrigin(url)) return;
    event.preventDefault();
    if (isExternalSafe(url)) void shell.openExternal(url);
  });
}

function createWindow(targetUrl, opts = {}) {
  if (!isLocalOrigin(targetUrl)) return null;

  const width = Math.max(400, Number(opts.size && opts.size.w) || 1400);
  const height = Math.max(300, Number(opts.size && opts.size.h) || 920);
  const pos = opts.pos && Number.isFinite(opts.pos.x) && Number.isFinite(opts.pos.y) ? { x: Math.round(opts.pos.x), y: Math.round(opts.pos.y) } : {};

  const win = new BrowserWindow({
    width,
    height,
    ...pos,
    title: APP_TITLE,
    icon: hasIcon() ? ICON_PATH : undefined,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyTaskbarDetails(win);

  const wc = win.webContents;
  const wcId = wc.id;

  attachNavigationGuards(wc);

  // Ασφαλές κλείσιμο με μη αποθηκευμένες αλλαγές:
  // Το Electron κρατά αυτόματα το παράθυρο ανοιχτό χωρίς μήνυμα browser όταν η σελίδα ακυρώσει το beforeunload,
  // επιτρέποντας να εμφανιστεί η ερώτηση «Αποθήκευση;» της εφαρμογής. Αν η σελίδα κόλλησε, το 2ο × κλείνει.
  wc.on('will-prevent-unload', (event) => {
    const now = Date.now();
    const prev = lastPrevent.get(wcId);
    const asked = askedAt.get(wcId) || 0;
    const stuck = prev !== undefined && now - prev < 10_000 && asked < prev;
    lastPrevent.set(wcId, now);
    if (stuck) event.preventDefault();
  });

  win.once('ready-to-show', () => {
    if (opts.maximized) win.maximize();
    win.show();
  });

  win.on('closed', () => {
    lastPrevent.delete(wcId);
    askedAt.delete(wcId);
  });

  void win.loadURL(targetUrl);
  return win;
}

app.on('second-instance', () => {
  const wins = BrowserWindow.getAllWindows();
  const mainWin = wins.find((w) => !w.webContents.getURL().includes('#open=')) || wins[0];
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  } else if (serverUrl) {
    createWindow(serverUrl, { maximized: true });
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (quitting) return;
  if (!ownsServer || !serverProc || serverProc.exitCode !== null) {
    if (hostReq) {
      hostReq.destroy();
      hostReq = null;
    }
    return;
  }
  event.preventDefault();
  quitting = true;
  void stopServer().finally(() => app.quit());
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!quitting) app.quit();
  });
}

app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(null);
    const url = await startOrConnectServer();
    setupSession();
    createWindow(url, { maximized: true });
  })
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Ruru Electron]', msg);
    if (app.isReady()) dialog.showErrorBox(APP_TITLE, msg);
    void stopServer().finally(() => app.exit(1));
  });
