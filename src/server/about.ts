/**
 * Έκδοση, σύνδεσμοι του έργου και έλεγχος για νέα έκδοση.
 * Οι σύνδεσμοι έρχονται από το package.json: `homepage` (ιστοσελίδα), `repository`
 * (π.χ. "github:όνομα/knightbase", για τις εκδόσεις) και `funding` (σελίδα δωρεών, π.χ. Ko-fi).
 * Όσα λείπουν δεν εμφανίζονται στην εφαρμογή. Ο έλεγχος ρωτά μόνο το GitHub API
 * (`releases/latest`) και κρατά την απάντηση 6 ώρες.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Router } from './http.ts';
import { HttpError } from './library.ts';
import { APP_ROOT } from './paths.ts';

interface PackageJson {
  version: string;
  homepage?: string;
  repository?: string | { url?: string };
  funding?: string | { url?: string } | Array<string | { url?: string }>;
}

const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')) as PackageJson;
export const VERSION = pkg.version;
const STARTED = Date.now();

const https = (u: unknown): string | null => (typeof u === 'string' && /^https:\/\/\S+$/.test(u) ? u : null);
const urlOf = (x: unknown): unknown => (typeof x === 'string' ? x : (x as { url?: string } | undefined)?.url);

/** "όνομα/repo" από "github:όνομα/repo", "όνομα/repo" ή https://github.com/όνομα/repo(.git) */
function githubRepo(r: unknown): string | null {
  const s = String(urlOf(r) ?? '').trim();
  const m = /^(?:github:|(?:git\+)?https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

const REPO = githubRepo(pkg.repository);

export const LINKS = {
  site: https(pkg.homepage),
  support: https(urlOf(Array.isArray(pkg.funding) ? pkg.funding[0] : pkg.funding)),
  repo: REPO ? `https://github.com/${REPO}` : null,
  releases: REPO ? `https://github.com/${REPO}/releases/latest` : null,
};

export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  url: string | null;
  checkedAt: number;
}

/** 0.10.0 > 0.9.3 (μόνο οι τρεις αριθμοί) */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

let cached: UpdateInfo | null = null;

export async function checkUpdate(force = false): Promise<UpdateInfo> {
  const none: UpdateInfo = { current: VERSION, latest: null, newer: false, url: null, checkedAt: Date.now() };
  if (!REPO) return none;
  if (!force && cached && Date.now() - cached.checkedAt < 6 * 3600_000) return cached;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `RuruChess/${VERSION}` },
    signal: AbortSignal.timeout(10_000),
  });
  // 404: δεν υπάρχει ακόμη καμία έκδοση
  if (r.status === 404) return (cached = none);
  if (!r.ok) throw new HttpError(502, `GitHub: ${r.status}`);
  const rel = (await r.json()) as { tag_name?: string; html_url?: string };
  const latest = String(rel.tag_name ?? '').replace(/^v/i, '') || null;
  cached = { current: VERSION, latest, newer: !!latest && newer(latest, VERSION), url: https(rel.html_url) ?? LINKS.releases, checkedAt: Date.now() };
  return cached;
}

/** Ανοίγει στον κανονικό browser μόνο συνδέσμους του έργου (όχι αυθαίρετες διευθύνσεις). */
function openLink(url: string): void {
  const ok =
    Object.values(LINKS).includes(url) ||
    (REPO !== null && url.startsWith(`https://github.com/${REPO}/`)) ||
    // οι πηγές των μαθημάτων και η άδειά τους
    /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?title=[\w%().,'-]+&oldid=\d+$/.test(url) ||
    url === 'https://creativecommons.org/licenses/by-sa/4.0/' ||
    // η σελίδα λήψης της βάσης αναφοράς (Lumbra's Gigabase)
    url === 'https://lumbrasgigabase.com/en/download-area-en/#pgn';
  if (!ok || !https(url)) throw new HttpError(400, 'Μη αποδεκτός σύνδεσμος');
  spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref();
}

export function registerAbout(r: Router): void {
  // root / started: για το scripts/open-dev.mjs (τρέχει ο κώδικας αυτού του φακέλου, ξεκίνησε μετά την τελευταία αλλαγή;)
  r.get('/api/version', () => ({ name: 'KnightBase', version: VERSION, node: process.versions.node, pid: process.pid, root: APP_ROOT, started: STARTED, links: LINKS }));
  r.get('/api/update', (req) => checkUpdate(req.query.get('force') === '1'));
  r.post('/api/open-link', (req) => {
    openLink(String(req.body?.url ?? ''));
    return { ok: true };
  });
}
