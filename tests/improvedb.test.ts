import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GameDatabase } from '../src/server/db/store.ts';
import { parseGame } from '../src/core/pgn.ts';
import { encodeGame } from '../src/core/codec.ts';
import { computeFills, planRenames } from '../src/server/improve.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knightbase-improve-'));
const target = new GameDatabase(path.join(dir, 'target.skdb'), { create: true });
const ref = new GameDatabase(path.join(dir, 'ref.skdb'), { create: true });
afterAll(() => {
  target.close();
  ref.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function add(db: GameDatabase, h: Record<string, string>) {
  const tags = Object.entries(h)
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n');
  const { game } = parseGame(`${tags}\n\n1. e4 e5 *`);
  const enc = encodeGame(game);
  db.insertGame({ headers: game.headers, tokens: enc.tokens, comments: null, fen: null, flags: enc.flags, plies: 2 });
}

add(target, { White: 'Banikas, Hristos', Black: 'Papadopoulos, G', WhiteElo: '2600', Date: '2020.01.10' });
add(target, { White: 'Banikas, H', Black: 'Smith, John', BlackElo: '2300', Date: '2020.03.01' });
add(ref, { White: 'Papadopoulos, Georgios', Black: 'Banikas, Hristos', WhiteElo: '2200', BlackElo: '2610', Date: '2020.02.01', WhiteFideId: '4201234', BlackFideId: '4200098' });

const tick = async () => {};
const opts = { names: true, elo: true, fide: true };

describe('βελτίωση βάσης', () => {
  it('ανάλυση: ενοποίηση στη βάση και γραφή της αναφοράς', async () => {
    const plan = await planRenames(target, ref, true, tick);
    expect(plan.renames).toEqual([
      { from: 'Banikas, H', to: 'Banikas, Hristos', games: 1, source: 'db', kind: 'complete' },
      { from: 'Papadopoulos, G', to: 'Papadopoulos, Georgios', games: 1, source: 'ref', kind: 'complete' },
    ]);
    const fills = await computeFills(target, ref, new Map(plan.renames.map((r) => [r.from, r.to])), plan.refByFinal, opts, tick);
    expect(fills.elo.map((e) => [e.player, e.side, e.elo, e.source])).toEqual([
      ['Papadopoulos, Georgios', 'b', 2200, 'ref'],
      ['Banikas, Hristos', 'w', 2600, 'db'],
    ]);
    expect(fills.fide.map((f) => [f.player, f.fideId, f.games.length])).toEqual([
      ['Banikas, Hristos', '4200098', 2],
      ['Papadopoulos, Georgios', '4201234', 1],
    ]);
  });

  it('εφαρμογή: μόνο όσα κράτησε ο χρήστης', async () => {
    // ο χρήστης κρατά μόνο την ενοποίηση «Banikas, H»
    expect(target.renamePlayer('Banikas, H', 'Banikas, Hristos')).toBe(1);
    expect(target.playerIdByName('Banikas, H')).toBeNull();
    const fills = await computeFills(target, ref, new Map(), new Map(), opts, tick);
    // ο «Papadopoulos, G» δεν αντιστοιχίστηκε: ούτε Elo ούτε FIDE ID από την αναφορά
    expect(fills.elo.map((e) => e.player)).toEqual(['Banikas, Hristos']);
    expect(fills.fide.map((f) => f.player)).toEqual(['Banikas, Hristos']);
    target.setElos(fills.elo);
    target.addTags(fills.fide.flatMap((f) => f.games.map((g) => ({ id: g.id, tags: { [g.side === 'w' ? 'WhiteFideId' : 'BlackFideId']: f.fideId } }))));
    const g2 = target.getGame(2)!;
    expect(g2.headers.White).toBe('Banikas, Hristos');
    expect(g2.headers.WhiteElo).toBe('2600');
    expect(g2.headers.WhiteFideId).toBe('4200098');
    expect(target.getGame(1)!.headers.BlackElo ?? '').toBe('');
    expect(target.stats().avgElo).toBeGreaterThan(0);
  });
});
