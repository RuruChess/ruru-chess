// Ιστοσελίδα: site/dist, με τα αγγλικά στη ρίζα και τα ελληνικά στο /el/. Στατικά αρχεία, χωρίς
// εξαρτήσεις και χωρίς cookies. Έκδοση και σύνδεσμοι από το package.json (`homepage`, `repository`,
// `funding`, `bugs.email`), μεγέθη και SHA-256 από το release/ (node scripts/make-release.mjs).
// Χωρίς σύνδεσμο GitHub βγαίνει προεπισκόπηση με σχετική ένδειξη στην κορυφή· χωρίς Ko-fi λείπει η «Στήριξε».
// Χρήση: node scripts/build-site.mjs [--check: σφάλμα αν λείπει κάτι για τη δημοσίευση]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'site', 'src');
const out = path.join(root, 'site', 'dist');
const rel = path.join(root, 'release', 'ruru');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { render, renderPrivacy, renderTerms } = await import(pathToFileURL(path.join(src, 'page.mjs')).href);
const content = (await import(pathToFileURL(path.join(src, 'content.mjs')).href)).default;

/** γλώσσες: η πρώτη στη ρίζα */
const LANGS = [
  { lang: 'en', dir: '' },
  { lang: 'el', dir: 'el/' },
];
/** ο εγκαταστάτης */
const FULL = 'Ruru-Chess-Setup.exe';

// ίδια ανάγνωση συνδέσμων με το src/server/about.ts
const https = (u) => (typeof u === 'string' && /^https:\/\/\S+$/.test(u) ? u : null);
const urlOf = (x) => (typeof x === 'string' ? x : x?.url);
const repoMatch = /^(?:github:|(?:git\+)?https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(urlOf(pkg.repository) ?? '').trim());
const gh = repoMatch ? `https://github.com/${repoMatch[1]}/${repoMatch[2]}` : null;
const kofi = https(urlOf(Array.isArray(pkg.funding) ? pkg.funding[0] : pkg.funding));
const homepage = https(pkg.homepage);
const site = homepage ? homepage.replace(/\/?$/, '/') : null;
const email = typeof pkg.bugs === 'object' && /^\S+@\S+$/.test(pkg.bugs.email ?? '') ? pkg.bugs.email : null;
const privacy = fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8').replace(/\r\n/g, '\n').split('<!-- el -->');
const terms = fs.readFileSync(path.join(root, 'TERMS.md'), 'utf8').replace(/\r\n/g, '\n').split('<!-- el -->');
const preview = !gh;
if (process.argv.includes('--check') && (preview || /\[(CONTROLLER|EMAIL)\]/.test([...privacy, ...terms].join(''))))
  throw new Error('Λείπει το "repository" στο package.json ή ο υπεύθυνος / το email στα PRIVACY.md και TERMS.md');
if (preview) console.warn('Προεπισκόπηση: λείπει το "repository" στο package.json.');

const base = gh ? `${gh}/releases/latest/download/` : null;
const links = {
  base,
  full: base ? base + FULL : '#download',
  portable: base ? `${base}Ruru-Chess-Portable.zip` : '#download',
  release: gh ? `${gh}/releases/latest` : '#download',
  releases: gh ? `${gh}/releases` : '#download',
  repo: gh ?? '#',
  issues: gh ? `${gh}/issues` : '#',
  license: gh ? `${gh}/blob/main/LICENSE` : '#',
  agpl: gh ? `${gh}/blob/main/licenses/AGPL-3.0.txt` : '#',
  credits: gh ? `${gh}/blob/main/CREDITS.md` : '#',
  kofi: kofi ?? '#support',
};

const mb = (f) => (fs.existsSync(path.join(rel, f)) ? String(Math.round(fs.statSync(path.join(rel, f)).size / 1e6)) : '?');
const sumsFile = path.join(rel, 'SHA256SUMS.txt');
const files = fs.existsSync(sumsFile)
  ? fs
      .readFileSync(sumsFile, 'utf8')
      .split('\n')
      .map((l) => /^([0-9a-f]{64})\s+(\S+)$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => ({ hash: m[1], name: m[2], mb: mb(m[2]), href: base ? base + m[2] : '#download' }))
  : [];
const builtAt = fs.existsSync(path.join(rel, FULL)) ? fs.statSync(path.join(rel, FULL)).mtime : new Date();

// εικονίδια Lucide (ISC), όπως στην εφαρμογή: όσα ζητά η σελίδα
const used = new Set([...fs.readFileSync(path.join(src, 'page.mjs'), 'utf8').matchAll(/icon\('([\w-]+)'\)/g)].map((m) => m[1]));
const icons = new Map();
for (const name of used) {
  const file = path.join(root, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons', `${name}.mjs`);
  if (!fs.existsSync(file)) throw new Error(`Δεν υπάρχει εικονίδιο Lucide «${name}»`);
  const { __iconData } = await import(pathToFileURL(file).href);
  const inner = __iconData.node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  icons.set(name, `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`);
}
const icon = (name) => icons.get(name);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets', 'img'), { recursive: true });
for (const f of ['style.css', 'site.js']) fs.copyFileSync(path.join(src, f), path.join(out, 'assets', f));
for (const f of fs.readdirSync(path.join(src, 'img'))) fs.copyFileSync(path.join(src, 'img', f), path.join(out, 'assets', 'img', f));
fs.copyFileSync(path.join(root, 'public', 'icon.png'), path.join(out, 'assets', 'icon.png'));
fs.copyFileSync(path.join(root, 'Ruru.ico'), path.join(out, 'favicon.ico'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

for (const [i, { lang, dir }] of LANGS.entries()) {
  const t = content[lang];
  const other = LANGS[1 - i];
  const date = new Intl.DateTimeFormat(lang === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(builtAt);
  const c = {
    root: dir ? '../' : '',
    otherLang: other.lang,
    otherLangHref: dir ? '../' + other.dir : other.dir,
    site,
    pageUrl: site ? site + dir : null,
    preview,
    links,
    files,
    fullName: FULL,
    kofi,
    email,
    year: new Date().getFullYear(),
    // ακατέργαστη έκδοση για ?v= και schema.org· στο κείμενο «1.1.0 BETA» όπως στην εφαρμογή
    rev: pkg.version,
    vars: {
      version: pkg.version.replace(/-(\w+)$/, (m, s) => ` ${s.toUpperCase()}`),
      setupMB: mb(FULL),
      portableMB: mb('Ruru-Chess-Portable.zip'),
      portableUrl: links.portable,
      date,
      issues: links.issues,
      repo: links.repo,
      email: email ?? '',
    },
  };
  fs.mkdirSync(path.join(out, dir), { recursive: true });
  fs.writeFileSync(path.join(out, dir, 'index.html'), render(lang, t, c, icon));
  fs.writeFileSync(path.join(out, dir, 'privacy.html'), renderPrivacy(lang, t, c, privacy[i]));
  fs.writeFileSync(path.join(out, dir, 'terms.html'), renderTerms(lang, t, c, terms[i]));
}

fs.writeFileSync(
  path.join(out, 'site.webmanifest'),
  JSON.stringify(
    {
      name: 'Ruru Chess',
      short_name: 'Ruru',
      description: content.en.description,
      start_url: '/',
      display: 'browser',
      background_color: '#F9F7F2',
      theme_color: '#175CD3',
      icons: [{ src: '/assets/icon.png', sizes: '128x128', type: 'image/png' }],
    },
    null,
    2,
  ) + '\n',
);

if (site) {
  const lastmod = builtAt.toISOString().slice(0, 10);
  const pages = ['', 'privacy.html', 'terms.html'];
  const urls = [];
  for (const p of pages) {
    const enUrl = `${site}${p}`;
    const elUrl = `${site}el/${p}`;
    for (const loc of [enUrl, elUrl]) {
      urls.push(
        `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <xhtml:link rel="alternate" hreflang="en" href="${enUrl}"/>\n    <xhtml:link rel="alternate" hreflang="el" href="${elUrl}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${enUrl}"/>\n  </url>`,
      );
    }
  }
  fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n`);
  fs.writeFileSync(
    path.join(out, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`,
  );
}
console.log(`Έτοιμο: site/dist (έκδοση ${pkg.version}${preview ? ', προεπισκόπηση' : ''})`);
