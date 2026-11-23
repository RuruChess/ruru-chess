import { describe, expect, it } from 'vitest';
import { applyMove, checkFlag, declineDraw, newRoom, offerDraw, requestRematch, resign, roomPgn, timeLeft, type RoomState } from '../src/core/online.ts';

const T0 = 1_000_000;
const room = (tc: RoomState['tc'] = { base: 60, inc: 2 }) => ({ ...newRoom({ id: 'abcdefgh', tc, hostColor: 'w', hostName: 'Ana' }, T0), guestJoined: true, names: { host: 'Ana', guest: 'Bob' } });

function play(s: RoomState, ucis: string[], t = T0): RoomState {
  for (const u of ucis) {
    const by = s.fen.split(' ')[1] as 'w' | 'b';
    const r = applyMove(s, by, u, s.moves.length, t);
    if (!r.ok) throw new Error(`${u}: ${r.error}`);
    s = r.state;
  }
  return s;
}

describe('online room', () => {
  it('accepts legal moves in turn and rejects others', () => {
    const s = room();
    expect(applyMove(s, 'b', 'e7e5', 0, T0)).toEqual({ ok: false, error: 'turn' });
    expect(applyMove(s, 'w', 'e2e5', 0, T0)).toEqual({ ok: false, error: 'illegal' });
    expect(applyMove(s, 'w', 'e2e4', 1, T0)).toEqual({ ok: false, error: 'stale' });
    const r = applyMove(s, 'w', 'e2e4', 0, T0);
    expect(r.ok && r.state.sans).toEqual(['e4']);
  });

  it('starts the clock after both first moves and adds the increment', () => {
    let s = play(room(), ['e2e4', 'e7e5'], T0);
    expect(s.clock!.running).toBe(true);
    expect(s.clock!.w).toBe(60_000);
    s = play(s, ['g1f3'], T0 + 5000);
    expect(s.clock!.w).toBe(60_000 - 5000 + 2000);
    expect(timeLeft(s.clock!, 'b', T0 + 6000)).toBe(60_000 - 1000);
  });

  it('flags only when the time is really up', () => {
    const s = play(room({ base: 60, inc: 0 }), ['e2e4', 'e7e5'], T0);
    expect(checkFlag(s, T0 + 59_000)).toBe(s);
    const f = checkFlag(s, T0 + 60_001);
    expect(f.result).toBe('0-1');
    expect(f.reason).toBe('flag');
  });

  it('detects checkmate', () => {
    const s = play(room(), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(s.result).toBe('0-1');
    expect(s.reason).toBe('checkmate');
  });

  it('detects threefold repetition', () => {
    const s = play(room(null), ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
    expect(s.result).toBe('1/2-1/2');
    expect(s.reason).toBe('repetition');
  });

  it('handles draw offers, resignation, abort and rematch', () => {
    let s = play(room(), ['e2e4', 'e7e5']);
    const o = offerDraw(s, 'w', T0);
    expect(o.ok && o.state.drawOffer).toBe('w');
    s = (o as { ok: true; state: RoomState }).state;
    expect(declineDraw(s, 'b').ok).toBe(true);
    const a = offerDraw(s, 'b', T0);
    expect(a.ok && a.state.result).toBe('1/2-1/2');
    const end = (a as { ok: true; state: RoomState }).state;
    const r1 = requestRematch(end, 'guest', T0);
    expect(r1.ok && r1.state.rematch.guest).toBe(true);
    const r2 = requestRematch((r1 as { ok: true; state: RoomState }).state, 'host', T0);
    expect(r2.ok && r2.state.hostColor).toBe('b');
    expect(r2.ok && r2.state.moves).toEqual([]);
    expect(r2.ok && r2.state.game).toBe(2);

    const early = resign(room(), 'w', T0);
    expect(early.ok && early.state.reason).toBe('abort');
    const late = resign(play(room(), ['e2e4', 'e7e5']), 'b', T0);
    expect(late.ok && late.state.result).toBe('1-0');
  });

  it('writes a PGN with names and clocks', () => {
    const s = play(room(), ['e2e4', 'e7e5', 'g1f3'], T0);
    const pgn = roomPgn(s, 'Game with a friend', new Date(2026, 10, 13));
    expect(pgn).toContain('[White "Ana"]');
    expect(pgn).toContain('[Black "Bob"]');
    expect(pgn).toContain('[TimeControl "60+2"]');
    expect(pgn).toContain('1. e4 {[%clk 0:01:00]} e5');
    expect(pgn).toContain('2. Nf3');
  });
});
