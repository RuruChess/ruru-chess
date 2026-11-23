/**
 * Βάσεις αναφοράς για λήψη (π.χ. σε νέα εγκατάσταση): Lumbra's Gigabase από τον επίσημο
 * ιστότοπο (CC BY-NC 4.0, © Michael Jansen, lumbrasgigabase.com). Λήψη με συνέχεια σε
 * «.part» και πρόοδο με SSE «download», μετά εισαγωγή· το .7z σβήνεται όταν η εισαγωγή
 * πετύχει και η νέα βάση γίνεται βάση αναφοράς (εκτός αν υπάρχει ήδη μεγαλύτερη).
 * Ο εγκαταστάτης γράφει `preset.json` ({"engine": "stockfish"}): τότε η λήψη της μηχανής ξεκινά μόνη της
 * στην πρώτη εκκίνηση. Η βάση δεν διανέμεται με την εφαρμογή (CC BY-NC): μόνο σύνδεσμος στη σελίδα της.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { APP_DIR, readPreset } from './paths.ts';
import type { Router } from './http.ts';
import { HttpError, type Library } from './library.ts';
import { addEngine } from './analysis.ts';
import { VERSION } from './about.ts';
import { listArchive, sevenZipPath } from './db/importer.ts';

export interface RefOption {
  id: string;
  name: string;
  note: string;
  file: string;
  url: string;
  /** μέγεθος λήψης */
  bytes: number;
  /** ελεύθερος χώρος που χρειάζεται (λήψη + εισαγωγή + ευρετήρια) */
  needGB: number;
  /** περίπου ο χώρος μετά την εισαγωγή */
  finalGB: number;
}

export const REFERENCE_OPTIONS: RefOption[] = [
  {
    id: 'lumbras-elite',
    name: "Lumbra's Gigabase OTB Elite",
    note: 'παρτίδες όπου και οι δύο παίκτες έχουν Elo 2400+',
    file: 'LumbrasGigabase_OTB_ELO2400.7z',
    url: 'https://lumbrasgigabase.com/download/otb-elite-elo-2400-2/?wpdmdl=10663',
    bytes: 205_801_819,
    needGB: 3,
    finalGB: 1.5,
  },
  {
    id: 'lumbras-complete',
    name: "Lumbra's Gigabase OTB Complete",
    note: 'όλες οι παρτίδες OTB, ~12,3 εκατ.',
    file: 'LumbrasGigabase_OTB_Complete.7z',
    url: 'https://lumbrasgigabase.com/download/otb-complete/?wpdmdl=9964',
    bytes: 2_523_311_468,
    needGB: 16,
    finalGB: 9.5,
  },
];

interface DownloadState {
  id: string;
  status: 'downloading' | 'importing' | 'error' | 'cancelled';
  got: number;
  total: number;
  error?: string;
  abort: AbortController;
}

const UA = `RuruChess/${VERSION} (local chess app)`;

/** Λήψη σε «.part» με συνέχεια (Range) αν υπάρχει ήδη κομμάτι· διακοπή μετά από 60 δευτ. χωρίς δεδομένα. */
export async function download(url: string, file: string, signal: AbortSignal, progress: (got: number, total: number) => void): Promise<void> {
  const part = `${file}.part`;
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  const stall = new AbortController();
  let timer = setTimeout(() => stall.abort(), 60_000);
  const both = AbortSignal.any([signal, stall.signal]);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...(have ? { Range: `bytes=${have}-` } : {}) }, signal: both });
    if (res.status === 200) have = 0;
    else if (res.status !== 206) throw new Error(`Ο διακομιστής απάντησε ${res.status}`);
    if (!res.body) throw new Error('Κενή απάντηση');
    // σελίδα αντί για αρχείο (π.χ. ο ιστότοπος άλλαξε τον τρόπο λήψης): όχι αποθήκευση σκουπιδιών ως .7z
    if (/text\/html/i.test(res.headers.get('content-type') ?? '')) throw new Error('Ο ιστότοπος έστειλε σελίδα αντί για αρχείο (άλλαξε ο τρόπος λήψης)');
    const total = have + Number(res.headers.get('content-length') ?? 0);
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
    let got = have;
    try {
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        clearTimeout(timer);
        timer = setTimeout(() => stall.abort(), 60_000);
        got += chunk.length;
        if (!out.write(chunk)) await once(out, 'drain');
        progress(got, total);
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (total && got < total) throw new Error('Η λήψη έμεινε μισή — δοκίμασε ξανά (θα συνεχίσει από εκεί που σταμάτησε)');
    fs.renameSync(part, file);
  } catch (e) {
    if (stall.signal.aborted && !signal.aborted) throw new Error('Δεν ήρθαν δεδομένα για 60 δευτ. — δοκίμασε ξανά (θα συνεχίσει από εκεί που σταμάτησε)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

interface EngineDownload {
  status: 'downloading' | 'installing' | 'done' | 'error';
  got: number;
  total: number;
  name?: string;
  /** η τελευταία έκδοση υπήρχε ήδη */
  upToDate?: boolean;
  error?: string;
}

const STOCKFISH_ID = 'stockfish';

/**
 * Ποια αρχεία της έκδοσης να δοκιμαστούν, με τη σειρά: η «universal» (από το Stockfish 18 διαλέγει
 * μόνη της τις εντολές του επεξεργαστή) και, για παλαιότερες εκδόσεις, AVX2 → SSE4.1 → απλή x86-64.
 */
export function stockfishAssets(names: string[], arch: string = process.arch): string[] {
  const order = [
    ...(arch === 'arm64' ? [/windows-arm64-universal\.zip$/] : []),
    /windows-x86-64-universal\.zip$/,
    /windows-x86-64-avx2\.zip$/,
    /windows-x86-64-sse41-popcnt\.zip$/,
    /windows-x86-64\.zip$/,
  ];
  return order.flatMap((re) => names.filter((n) => re.test(n)));
}

/** Η τελευταία έκδοση (π.χ. «sf_19») και τα αρχεία της για Windows, από το GitHub. */
async function stockfishRelease(): Promise<{ tag: string; assets: Array<{ name: string; url: string }> }> {
  const res = await fetch('https://api.github.com/repos/official-stockfish/Stockfish/releases/latest', { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`Δεν βρέθηκε η τελευταία έκδοση του Stockfish (GitHub ${res.status})`);
  const rel = (await res.json()) as { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
  const urls = new Map(rel.assets.map((a) => [a.name, a.browser_download_url]));
  const assets = stockfishAssets([...urls.keys()]).map((name) => ({ name, url: urls.get(name)! }));
  if (!assets.length) throw new Error(`Η έκδοση ${rel.tag_name} του Stockfish δεν έχει αρχείο για Windows`);
  return { tag: rel.tag_name, assets };
}

function findFile(dir: string, match: (name: string) => boolean): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, match);
      if (f) return f;
    } else if (match(e.name)) return p;
  }
  return null;
}

export function registerDownloads(r: Router, lib: Library): void {
  const states = new Map<string, DownloadState>();
  const dir = () => path.join(lib.settings.databasesDir, '_downloads');
  const pub = (s: DownloadState) => ({ id: s.id, status: s.status, got: s.got, total: s.total, error: s.error });
  const installed = (o: RefOption) =>
    lib.entries.find((e) => (e.source && path.basename(e.source.path).toLowerCase() === o.file.toLowerCase()) || e.name === path.basename(o.file, '.7z'));

  r.get('/api/reference/options', () => {
    let freeBytes: number | null = null;
    try {
      fs.mkdirSync(lib.settings.databasesDir, { recursive: true });
      const st = fs.statfsSync(lib.settings.databasesDir);
      freeBytes = st.bavail * st.bsize;
    } catch {
      freeBytes = null;
    }
    return {
      freeBytes,
      options: REFERENCE_OPTIONS.map((o) => {
        const s = states.get(o.id);
        return { ...o, installed: unfinished(o) ? null : (installed(o)?.id ?? null), state: s ? pub(s) : null };
      }),
    };
  });

  /** Ολόκληρη αρχειοθήκη με PGN μέσα (μισή λήψη ή σελίδα HTML με όνομα .7z: το 7-Zip δεν την ανοίγει). */
  const goodArchive = async (file: string) => {
    try {
      return (await listArchive(file)).some((m) => /\.pgn$/i.test(m.name));
    } catch {
      return false;
    }
  };

  // ---------------------------------------------------------------------------
  // Από 11/2026 η Lumbra's Gigabase κατεβαίνει μόνο από browser (σύντομος έλεγχος proof-of-work στη σελίδα της,
  // που δεν τον παρακάμπτουμε). Ο χρήστης κατεβάζει το αρχείο από τη σελίδα· εδώ το βρίσκουμε στις Λήψεις.
  const LOCAL_RX = /lumbra.*\.(7z|zip|pgn)$/i;
  const localFiles = () => {
    const out: Array<{ path: string; name: string; size: number; mtime: number; db: string | null; busy: boolean }> = [];
    for (const d of [path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), 'OneDrive', 'Downloads')]) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(d);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!LOCAL_RX.test(name)) continue;
        const p = path.join(d, name);
        try {
          const st = fs.statSync(p);
          if (!st.isFile()) continue;
          const e = lib.entries.find((x) => x.source && path.resolve(x.source.path).toLowerCase() === p.toLowerCase());
          out.push({ path: p, name, size: st.size, mtime: st.mtimeMs, db: e?.id ?? null, busy: Boolean(e && lib.busy(e.id)) });
        } catch {
          // σβήστηκε στο μεταξύ
        }
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  };
  r.get('/api/reference/local', () => ({ files: localFiles() }));
  r.post('/api/reference/import', async (req) => {
    const f = localFiles().find((x) => x.path === String(req.body?.path ?? ''));
    if (!f) throw new HttpError(404, 'Δεν βρέθηκε το αρχείο στις Λήψεις');
    if (!/\.pgn$/i.test(f.name) && !(await goodArchive(f.path))) throw new HttpError(422, `Το «${f.name}» δεν ανοίγει (η λήψη έμεινε μισή;) — κατέβασέ το ξανά από τη σελίδα.`);
    const { entry } = lib.openFile(f.path);
    const ui = (lib.settings.ui as Record<string, unknown>) ?? {};
    lib.saveSettings({ ui: { ...ui, referenceDb: entry.id } });
    return { id: entry.id };
  });

  /** Εισαγωγή του κατεβασμένου .7z και ορισμός ως βάση αναφοράς (το .7z σβήνεται μόνο όταν η εισαγωγή πετύχει). */
  const importRef = (o: RefOption, file: string) => {
    const { entry } = lib.openFile(file, { removeSource: true });
    const ui = (lib.settings.ui as Record<string, unknown>) ?? {};
    // όχι υποβάθμιση: αν η τρέχουσα αναφορά είναι η μεγαλύτερη επιλογή, μένει αυτή
    const bigger = REFERENCE_OPTIONS.some((x) => x.bytes > o.bytes && ui.referenceDb && installed(x)?.id === ui.referenceDb);
    if (!bigger) lib.saveSettings({ ui: { ...ui, referenceDb: entry.id } });
  };

  /**
   * Μισή βάση αναφοράς: το .7z υπάρχει ακόμη (σβήνεται μόνο μετά από επιτυχή εισαγωγή) αλλά υπάρχει και βάση από αυτό,
   * χωρίς εισαγωγή σε εξέλιξη — το Ruru έκλεισε στη μέση. Η μισή βάση φεύγει και η εισαγωγή ξαναρχίζει.
   */
  const unfinished = (o: RefOption) => {
    const e = installed(o);
    return e && fs.existsSync(path.join(dir(), o.file)) && !lib.busy(e.id) && states.get(o.id)?.status !== 'downloading' ? e : undefined;
  };
  const resumeImport = (o: RefOption) => {
    const e = unfinished(o);
    if (!e) return false;
    lib.remove(e.id, true);
    importRef(o, path.join(dir(), o.file));
    states.set(o.id, { id: o.id, status: 'importing', got: o.bytes, total: o.bytes, abort: new AbortController() });
    r.broadcast('download', pub(states.get(o.id)!));
    return true;
  };

  const start = (o: RefOption) => {
    if ([...states.values()].some((s) => s.status === 'downloading')) throw new HttpError(409, 'Γίνεται ήδη μια λήψη');
    fs.mkdirSync(dir(), { recursive: true });
    const st = fs.statfsSync(dir());
    const free = st.bavail * st.bsize;
    if (free < o.needGB * 1e9) throw new HttpError(409, `Δεν υπάρχει αρκετός χώρος: χρειάζονται ~${o.needGB} GB ελεύθερα, υπάρχουν ${(free / 1e9).toFixed(1)} GB`);
    const s: DownloadState = { id: o.id, status: 'downloading', got: 0, total: o.bytes, abort: new AbortController() };
    states.set(o.id, s);
    let last = 0;
    const emit = () => r.broadcast('download', pub(s));
    const file = path.join(dir(), o.file);
    void (async () => {
      try {
        // ολόκληρο το αρχείο υπάρχει ήδη (η εισαγωγή δεν είχε τελειώσει ή απέτυχε): χωρίς ξανά λήψη
        if (!fs.existsSync(file)) {
          await download(o.url, file, s.abort.signal, (got, total) => {
            s.got = got;
            s.total = total || o.bytes;
            if (Date.now() - last > 400) {
              last = Date.now();
              emit();
            }
          });
        }
        // εισαγωγή (εργασία με πρόοδο στη Βιβλιοθήκη) και ορισμός ως βάση αναφοράς
        importRef(o, file);
        s.status = 'importing';
      } catch (e) {
        s.status = s.abort.signal.aborted ? 'cancelled' : 'error';
        s.error = (e as Error).message;
      }
      emit();
    })();
    emit();
    return pub(s);
  };

  // ---------------------------------------------------------------------------
  // Μηχανή: η τελευταία έκδοση του Stockfish (GPLv3) από τις επίσημες εκδόσεις του GitHub.
  // Πρώτα η «universal» (ή, σε παλαιότερες εκδόσεις, η AVX2)· αν δεν τρέχει, οι πιο συμβατές.
  // Μπαίνει στο <βάσεις>\engines\Stockfish\<έκδοση> με σταθερό id «stockfish» και γίνεται η
  // προεπιλεγμένη μηχανή· νέα λήψη = ενημέρωση της ίδιας μηχανής.
  let engineState: EngineDownload | null = null;
  const installStockfish = () => {
    if (engineState && (engineState.status === 'downloading' || engineState.status === 'installing')) throw new HttpError(409, 'Γίνεται ήδη λήψη της μηχανής');
    const st: EngineDownload = { status: 'downloading', got: 0, total: 0 };
    engineState = st;
    let last = 0;
    const emit = () => r.broadcast('engineDownload', st);
    const base = path.join(lib.settings.databasesDir, 'engines', 'Stockfish');
    void (async () => {
      const tmp = path.join(base, '_tmp');
      try {
        let lastError: Error | null = null;
        const rel = await stockfishRelease();
        const target = path.join(base, rel.tag);
        const current = lib.settings.engines.find((e) => e.id === STOCKFISH_ID);
        const upToDate = Boolean(current && current.path.startsWith(target + path.sep) && fs.existsSync(current.path));
        if (current && upToDate) {
          if (lib.settings.defaultEngine !== STOCKFISH_ID) lib.saveSettings({ defaultEngine: STOCKFISH_ID });
          st.name = current.name;
          st.upToDate = true;
        }
        for (const asset of upToDate ? [] : rel.assets) {
          st.status = 'downloading';
          const zip = path.join(dir(), asset.name);
          fs.mkdirSync(dir(), { recursive: true });
          await download(asset.url, zip, new AbortController().signal, (got, total) => {
            st.got = got;
            st.total = total;
            if (Date.now() - last > 400) {
              last = Date.now();
              emit();
            }
          });
          st.status = 'installing';
          emit();
          fs.rmSync(tmp, { recursive: true, force: true });
          fs.mkdirSync(tmp, { recursive: true });
          execFileSync(sevenZipPath(), ['x', '-y', `-o${tmp}`, zip], { stdio: 'ignore', windowsHide: true });
          fs.rmSync(zip, { force: true });
          const own = asset.name.replace(/\.zip$/i, '.exe').toLowerCase();
          const exe = findFile(tmp, (n) => n.toLowerCase() === own) ?? findFile(tmp, (n) => /^stockfish.*\.exe$/i.test(n));
          if (!exe) throw new Error('Δεν βρέθηκε το stockfish.exe μέσα στο αρχείο');
          // ολόκληρος ο φάκελος του εκτελέσιμου (μαζί η άδεια GPL και ό,τι άλλο χρειάζεται)
          fs.rmSync(target, { recursive: true, force: true });
          fs.cpSync(path.dirname(exe), target, { recursive: true });
          const dest = path.join(target, path.basename(exe));
          try {
            const { engine } = await addEngine(lib, dest, { id: STOCKFISH_ID, makeDefault: true });
            st.name = engine.name;
            lastError = null;
            // οι παλαιότερες εκδόσεις (όσες δεν τρέχουν αυτή τη στιγμή)
            for (const old of fs.readdirSync(base)) {
              if (old === rel.tag || old === '_tmp') continue;
              try {
                fs.rmSync(path.join(base, old), { recursive: true, force: true });
              } catch {
                // σε χρήση: μένει για την επόμενη φορά
              }
            }
            break;
          } catch (e) {
            // δεν τρέχει σε αυτόν τον επεξεργαστή: η επόμενη, πιο συμβατή έκδοση
            lastError = e as Error;
            fs.rmSync(target, { recursive: true, force: true });
          }
        }
        if (lastError) throw new Error(`Το Stockfish δεν τρέχει σε αυτόν τον υπολογιστή (${lastError.message})`);
        st.status = 'done';
      } catch (e) {
        st.status = 'error';
        st.error = (e as Error).message;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      emit();
    })();
    emit();
    return st;
  };
  r.get('/api/stockfish', () => ({ state: engineState, installed: lib.settings.engines.find((e) => e.id === STOCKFISH_ID) ?? null }));
  r.post('/api/stockfish/install', () => installStockfish());

  r.post('/api/reference/download', (req) => {
    const o = REFERENCE_OPTIONS.find((x) => x.id === req.body?.id);
    if (!o) throw new HttpError(404, 'Άγνωστη βάση');
    if (resumeImport(o)) return pub(states.get(o.id)!);
    return start(o);
  });

  // πακέτο με προεπιλογές: λήψη μηχανής / βάσης μόνο στην πρώτη εκκίνηση (αν ακυρωθεί, δεν ξαναρχίζει)
  try {
    const preset = readPreset();
    const engineMarker = path.join(APP_DIR, 'preset-engine-started');
    if (preset.engine === 'stockfish' && !fs.existsSync(engineMarker) && !lib.settings.engines.some((e) => e.id === STOCKFISH_ID)) {
      setTimeout(() => {
        try {
          installStockfish();
          fs.mkdirSync(APP_DIR, { recursive: true });
          fs.writeFileSync(engineMarker, new Date().toISOString());
        } catch (e) {
          console.warn('Αυτόματη λήψη του Stockfish:', (e as Error).message);
        }
      }, 2000);
    }
    // η βάση αναφοράς δεν κατεβαίνει πια μόνη της (από 11/2026 ο ιστότοπός της θέλει browser): την προτείνει το «Καλώς ήρθες»
  } catch {
    // οι αυτόματες λήψεις δεν πρέπει να εμποδίζουν την εκκίνηση
  }

  // στην εκκίνηση: όποια εισαγωγή βάσης αναφοράς έμεινε στη μέση ξαναρχίζει μόνη της
  setTimeout(async () => {
    for (const o of REFERENCE_OPTIONS) {
      try {
        const file = path.join(dir(), o.file);
        if (fs.existsSync(file) && states.get(o.id)?.status !== 'downloading' && !(await goodArchive(file))) {
          fs.rmSync(file, { force: true });
          const half = installed(o);
          if (half && !lib.busy(half.id)) lib.remove(half.id, true);
          console.log(`Βάση αναφοράς «${o.name}»: το κατεβασμένο αρχείο ήταν χαλασμένο και σβήστηκε`);
          continue;
        }
        if (resumeImport(o)) console.log(`Βάση αναφοράς «${o.name}»: η εισαγωγή είχε μείνει στη μέση· ξαναρχίζει`);
      } catch (e) {
        console.warn('Συνέχεια εισαγωγής βάσης αναφοράς:', (e as Error).message);
      }
    }
  }, 2500);

  r.post('/api/reference/cancel', (req) => {
    states.get(String(req.body?.id))?.abort.abort();
    return { ok: true };
  });
}
