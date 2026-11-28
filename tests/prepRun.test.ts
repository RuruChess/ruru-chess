/**
 * Η «Προετοιμασία» από άκρη σε άκρη στον server: αληθινές προσωρινές βάσεις, ψεύτικο δίκτυο.
 * OTB από όλες τις βάσεις, κοινά φίλτρα, διπλές, διακοπή και «Ενημέρωση» χωρίς χαμένες παρτίδες.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeGame } from '../src/core/codec.ts';
import { parseGames } from '../src/core/pgn.ts';
import { PREP_DEFAULTS, inPeriod, periodStart, sameGame, shareLimit, siteGameKey, type PrepInfo, type PrepOpts, type PrepProgress } from '../src/core/prep.ts';

const dir = vi.hoisted(() => {
  // πριν από κάθε import: ο server γράφει το prep.json του εδώ, όχι στα Έγγραφα του χρήστη
  const base = process.env.TEMP ?? process.env.TMPDIR ?? '/tmp';
  return `${base}/knightbase-prep-${process.pid}-${Date.now()}`;
});
vi.mock('../src/server/paths.ts', async (original) => ({ ...(await original<object>()), APP_DIR: dir }));

const { GameDatabase } = await import('../src/server/db/store.ts');
const { registerPrep } = await import('../src/server/prep.ts');
const { gameSpeeds, mainMoves } = await import('../src/server/prepPlayers.ts');

type Db = InstanceType<typeof GameDatabase>;

const LINES = [
  '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7',
  '1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. f3 O-O',
  '1. c4 e5 2. Nc3 Nf6 3. g3 d5 4. cxd5 Nxd5 5. Bg2 Nb6',
  '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6',
  '1. Nf3 d5 2. g3 c6 3. Bg2 Bg4 4. O-O Nd7 5. d3 Ngf6',
  '1. e4 e6 2. d4 d5 3. Nc3 Bb4 4. e5 c5 5. a3 Bxc3+',
];
const pgnOf = (h: Record<string, string>, moves: string) =>
  `${Object.entries({ Event: 'Open', Result: '1-0', ...h })
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n')}\n\n${moves} ${h.Result ?? '1-0'}`;

function insert(db: Db, pgn: string): number {
  let n = 0;
  for (const { game } of parseGames(pgn)) {
    const enc = encodeGame(game);
    db.insertGame({ headers: game.headers, tokens: enc.tokens, comments: enc.comments, fen: null, flags: enc.flags, plies: mainMoves(enc.tokens).length });
    n++;
  }
  return n;
}

interface Entry {
  id: string;
  name: string;
  file: string;
  kind: 'user';
  created: number;
}

let entries: Entry[];
let dbs: Map<string, Db>;
let handled: string[];
let routes: Map<string, (req: any) => any>;
let events: PrepProgress[];
let urls: string[];
let site: (url: string, signal?: AbortSignal) => Response | Promise<Response>;
let serial = 0;
const opened: Db[] = [];

function makeDb(name: string): Entry {
  const id = `db${++serial}`;
  const file = path.join(dir, `${id}.kbdb`);
  const db = new GameDatabase(file, { create: true });
  opened.push(db);
  dbs.set(id, db);
  const e: Entry = { id, name, file, kind: 'user', created: 0 };
  entries.push(e);
  return e;
}
const add = (e: Entry, h: Record<string, string>, moves: string) => insert(dbs.get(e.id)!, pgnOf(h, moves));
const gamesOf = (p: PrepInfo) => {
  const db = dbs.get(p.dbId)!;
  return Array.from(db.search({ deleted: false }), (id) => db.getGame(id)!);
};
const saved = () => JSON.parse(fs.readFileSync(path.join(dir, 'prep.json'), 'utf8')) as Array<PrepInfo & { li?: number; cc?: number }>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 600 && !cond(); i++) await sleep(5);
  expect(cond()).toBe(true);
}

async function begin(body: Record<string, unknown>): Promise<PrepInfo> {
  events = [];
  const { prep } = await routes.get('POST /api/prep/start')!({ body });
  return prep;
}
async function finished(p: PrepInfo): Promise<PrepProgress> {
  await until(() => events.some((e) => e.id === p.id && e.phase !== 'running'));
  return events.find((e) => e.id === p.id && e.phase !== 'running')!;
}
async function prepare(body: Record<string, unknown>, opts: Partial<PrepOpts> = {}) {
  const prep = await begin({ ...body, opts: { ...PREP_DEFAULTS, ...opts } });
  const end = await finished(prep);
  return { prep, end };
}

const NOW = Date.now();
const DAY = 86400_000;
const liGame = (i: number, user = 'liuser') => ({
  createdAt: NOW - i * DAY,
  variant: 'standard',
  pgn: pgnOf({ Site: `https://lichess.org/game/game${String(i).padStart(4, '0')}`, White: user, Black: `rival${i}`, TimeControl: '180+2' }, LINES[i % LINES.length]),
});

beforeEach(() => {
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, 'prep.json'), { force: true });
  entries = [];
  dbs = new Map();
  handled = [];
  routes = new Map();
  events = [];
  urls = [];
  site = () => new Response('', { status: 404 });
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    return site(String(url), init?.signal ?? undefined);
  });
  const router = {
    get: (p: string, f: (req: any) => any) => routes.set(`GET ${p}`, f),
    post: (p: string, f: (req: any) => any) => routes.set(`POST ${p}`, f),
    broadcast: (type: string, data: PrepProgress) => {
      if (type === 'prep') events.push(structuredClone(data));
    },
  };
  const lib = {
    get entries() {
      return entries;
    },
    settings: { ui: {} },
    busy: () => undefined,
    handle: (id: string) => {
      handled.push(id);
      return { db: dbs.get(id) };
    },
    create: (name: string) => makeDb(name),
    rename: (id: string, name: string) => Object.assign(entries.find((e) => e.id === id)!, { name }),
    addPgn: (id: string, pgn: string) => insert(dbs.get(id)!, pgn),
  };
  registerPrep(router as any, lib as any);
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const db of opened) db.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

it('το τεστ γράφει σε προσωρινό φάκελο', () => {
  expect(path.resolve(dir).startsWith(path.resolve(process.env.TEMP ?? os.tmpdir()))).toBe(true);
});

describe('φίλτρα', () => {
  it('περίοδος: όλες, μήνες, «μετά από», μισές ημερομηνίες', () => {
    expect(periodStart({ months: 0 }).day).toBe(0);
    expect(periodStart({ months: 12 }, new Date(2026, 10, 22)).day).toBe(20251122);
    expect(periodStart({ months: 0, after: '2024-03-05' }).day).toBe(20240305);
    expect(inPeriod(0, 0)).toBe(true);
    expect(inPeriod(0, 20251122)).toBe(false);
    expect(inPeriod(20250000, 20251122)).toBe(true);
    expect(inPeriod(20251100, 20251122)).toBe(true);
    expect(inPeriod(20251121, 20251122)).toBe(false);
  });
  it('συνολικό όριο: μία πηγή το παίρνει όλο, πολλές το μοιράζονται', () => {
    expect(shareLimit([900], 250)).toEqual([250]);
    expect(shareLimit([53, 900], 250)).toEqual([53, 197]);
    expect(shareLimit([400, 400, 400], 250).reduce((a, b) => a + b)).toBe(250);
    expect(shareLimit([10, 20], 250)).toEqual([10, 20]);
  });
  it('ρυθμοί OTB σε λεπτά, online σε δευτερόλεπτα', () => {
    expect(gameSpeeds({ Event: 'Open', TimeControl: '90+30' })).toEqual(['classical']);
    expect(gameSpeeds({ Event: 'Open', TimeControl: '40/5400+30' })).toEqual(['classical']);
    expect(gameSpeeds({ Event: 'Open', TimeControl: '3+2' })).toEqual(['blitz']);
    expect(gameSpeeds({ Event: 'Bullet Cup' })).toEqual(['bullet']);
    expect(gameSpeeds({ Event: 'Rated game', Site: 'https://lichess.org/abcd1234', TimeControl: '60+0' })).toEqual(['bullet']);
  });
});

describe('διπλές', () => {
  const g = (opp: string, date: number, n: number, extra = {}) => ({ color: 'white' as const, opp, date, result: 2, moves: Array.from({ length: n }, (_, i) => i + 1), ...extra });
  it('άλλη γραφή ονόματος, λείπει η τελευταία κίνηση', () => {
    expect(sameGame(g('Gkoumas, Georgios', 20080822, 72), g('Goumas, Georgios', 20080822, 72))).toBe(true);
    expect(sameGame(g('Arnaudov, Petar G', 20221022, 115), g('Arnaudov, G. Petar', 20221022, 114))).toBe(true);
  });
  it('σύντομη ισοπαλία με ίδιες κινήσεις, άλλη μέρα ή αντίπαλος: άλλη παρτίδα', () => {
    expect(sameGame(g('So, Wesley', 20210626, 28), g('So, Wesley', 20210523, 28))).toBe(false);
    expect(sameGame(g('So, Wesley', 20210626, 28), g('Grischuk, Alexander', 20210626, 28))).toBe(false);
  });
  it('παρτίδες site: μόνο με το id τους', () => {
    expect(sameGame(g('x', 20260101, 90, { key: 'li:aaaaaaaa' }), g('x', 20260101, 90, { key: 'li:bbbbbbbb' }))).toBe(false);
    expect(siteGameKey({ Site: 'https://lichess.org/abcd1234' })).toBe('li:abcd1234');
    expect(siteGameKey({ Site: 'https://lichess.org/game/abcd1234' })).toBe('li:abcd1234');
    expect(siteGameKey({ Site: 'https://lichess.org/broadcast/x/y' })).toBe(null);
    expect(siteGameKey({ Link: 'https://www.chess.com/game/live/12345' })).toBe('cc:live:12345');
  });
});

describe('FIDE / OTB', () => {
  const ME = 'Batsis, Lazaros';
  const ID = '25000001';

  it('όλες οι βάσεις μαζί, χωρίς διπλές, συνονόματους και bullet, χωρίς να αγγίζει το «τελευταίο άνοιγμα»', async () => {
    const a = makeDb('Αναφορά');
    const b = makeDb('Greekbase');
    const mine = { White: ME, WhiteFideId: ID };
    add(a, { ...mine, Black: 'Papas, A', Date: '2020.01.05' }, LINES[0]);
    add(b, { ...mine, Black: 'Papas, A', Date: '2020.01.05' }, `{σχόλιο} ${LINES[0]}`); // η ίδια με σχόλιο
    add(b, { ...mine, Black: 'Other, B', Date: '2023.04.01', TimeControl: '90+30' }, LINES[1]);
    add(b, { White: 'Third, C', Black: 'Batsis Lazaros', BlackFideId: ID, Date: '2019.02.02' }, LINES[2]);
    add(b, { White: ME, WhiteFideId: '999999', Black: 'Namesake, X', Date: '2020.02.02' }, LINES[3]);
    for (let i = 0; i < 10; i++) add(a, { ...mine, Black: `Player${i}, P`, Date: `2018.03.${String(i + 10)}` }, LINES[4]);
    add(b, { ...mine, Black: 'Fast, F', Date: '2022.01.01', Event: 'Bullet Cup' }, LINES[5]);

    const { prep, end } = await prepare({ otb: { name: ME, fideId: Number(ID) } });
    const got = gamesOf(prep);
    expect(end.phase).toBe('done');
    expect(got).toHaveLength(13);
    expect(got[0].row.date).toBe(20230401); // από τη νεότερη
    expect(got.every((g) => g.row.white === ME || g.row.black === ME)).toBe(true);
    expect(got.some((g) => g.row.black === 'Namesake, X')).toBe(false);
    expect(handled).not.toContain(a.id);
    expect(handled).not.toContain(b.id);
  });

  it('χρώμα, περίοδος και συνολικό όριο ισχύουν και για OTB', async () => {
    const a = makeDb('A');
    for (let i = 0; i < 6; i++) add(a, { White: ME, Black: `W${i}, P`, Date: `202${i}.05.05` }, LINES[i]);
    add(a, { White: 'B, P', Black: ME, Date: '2025.06.06' }, LINES[0]);

    expect(gamesOf((await prepare({ otb: { name: ME } }, { color: 'black' })).prep)).toHaveLength(1);
    expect(gamesOf((await prepare({ otb: { name: ME } }, { after: '2024-01-01' })).prep)).toHaveLength(3);
    const capped = gamesOf((await prepare({ otb: { name: ME } }, { max: 2 })).prep);
    expect(capped.map((g) => g.row.date)).toEqual([20250606, 20250505]);
  });

  it('«Ενημέρωση»: η καινούργια μπαίνει, όσες κόπηκαν από το όριο όχι', async () => {
    const a = makeDb('A');
    for (let i = 0; i < 4; i++) add(a, { White: ME, Black: `W${i}, P`, Date: `202${i}.05.05` }, LINES[i]);
    const { prep } = await prepare({ otb: { name: ME } }, { max: 2 });
    add(makeDb('Νέα'), { White: ME, Black: 'New, N', Date: '2026.11.01' }, LINES[5]);
    await finished(await begin({ id: prep.id }));
    expect(gamesOf(prep).map((g) => g.row.date).sort()).toEqual([20220505, 20230505, 20261101]);
  });

  it('αρχικό μόνο όταν δεν είναι διφορούμενο', async () => {
    const a = makeDb('A');
    add(a, { White: ME, Black: 'P, Q', Date: '2020.01.01' }, LINES[0]);
    add(a, { White: 'Batsis, L', Black: 'R, S', Date: '2021.01.01' }, LINES[1]);
    const player = () => routes.get('POST /api/prep/player')!({ body: { name: ME } });
    expect((await player()).games).toBe(2);
    add(a, { White: 'Batsis, Leonidas', Black: 'T, U', Date: '2022.01.01' }, LINES[2]);
    const r = await player();
    expect(r.games).toBe(1);
    expect(r.maybe.map((m: { name: string }) => m.name)).toContain('Batsis, L');
  });

  it('αναζήτηση: με οποιαδήποτε σειρά, πέρα από τα 60 πρώτα αλφαβητικά, χωρίς δίκτυο', async () => {
    const a = makeDb('A');
    for (let i = 10; i < 80; i++) add(a, { White: `Garcia, A${i}`, Black: 'X, Y', Date: '2020.01.01' }, LINES[0]);
    for (let i = 0; i < 3; i++) add(a, { White: 'Garcia, Zenon', Black: `Z${i}, Q`, Date: '2021.01.01' }, LINES[i]);
    const find = (q: string) => routes.get('GET /api/prep/players')!({ query: new URLSearchParams({ q }) });
    expect((await find('garcia'))[0].name).toBe('Garcia, Zenon');
    expect((await find('zenon garcia'))[0].name).toBe('Garcia, Zenon');
    expect(urls).toEqual([]);
  });

  it('FIDE ID → ο παίκτης από το Lichess', async () => {
    site = (u) => (u.endsWith('/api/fide/player/25000001') ? Response.json({ id: 25000001, name: ME, federation: 'GRE' }) : new Response('', { status: 404 }));
    const r = await routes.get('GET /api/prep/players')!({ query: new URLSearchParams({ q: ID }) });
    expect(r[0]).toMatchObject({ name: ME, fideId: 25000001 });
  });

  it('παλιά προετοιμασία: στις βάσεις και στα ονόματά της, χωρίς φίλτρα', async () => {
    const a = makeDb('A');
    const other = makeDb('B');
    const target = makeDb('Αντίπαλος - Batsis');
    add(a, { White: 'Batsis, L', Black: 'P, Q', Date: '2001.01.01' }, LINES[0]);
    add(other, { White: 'Batsis, L', Black: 'R, S', Date: '2002.01.01' }, LINES[1]);
    const opts = { speeds: ['bullet'], months: 12, max: 2000, rated: true };
    fs.writeFileSync(
      path.join(dir, 'prep.json'),
      JSON.stringify([{ id: 'old', name: 'Batsis', dbId: target.id, locals: [{ dbId: a.id, players: ['Batsis, L'] }], opts, counts: { lichess: 0, chesscom: 0, local: 0 }, at: 1 }]),
    );
    const prep = await begin({ id: 'old' });
    await finished(prep);
    expect(gamesOf(prep).map((g) => g.row.date)).toEqual([20010101]);
  });
});

describe('Lichess και Chess.com', () => {
  it('Lichess: φίλτρα στο αίτημα, όριο συνολικό', async () => {
    site = () => new Response(Array.from({ length: 8 }, (_, i) => JSON.stringify(liGame(i))).join('\n'));
    const { prep } = await prepare({ lichess: 'liuser' }, { max: 5, color: 'white' });
    const q = new URL(urls[0]).searchParams;
    expect([q.get('max'), q.get('color'), q.get('rated'), q.get('perfType')]).toEqual(['5', 'white', 'true', 'classical,rapid,blitz']);
    expect(q.get('since')).toBe(null);
    expect(gamesOf(prep)).toHaveLength(5);
  });

  it('τρεις πηγές παράλληλα, το όριο μοιράζεται', async () => {
    const a = makeDb('A');
    add(a, { White: 'Test, T', Black: 'Old, O', Date: '1999.01.01' }, LINES[0]);
    let ccAskedBeforeLichessEnded = false;
    let lichessEnded = false;
    site = async (u) => {
      if (u.includes('lichess.org/api/games')) {
        await sleep(80);
        lichessEnded = true;
        return new Response(Array.from({ length: 8 }, (_, i) => JSON.stringify(liGame(i))).join('\n'));
      }
      if (u.endsWith('/games/archives')) {
        ccAskedBeforeLichessEnded = !lichessEnded;
        return Response.json({ archives: [] });
      }
      return new Response('', { status: 404 });
    };
    const { prep, end } = await prepare({ otb: { name: 'Test, T' }, lichess: 'liuser', chesscom: 'ccuser' }, { max: 4 });
    expect(ccAskedBeforeLichessEnded).toBe(true);
    expect(Object.keys(end.sources)).toEqual(['otb', 'lichess', 'chesscom']);
    const dates = gamesOf(prep).map((g) => g.row.date);
    expect(dates).toHaveLength(4);
    expect(dates).toContain(19990101); // η παλιά OTB δεν χάνεται κάτω από τις online
  });

  it('Lichess: η διακοπή κρατά ό,τι ήρθε και η «Ενημέρωση» συμπληρώνει χωρίς διπλές', async () => {
    const enc = new TextEncoder();
    site = (_u, signal) =>
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < 3; i++) c.enqueue(enc.encode(`${JSON.stringify(liGame(i))}\n`));
            signal?.addEventListener('abort', () => c.error(new Error('aborted')));
          },
        }),
      );
    const prep = await begin({ lichess: 'liuser', opts: { ...PREP_DEFAULTS, max: 5 } });
    await until(() => events.some((e) => e.sources.lichess?.found === 3));
    routes.get('POST /api/prep/:id/cancel')!({ params: { id: prep.id } });
    expect((await finished(prep)).phase).toBe('cancelled');
    expect(gamesOf(prep)).toHaveLength(3);
    expect(saved()[0].li).toBeUndefined();

    site = () => new Response(Array.from({ length: 8 }, (_, i) => JSON.stringify(liGame(i))).join('\n'));
    await finished(await begin({ id: prep.id }));
    expect(gamesOf(prep)).toHaveLength(5);
  });

  it('Chess.com: διακοπή στη μέση δεν αφήνει τρύπα στους παλιούς μήνες', async () => {
    const months = [
      { key: '2026/08', day: Date.UTC(2026, 7, 10) },
      { key: '2026/09', day: Date.UTC(2026, 8, 10) },
      { key: '2026/10', day: Date.UTC(2026, 9, 10) },
    ];
    let block = true;
    site = (u) => {
      if (u.endsWith('/games/archives')) return Response.json({ archives: months.map((m) => `https://api.chess.com/pub/player/ccuser/games/${m.key}`) });
      const i = months.findIndex((m) => u.endsWith(m.key));
      const games = [0, 1].map((k) => ({
        end_time: (months[i].day + k * DAY) / 1000,
        rules: 'chess',
        rated: true,
        time_class: 'blitz',
        white: { username: 'ccuser' },
        pgn: pgnOf({ Link: `https://www.chess.com/game/live/${i}${k}`, White: 'ccuser', Black: `r${i}${k}` }, LINES[i]),
      }));
      const body = Response.json({ games });
      return block && i === 1 ? sleep(150).then(() => body) : body;
    };
    const prep = await begin({ chesscom: 'ccuser', opts: PREP_DEFAULTS });
    await until(() => events.some((e) => e.sources.chesscom?.month === '2026/09') || urls.some((u) => u.endsWith('2026/09')));
    routes.get('POST /api/prep/:id/cancel')!({ params: { id: prep.id } });
    await finished(prep);
    expect(gamesOf(prep)).toHaveLength(2);
    block = false;
    await finished(await begin({ id: prep.id }));
    expect(gamesOf(prep)).toHaveLength(6);
  });

  it('αναφορά: Lichess ως Lichess, OTB με τόπο «chess.com INT» ως OTB', async () => {
    const a = makeDb('A');
    add(a, { White: 'Test, T', Black: 'Old, O', Date: '2024.01.01', Site: 'chess.com INT', TimeControl: '90+30' }, LINES[0]);
    site = (u) => (u.includes('/api/games/') ? new Response(JSON.stringify(liGame(1))) : new Response('', { status: 404 }));
    const { prep } = await prepare({ otb: { name: 'Test, T' }, lichess: 'liuser' });
    const r = routes.get('GET /api/prep/:id/report')!({ params: { id: prep.id } });
    expect(r.sources).toEqual({ otb: 1, lichess: 1 });
    expect(r.speeds.map((x: { speed: string }) => x.speed).sort()).toEqual(['blitz', 'classical']);
  });

  it('άγνωστος χρήστης: σφάλμα της πηγής, και η διόρθωση ξαναχρησιμοποιεί την άδεια βάση', async () => {
    const { prep, end } = await prepare({ lichess: 'nosuchuser' });
    expect(end.sources.lichess).toMatchObject({ state: 'error', error: 'notfound' });
    expect(saved()[0].error).toBe('lichess:notfound');
    site = () => new Response(JSON.stringify(liGame(1)));
    const fixed = await prepare({ lichess: 'liuser', replace: prep.id });
    expect(fixed.prep.dbId).toBe(prep.dbId);
    expect(gamesOf(fixed.prep)).toHaveLength(1);
  });
});

describe('ίδιος αντίπαλος ξανά', () => {
  const ME = 'Doe, John';

  it('ίδια φίλτρα: ενημέρωση της ίδιας προετοιμασίας, όχι δεύτερη', async () => {
    add(makeDb('A'), { White: ME, Black: 'P, Q', Date: '2020.01.01' }, LINES[0]);
    const first = await prepare({ otb: { name: ME } });
    const again = await prepare({ otb: { name: 'doe, john' } });
    expect(again.prep.id).toBe(first.prep.id);
    expect(saved()).toHaveLength(1);
    expect(gamesOf(again.prep)).toHaveLength(1);
  });

  it('χωρίς παρτίδες και άλλα φίλτρα: η ίδια βάση· με παρτίδες και άλλα φίλτρα: νέα προετοιμασία', async () => {
    const empty = await prepare({ lichess: 'nobody' });
    const retry = await prepare({ lichess: 'Nobody' }, { color: 'white' });
    expect(retry.prep.dbId).toBe(empty.prep.dbId);
    expect(saved()).toHaveLength(1);

    add(makeDb('A'), { White: ME, Black: 'P, Q', Date: '2020.01.01' }, LINES[0]);
    const full = await prepare({ otb: { name: ME } });
    const other = await prepare({ otb: { name: ME } }, { color: 'white' });
    expect(other.prep.id).not.toBe(full.prep.id);
  });

  it('αφαίρεση: η άδεια βάση δίνεται για σβήσιμο, η βάση με παρτίδες όχι', async () => {
    const empty = await prepare({ lichess: 'nobody' });
    add(makeDb('A'), { White: ME, Black: 'P, Q', Date: '2020.01.01' }, LINES[0]);
    const full = await prepare({ otb: { name: ME } });
    const forget = (id: string) => routes.get('POST /api/prep/:id/forget')!({ params: { id } });
    expect((await forget(empty.prep.id)).emptyDb).toBe(empty.prep.dbId);
    expect((await forget(full.prep.id)).emptyDb).toBe(null);
    expect(saved()).toHaveLength(0);
  });
});
