import { describe, expect, it } from 'vitest';
import { LichessGameFeed, broadcastGameId, liveClocks, livePgn, mergeLive, parseClk, pathBetween, splitPgnStream } from '../src/core/live.ts';
import { parseGames } from '../src/core/pgn.ts';
import { Game } from '../src/core/game.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('LichessGameFeed', () => {
  it('φτιάχνει PGN με ρολόγια από το ndjson του Lichess', () => {
    const f = new LichessGameFeed({ Event: 'Rated blitz game', TimeControl: '180+0' });
    f.push({ id: 'TjW5mAC7', players: { white: { user: { name: 'novik70', title: 'GM' }, rating: 2574 }, black: { user: { name: 'flo50' }, rating: 2599 } } });
    expect(f.push({ fen: START, wc: 180, bc: 180 })).toBe(false);
    expect(f.push({ fen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1', lm: 'd2d4', wc: 180, bc: 180 })).toBe(true);
    expect(f.push({ fen: 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2', lm: 'd7d5', wc: 180, bc: 179 })).toBe(true);
    const g = parseGames(f.pgn())[0].game;
    expect(g.headers.White).toBe('novik70');
    expect(g.headers.WhiteTitle).toBe('GM');
    expect(g.mainline().map((n) => n.san)).toEqual(['d4', 'd5']);
    expect(g.mainline()[1].clock).toBe('0:02:59');
    expect(g.headers.Result).toBe('*');
    // τέλος: η περιγραφή ξανά με status/winner
    f.push({ id: 'TjW5mAC7', players: {}, status: { name: 'resign' }, winner: 'black' });
    expect(f.ended).toBe(true);
    expect(parseGames(f.pgn())[0].game.headers.Result).toBe('0-1');
  });

  it('ζητά resync όταν λείπει κίνηση', () => {
    const f = new LichessGameFeed();
    expect(f.push({ fen: 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2', lm: 'd7d5', wc: 1, bc: 1 })).toBe('resync');
    f.reset(START, ['e4', 'e5', 'Nf3'], [18000, 17900, 17500]);
    expect(f.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(f.moves[2].clock).toBe(175);
  });
});

describe('livePgn', () => {
  it('παρτίδα από θέση με τα μαύρα να παίζουν', () => {
    const fen = '8/8/8/8/8/5k2/8/4K2q b - - 3 40';
    const g = parseGames(livePgn({}, fen, [{ san: 'Qh2' }, { san: 'Kd1' }]))[0].game;
    expect(g.startFen).toBe(fen);
    expect(g.mainline().map((n) => n.san)).toEqual(['Qh2', 'Kd1']);
  });
});

describe('splitPgnStream', () => {
  const a = '[Event "A"]\n[GameURL "https://lichess.org/broadcast/x/r/VAvN8M7d/hzQ5TGAl"]\n[Result "*"]\n\n1. e4 { [%clk 1:00:00] } *';
  const b = '[Event "B"]\n[GameURL "https://lichess.org/broadcast/x/r/VAvN8M7d/0xFFBioe"]\n[Result "1-0"]\n\n1. d4 1-0';
  it('χωρίζει ολόκληρες παρτίδες και κρατά τη μισή', () => {
    let r = splitPgnStream(`${a}\n\n\n${b.slice(0, 40)}`);
    expect(r.games).toHaveLength(1);
    expect(broadcastGameId(r.games[0])).toBe('hzQ5TGAl');
    r = splitPgnStream(r.rest + b.slice(40) + '\n\n\n');
    expect(r.games).toHaveLength(1);
    expect(broadcastGameId(r.games[0])).toBe('0xFFBioe');
    expect(r.rest).toBe('');
  });
  it('κομμένη κεφαλίδα «[Result "*» δεν είναι ολόκληρη παρτίδα', () => {
    expect(splitPgnStream('[Event "A"]\n[Result "*').games).toHaveLength(0);
  });
});

describe('mergeLive', () => {
  it('νέες κινήσεις στην κύρια γραμμή, η βαριάντα του χρήστη μένει δευτερεύουσα', () => {
    const target = parseGames('1. e4 e5 2. Nf3 (2. Bc4) *')[0].game;
    // ο χρήστης έπαιξε 2... Nc6 στο τέλος της live γραμμής
    const user = target.addMove(target.mainline()[2], target.mainline()[2].position().parseSan('Nc6'));
    const src = parseGames('[TimeControl "180+0"]\n\n1. e4 { [%clk 0:02:59] } e5 2. Nf3 Nf6 { [%clk 0:02:50] } *')[0].game;
    const { changed, end } = mergeLive(target, src);
    expect(changed).toBe(true);
    expect(end.san).toBe('Nf6');
    expect(target.mainline().map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3', 'Nf6']);
    expect(target.mainline()[2].children[1]).toBe(user);
    expect(target.mainline()[1].parent!.children.length).toBe(1);
    expect(target.root.children[0].children[0].children.map((n) => n.san)).toEqual(['Nf3', 'Bc4']);
    expect(mergeLive(target, src).changed).toBe(false);
  });
});

describe('pathBetween', () => {
  it('δίνει τις κινήσεις ως το τέλος της live γραμμής, μόνο όταν η αρχή είναι πρόγονος', () => {
    const g = parseGames('1. e4 e5 2. Nf3 (2. Bc4 Nf6) 2... Nc6 3. Bb5 *')[0].game;
    const [e4, , nf3, nc6, bb5] = g.mainline();
    expect(pathBetween(e4, bb5)?.map((n) => n.san)).toEqual(['e5', 'Nf3', 'Nc6', 'Bb5']);
    expect(pathBetween(g.root, e4)?.map((n) => n.san)).toEqual(['e4']);
    expect(pathBetween(nc6, nc6)).toEqual([]);
    // πιο πίσω ή σε άλλη βαριάντα: όχι
    expect(pathBetween(bb5, nf3)).toBeNull();
    const bc4 = nf3.parent!.children[1];
    expect(pathBetween(bc4, bb5)).toBeNull();
    expect(pathBetween(nf3, bc4.children[0])).toBeNull();
  });
});

describe('ρολόγια', () => {
  it('το τελευταίο [%clk] κάθε πλευράς, αλλιώς ο αρχικός χρόνος', () => {
    const g = parseGames('[TimeControl "180+2"]\n\n1. e4 { [%clk 0:02:58] } e5 { [%clk 0:02:55] } 2. Nf3 *')[0].game;
    const end = g.mainline().at(-1)!;
    expect(liveClocks(end, g.headers)).toEqual({ w: 178000, b: 175000, turn: 'b' });
    const empty = new Game();
    expect(liveClocks(empty.root, { TimeControl: '5400+30' })).toEqual({ w: 5400000, b: 5400000, turn: 'w' });
    expect(parseClk('0:00:05.3')).toBe(5300);
    expect(parseClk('x')).toBeNull();
  });
});
