/**
 * Τα παράθυρα του KnightBase ανοίγουν σε δικό τους Edge (ξεχωριστό προφίλ στο
 * %LOCALAPPDATA%\Ruru\browser, ή στον παλιό KnightBase αν υπάρχει) με τοπικό κανάλι ελέγχου (DevTools, μόνο 127.0.0.1).
 * Μέσα από αυτό, όταν πατηθεί το × σε παράθυρο με αλλαγές, το μήνυμα «Αποχώρηση;» του browser
 * απορρίπτεται αμέσως: το παράθυρο μένει ανοιχτό και η σελίδα δείχνει τη δική της ερώτηση
 * «Αποθήκευση;» στο κέντρο. Χωρίς το κανάλι (π.χ. άλλος browser) εμφανίζονται και τα δύο.
 */
import fs from 'node:fs';
import path from 'node:path';
import { OLD_NAME, appLocalDir, localAppDataDir } from './rename.ts';

export function browserProfileDir(): string {
  const dir = appLocalDir();
  // το προφίλ της παλιάς έκδοσης (SkakiBase), όσο δεν έχει μετονομαστεί (π.χ. ήταν ανοιχτά τα παράθυρά της)
  const old = path.join(localAppDataDir(), OLD_NAME);
  return path.join(!fs.existsSync(dir) && fs.existsSync(path.join(old, 'browser')) ? old : dir, 'browser');
}

/** Ορίσματα του browser για το προφίλ και το κανάλι ελέγχου. */
export function browserArgs(): string[] {
  return [`--user-data-dir=${browserProfileDir()}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check'];
}

type Message = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: unknown; sessionId?: string };

let ws: WebSocket | null = null;
let connecting = false;
let nextId = 0;
const pending = new Map<number, (m: Message) => void>();
/** κλειδί παραθύρου (#open=…) ανά σύνδεση σελίδας, και η σύνδεση κάθε σελίδας */
const sessionKey = new Map<string, string>();
const targetSession = new Map<string, string>();
/** πότε απορρίφθηκε τελευταία φορά το μήνυμα κλεισίματος σε κάθε σελίδα */
const lastDismiss = new Map<string, number>();
/** πότε έδειξε η σελίδα τη δική της ερώτηση (ανά κλειδί παραθύρου) */
const askedAt = new Map<string, number>();
/** παράθυρα (κλειδιά #open=…) που ανοίγουν μεγιστοποιημένα μόλις φανούν στο κανάλι */
const maximize = new Set<string>();

const keyOf = (url: string) => /#open=([\w-]+)/.exec(url)?.[1] ?? 'main';

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Message> {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return resolve({});
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

async function attach(targetId: string, url: string): Promise<void> {
  if (targetSession.has(targetId)) return;
  targetSession.set(targetId, '');
  const r = await send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = r.result?.sessionId as string | undefined;
  if (!sessionId) {
    targetSession.delete(targetId);
    return;
  }
  targetSession.set(targetId, sessionId);
  sessionKey.set(sessionId, keyOf(url));
  await send('Page.enable', {}, sessionId);
  await maximizeIfWanted(targetId, url);
}

/** Μεγιστοποίηση του παραθύρου μιας σελίδας, αν το ζήτησε ο server όταν το άνοιγε (μία φορά). */
async function maximizeIfWanted(targetId: string, url: string): Promise<void> {
  const key = keyOf(url);
  if (!maximize.delete(key)) return;
  const w = await send('Browser.getWindowForTarget', { targetId });
  const windowId = w.result?.windowId as number | undefined;
  if (windowId !== undefined) await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
}

/** Το παράθυρο με αυτό το κλειδί (#open=…) να ανοίξει μεγιστοποιημένο (όσο υπάρχει το κανάλι ελέγχου). */
export function maximizeOnOpen(key: string): void {
  maximize.add(key);
  // όχι για πάντα: ένα παράθυρο που δεν άνοιξε ποτέ δεν μένει στη λίστα
  setTimeout(() => maximize.delete(key), 60_000).unref();
}

function onMessage(m: Message): void {
  if (m.id !== undefined) {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
    return;
  }
  const p = m.params ?? {};
  if (m.method === 'Target.targetCreated') {
    const info = p.targetInfo as { targetId: string; type: string; url: string };
    if (info.type === 'page') void attach(info.targetId, info.url);
  } else if (m.method === 'Target.targetInfoChanged') {
    const info = p.targetInfo as { targetId: string; url: string };
    const sid = targetSession.get(info.targetId);
    if (sid) sessionKey.set(sid, keyOf(info.url));
    // η σελίδα μπορεί να πρωτοφανεί χωρίς τη διεύθυνσή της (#open=…): μεγιστοποίηση μόλις τη μάθουμε
    if (sid) void maximizeIfWanted(info.targetId, info.url);
  } else if (m.method === 'Target.detachedFromTarget') {
    sessionKey.delete(String(p.sessionId));
    lastDismiss.delete(String(p.sessionId));
    for (const [t, sid] of targetSession) if (sid === p.sessionId) targetSession.delete(t);
  } else if (m.method === 'Page.javascriptDialogOpening' && p.type === 'beforeunload' && m.sessionId) {
    // Ασφάλεια: αν μετά την προηγούμενη απόρριψη η σελίδα δεν έδειξε τη δική της ερώτηση
    // (π.χ. κόλλησε), το δεύτερο × κλείνει κανονικά το παράθυρο.
    const now = Date.now();
    const prev = lastDismiss.get(m.sessionId);
    const asked = askedAt.get(sessionKey.get(m.sessionId) ?? 'main') ?? 0;
    const stuck = prev !== undefined && now - prev < 10_000 && asked < prev;
    lastDismiss.set(m.sessionId, now);
    void send('Page.handleJavaScriptDialog', { accept: stuck }, m.sessionId);
  }
}

/**
 * Σύνδεση στο κανάλι ελέγχου του browser (αν τρέχει). Δοκιμάζει για λίγα δευτερόλεπτα, γιατί
 * μετά από νέα εκκίνηση το αρχείο DevToolsActivePort γράφεται με λίγη καθυστέρηση (και ως τότε
 * μπορεί να έχει τη θύρα της προηγούμενης φοράς).
 */
export function connectBrowser(tries = 50): void {
  if (ws || connecting) return;
  connecting = true;
  void (async () => {
    try {
      for (let i = 0; i < tries && !ws; i++) {
        try {
          const [port, wsPath] = fs.readFileSync(path.join(browserProfileDir(), 'DevToolsActivePort'), 'utf8').split('\n').map((s) => s.trim());
          if (port && wsPath) {
            const sock = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
            await new Promise<void>((resolve, reject) => {
              sock.onopen = () => resolve();
              sock.onerror = () => reject(new Error('devtools'));
            });
            ws = sock;
            sock.onmessage = (ev) => onMessage(JSON.parse(String(ev.data)) as Message);
            sock.onclose = () => {
              ws = null;
              sessionKey.clear();
              targetSession.clear();
              lastDismiss.clear();
            };
            await send('Target.setDiscoverTargets', { discover: true });
            const r = await send('Target.getTargets');
            for (const t of (r.result?.targetInfos ?? []) as Array<{ targetId: string; type: string; url: string; attached: boolean }>) if (t.type === 'page') await attach(t.targetId, t.url);
            break;
          }
        } catch {
          // ακόμη δεν υπάρχει (ή είναι παλιό) το αρχείο / η θύρα
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      connecting = false;
    }
  })();
}

/** Κατάσταση του καναλιού ελέγχου (για διάγνωση: GET /api/browser-status). */
export function browserStatus(): { connected: boolean; pages: number } {
  return { connected: ws !== null, pages: sessionKey.size };
}

/** Η σελίδα έδειξε τη δική της ερώτηση «Αποθήκευση;». */
export function markAsked(key: string): void {
  askedAt.set(key, Date.now());
}
