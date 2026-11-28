/** Όλες οι διαδρομές του API του Ruru. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { once } from 'node:events';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { Position, START_FEN } from '../core/chess.ts';
import { GF_COMMENTS, GF_NAGS, GF_SHAPES, GF_VARIATIONS, decodeGame, encodeGame, replayMainline, tokenToMove } from '../core/codec.ts';
import type { GameNode } from '../core/game.ts';
import { parseGames, writeGame } from '../core/pgn.ts';
import { checkPgnFile, pgnForSending } from '../core/pgnFile.ts';
import { FILE_MAX_GAMES } from '../core/social.ts';
import { GF_DELETED, type GameDatabase, type GameRow, type SearchCriteria } from './db/store.ts';
import { HANDLED, type Req, type Router } from './http.ts';
import { HttpError, Library, type EngineConfig } from './library.ts';
import { AnalysisManager, addEngine, probeEngine, validHistory } from './analysis.ts';
import { pressureMove } from './pressure.ts';
import { discoverEngines } from './engine.ts';
import { bookMoves, polyglotKey, polyglotMove, writeBook } from './book.ts';
import { quickFolders } from './paths.ts';
import { RESULT_TEXT, parsePgnDate, searchKey } from './text.ts';
import { ArrayIds, RangeIds, type IdList } from './idlist.ts';
import { scanGames, type ScanOptions, type ScanSpec } from './db/scan.ts';
import { parseManeuver } from '../core/maneuver.ts';
import { parseMaterial } from '../core/material.ts';
import { parsePawns, type PawnMode } from '../core/pawns.ts';
import { tiebreakOrder, tiebreaks } from '../core/tiebreak.ts';
import { computeFills, planRenames, type Fills, type ImproveOptions, type RenamePlan } from './improve.ts';
import { openAppWindow, setWindowDelegate } from './window.ts';
import { psQuote } from './psQuote.ts';
import { VERSION } from './about.ts';
import { browserStatus, markAsked, maximizeOnOpen } from './browser.ts';

const OPENINGS_TSV = new URL('../data/openings.tsv', import.meta.url);

interface ViewSpec {
  filter?: SearchCriteria;
  fen?: string;
  sort?: { col: string; desc: boolean };
  /** θέση πέρα από το βάθος του ευρετηρίου: παράλληλη σάρωση όλων των παρτίδων (μόνο αν ζητηθεί) */
  deep?: boolean;
}

interface CachedView {
  spec: ViewSpec;
  ids: IdList;
  at: number;
  posTotal?: number;
  limited?: boolean;
  /** βάση που εισάγεται: το πλήθος της όταν φτιάχτηκε η λίστα (μετά από νέες παρτίδες ξαναφτιάχνεται) */
  gen?: number;
}

// Worker για βαριές λίστες
let qWorker: Worker | null = null;
let qSeq = 1;
const qPending = new Map<number, { resolve: (ids: Int32Array) => void; reject: (e: Error) => void; progress?: (done: number, total: number) => void }>();

function queryInWorker(gdb: GameDatabase, filter: SearchCriteria | null, baseIds: Int32Array | null, sort: { col: string; desc: boolean } | null, signal?: AbortSignal): Promise<Int32Array> {
  // βάση που εισάγεται: ο worker ανοίγει σύνδεση μόνο για ανάγνωση (αλλιώς θα περίμενε ή θα καθυστερούσε την εισαγωγή)
  return workerRequest({ file: gdb.file, filter, baseIds, sort, growing: gdb.growing }, signal);
}

/**
 * Αίτημα στον worker των λιστών. Ακύρωση: ο worker τερματίζεται (μια ερώτηση SQLite δεν
 * σταματά αλλιώς) και ό,τι περίμενε απορρίπτεται· το επόμενο αίτημα ξεκινά νέο worker.
 */
function workerRequest(
  msg: { file: string; op?: 'doubles'; filter?: SearchCriteria | null; baseIds?: Int32Array | null; sort?: { col: string; desc: boolean } | null; growing?: GameDatabase['growing'] },
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<Int32Array> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (!qWorker) {
    qWorker = new Worker(new URL('./db/queryWorker.ts', import.meta.url));
    qWorker.on('message', (m: { id: number; ids?: Int32Array; error?: string; progress?: { done: number; total: number } }) => {
      const p = qPending.get(m.id);
      if (!p) return;
      if (m.progress) {
        p.progress?.(m.progress.done, m.progress.total);
        return;
      }
      qPending.delete(m.id);
      if (m.error) p.reject(new HttpError(500, m.error));
      else p.resolve(m.ids!);
    });
    qWorker.on('error', (e) => {
      for (const p of qPending.values()) p.reject(e as Error);
      qPending.clear();
      qWorker = null;
    });
    qWorker.unref();
  }
  const id = qSeq++;
  const worker = qWorker;
  return new Promise<Int32Array>((resolve, reject) => {
    const onAbort = () => {
      if (qWorker !== worker || !qPending.has(id)) return;
      for (const p of qPending.values()) p.reject(signal!.reason);
      qPending.clear();
      qWorker = null;
      void worker.terminate();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    qPending.set(id, {
      resolve: (ids) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(ids);
      },
      reject: (e) => {
        signal?.removeEventListener('abort', onAbort);
        reject(e);
      },
      progress: onProgress,
    });
    worker.postMessage({ ...msg, id });
  });
}

/** Κλείνει τη σύνδεση του worker σε μια βάση (π.χ. πριν από διαγραφή ή εισαγωγή). */
export function releaseQueryDb(file: string): void {
  qWorker?.postMessage({ type: 'close', file });
}

export function registerApi(r: Router, lib: Library, analysis: AnalysisManager): void {
  const views = new Map<string, CachedView>();

  const db = (req: Req): GameDatabase => lib.handle(req.params.id).db;
  /**
   * μόνο ανάγνωση: δουλεύει και όσο η βάση εισάγεται (λίστα, γραμμές, παρτίδα). Όχι για παίκτες, τουρνουά
   * και στατιστικά: σε νέα βάση τα ευρετήρια `games_*` λείπουν ως το τέλος και θα σάρωναν όλο τον πίνακα
   */
  const rdb = (req: Req): GameDatabase => lib.read(req.params.id).db;
  const num = (v: unknown, def = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  };

  // -------------------------------------------------------------------------
  // Θέσεις: ευρετήριο ή σάρωση

  async function positionIds(req: Req, fen: string, opts: ScanOptions = {}): Promise<{ ids: Int32Array; total: number; limited: boolean }> {
    const h = lib.handle(req.params.id);
    const pos = Position.fromFen(fen);
    if (h.index && h.db.getMeta('indexStale') !== '1') {
      const res = h.index.gameIds(pos.hashHi, pos.hashLo, 2_000_000);
      // βαθύτερες θέσεις από το ευρετήριο: συμπλήρωση με σάρωση στις μικρές βάσεις
      const ply = (pos.fullmove - 1) * 2 + pos.turn;
      if (res.total > 0 || ply < h.index.maxPly || h.db.count() > 300_000) {
        return { ids: res.ids, total: res.ids.length, limited: ply >= h.index.maxPly && res.total === 0 };
      }
    }
    // χωρίς (έγκυρο) ευρετήριο ή πέρα από το βάθος του: παράλληλη σάρωση με workers
    const ids = await scanGames(h.db.file, { kind: 'position', fen }, { minId: h.db.minId(), maxId: h.db.maxId() }, opts);
    return { ids, total: ids.length, limited: false };
  }

  async function computeView(req: Req, spec: ViewSpec, scan: (label: string) => ScanOptions = () => ({})): Promise<CachedView> {
    const gdb = rdb(req);
    let base: Int32Array | null = null;
    let posTotal: number | undefined;
    let limited = false;
    // υλικό, ελιγμοί και δομή πιονιών δεν είναι κριτήρια SQL: σάρωση κινήσεων με workers πάνω στις υποψήφιες
    const { material, materialAnyColor, maneuver, maneuverSide, pawns, pawnsMode, ...filter } = spec.filter ?? {};
    const scans: ScanSpec[] = [];
    if (material) {
      const m = parseMaterial(material);
      if (!m) throw new HttpError(400, 'Άκυρο υλικό — π.χ. KRP-KR ή R*-R*');
      scans.push({ kind: 'material', material: m, anyColor: Boolean(materialAnyColor) });
    }
    if (maneuver) {
      const m = parseManeuver(maneuver, maneuverSide === 0 || maneuverSide === 1 ? maneuverSide : -1);
      if (!m) throw new HttpError(400, 'Άκυρος ελιγμός — π.χ. «Nd2 Nf1 Ng3»');
      scans.push({ kind: 'maneuver', maneuver: m });
    }
    if (pawns) {
      const p = parsePawns(pawns, (pawnsMode ?? 'exact') as PawnMode);
      if (!p) throw new HttpError(400, 'Άκυρη δομή πιονιών — χρειάζεται FEN');
      scans.push({ kind: 'pawns', pawns: p });
    }
    const mat = scans.length > 0;
    // θέλουν το ευρετήριο θέσεων ή σάρωση όλων των κινήσεων: μετά την εισαγωγή
    if ((spec.fen || mat) && gdb.growing) throw new HttpError(409, 'Η αναζήτηση θέσης, υλικού, ελιγμού ή δομής πιονιών γίνεται μόλις τελειώσει η εισαγωγή της βάσης.');
    let hasFilter = Object.values(filter).some((v) => v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && !v.length));
    // βασική λίστα χωρίς φίλτρο: αν τα id είναι συνεχόμενα, δεν χρειάζεται καμία ανάγνωση
    if (!spec.fen && !hasFilter && !mat && (!spec.sort || spec.sort.col === 'id')) {
      const n = gdb.count();
      const lo = gdb.minId();
      if (!n || gdb.maxId() - lo + 1 === n) return { spec, ids: new RangeIds(lo, n, Boolean(spec.sort?.desc)), at: Date.now() };
    }
    if (spec.fen) {
      const p = await positionIds(req, spec.fen, scan('Θέση'));
      base = p.ids;
      posTotal = p.total;
      limited = p.limited;
      if (limited && spec.deep) {
        base = await scanGames(gdb.file, { kind: 'position', fen: spec.fen }, { minId: gdb.minId(), maxId: gdb.maxId() }, scan('Θέση'));
        posTotal = base.length;
        limited = false;
      }
    }
    if (mat) {
      let cand = base;
      if (hasFilter && gdb.count() <= 200_000) {
        cand = gdb.search(filter);
        if (base) {
          const allowed = new Set(base);
          cand = cand.filter((x) => allowed.has(x));
        }
      } else if (hasFilter) cand = await queryInWorker(gdb, filter, base, null, scan('Φίλτρο').signal);
      let found = cand;
      for (const sc of scans) found = await scanGames(gdb.file, sc, found ?? { minId: gdb.minId(), maxId: gdb.maxId() }, scan(sc.kind === 'material' ? 'Υλικό' : sc.kind === 'pawns' ? 'Δομή πιονιών' : 'Ελιγμός'));
      base = found;
      hasFilter = false;
    }
    // μικρές λίστες εδώ, μεγάλες σε worker (ο server μένει διαθέσιμος)· κατά την εισαγωγή όλες σε worker,
    // γιατί χωρίς τα ευρετήρια της βάσης σαρώνουν όλο τον πίνακα και το κύριο νήμα γράφει τις παρτίδες
    const small = !gdb.growing && (gdb.count() <= 200_000 || (base !== null && base.length <= 50_000 && !hasFilter));
    let ids: Int32Array;
    if (small) {
      if (hasFilter) {
        ids = gdb.search(filter);
        if (base) {
          const allowed = new Set(base);
          ids = ids.filter((x) => allowed.has(x));
        }
      } else ids = base ?? gdb.allIds();
      if (spec.sort && spec.sort.col !== 'id') ids = gdb.sortIds(ids, spec.sort.col, spec.sort.desc);
      else if (spec.sort?.desc) ids = ids.slice().reverse();
    } else {
      ids = await queryInWorker(gdb, hasFilter ? filter : null, base, spec.sort ?? null, scan('Ταξινόμηση').signal);
    }
    return { spec, ids: new ArrayIds(ids), at: Date.now(), posTotal, limited };
  }

  function viewKey(dbId: string, spec: ViewSpec): string {
    return dbId + ':' + crypto.createHash('sha1').update(JSON.stringify(spec)).digest('hex').slice(0, 16);
  }

  function getView(req: Req, key: string): CachedView {
    const v = views.get(key);
    if (!v) throw new HttpError(410, 'Η λίστα έληξε — ανανέωση');
    v.at = Date.now();
    return v;
  }

  function invalidateViews(dbId: string): void {
    // και στα άλλα παράθυρα: η λίστα αυτής της βάσης ξαναφορτώνεται
    r.broadcast('db', { id: dbId });
    for (const k of [...views.keys()]) if (k.startsWith(dbId + ':')) views.delete(k);
  }

  function rememberView(key: string, v: CachedView): void {
    views.set(key, v);
    if (views.size > 40) {
      const oldest = [...views.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      views.delete(oldest[0]);
    }
  }

  // -------------------------------------------------------------------------
  // Βιβλιοθήκη

  r.get('/api/library', () => ({ databases: lib.list(), jobs: [...lib.jobs.values()].map((j) => lib.publicJob(j)) }));

  r.post('/api/library/open', (req) => {
    const paths: string[] = Array.isArray(req.body?.paths) ? req.body.paths : [req.body?.path];
    const out = [];
    for (const p of paths.filter(Boolean)) {
      const { entry, job } = lib.openFile(p);
      out.push({ entry, job: job ? lib.publicJob(job) : null });
    }
    return { opened: out };
  });

  r.post('/api/library/new', (req) => ({ entry: lib.create(String(req.body?.name ?? 'Νέα βάση'), req.body?.file ? String(req.body.file) : undefined) }));
  r.post('/api/library/:id/rename', (req) => ({ entry: lib.rename(req.params.id, String(req.body?.name ?? '')) }));
  r.post('/api/library/:id/remove', async (req) => {
    releaseQueryDb(lib.find(req.params.id).file);
    await new Promise((res) => setTimeout(res, 50));
    lib.remove(req.params.id, Boolean(req.body?.deleteFiles));
    invalidateViews(req.params.id);
    return { ok: true };
  });
  r.post('/api/library/:id/import', (req) => {
    const job = lib.importInto(req.params.id, String(req.body?.path));
    invalidateViews(req.params.id);
    return { job: lib.publicJob(job) };
  });
  r.post('/api/library/:id/reindex', (req) => ({ job: lib.publicJob(lib.startIndexJob(req.params.id)) }));
  // μετατροπή στη νέα μορφή (λεξικό ετικετών): πρώτα κλείνει η σύνδεση του worker των λιστών
  r.post('/api/library/:id/convert', async (req) => {
    releaseQueryDb(lib.find(req.params.id).file);
    await new Promise((res) => setTimeout(res, 50));
    const job = lib.convertFormat(req.params.id);
    invalidateViews(req.params.id);
    return { job: lib.publicJob(job) };
  });
  r.get('/api/jobs',() => [...lib.jobs.values()].map((j) => lib.publicJob(j)));
  r.post('/api/jobs/:job/cancel', (req) => {
    lib.cancelJob(req.params.job);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Βάση

  /** βάσεις με παλιά στατιστικά που ξαναϋπολογίστηκαν σε αυτή την εκτέλεση (μία φορά η καθεμία) */
  const statsRefreshed = new Set<string>();

  r.get('/api/db/:id/info', (req) => {
    const entry = lib.find(req.params.id);
    const h = lib.handle(req.params.id);
    const stats = h.db.stats();
    // παλιά βάση: η παλιά τιμή τώρα, η σωστή την επόμενη φορά (χωρίς σάρωση στο κύριο νήμα)
    if (h.db.statsOutdated && !lib.busy(req.params.id) && !statsRefreshed.has(h.db.file)) {
      statsRefreshed.add(h.db.file);
      const w = new Worker(new URL('./db/statsWorker.ts', import.meta.url), { workerData: h.db.file });
      w.on('error', () => {});
      w.on('exit', () => h.db.forgetStats());
      w.unref();
    }
    return {
      entry,
      stats,
      index: h.index ? { entries: h.index.entries, maxPly: h.index.maxPly, stale: h.db.getMeta('indexStale') === '1' } : null,
    };
  });

  /** Σαρώσεις λιστών σε εξέλιξη (scanId του πελάτη): πρόοδος με SSE «scan» και ακύρωση. */
  const scansRunning = new Map<string, AbortController>();

  r.post('/api/db/:id/view', async (req) => {
    const { scanId, ...spec } = (req.body ?? {}) as ViewSpec & { scanId?: string };
    const key = viewKey(req.params.id, spec);
    // βάση που εισάγεται: η λίστα ξαναφτιάχνεται όταν έχουν μπει νέες παρτίδες
    const gen = lib.importing(req.params.id) ? rdb(req).count() : undefined;
    let v = views.get(key);
    if (v && v.gen !== gen) v = undefined;
    if (!v) {
      const id = scanId ? String(scanId) : '';
      const ac = new AbortController();
      if (id) scansRunning.set(id, ac);
      try {
        v = await computeView(req, spec, (label) => ({
          signal: ac.signal,
          onProgress: id ? (done, total) => r.broadcast('scan', { id, label, done, total }) : undefined,
        }));
      } catch (e) {
        if (ac.signal.aborted) throw new HttpError(499, 'Η αναζήτηση ακυρώθηκε');
        throw e;
      } finally {
        if (id) scansRunning.delete(id);
      }
      v.gen = gen;
      rememberView(key, v);
    }
    return { key, count: v.ids.length, posTotal: v.posTotal, limited: v.limited };
  });

  r.post('/api/scan/:id/cancel', (req) => {
    scansRunning.get(req.params.id)?.abort();
    return { ok: true };
  });

  r.get('/api/db/:id/rows', (req) => {
    const v = getView(req, req.query.get('key') ?? '');
    const offset = Math.max(0, num(req.query.get('offset')));
    const limit = Math.min(500, Math.max(1, num(req.query.get('limit'), 100)));
    const slice = v.ids.slice(offset, offset + limit);
    return { count: v.ids.length, offset, rows: rdb(req).rows(slice) };
  });

  /** Θέση μιας παρτίδας στη λίστα (για «επόμενη / προηγούμενη παρτίδα»). */
  r.get('/api/db/:id/neighbors', (req) => {
    const v = getView(req, req.query.get('key') ?? '');
    const gid = num(req.query.get('game'));
    const i = v.ids.indexOf(gid);
    return { index: i, prev: i > 0 ? v.ids.at(i - 1) : null, next: i >= 0 && i + 1 < v.ids.length ? v.ids.at(i + 1) : null, count: v.ids.length };
  });

  r.get('/api/db/:id/game/:gid', (req) => {
    const g = rdb(req).getGame(num(req.params.gid));
    if (!g) throw new HttpError(404, 'Δεν βρέθηκε η παρτίδα');
    const game = decodeGame(g.tokens, g.comments, g.fen ?? START_FEN);
    game.headers = { ...game.headers, ...g.headers };
    return { id: g.row.id, row: g.row, pgn: writeGame(game, { maxLine: 0 }) };
  });

  function gameFromPgn(pgn: string) {
    const parsed = parseGames(pgn);
    if (!parsed.length) throw new HttpError(400, 'Δεν βρέθηκε παρτίδα στο PGN');
    return parsed.map(({ game, error }) => {
      const enc = encodeGame(game);
      return {
        headers: game.headers,
        tokens: enc.tokens,
        comments: enc.comments.length ? enc.comments : null,
        fen: game.isStandardStart ? null : game.startFen,
        flags: enc.flags | (error ? 32 : 0),
        plies: game.plyCount(),
      };
    });
  }

  r.put('/api/db/:id/game/:gid', (req) => {
    const [g] = gameFromPgn(String(req.body?.pgn ?? ''));
    db(req).replaceGame(num(req.params.gid), g);
    lib.markChanged(req.params.id);
    invalidateViews(req.params.id);
    return { ok: true };
  });

  const insertPgn = (id: string, pgn: string): number[] => {
    const games = gameFromPgn(pgn);
    const gdb = lib.handle(id).db;
    const ids: number[] = [];
    gdb.db.exec('BEGIN');
    try {
      for (const g of games) ids.push(gdb.insertGame(g));
      gdb.db.exec('COMMIT');
    } catch (e) {
      gdb.rollback();
      throw e;
    }
    lib.markChanged(id);
    invalidateViews(id);
    return ids;
  };
  // και για το «Οι παρτίδες μου» (mygames.ts)
  lib.addPgn = (id, pgn) => insertPgn(id, pgn).length;

  r.post('/api/db/:id/games', (req) => ({ ids: insertPgn(req.params.id, String(req.body?.pgn ?? '')) }));

  r.post('/api/db/:id/delete', (req) => {
    const ids: number[] = (req.body?.ids ?? []).map(Number);
    db(req).setDeleted(ids, req.body?.deleted !== false);
    invalidateViews(req.params.id);
    return { ok: true };
  });

  // οριστικό σβήσιμο των επιλεγμένων (με ερώτηση στο περιβάλλον), χωρίς το ενδιάμεσο «σημάδι»
  r.post('/api/db/:id/erase', (req) => {
    const ids: number[] = (req.body?.ids ?? []).map(Number).filter(Number.isInteger);
    const n = db(req).deleteGames(ids);
    lib.markChanged(req.params.id);
    invalidateViews(req.params.id);
    return { removed: n };
  });

  r.post('/api/db/:id/purge', (req) => {
    const n = db(req).purgeDeleted();
    lib.markChanged(req.params.id);
    invalidateViews(req.params.id);
    return { removed: n };
  });

  function idsFromBody(req: Req): number[] {
    if (Array.isArray(req.body?.ids)) return req.body.ids.map(Number);
    if (req.body?.key) return Array.from(getView(req, String(req.body.key)).ids);
    throw new HttpError(400, 'Δεν δόθηκαν παρτίδες');
  }

  r.post('/api/db/:id/copy', (req) => {
    const ids = idsFromBody(req);
    const src = db(req);
    const targetId = String(req.body?.target);
    const dst = lib.handle(targetId).db;
    let n = 0;
    dst.db.exec('BEGIN');
    try {
      for (const id of ids) {
        const g = src.getGame(id);
        if (!g) continue;
        dst.insertGame({ headers: g.headers, tokens: g.tokens, comments: g.comments, fen: g.fen, flags: g.row.flags & 0xff, plies: g.row.plies });
        n++;
      }
      dst.db.exec('COMMIT');
    } catch (e) {
      dst.rollback();
      throw e;
    }
    lib.markChanged(targetId);
    invalidateViews(targetId);
    return { copied: n };
  });

  function writePgnTo(gdb: GameDatabase, ids: Iterable<number>, write: (s: string) => void, format = writeGame): number {
    let n = 0;
    for (const id of ids) {
      const g = gdb.getGame(id);
      if (!g) continue;
      const game = decodeGame(g.tokens, g.comments, g.fen ?? START_FEN);
      game.headers = { ...game.headers, ...g.headers };
      write(format(game) + '\n');
      n++;
    }
    return n;
  }

  r.post('/api/db/:id/export', (req) => {
    const ids = idsFromBody(req);
    const file = String(req.body?.path ?? '');
    if (!file) throw new HttpError(400, 'Δεν δόθηκε αρχείο');
    const fd = fs.openSync(file, 'w');
    try {
      const n = writePgnTo(db(req), ids, (s) => fs.writeSync(fd, s));
      return { exported: n, path: file };
    } finally {
      fs.closeSync(fd);
    }
  });

  r.get('/api/db/:id/export.pgn', (req) => {
    const v = getView(req, req.query.get('key') ?? '');
    const name = lib.find(req.params.id).name;
    req.res.writeHead(200, {
      'Content-Type': 'application/x-chess-pgn; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.pgn`,
    });
    writePgnTo(db(req), v.ids, (s) => req.res.write(s));
    req.res.end();
    return HANDLED;
  });

  // Φίλοι: το PGN μιας βάσης (όλης ή των παρτίδων `ids`) για αποστολή σε φίλο ή ομάδα (pgnFile.ts)
  // (σε κομμάτια των 500 παρτίδων: περιμένει όταν γεμίζει η σύνδεση και σταματά αν η σελίδα τα παρατήσει στο 1 MB)
  r.post('/api/db/:id/pgn', async (req) => {
    const gdb = db(req);
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(Number) : Array.from(gdb.search({ deleted: false }));
    const stripClocks = req.body?.stripClocks === true;
    if (ids.length > FILE_MAX_GAMES) throw new HttpError(413, 'Δεν χωρούν στο 1 MB της αποστολής: διάλεξε λιγότερες παρτίδες');
    const res = req.res;
    res.writeHead(200, { 'Content-Type': 'application/x-chess-pgn; charset=utf-8', 'Cache-Control': 'no-store' });
    let closed = false;
    res.on('close', () => (closed = true));
    const fmt = (g: Parameters<typeof pgnForSending>[0]) => pgnForSending(g, stripClocks ? { stripClocks: true } : undefined);
    try {
      for (let i = 0; i < ids.length && !closed; i += 500) {
        writePgnTo(gdb, ids.slice(i, i + 500), (s) => res.write(s), fmt);
        if (res.writableNeedDrain && !closed) await Promise.race([once(res, 'drain'), once(res, 'close')]).catch(() => (closed = true));
      }
    } finally {
      res.end();
    }
    return HANDLED;
  });

  // Φίλοι: παρτίδες που έστειλε ένας φίλος (μόνο PGN σε απλό κείμενο, έως 1 MB) → νέα βάση με εισαγωγή
  r.post('/api/library/receive', async (req) => {
    if (typeof req.body?.pgn !== 'string') throw new HttpError(400, 'Δεν είναι PGN');
    const data = Buffer.from(req.body.pgn, 'utf8');
    const checked = checkPgnFile(data);
    if ('error' in checked) {
      if (checked.error === 'large') throw new HttpError(413, 'Το αρχείο ξεπερνά το 1 MB');
      throw new HttpError(400, 'Το αρχείο δεν είναι καθαρό PGN');
    }
    const name =
      String(req.body?.name ?? '')
        .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '')
        .replace(/\.pgn$/i, '')
        .trim()
        .slice(0, 60) || 'Βάση από φίλο';
    const dir = path.join(os.tmpdir(), 'knightbase-received', crypto.randomUUID().slice(0, 8));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.pgn`);
    fs.writeFileSync(file, data);
    const { entry, job } = lib.openFile(file, { removeSource: true });
    return { entry, job: job ? lib.publicJob(job) : null };
  });

  // Δέντρο ανοιγμάτων από τη βάση
  /**
   * Καινοτομία (FindNovelty): η πρώτη θέση της κύριας γραμμής (fens: μετά από κάθε κίνηση)
   * που δεν υπάρχει σε παλαιότερη παρτίδα της βάσης. Δεν μετρούν η ίδια η παρτίδα (gameId)
   * και οι διαγραμμένες· παρτίδες χωρίς ημερομηνία θεωρούνται παλαιότερες.
   */
  r.post('/api/db/:id/novelty', async (req) => {
    const h = lib.handle(req.params.id);
    const fens: string[] = Array.isArray(req.body?.fens) ? req.body.fens.map(String) : [];
    const date = parsePgnDate(req.body?.date ? String(req.body.date) : undefined);
    const self = num(req.body?.gameId);
    const indexed = Boolean(h.index) && h.db.getMeta('indexStale') !== '1';
    const surname = (s: string) => searchKey(s.split(',')[0]);
    const sw = surname(String(req.body?.white ?? ''));
    const sb = surname(String(req.body?.black ?? ''));
    const row = h.db.db.prepare(
      `SELECT g.date AS date, pw.key AS wk, pb.key AS bk FROM games g JOIN players pw ON pw.id = g.white JOIN players pb ON pb.id = g.black
       WHERE g.id = ? AND (g.flags & ${GF_DELETED}) = 0`,
    );
    const earlier = (ids: Iterable<number>) =>
      [...new Set(ids)].filter((id) => {
        if (id === self) return false;
        const g = row.get(id) as { date: number; wk: string; bk: string } | undefined;
        if (!g) return false;
        // η ίδια παρτίδα από άλλη πηγή: ίδια επώνυμα, ίσως άλλη ή άγνωστη ημερομηνία
        if (sw && sb && surname(g.wk) === sw && surname(g.bk) === sb) return false;
        return !date || !g.date || g.date < date;
      });
    const positions = fens.map((f) => Position.fromFen(f));
    let before = h.db.count();
    let last: number[] | null = null; // οι παλαιότερες παρτίδες της προηγούμενης θέσης, όταν είναι λίγες
    for (let i = 0; i < fens.length; i++) {
      const pos = positions[i];
      // πολλές παρτίδες: σίγουρα παιγμένη πριν, αρκεί η μέτρηση από το ευρετήριο
      const c = indexed ? h.index!.count(pos.hashHi, pos.hashLo) : -1;
      if (c > 64) {
        before = c;
        last = null;
        continue;
      }
      const p = await positionIds(req, fens[i]);
      if (!p.limited) {
        const ids = earlier(p.ids);
        if (!ids.length) return { index: i, limited: false, before };
        before = ids.length;
        last = ids;
        continue;
      }
      // πέρα από το βάθος του ευρετηρίου: συνέχεια μόνο με τις παρτίδες της τελευταίας θέσης του
      // (χωρίς μεταθέσεις από άλλες γραμμές), αν δεν είναι πάρα πολλές
      if (!last && i > 0 && h.index) {
        const prev = h.index.gameIds(positions[i - 1].hashHi, positions[i - 1].hashLo, 5000);
        if (prev.total <= 5000) last = earlier(prev.ids);
      }
      if (!last) return { index: -1, limited: true, ply: i, before };
      const scratch = new Position();
      let alive = last.map((id) => {
        const seen = new Set<string>();
        const m = h.db.moveData(id);
        if (m) replayMainline(m.tokens, scratch, m.fen, (pp) => void seen.add(`${pp.hashHi}:${pp.hashLo}`));
        return seen;
      });
      for (let j = i; j < fens.length; j++) {
        const key = `${positions[j].hashHi}:${positions[j].hashLo}`;
        alive = alive.filter((s) => s.has(key));
        if (!alive.length) return { index: j, limited: false, before, beyondIndex: true };
        before = alive.length;
      }
      return { index: -1, limited: false, before, beyondIndex: true };
    }
    return { index: -1, limited: false, before };
  });

  /**
   * Βιβλίο Polyglot (.bin) από τη βάση: κινήσεις με ≥ minGames παρτίδες ως το maxPly, βάρος
   * 2·νίκες + ισοπαλίες (και άγνωστα αποτελέσματα) της πλευράς που παίζει. Μικρές βάσεις:
   * από όλες τις παρτίδες· μεγάλες: από το δέντρο του ευρετηρίου (θέσεις με ≥24 παρτίδες).
   */
  r.post('/api/db/:id/book', async (req) => {
    const h = lib.handle(req.params.id);
    const file = String(req.body?.path ?? '');
    if (!file) throw new HttpError(400, 'Δεν δόθηκε αρχείο');
    const maxPly = Math.max(1, Math.min(60, num(req.body?.maxPly, 30)));
    const minGames = Math.max(1, num(req.body?.minGames, 3));
    const agg = new Map<string, { key: bigint; move: number; white: boolean; w: number; d: number; l: number; n: number }>();
    const add = (pos: Position, mv: number, w: number, d: number, l: number, n: number) => {
      const key = polyglotKey(pos);
      const move = polyglotMove(mv);
      const k = `${key}:${move}`;
      let a = agg.get(k);
      if (!a) agg.set(k, (a = { key, move, white: pos.turn === 0, w: 0, d: 0, l: 0, n: 0 }));
      a.w += w;
      a.d += d;
      a.l += l;
      a.n += n;
    };
    const fromTree = Boolean(h.index && h.index.tree(Position.start().hashHi, Position.start().hashLo)) && h.db.count() > 50_000;
    if (!fromTree) {
      const p = new Position();
      let k = 0;
      for (const g of h.db.iterateMoves()) {
        const r3 = [g.result === 1 ? 1 : 0, g.result === 2 ? 1 : 0, g.result === 3 ? 1 : 0];
        replayMainline(g.tokens, p, g.fen, (pp, ply, next) => {
          if (ply >= maxPly || next === 0xffff) return true;
          const mv = tokenToMove(pp, next);
          if (mv) add(pp, mv, r3[0], r3[1], r3[2], 1);
          return false;
        });
        if (++k % 2000 === 0) await new Promise((r) => setImmediate(r));
      }
    } else {
      // από την αρχική θέση κατά πλάτος· στην ουρά FEN (το Position έχει μεγάλη στοίβα αναίρεσης)
      const seen = new Set<string>();
      const queue: Array<[string, number]> = [[START_FEN, 0]];
      for (let qi = 0; qi < queue.length; qi++) {
        const [fen, ply] = queue[qi];
        const pos = Position.fromFen(fen);
        const id = `${pos.hashHi}:${pos.hashLo}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const t = h.index!.tree(pos.hashHi, pos.hashLo);
        if (!t) continue;
        for (const m of t.moves) {
          if (m.games < minGames) continue;
          const mv = tokenToMove(pos, m.token);
          if (!mv || pos.board[mv & 0x7f] === 0 || !pos.isLegalPseudo(mv)) continue;
          add(pos, mv, m.w, m.d, m.l, m.games);
          if (ply + 1 < maxPly) {
            pos.makeMove(mv);
            queue.push([pos.fen(), ply + 1]);
            pos.unmakeMove();
          }
        }
        if (qi % 2000 === 0) await new Promise((r) => setImmediate(r));
      }
    }
    const entries = [...agg.values()]
      .filter((a) => a.n >= minGames)
      .map((a) => ({ key: a.key, move: a.move, weight: 2 * (a.white ? a.w : a.l) + a.d + (a.n - a.w - a.d - a.l) }));
    const n = writeBook(file, entries);
    return { path: file, entries: n, positions: new Set(entries.map((e) => e.key)).size, source: fromTree ? 'tree' : 'games' };
  });

  r.post('/api/db/:id/tree', (req) => {
    const fen = String(req.body?.fen ?? START_FEN);
    const h = lib.handle(req.params.id);
    const pos = Position.fromFen(fen);
    const stale = h.db.getMeta('indexStale') === '1';
    if (!h.index) return { indexed: false, total: 0, moves: [] };
    const pre = h.index.tree(pos.hashHi, pos.hashLo);
    let total = 0;
    let moves: Array<{ token: number; games: number; w: number; d: number; l: number; elo: number; oppElo: number; year: number }>;
    if (pre) {
      moves = pre.moves;
      total = h.index.count(pos.hashHi, pos.hashLo);
    } else {
      const { ids } = h.index.gameIds(pos.hashHi, pos.hashLo, 5000);
      total = ids.length;
      const agg = new Map<number, { token: number; games: number; w: number; d: number; l: number; eloSum: number; eloN: number; oppSum: number; oppN: number; year: number }>();
      const rows = new Map(h.db.rows(ids).map((row) => [row.id, row]));
      const p = new Position();
      for (const id of ids) {
        const md = h.db.moveData(id);
        const row = rows.get(id);
        if (!md || !row) continue;
        let next = -1;
        replayMainline(md.tokens, p, md.fen, (pp, _ply, nx) => {
          if (pp.hashHi === pos.hashHi && pp.hashLo === pos.hashLo) {
            next = nx;
            return true;
          }
          return false;
        });
        if (next < 0 || next === 0xffff) continue;
        let a = agg.get(next);
        if (!a) agg.set(next, (a = { token: next, games: 0, w: 0, d: 0, l: 0, eloSum: 0, eloN: 0, oppSum: 0, oppN: 0, year: 0 }));
        a.games++;
        if (row.result === 1) a.w++;
        else if (row.result === 2) a.d++;
        else if (row.result === 3) a.l++;
        const own = pos.turn === 0 ? row.welo : row.belo;
        const opp = pos.turn === 0 ? row.belo : row.welo;
        if (own) {
          a.eloSum += own;
          a.eloN++;
        }
        if (opp) {
          a.oppSum += opp;
          a.oppN++;
        }
        a.year = Math.max(a.year, Math.floor(row.date / 10000));
      }
      moves = [...agg.values()]
        .map((a) => ({ token: a.token, games: a.games, w: a.w, d: a.d, l: a.l, elo: a.eloN ? Math.round(a.eloSum / a.eloN) : 0, oppElo: a.oppN ? Math.round(a.oppSum / a.oppN) : 0, year: a.year }))
        .sort((x, y) => y.games - x.games);
    }
    const out = moves.map((m) => {
      const mv = tokenToMove(pos, m.token);
      const legal = pos.board[mv & 0x7f] !== 0 && pos.isLegalPseudo(mv);
      const score = m.games ? (pos.turn === 0 ? m.w + m.d / 2 : m.l + m.d / 2) / m.games : 0;
      return {
        san: legal ? pos.san(mv) : '?',
        uci: legal ? pos.moveToUci(mv) : '',
        games: m.games,
        w: m.w,
        d: m.d,
        l: m.l,
        score,
        elo: m.elo,
        perf: m.oppElo ? Math.round(m.oppElo + Math.max(-800, Math.min(800, 800 * (score - 0.5)))) : 0,
        year: m.year,
      };
    });
    return { indexed: true, stale, total, moves: out.filter((m) => m.uci), maxPly: h.index.maxPly };
  });

  // Κατάλογοι
  r.get('/api/db/:id/players', (req) => db(req).players(req.query.get('prefix') ?? '', num(req.query.get('limit'), 200)));
  r.get('/api/db/:id/tournaments', (req) => db(req).tournaments(req.query.get('prefix') ?? '', num(req.query.get('limit'), 300)));

  r.get('/api/db/:id/player', (req) => {
    const gdb = db(req);
    const name = req.query.get('name') ?? '';
    const pid = gdb.playerIdByName(name);
    if (pid === null) throw new HttpError(404, 'Δεν βρέθηκε ο παίκτης');
    const rows = gdb.db
      .prepare('SELECT id, white, black, welo, belo, date, result, eco, event FROM games WHERE white = ? OR black = ? ORDER BY date')
      .all(pid, pid) as Array<{ id: number; white: number; black: number; welo: number; belo: number; date: number; result: number; eco: string; event: number }>;
    const score = { white: [0, 0, 0], black: [0, 0, 0] };
    const ratings = new Map<number, number>();
    const openings = { white: new Map<string, number[]>(), black: new Map<string, number[]>() };
    const opponents = new Map<number, number[]>();
    for (const g of rows) {
      const asWhite = g.white === pid;
      const res = g.result;
      const idx = res === 2 ? 1 : (res === 1 && asWhite) || (res === 3 && !asWhite) ? 0 : res === 0 ? -1 : 2;
      const side = asWhite ? score.white : score.black;
      if (idx >= 0) side[idx]++;
      const elo = asWhite ? g.welo : g.belo;
      const y = Math.floor(g.date / 10000);
      if (elo && y) ratings.set(y, Math.max(ratings.get(y) ?? 0, elo));
      const eco = g.eco ? g.eco : '?';
      const om = asWhite ? openings.white : openings.black;
      const o = om.get(eco) ?? [0, 0, 0];
      if (idx >= 0) o[idx]++;
      om.set(eco, o);
      const opp = asWhite ? g.black : g.white;
      const op = opponents.get(opp) ?? [0, 0, 0];
      if (idx >= 0) op[idx]++;
      opponents.set(opp, op);
    }
    const top = (m: Map<string, number[]>) =>
      [...m.entries()]
        .map(([eco, [w, d, l]]) => ({ eco, games: w + d + l, w, d, l }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 15);
    const topOpp = [...opponents.entries()]
      .map(([id, [w, d, l]]) => ({ name: gdb.playerName(id), games: w + d + l, w, d, l }))
      .sort((a, b) => b.games - a.games)
      .slice(0, 15);
    return {
      name,
      games: rows.length,
      score,
      ratings: [...ratings.entries()].sort((a, b) => a[0] - b[0]).map(([year, elo]) => ({ year, elo })),
      openings: { white: top(openings.white), black: top(openings.black) },
      opponents: topOpp,
      first: Math.floor((rows.find((g) => g.date > 0)?.date ?? 0) / 10000),
      last: rows.length ? Math.floor(rows[rows.length - 1].date / 10000) : 0,
      ids: rows.map((g) => g.id),
    };
  });

  r.get('/api/db/:id/crosstable', (req) => {
    const gdb = db(req);
    const ids = gdb.tournamentGames(num(req.query.get('event')), num(req.query.get('site')), num(req.query.get('year')));
    const rows = gdb.rows(ids);
    const players = new Map<string, { name: string; elo: number; points: number; games: number; results: Map<string, string[]> }>();
    const get = (name: string, elo: number) => {
      let p = players.get(name);
      if (!p) players.set(name, (p = { name, elo, points: 0, games: 0, results: new Map() }));
      if (elo > p.elo) p.elo = elo;
      return p;
    };
    for (const g of rows) {
      const w = get(g.white, g.welo);
      const b = get(g.black, g.belo);
      const [ws, bs] = g.result === 1 ? ['1', '0'] : g.result === 2 ? ['½', '½'] : g.result === 3 ? ['0', '1'] : ['*', '*'];
      if (g.result) {
        w.games++;
        b.games++;
        w.points += g.result === 1 ? 1 : g.result === 2 ? 0.5 : 0;
        b.points += g.result === 3 ? 1 : g.result === 2 ? 0.5 : 0;
      }
      (w.results.get(b.name) ?? w.results.set(b.name, []).get(b.name)!).push(ws);
      (b.results.get(w.name) ?? b.results.set(w.name, []).get(w.name)!).push(bs);
    }
    const score = (r: string) => (r === '1' ? 1 : r === '½' ? 0.5 : 0);
    const tb = tiebreaks(
      [...players.values()].map((p) => ({
        name: p.name,
        points: p.points,
        games: [...p.results].flatMap(([opp, rs]) => rs.filter((r) => r !== '*').map((r) => ({ opp, score: score(r) }))),
      })),
    );
    // πουλ: λίγοι παίκτες που έπαιξαν (σχεδόν) όλοι με όλους ή χωρίς γύρους
    const n = players.size;
    const avgGames = [...players.values()].reduce((a, p) => a + p.games, 0) / Math.max(1, n);
    const hasRounds = rows.some((g) => parseInt(g.round, 10) > 0);
    const roundRobin = n <= 24 && (avgGames >= 0.75 * (n - 1) || !hasRounds);
    const order = tiebreakOrder(roundRobin);
    const list = [...players.values()].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const ta = tb.get(a.name)!;
      const tbb = tb.get(b.name)!;
      for (const k of order) if (tbb[k] !== ta[k]) return tbb[k] - ta[k];
      return b.elo - a.elo;
    });
    // ελβετικό σύστημα: αποτελέσματα ανά γύρο (αντίπαλος, χρώμα, αποτέλεσμα)
    const rank = new Map(list.map((p, i) => [p.name, i + 1]));
    const rounds = new Map<string, Array<{ round: number; opp: number; color: 'w' | 'b'; res: string }>>();
    let maxRound = 0;
    for (const g of rows) {
      const rd = parseInt(g.round, 10);
      if (!Number.isFinite(rd) || rd <= 0) continue;
      maxRound = Math.max(maxRound, rd);
      const [ws, bs] = g.result === 1 ? ['1', '0'] : g.result === 2 ? ['½', '½'] : g.result === 3 ? ['0', '1'] : ['*', '*'];
      (rounds.get(g.white) ?? rounds.set(g.white, []).get(g.white)!).push({ round: rd, opp: rank.get(g.black) ?? 0, color: 'w', res: ws });
      (rounds.get(g.black) ?? rounds.set(g.black, []).get(g.black)!).push({ round: rd, opp: rank.get(g.white) ?? 0, color: 'b', res: bs });
    }
    return {
      event: rows[0]?.event ?? '',
      site: rows[0]?.site ?? '',
      maxRound: Math.min(maxRound, 30),
      roundRobin,
      tiebreaks: order,
      players: list.map((p) => ({
        name: p.name,
        elo: p.elo,
        points: p.points,
        games: p.games,
        tb: tb.get(p.name)!,
        results: roundRobin ? list.map((o) => (o.name === p.name ? null : (p.results.get(o.name) ?? []).join(' '))) : [],
        rounds: (rounds.get(p.name) ?? []).sort((a, b) => a.round - b.round),
      })),
      ids: Array.from(ids),
    };
  });

  /**
   * Αφαίρεση σχολιασμού από όλη τη βάση (UnAnnotateDB): βαριάντες, σχόλια (και ρολόγια /
   * αξιολογήσεις), σύμβολα, γραφικά. Εργασία με πρόοδο· αγγίζει μόνο τις σχολιασμένες παρτίδες.
   */
  r.post('/api/db/:id/unannotate', (req) => {
    const opts = { variations: Boolean(req.body?.variations), comments: Boolean(req.body?.comments), nags: Boolean(req.body?.nags), shapes: Boolean(req.body?.shapes) };
    const mask = (opts.variations ? GF_VARIATIONS : 0) | (opts.comments ? GF_COMMENTS : 0) | (opts.nags ? GF_NAGS : 0) | (opts.shapes ? GF_SHAPES : 0);
    if (!mask) throw new HttpError(400, 'Δεν επιλέχθηκε τι θα αφαιρεθεί');
    const dbId = req.params.id;
    const job = lib.runJob(dbId, 'Αφαίρεση σχολιασμού', async (gdb, j, progress) => {
      const ids = gdb.idsWithFlags(mask);
      for (let i = 0; i < ids.length && !j.abort.signal.aborted; i += 2000) {
        gdb.stripGames(ids.subarray(i, i + 2000), opts);
        progress(Math.min(ids.length, i + 2000), ids.length);
        await new Promise((r) => setImmediate(r));
      }
      invalidateViews(dbId);
    });
    return { id: job.id };
  });

  /** Πού είναι οι νεότερες παρτίδες μιας βάσης: στα μικρά id (π.χ. Lumbras, 2026 → 1950) ή στα μεγάλα. */
  const newestFirst = new WeakMap<GameDatabase, boolean>();
  const isNewestFirst = (gdb: GameDatabase): boolean => {
    let v = newestFirst.get(gdb);
    if (v === undefined) {
      const avg = (where: string, ...args: number[]) => (gdb.db.prepare(`SELECT avg(date) AS d FROM games WHERE ${where} AND date > 0`).get(...args) as { d: number | null }).d ?? 0;
      v = avg('id <= ?', gdb.minId() + 500) > avg('id >= ?', gdb.maxId() - 500);
      newestFirst.set(gdb, v);
    }
    return v;
  };

  /**
   * «Αναφορά»: παρτίδες μιας θέσης. Από τις 6.000 νεότερες
   * της θέσης, πρώτα όσες έχουν δυνατούς παίκτες (και οι δύο ≥2400) κατά ημερομηνία, μετά
   * οι υπόλοιπες κατά μέσο Elo· με τη συνέχεια της παρτίδας από τη θέση.
   */
  r.post('/api/db/:id/position-games', async (req) => {
    const h = lib.handle(req.params.id);
    const fen = String(req.body?.fen ?? START_FEN);
    const limit = Math.min(100, Math.max(1, num(req.body?.limit, 40)));
    const pos = Position.fromFen(fen);
    const ply = (pos.fullmove - 1) * 2 + pos.turn;
    const fromEnd = !isNewestFirst(h.db);
    let ids: Int32Array;
    let total: number;
    if (h.index && h.db.getMeta('indexStale') !== '1' && (ply < h.index.maxPly || h.index.count(pos.hashHi, pos.hashLo) > 0)) {
      ({ ids, total } = h.index.edgeGameIds(pos.hashHi, pos.hashLo, 6000, fromEnd));
    } else {
      const p = await positionIds(req, fen);
      total = p.total;
      ids = fromEnd ? p.ids.subarray(Math.max(0, p.ids.length - 6000)) : p.ids.subarray(0, 6000);
    }
    const strong = (g: GameRow) => Math.min(g.welo, g.belo) >= 2400;
    const rows = h.db.rows(ids).filter((g) => !(g.flags & GF_DELETED));
    rows.sort((a, b) => Number(strong(b)) - Number(strong(a)) || (strong(a) ? b.date - a.date : b.welo + b.belo - (a.welo + a.belo) || b.date - a.date));
    const scratch = new Position();
    const games = rows.slice(0, limit).map((g) => {
      // οι επόμενες κινήσεις της παρτίδας από αυτή τη θέση
      const next: string[] = [];
      const md = h.db.moveData(g.id);
      let found = false;
      if (md) {
        replayMainline(md.tokens, scratch, md.fen, (pp, _ply, tk) => {
          if (!found && pp.hashHi === pos.hashHi && pp.hashLo === pos.hashLo) found = true;
          if (!found) return false;
          if (tk === 0xffff || next.length >= 4) return true;
          next.push(pp.san(tokenToMove(pp, tk)));
          return false;
        });
      }
      return { id: g.id, white: g.white, black: g.black, welo: g.welo, belo: g.belo, result: g.result, date: g.date, event: g.event, next };
    });
    return { total, games };
  });

  /** Εύρεση διπλών παρτίδων (ίδιοι παίκτες, αποτέλεσμα και κινήσεις) — σημαδεύονται ως διαγραμμένες. */
  r.post('/api/db/:id/doubles', async (req) => {
    const gdb = db(req);
    // στον worker: σε τεράστιες βάσεις η σάρωση κρατά λεπτά (ακύρωση με το scanId, όπως οι λίστες)
    const id = req.body?.scanId ? String(req.body.scanId) : '';
    const ac = new AbortController();
    if (id) scansRunning.set(id, ac);
    let dups: number[];
    try {
      // πρόοδος χωρίς label: το παράθυρο κρατά το δικό του («Διπλές παρτίδες…», και στα αγγλικά)
      dups = [...(await workerRequest({ file: gdb.file, op: 'doubles' }, ac.signal, id ? (done, total) => r.broadcast('scan', { id, done, total }) : undefined))];
    } catch (e) {
      if (ac.signal.aborted) throw new HttpError(499, 'Η αναζήτηση ακυρώθηκε');
      throw e;
    } finally {
      if (id) scansRunning.delete(id);
    }
    if (req.body?.mark !== false && dups.length) gdb.setDeleted(dups, true);
    invalidateViews(req.params.id);
    return { doubles: dups.length, ids: dups };
  });

  // -------------------------------------------------------------------------
  // Παράθυρα: κάθε βάση / παρτίδα σε δικό της παράθυρο. Η περιγραφή
  // του παραθύρου μένει εδώ και το νέο παράθυρο τη ζητά με το κλειδί του (#open=…).

  const windowTabs = new Map<string, unknown>();
  const localOrigin = (value: unknown): URL => {
    let origin: URL;
    try {
      origin = new URL(String(value ?? ''));
    } catch {
      throw new HttpError(400, 'Άκυρη διεύθυνση παραθύρου');
    }
    if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new HttpError(400, 'Μόνο τοπικά παράθυρα');
    return origin;
  };

  // Συμβατότητα με παράθυρα της 0.3.0 που είναι ακόμη ανοιχτά: στέλνουν την παρτίδα με τις αλλαγές
  // όταν κλείνουν, και ο server ανοίγει μικρό παράθυρο «Αποθήκευση;». (Η 0.4.0 ρωτά μέσα στο ίδιο
  // παράθυρο, βλ. browser.ts.)
  const closing = new Map<string, { tab: unknown; timer: ReturnType<typeof setTimeout> }>();
  const prompts = new Map<string, unknown>();
  r.post('/api/window/closed', (req) => {
    const origin = localOrigin(req.body?.origin);
    const key = String(req.body?.key ?? '');
    const tab = req.body?.tab;
    if (!tab || tab.kind !== 'game' || typeof tab.pgn !== 'string') throw new HttpError(400, 'Άκυρη παρτίδα');
    const b = req.body?.bounds as { x: number; y: number; w: number; h: number } | undefined;
    // open: false → μόνο το κλειδί της ερώτησης, χωρίς παράθυρο (για δοκιμές)
    if (req.body?.open === false) {
      const pk = crypto.randomUUID().slice(0, 12);
      prompts.set(pk, tab);
      return { ok: true, pk };
    }
    const timer = setTimeout(() => {
      closing.delete(key);
      const pk = crypto.randomUUID().slice(0, 12);
      prompts.set(pk, tab);
      const size = { w: 540, h: 330 };
      const pos = b && [b.x, b.y, b.w, b.h].every(Number.isFinite) ? { x: Math.round(b.x + (b.w - size.w) / 2), y: Math.round(b.y + (b.h - size.h) / 3) } : undefined;
      openAppWindow(`${origin.origin}/#closeprompt=${pk}`, size, pos);
    }, 1500);
    clearTimeout(closing.get(key)?.timer);
    closing.set(key, { tab, timer });
    return { ok: true };
  });
  r.get('/api/closeprompt/:pk', (req) => {
    if (!prompts.has(req.params.pk)) throw new HttpError(404, 'Η ερώτηση δεν βρέθηκε');
    return { tab: prompts.get(req.params.pk) };
  });
  r.post('/api/closeprompt/:pk/done', (req) => {
    prompts.delete(req.params.pk);
    return { ok: true };
  });

  // η σελίδα έδειξε τη δική της ερώτηση «Αποθήκευση;» (βλ. browser.ts)
  r.post('/api/window/asked', (req) => {
    markAsked(String(req.body?.key ?? 'main'));
    return { ok: true };
  });
  r.get('/api/browser-status', () => browserStatus());
  // αρίθμηση νέων παρτίδων: «Νέα παρτίδα 1», «Νέα παρτίδα 2», …
  let gameNumber = 0;
  r.post('/api/game-number', () => ({ n: ++gameNumber }));

  r.post('/api/window', (req) => {
    const origin = localOrigin(req.body?.origin);
    const key = crypto.randomUUID().slice(0, 12);
    windowTabs.set(key, req.body?.tab ?? null);
    if (windowTabs.size > 500) windowTabs.delete(windowTabs.keys().next().value!);
    const kind = String(req.body?.tab?.kind ?? '');
    const size = kind === 'settings' ? { w: 1000, h: 820 } : kind === 'db' || kind === 'library' ? { w: 1500, h: 950 } : { w: 1400, h: 920 };
    // open: false → μόνο το κλειδί (το παράθυρο το ανοίγει ο ίδιος ο πελάτης, π.χ. σε δοκιμές)
    if (req.body?.open !== false) {
      // βάσεις, παρτίδες κ.λπ. σε όλη την οθόνη (μεγιστοποιημένα)· οι Ρυθμίσεις στο δικό τους μέγεθος
      if (kind !== 'settings') maximizeOnOpen(key);
      openAppWindow(`${origin.origin}/#open=${key}`, size, undefined, { maximized: kind !== 'settings' });
    }
    return { ok: true, key };
  });
  // Electron host: δέχεται αιτήματα νέου παραθύρου όταν συνδέεται σε server που τρέχει ήδη
  r.get('/api/window/host', (req) => {
    if (req.raw.headers['x-knightbase'] !== 'electron') throw new HttpError(403, 'Μη αποδεκτό αίτημα');
    const res = req.res;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    res.flushHeaders();
    const detach = setWindowDelegate((w) => {
      if (res.writableEnded || res.destroyed) return false;
      res.write(JSON.stringify(w) + '\n');
      return true;
    });
    res.on('close', detach);
    return HANDLED;
  });
  r.get('/api/window/:key', (req) => {
    const pending = closing.get(req.params.key);
    if (pending) {
      clearTimeout(pending.timer);
      closing.delete(req.params.key);
      windowTabs.set(req.params.key, pending.tab);
      return { tab: pending.tab };
    }
    if (!windowTabs.has(req.params.key)) throw new HttpError(404, 'Το παράθυρο δεν βρέθηκε');
    return { tab: windowTabs.get(req.params.key) };
  });

  // -------------------------------------------------------------------------
  // Βελτίωση βάσης (ImproveDB): ανάλυση → προεπισκόπηση → εφαρμογή όσων κράτησε ο χρήστης

  const improvePlans = new Map<string, RenamePlan & { dbId: string; ref: string | null; opts: ImproveOptions; fills: Fills }>();
  const CANCELLED = new Error('cancelled');
  const ticker =
    (j: { abort: AbortController }, progress: (done: number, total: number, message?: string) => void) =>
    async (done: number, total: number, message: string) => {
      progress(done, total, message);
      await new Promise((r) => setImmediate(r));
      if (j.abort.signal.aborted) throw CANCELLED;
    };

  r.post('/api/db/:id/improve', (req) => {
    const dbId = req.params.id;
    const refId = req.body?.reference ? String(req.body.reference) : null;
    if (refId === dbId) throw new HttpError(400, 'Η βάση αναφοράς πρέπει να είναι άλλη');
    const opts: ImproveOptions = { names: req.body?.names !== false, elo: req.body?.elo !== false, fide: req.body?.fide !== false };
    if (db(req).count() > 1_000_000) throw new HttpError(413, 'Πολύ μεγάλη βάση για βελτίωση (όριο 1.000.000 παρτίδες)');
    const ref = refId ? lib.handle(refId).db : null;
    const job = lib.runJob(dbId, 'Βελτίωση βάσης: ανάλυση', async (gdb, j, progress) => {
      const tick = ticker(j, progress);
      try {
        const plan = await planRenames(gdb, ref, opts.names, tick);
        const fills = await computeFills(gdb, ref, new Map(plan.renames.map((x) => [x.from, x.to])), plan.refByFinal, opts, tick);
        for (const [k, v] of improvePlans) if (v.dbId === dbId) improvePlans.delete(k);
        improvePlans.set(j.id, { dbId, ref: refId, opts, ...plan, fills });
      } catch (e) {
        if (e !== CANCELLED) throw e;
      }
    });
    return { id: job.id };
  });

  r.get('/api/improve/:job', (req) => {
    const p = improvePlans.get(req.params.job);
    if (!p) throw new HttpError(404, 'Δεν βρέθηκε η ανάλυση');
    const fromRef = p.fills.elo.filter((e) => e.source === 'ref').length;
    return {
      renames: p.renames,
      ambiguous: p.ambiguous,
      elo: { sides: p.fills.elo.length, games: new Set(p.fills.elo.map((e) => e.id)).size, fromRef, sample: p.fills.elo.slice(0, 40) },
      fide: {
        players: p.fills.fide.length,
        games: p.fills.fide.reduce((s, f) => s + f.games.length, 0),
        sample: p.fills.fide.slice(0, 40).map((f) => ({ player: f.player, fideId: f.fideId, source: f.source, games: f.games.length })),
      },
    };
  });

  /** Εφαρμογή: οι μετονομασίες που κράτησε ο χρήστης ({renames: [from…]}), μετά Elo / FIDE ID από την αρχή. */
  r.post('/api/improve/:job/apply', (req) => {
    const p = improvePlans.get(req.params.job);
    if (!p) throw new HttpError(404, 'Δεν βρέθηκε η ανάλυση');
    const accept = new Set<string>(Array.isArray(req.body?.renames) ? req.body.renames.map(String) : []);
    const ref = p.ref ? lib.handle(p.ref).db : null;
    const job = lib.runJob(p.dbId, 'Βελτίωση βάσης: εφαρμογή', async (gdb, j, progress) => {
      const tick = ticker(j, progress);
      try {
        const renames = p.renames.filter((x) => accept.has(x.from));
        for (let i = 0; i < renames.length; i++) {
          if (i % 200 === 0) await tick(i, renames.length, 'Μετονομασίες');
          gdb.renamePlayer(renames[i].from, renames[i].to);
        }
        // με τα ονόματα όπως έμειναν: μια ενοποίηση που απορρίφθηκε δεν δίνει Elo σε άλλον
        const fills = await computeFills(gdb, ref, new Map(), p.spelling, p.opts, tick);
        // σε κομμάτια: ο server μένει διαθέσιμος (η Greekbase έχει ~300.000 ετικέτες FIDE ID)
        for (let i = 0; i < fills.elo.length; i += 5000) {
          await tick(i, fills.elo.length, 'Εγγραφή Elo');
          gdb.setElos(fills.elo.slice(i, i + 5000));
        }
        const tags = fills.fide.flatMap((f) => f.games.map((g) => ({ id: g.id, tags: { [g.side === 'w' ? 'WhiteFideId' : 'BlackFideId']: f.fideId } })));
        for (let i = 0; i < tags.length; i += 5000) {
          await tick(i, tags.length, 'Εγγραφή FIDE ID');
          gdb.addTags(tags.slice(i, i + 5000));
        }
        progress(1, 1, `Μετονομασίες ${renames.length} · Elo ${fills.elo.length} · FIDE ID ${tags.length}`);
      } catch (e) {
        if (e !== CANCELLED) throw e;
      } finally {
        invalidateViews(p.dbId);
      }
    });
    improvePlans.delete(req.params.job);
    return { id: job.id };
  });

  /**
   * Αναφορά ρεπερτορίου: για κάθε τέλος γραμμής στη βάση ρεπερτορίου, οι παρτίδες
   * μιας βάσης αναφοράς που φτάνουν εκεί (πόσες και οι πιο πρόσφατες).
   */
  r.post('/api/repertoire/report', (req) => {
    const rep = lib.handle(String(req.body?.repertoire)).db;
    const ref = lib.handle(String(req.body?.reference));
    if (!ref.index) throw new HttpError(409, 'Η βάση αναφοράς δεν έχει ευρετήριο θέσεων');
    const minPly = Math.max(1, num(req.body?.minPly, 6));
    const perLine = Math.min(20, Math.max(1, num(req.body?.perLine, 5)));
    const leaves = new Map<string, { fen: string; line: string; ply: number; hi: number; lo: number; repGame: number }>();
    for (const g of rep.iterateMoves()) {
      const game = decodeGame(g.tokens, null, g.fen ?? START_FEN);
      const walk = (n: GameNode, path: string[]) => {
        if (!n.children.length) {
          if (n.ply >= minPly) {
            const p = Position.fromFen(n.fen);
            const key = p.hashKey();
            if (!leaves.has(key) && leaves.size < 1000) leaves.set(key, { fen: n.fen, line: path.join(' '), ply: n.ply, hi: p.hashHi, lo: p.hashLo, repGame: g.id });
          }
          return;
        }
        for (const c of n.children) {
          const label = c.whiteMoved(game.startTurn) ? `${c.moveNumber(game.startFullmove, game.startTurn)}.${c.san}` : path.length ? c.san : `${c.moveNumber(game.startFullmove, game.startTurn)}...${c.san}`;
          walk(c, [...path, label]);
        }
      };
      walk(game.root, []);
    }
    const out = [];
    for (const leaf of leaves.values()) {
      const { ids, total } = ref.index.gameIds(leaf.hi, leaf.lo, 50000);
      let recent: Array<{ id: number; white: string; black: string; welo: number; belo: number; date: number; result: number; event: string }> = [];
      if (ids.length) {
        const top = ref.db.db
          .prepare(`SELECT id FROM games WHERE id IN (${Array.from(ids.subarray(0, 50000)).join(',')}) ORDER BY date DESC LIMIT ${perLine}`)
          .all() as Array<{ id: number }>;
        recent = ref.db.rows(top.map((t) => t.id));
      }
      out.push({ line: leaf.line, fen: leaf.fen, ply: leaf.ply, games: total, beyondIndex: leaf.ply > ref.index.maxPly, recent });
    }
    out.sort((a, b) => b.games - a.games || a.line.localeCompare(b.line));
    return { lines: out, truncated: leaves.size >= 1000, indexMaxPly: ref.index.maxPly };
  });

  // -------------------------------------------------------------------------
  // Μηχανές

  r.get('/api/engines', () => {
    const known = new Set(lib.settings.engines.map((e) => path.resolve(e.path).toLowerCase()));
    return {
      engines: lib.settings.engines,
      defaultEngine: lib.settings.defaultEngine,
      discovered: discoverEngines().filter((p) => !known.has(path.resolve(p).toLowerCase())),
    };
  });

  r.post('/api/engines', async (req) => {
    const exe = String(req.body?.path ?? '');
    if (!fs.existsSync(exe)) throw new HttpError(400, 'Δεν βρέθηκε το εκτελέσιμο της μηχανής');
    return addEngine(lib, exe);
  });

  r.put('/api/engines/:eid', (req) => {
    const { makeDefault: _md, ...patch } = (req.body ?? {}) as Record<string, unknown>;
    void _md;
    const engines = lib.settings.engines.map((e) => (e.id === req.params.eid ? ({ ...e, ...patch, id: e.id } as EngineConfig) : e));
    lib.saveSettings({ engines, defaultEngine: req.body?.makeDefault ? req.params.eid : lib.settings.defaultEngine });
    return { engines };
  });

  r.del('/api/engines/:eid', (req) => {
    const engines = lib.settings.engines.filter((e) => e.id !== req.params.eid);
    lib.saveSettings({ engines, defaultEngine: lib.settings.defaultEngine === req.params.eid ? (engines[0]?.id ?? null) : lib.settings.defaultEngine });
    return { engines };
  });

  r.get('/api/engines/:eid/options', async (req) => {
    const cfg = lib.settings.engines.find((e) => e.id === req.params.eid);
    if (!cfg) throw new HttpError(404, 'Δεν βρέθηκε η μηχανή');
    return probeEngine(cfg.path);
  });

  r.post('/api/analysis/start', async (req) => {
    const engineId = String(req.body?.engineId ?? lib.settings.defaultEngine ?? '');
    return analysis.start(String(req.body?.session), engineId, String(req.body?.fen), num(req.body?.multipv, 3));
  });
  r.post('/api/analysis/stop', async (req) => {
    await analysis.stop(String(req.body?.session));
    return { ok: true };
  });
  r.post('/api/analysis/close', (req) => {
    analysis.close(String(req.body?.session));
    return { ok: true };
  });
  /**
   * Κίνηση της μηχανής (παιχνίδι εναντίον μηχανής ή bot): `skill` / `elo` (δύναμη), `movetime` ή `nodes` / `depth`
   * (όριο αναζήτησης), `multipv` (1–5: γραμμές για τα bots με προσωπικότητα, στο `lines`).
   */
  r.post('/api/engine/move', async (req) => {
    const engineId = String(req.body?.engineId ?? lib.settings.defaultEngine ?? '');
    const extra: Record<string, number | string> = {};
    if (req.body?.skill !== undefined) extra['Skill Level'] = Math.max(0, Math.min(20, num(req.body.skill, 20)));
    if (req.body?.elo) {
      extra['UCI_LimitStrength'] = 'true';
      extra['UCI_Elo'] = num(req.body.elo, 1500);
    }
    // `play`: επιλογές παιχνιδιού αντί για ανάλυσης (π.χ. η Leela με contempt)
    const play = Object.keys(extra).length > 0 || req.body?.play === true;
    const nodes = req.body?.nodes ? Math.max(100, Math.min(50_000_000, Math.round(num(req.body.nodes, 10_000)))) : 0;
    const depth = req.body?.depth ? Math.max(1, Math.min(60, Math.round(num(req.body.depth, 10)))) : 0;
    const limits = nodes ? { nodes } : depth ? { depth } : { movetime: Math.max(50, num(req.body?.movetime, 1000)) };
    const multipv = Math.max(1, Math.min(5, Math.round(num(req.body?.multipv, 1))));
    const u = await analysis.evaluate(engineId, String(req.body?.fen), limits, extra, play, multipv, validHistory(req.body?.startFen, req.body?.moves, String(req.body?.fen)));
    return { bestmove: u.bestmove, line: u.lines[0] ?? null, ...(multipv > 1 ? { lines: u.lines } : {}) };
  });
  /**
   * Κίνηση της μηχανής «με κίνητρο» («Παίξε τη θέση»): από τις ισάξιες κινήσεις αυτή που αφήνει στον αντίπαλο τις
   * περισσότερες ευκαιρίες για λάθος, χωρίς άσκοπες απλουστεύσεις (`pressure.ts`). `movetime`: όλος ο χρόνος σκέψης.
   */
  r.post('/api/engine/pressure', async (req) => {
    const engineId = String(req.body?.engineId ?? lib.settings.defaultEngine ?? '');
    const fen = String(req.body?.fen ?? '');
    try {
      Position.fromFen(fen);
    } catch {
      throw new HttpError(400, 'Άκυρη θέση (FEN)');
    }
    const movetime = Math.max(300, Math.min(10_000, num(req.body?.movetime, 2000)));
    return pressureMove(analysis, engineId, fen, validHistory(req.body?.startFen, req.body?.moves, fen), movetime);
  });

  r.post('/api/analysis/game', (req) => {
    const engineId = String(req.body?.engineId ?? lib.settings.defaultEngine ?? '');
    const fens: string[] = req.body?.fens ?? [];
    const job = analysis.analyzeGame(engineId, fens, Math.max(100, num(req.body?.movetime, 1000)));
    return { id: job.id, total: job.total };
  });
  r.get('/api/analysis/game/:job', (req) => {
    const j = analysis.jobs.get(req.params.job);
    if (!j) throw new HttpError(404, 'Δεν βρέθηκε η εργασία');
    return j;
  });
  r.post('/api/analysis/game/:job/cancel', (req) => {
    analysis.cancelJob(req.params.job);
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Online (Lichess): βιβλίο ανοιγμάτων, cloud αξιολόγηση, tablebases

  const onlineCache = new Map<string, unknown>();
  async function cachedFetch(url: string): Promise<unknown> {
    if (!lib.settings.onlineLookups) throw new HttpError(403, 'Οι online αναζητήσεις είναι απενεργοποιημένες στις ρυθμίσεις');
    const hit = onlineCache.get(url);
    if (hit) return hit;
    const res = await fetch(url, { headers: { 'User-Agent': `RuruChess/${VERSION} (local chess app)` }, signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(502, `Η υπηρεσία απάντησε ${res.status}`);
    const data = await res.json();
    onlineCache.set(url, data);
    if (onlineCache.size > 2000) onlineCache.delete(onlineCache.keys().next().value!);
    return data;
  }

  r.get('/api/online/cloud', (req) => cachedFetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(req.query.get('fen') ?? START_FEN)}&multiPv=${num(req.query.get('multiPv'), 3)}`));
  r.get('/api/online/tablebase', (req) => cachedFetch(`https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(req.query.get('fen') ?? '')}`));

  // -------------------------------------------------------------------------
  // Ρυθμίσεις, αρχεία, διάλογοι

  r.get('/api/settings', () => lib.settings);
  const SETTINGS_KEYS = ['language', 'boardTheme', 'pieceSet', 'showCoordinates', 'animationMs', 'onlineLookups', 'watchLive', 'myGames', 'defaultEngine', 'ui', 'bookPath'];
  const settingsPatch = (body: Record<string, unknown> | null | undefined) => {
    const patch: Record<string, unknown> = {};
    for (const k of SETTINGS_KEYS) if (body && k in body) patch[k] = body[k];
    return patch;
  };
  // «Εφαρμογή» χωρίς αποθήκευση: όλα τα παράθυρα δείχνουν προσωρινά τις αλλαγές του παραθύρου
  // ρυθμίσεων (`owner`). Γυρίζουν στις αποθηκευμένες με «Ακύρωση αλλαγών» ή μόλις κλείσει το παράθυρο
  // ρυθμίσεων (κλείνει η σύνδεσή του)· κρατιούνται μόνο με «Αποθήκευση».
  let preview: { owner: string; patch: Record<string, unknown> } | null = null;
  let revertTimer: ReturnType<typeof setTimeout> | null = null;
  const shown = () => {
    if (!preview) return lib.settings;
    const { ui, ...rest } = preview.patch as { ui?: Record<string, unknown> };
    return { ...lib.settings, ...rest, ui: { ...((lib.settings.ui as Record<string, unknown>) ?? {}), ...(ui ?? {}) }, preview: true };
  };
  // κάθε αποθήκευση φτάνει σε όλα τα παράθυρα (SSE «settings»), μαζί με την «Εφαρμογή» αν υπάρχει
  lib.onSettingsChange = () => r.broadcast('settings', shown());
  r.onClientClose = (win) => {
    if (!preview || preview.owner !== win) return;
    if (revertTimer) clearTimeout(revertTimer);
    // λίγη αναμονή: αν απλώς ξανασυνδεθεί (π.χ. F5), η «Εφαρμογή» μένει
    revertTimer = setTimeout(() => {
      revertTimer = null;
      if (preview?.owner !== win) return;
      preview = null;
      r.broadcast('settings', lib.settings);
    }, 1500);
  };
  r.onClientOpen = (win) => {
    if (revertTimer && preview?.owner === win) {
      clearTimeout(revertTimer);
      revertTimer = null;
    }
  };
  r.put('/api/settings', (req) => {
    preview = null;
    return lib.saveSettings(settingsPatch(req.body));
  });
  // ένα κλειδί του ui (π.χ. διάταξη σκακιέρας): συγχώνευση με τις αποθηκευμένες, όχι αντικατάσταση
  r.put('/api/settings/ui', (req) => lib.saveSettings({ ui: { ...((lib.settings.ui as Record<string, unknown>) ?? {}), ...((req.body ?? {}) as Record<string, unknown>) } }));
  r.post('/api/settings/preview', (req) => {
    preview = req.body?.settings ? { owner: String(req.body?.win ?? ''), patch: settingsPatch(req.body.settings as Record<string, unknown>) } : null;
    r.broadcast('settings', shown());
    return { ok: true };
  });

  // Βιβλίο ανοιγμάτων Polyglot
  r.get('/api/book', (req) => {
    const file = String(lib.settings.bookPath ?? '');
    if (!file || !fs.existsSync(file)) return { configured: false, moves: [] };
    return { configured: true, name: path.basename(file), moves: bookMoves(file, req.query.get('fen') ?? START_FEN) };
  });

  r.get('/api/openings.tsv', (req) => {
    req.res.writeHead(200, { 'Content-Type': 'text/tab-separated-values; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    req.res.end(fs.readFileSync(OPENINGS_TSV));
    return HANDLED;
  });

  r.get('/api/fs/quick', () => quickFolders());
  r.get('/api/fs/list', (req) => {
    const dir = req.query.get('dir') || '';
    if (!dir) {
      // δίσκοι
      const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((d) => `${d}:\\`).filter((d) => fs.existsSync(d));
      return { dir: '', parent: null, entries: drives.map((d) => ({ name: d, path: d, dir: true, size: 0 })) };
    }
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('$') && !e.name.startsWith('.'))
      .map((e) => {
        const p = path.join(dir, e.name);
        let size = 0;
        let isDir = e.isDirectory();
        try {
          const st = fs.statSync(p);
          size = st.size;
          isDir = st.isDirectory();
        } catch {
          // χωρίς πρόσβαση
        }
        return { name: e.name, path: p, dir: isDir, size };
      })
      .filter((e) => e.dir || /\.(pgn|cbh|cbv|cbz|si4|kbdb|skdb|7z|zip)$/i.test(e.name))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'el') : a.dir ? -1 : 1));
    const parent = path.dirname(dir) === dir ? '' : path.dirname(dir);
    return { dir, parent, entries };
  });

  r.post('/api/dialog/open', async (req) => ({ paths: await nativeDialog('open', String(req.body?.initialDir ?? ''), '') }));
  r.post('/api/dialog/save', async (req) => ({ paths: await nativeDialog('save', String(req.body?.initialDir ?? ''), String(req.body?.name ?? 'export.pgn')) }));
  r.post('/api/dialog/exe', async () => ({ paths: await nativeDialog('exe', '', '') }));
  r.post('/api/dialog/book', async () => ({ paths: await nativeDialog('book', '', '') }));
  r.post('/api/dialog/savebook', async (req) => ({ paths: await nativeDialog('savebook', '', String(req.body?.name ?? 'book.bin')) }));
  r.post('/api/dialog/savedb', async (req) => ({ paths: await nativeDialog('savedb', String(req.body?.initialDir ?? ''), String(req.body?.name ?? 'Νέα βάση.kbdb')) }));

  r.post('/api/open-folder', (req) => {
    const p = String(req.body?.path ?? '');
    if (p && fs.existsSync(p)) spawn('explorer.exe', [fs.statSync(p).isDirectory() ? p : `/select,${p}`], { detached: true, windowsHide: false });
    return { ok: true };
  });

  void RESULT_TEXT;
}

/** Διάλογος αρχείων των Windows (μέσω PowerShell). */
function nativeDialog(kind: 'open' | 'save' | 'savebook' | 'savedb' | 'exe' | 'book', initialDir: string, name: string): Promise<string[]> {
  const filter =
    kind === 'savedb'
      ? 'Βάση Ruru (*.kbdb)|*.kbdb'
      : kind === 'book' || kind === 'savebook'
      ? 'Βιβλία Polyglot (*.bin)|*.bin|Όλα τα αρχεία (*.*)|*.*'
      : kind === 'exe'
      ? 'Μηχανές UCI (*.exe)|*.exe|Όλα τα αρχεία (*.*)|*.*'
      : kind === 'save'
        ? 'PGN (*.pgn)|*.pgn'
        : 'Βάσεις σκακιού (*.pgn;*.cbh;*.cbv;*.si4;*.kbdb;*.7z;*.zip)|*.pgn;*.cbh;*.cbv;*.si4;*.kbdb;*.skdb;*.7z;*.zip|PGN (*.pgn)|*.pgn|ChessBase (*.cbh;*.cbv)|*.cbh;*.cbv|Scid (*.si4)|*.si4|Αρχειοθήκες (*.7z;*.zip)|*.7z;*.zip|Όλα τα αρχεία (*.*)|*.*';
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    '$owner.StartPosition = "CenterScreen"',
    '$owner.Size = New-Object System.Drawing.Size(1,1)',
    '$owner.Show()',
    '$owner.Activate()',
    kind === 'save' || kind === 'savebook' || kind === 'savedb' ? '$d = New-Object System.Windows.Forms.SaveFileDialog' : '$d = New-Object System.Windows.Forms.OpenFileDialog',
    `$d.Filter = ${psQuote(filter)}`,
    kind === 'open' ? '$d.Multiselect = $true' : '',
    initialDir ? `$d.InitialDirectory = ${psQuote(initialDir)}` : '',
    name ? `$d.FileName = ${psQuote(name)}` : '',
    '$r = $d.ShowDialog($owner)',
    '$owner.Close()',
    'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { if ($d.FileNames) { $d.FileNames -join "`n" } else { $d.FileName } }',
  ]
    .filter(Boolean)
    .join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    p.on('error', reject);
    p.on('close', () => resolve(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
  });
}
