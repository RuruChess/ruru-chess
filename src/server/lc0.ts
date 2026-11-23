/**
 * Lc0 (Leela Chess Zero, GPL-3.0) με προαιρετική λήψη από τις επίσημες σελίδες: το εκτελέσιμο για CPU, ένα μικρό
 * δίκτυο της Leela (αντίπαλος που παίζει για νίκη και στις ισόπαλες θέσεις, με «contempt») και τα βάρη Maia
 * 1100–1900 (CSSLab, GPL-3.0· παίζουν σαν άνθρωποι αυτού του Elo, με έναν κόμβο ανά κίνηση). Οι έλεγχοι των
 * αρχείων (μέγεθος, sha256, git blob SHA-1) και η ιδέα είναι από το RealChessBase (Λάζαρος Μπατσής, GPL-3.0).
 * Εγκατάσταση στο <βάσεις>\engines\Lc0· οι μηχανές «Leela» και «Maia 1100»…«Maia 1900» μπαίνουν στις ρυθμίσεις
 * χωρίς να γίνουν προεπιλογή ανάλυσης.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Router } from './http.ts';
import { HttpError, type EngineConfig, type Library } from './library.ts';
import { validHistory, type AnalysisManager } from './analysis.ts';
import { UciEngine } from './engine.ts';
import { download } from './downloads.ts';
import { sevenZipPath } from './db/importer.ts';

/** Το Lc0 για Windows (CPU, oneDNN), καρφωμένο με μέγεθος και sha256 (το `digest` της έκδοσης στο GitHub). */
export const LC0 = {
  version: 'v0.32.1',
  file: 'lc0-v0.32.1-windows-cpu-dnnl.zip',
  url: 'https://github.com/LeelaChessZero/lc0/releases/download/v0.32.1/lc0-v0.32.1-windows-cpu-dnnl.zip',
  bytes: 24_001_097,
  sha256: 'b9cfcfbd3dabffbfd452f6e8e087c22273721bef48eba19640b6d92006c142f5',
};

/** Το δίκτυο της Leela: το μικρό που προτείνει το έργο για CPU (256 φίλτρα, 10 μπλοκ). */
export const LEELA_NET = {
  name: 'T1-256x10',
  file: 't1-256x10-distilled-swa-2432500.pb.gz',
  url: 'https://storage.lczero.org/files/networks-contrib/t1-256x10-distilled-swa-2432500.pb.gz',
  bytes: 37_118_673,
  sha256: 'bc27a6cae8ad36f2b9a80a6ad9dabb0d6fda25b1e7f481a79bc359e14f563406',
};

export const MAIA_LEVELS = [1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900] as const;

/** Τα βάρη Maia (CSSLab/maia-chess, έκδοση v1.0): μέγεθος και SHA-1 του git blob, όπως στο αποθετήριο (`maia_weights/`). */
export const MAIA_WEIGHTS: Record<number, { bytes: number; gitSha1: string }> = {
  1100: { bytes: 1_313_193, gitSha1: '10838269d236a981a3139d8377c28ce67fa19e99' },
  1200: { bytes: 1_249_692, gitSha1: '64706a23a3e105d1a0e02e63e6ee9bee40bfdfe8' },
  1300: { bytes: 1_244_431, gitSha1: '97181c6cc59de5a2d0c2d6a0fe1eb440cf76d7f2' },
  1400: { bytes: 1_328_977, gitSha1: '4c2c9cccd28b362d40b35697dcd4062f12ed97c3' },
  1500: { bytes: 1_258_199, gitSha1: '651551e2603c3efba9c6ded3b87da302c40722fb' },
  1600: { bytes: 1_313_870, gitSha1: 'a5fcec728608025a35d5c06c1db3559fc2b39562' },
  1700: { bytes: 1_313_415, gitSha1: 'ab4208a76eaf4ddca63df71664a2c38cd46c350e' },
  1800: { bytes: 1_289_431, gitSha1: '431bb24159a55bf32fe46e724353d3556b8b3862' },
  1900: { bytes: 1_262_607, gitSha1: '52d22a8213ac82ffd4f9258c41f8dff8a4a00282' },
};

export const maiaUrl = (elo: number) => `https://github.com/CSSLab/maia-chess/releases/download/v1.0/maia-${elo}.pb.gz`;

/** Περίπου πόσα bytes κατεβαίνουν συνολικά (για την εμφάνιση). */
export const LC0_DOWNLOAD_BYTES = LC0.bytes + (LEELA_NET.bytes || 35_000_000) + MAIA_LEVELS.reduce((a, l) => a + MAIA_WEIGHTS[l].bytes, 0);

/**
 * Επιλογές της Leela όταν παίζει: θεωρεί ότι είναι δυνατότερη από τον αντίπαλο (contempt στο μοντέλο WDL), άρα
 * αποφεύγει τις ισοπαλίες και ψάχνει νίκη ακόμη και σε ισόπαλες θέσεις. Όποια δεν υπάρχει στην έκδοση αγνοείται.
 */
export const LEELA_PLAY_OPTIONS: Record<string, string | number> = { Contempt: '300', ContemptMode: 'play', WDLCalibrationElo: 2700 };

/** Νήματα της Leela σε CPU: με 8 γίνεται περίπου 5 φορές πιο γρήγορη από την προεπιλογή του Lc0. */
export const leelaThreads = () => Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)));

/** SHA-1 του git blob ενός αρχείου (όπως το `git hash-object`). */
export function gitBlobSha1(file: string): string {
  const data = fs.readFileSync(file);
  return crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}

const sha256Of = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * Τα βάρη για το Lc0 ως σχετική διαδρομή από τον φάκελό του (εκεί ξεκινά η διεργασία): το Lc0 ανοίγει αρχεία με
 * την κωδικοσελίδα ANSI των Windows, οπότε μια απόλυτη διαδρομή με ελληνικά δεν διαβάζεται.
 */
export function lc0Rel(exe: string, file: string): string {
  return path.relative(path.dirname(exe), file).split(path.sep).join('/');
}

export interface Lc0State {
  status: 'downloading' | 'installing' | 'done' | 'error' | 'cancelled';
  step: 'lc0' | 'leela' | 'maia' | 'check' | 'register';
  got: number;
  total: number;
  error?: string;
}

/** Οι μηχανές του Lc0 στις ρυθμίσεις. */
export const lc0Engines = (engines: EngineConfig[]) => engines.filter((e) => e.leela || e.human);

/** Η μηχανή Maia με Elo πιο κοντά στο ζητούμενο. */
export function nearestMaia(engines: EngineConfig[], elo: number): EngineConfig | null {
  let best: EngineConfig | null = null;
  for (const e of engines) if (e.human && (!best || Math.abs(e.human.elo - elo) < Math.abs(best.human!.elo - elo))) best = e;
  return best;
}

/** Το Lc0 ξεκινά με τα βάρη και δίνει κίνηση σε έναν κόμβο· επιστρέφει τα ονόματα των επιλογών του. */
async function checkLc0(exe: string, rel: string): Promise<Set<string>> {
  const e = new UciEngine(exe, [`--weights=${rel}`]);
  try {
    const idn = await e.start();
    if (!idn.options.some((o) => o.name.toLowerCase() === 'weightsfile')) throw new Error(`Το ${path.basename(exe)} δεν είναι το Lc0 (λείπει η επιλογή WeightsFile)`);
    e.setOption('WeightsFile', rel);
    e.setOption('Threads', 1);
    const u = await e.analyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { nodes: 1 }, 1, () => {});
    if (!u.bestmove) throw new Error(`Το Lc0 δεν έδωσε κίνηση με τα βάρη ${path.basename(rel)}`);
    return new Set(idn.options.map((o) => o.name));
  } finally {
    e.quit();
  }
}

export function registerLc0(r: Router, lib: Library, analysis: AnalysisManager): void {
  let state: Lc0State | null = null;
  let abort: AbortController | null = null;
  const paths = () => {
    const root = path.join(lib.settings.databasesDir, 'engines', 'Lc0');
    const bin = path.join(root, LC0.version);
    return { root, bin, exe: path.join(bin, 'lc0.exe'), nets: path.join(root, 'nets'), maia: path.join(root, 'maia'), tmp: path.join(root, '_tmp'), dl: path.join(root, '_downloads') };
  };
  const status = () => {
    const engines = lc0Engines(lib.settings.engines).filter((e) => fs.existsSync(e.path));
    return {
      state,
      version: LC0.version,
      net: LEELA_NET.name,
      bytes: LC0_DOWNLOAD_BYTES,
      leela: engines.find((e) => e.leela)?.id ?? null,
      maia: engines.filter((e) => e.human).map((e) => ({ id: e.id, elo: e.human!.elo })),
      dir: paths().root,
    };
  };
  const emit = () => r.broadcast('lc0', status());

  const install = () => {
    if (state && (state.status === 'downloading' || state.status === 'installing')) return status();
    const st: Lc0State = { status: 'downloading', step: 'lc0', got: 0, total: LC0_DOWNLOAD_BYTES };
    state = st;
    const ac = new AbortController();
    abort = ac;
    const p = paths();
    let done = 0;
    let last = 0;
    const progress = (got: number) => {
      st.got = done + got;
      if (Date.now() - last > 300) {
        last = Date.now();
        emit();
      }
    };
    void (async () => {
      try {
        fs.mkdirSync(p.dl, { recursive: true });
        // 1. Lc0: μέγεθος και sha256, αποσυμπίεση σε προσωρινό φάκελο και μετά στη θέση του (ποτέ μισή εγκατάσταση)
        if (!fs.existsSync(p.exe)) {
          const zip = path.join(p.dl, LC0.file);
          await download(LC0.url, zip, ac.signal, progress);
          if (fs.statSync(zip).size !== LC0.bytes || sha256Of(zip) !== LC0.sha256) {
            fs.rmSync(zip, { force: true });
            throw new Error('Το αρχείο του Lc0 δεν ταιριάζει με την επίσημη έκδοση (έλεγχος sha256)');
          }
          st.status = 'installing';
          emit();
          fs.rmSync(p.tmp, { recursive: true, force: true });
          fs.mkdirSync(p.tmp, { recursive: true });
          execFileSync(sevenZipPath(), ['x', '-y', `-o${p.tmp}`, zip], { stdio: 'ignore', windowsHide: true });
          fs.rmSync(zip, { force: true });
          const inner = fs.existsSync(path.join(p.tmp, 'lc0.exe')) ? p.tmp : fs.readdirSync(p.tmp, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(p.tmp, d.name)).find((d) => fs.existsSync(path.join(d, 'lc0.exe')));
          if (!inner) throw new Error('Το αρχείο του Lc0 δεν περιέχει lc0.exe');
          fs.rmSync(p.bin, { recursive: true, force: true });
          fs.cpSync(inner, p.bin, { recursive: true });
          fs.rmSync(p.tmp, { recursive: true, force: true });
        }
        done += LC0.bytes;
        // 2. το δίκτυο της Leela (μέγεθος και sha256 όταν είναι καρφωμένα)
        st.status = 'downloading';
        st.step = 'leela';
        emit();
        fs.mkdirSync(p.nets, { recursive: true });
        const net = path.join(p.nets, LEELA_NET.file);
        if (!fs.existsSync(net)) {
          await download(LEELA_NET.url, net, ac.signal, progress);
          if ((LEELA_NET.bytes && fs.statSync(net).size !== LEELA_NET.bytes) || (LEELA_NET.sha256 && sha256Of(net) !== LEELA_NET.sha256)) {
            fs.rmSync(net, { force: true });
            throw new Error('Το δίκτυο της Leela δεν ταιριάζει με το επίσημο αρχείο (έλεγχος sha256)');
          }
        }
        done += LEELA_NET.bytes || fs.statSync(net).size;
        // 3. τα βάρη Maia: μέγεθος και ο έλεγχος του git blob
        st.step = 'maia';
        emit();
        fs.mkdirSync(p.maia, { recursive: true });
        for (const elo of MAIA_LEVELS) {
          const w = MAIA_WEIGHTS[elo];
          const dest = path.join(p.maia, `maia-${elo}.pb.gz`);
          if (!fs.existsSync(dest) || gitBlobSha1(dest) !== w.gitSha1) {
            fs.rmSync(dest, { force: true });
            await download(maiaUrl(elo), dest, ac.signal, progress);
            if (gitBlobSha1(dest) !== w.gitSha1) {
              fs.rmSync(dest, { force: true });
              throw new Error(`Τα βάρη maia-${elo} δεν ταιριάζουν με το αποθετήριο της Maia (έλεγχος SHA-1)`);
            }
          }
          done += w.bytes;
        }
        // 4. έλεγχος: το Lc0 ξεκινά με το δίκτυο της Leela και με τη Maia και παίζει
        st.status = 'installing';
        st.step = 'check';
        emit();
        const netRel = lc0Rel(p.exe, net);
        const names = await checkLc0(p.exe, netRel);
        await checkLc0(p.exe, lc0Rel(p.exe, path.join(p.maia, 'maia-1500.pb.gz')));
        // 5. οι μηχανές στις ρυθμίσεις (η προεπιλογή ανάλυσης δεν αλλάζει)
        st.step = 'register';
        const keep = lib.settings.engines.filter((e) => !e.leela && !e.human);
        const contempt = Object.fromEntries(Object.entries(LEELA_PLAY_OPTIONS).filter(([k]) => names.has(k)));
        const leela: EngineConfig = { id: 'leela', name: `Leela (${LEELA_NET.name})`, path: p.exe, args: [`--weights=${netRel}`], options: { WeightsFile: netRel, Threads: leelaThreads(), ...contempt }, leela: true };
        const maias: EngineConfig[] = MAIA_LEVELS.map((elo) => {
          const rel = lc0Rel(p.exe, path.join(p.maia, `maia-${elo}.pb.gz`));
          return { id: `maia-${elo}`, name: `Maia ${elo}`, path: p.exe, args: [`--weights=${rel}`], options: { WeightsFile: rel, Threads: 1 }, human: { elo } };
        });
        const def = lib.settings.defaultEngine;
        lib.saveSettings({ engines: [...keep, leela, ...maias], defaultEngine: def && keep.some((e) => e.id === def) ? def : (keep[0]?.id ?? 'leela') });
        st.status = 'done';
        st.got = st.total;
      } catch (e) {
        st.status = ac.signal.aborted ? 'cancelled' : 'error';
        st.error = (e as Error).message;
      } finally {
        fs.rmSync(p.tmp, { recursive: true, force: true });
        if (abort === ac) abort = null;
      }
      emit();
    })();
    emit();
    return status();
  };

  const uninstall = () => {
    if (state && (state.status === 'downloading' || state.status === 'installing')) throw new HttpError(409, 'Η λήψη του Lc0 τρέχει ακόμη');
    const engines = lib.settings.engines.filter((e) => !e.leela && !e.human);
    const def = lib.settings.defaultEngine;
    lib.saveSettings({ engines, defaultEngine: def && engines.some((e) => e.id === def) ? def : (engines[0]?.id ?? null) });
    const { root } = paths();
    // μόνο ο δικός μας φάκελος (…\engines\Lc0)
    if (path.basename(root) === 'Lc0' && path.basename(path.dirname(root)) === 'engines') fs.rmSync(root, { recursive: true, force: true });
    state = null;
    return status();
  };

  r.get('/api/lc0', () => status());
  r.post('/api/lc0/install', () => install());
  r.post('/api/lc0/cancel', () => {
    abort?.abort();
    return { ok: true };
  });
  r.del('/api/lc0', () => uninstall());
  /**
   * Οι κινήσεις που θα έπαιζε ένας άνθρωπος αυτού του Elo, με πιθανότητες (ένας κόμβος του Lc0 με τα βάρη Maia):
   * {engineId? | elo?, fen, startFen?, moves?}.
   */
  r.post('/api/engine/human', async (req) => {
    const fen = String(req.body?.fen ?? '');
    const engines = lib.settings.engines;
    const wanted = typeof req.body?.engineId === 'string' ? engines.find((e) => e.id === req.body.engineId && e.human) : null;
    const cfg = wanted ?? nearestMaia(engines, Number(req.body?.elo) || 1500);
    if (!cfg) throw new HttpError(404, 'Δεν υπάρχει μηχανή Maia: κατέβασέ την από τις Ρυθμίσεις → Μηχανές');
    const out = await analysis.humanMoves(cfg.id, fen, validHistory(req.body?.startFen, req.body?.moves, fen));
    return { engineId: cfg.id, elo: cfg.human!.elo, ...out };
  });
}
