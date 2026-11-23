import { describe, expect, it } from 'vitest';
import { parseGame, parseGames, writeGame, findGameStarts, parseComment } from '../src/core/pgn.ts';
import { encodeGame, decodeGame, encodeMovetext, createIndexSink, replayMainline, GF_VARIATIONS, GF_COMMENTS } from '../src/core/codec.ts';
import { Position, START_FEN } from '../src/core/chess.ts';

const SAMPLE = `[Event "Test, \\"quoted\\""]
[Site "Θεσσαλονίκη"]
[Date "2024.05.01"]
[Round "1"]
[White "Παπαδόπουλος, Γιώργος"]
[Black "Smith, John"]
[Result "1-0"]
[WhiteElo "2100"]

{Σχόλιο παρτίδας} 1. e4 e5 2. Nf3 {[%csl Rd4][%cal Gf3e5] ο ίππος} Nc6 (2... d6 {Philidor} 3. d4 (3. Bc4 Be7) 3... exd4 $6) (2... Nf6 3. Nxe5) 3. Bb5 a6!? 4. Ba4 $1 Nf6 5. O-O {[%clk 0:59:30]} Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 1-0`;

describe('PGN', () => {
  it('διαβάζει κεφαλίδες, βαριάντες, σχόλια, σύμβολα και γραφικά', () => {
    const { game, error } = parseGame(SAMPLE);
    expect(error).toBeNull();
    expect(game.headers.Event).toBe('Test, "quoted"');
    expect(game.headers.White).toBe('Παπαδόπουλος, Γιώργος');
    expect(game.root.comment).toBe('Σχόλιο παρτίδας');
    const main = game.mainline();
    expect(main.length).toBe(17);
    expect(main[2].san).toBe('Nf3');
    expect(main[2].comment).toBe('ο ίππος');
    expect(main[2].shapes).toEqual([
      { color: 'R', from: 0x33, to: 0x33 },
      { color: 'G', from: 0x25, to: 0x44 },
    ]);
    // βαριάντες μετά το 2.Nf3
    expect(main[2].children.map((c) => c.san)).toEqual(['Nc6', 'd6', 'Nf6']);
    const d6 = main[2].children[1];
    expect(d6.comment).toBe('Philidor');
    expect(d6.children[0].children.map((c) => c.san)).toEqual(['exd4', 'Be7'].slice(0, 1).concat([]));
    expect(d6.children.map((c) => c.san)).toEqual(['d4', 'Bc4']);
    expect(d6.children[0].children[0].nags).toEqual([6]);
    expect(main[5].nags).toEqual([5]);
    expect(main[6].nags).toEqual([1]);
    expect(main[8].clock).toBe('0:59:30');
  });

  it('στρογγυλό ταξίδι PGN → δέντρο → PGN', () => {
    const { game } = parseGame(SAMPLE);
    const out = writeGame(game);
    const again = parseGame(out).game;
    expect(writeGame(again)).toBe(out);
    expect(out.split('\n').every((l) => l.length <= 80)).toBe(true);
    const flat = writeGame(game, { maxLine: 0 });
    expect(flat).toContain('(2... d6 {Philidor} 3. d4 (3. Bc4 Be7) 3... exd4 $6)');
    expect(flat).toContain('{[%csl Rd4] [%cal Gf3e5] ο ίππος}');
  });

  it('χωρίζει πολλές παρτίδες και αντέχει σχόλια με αγκύλες', () => {
    const text = SAMPLE + '\n\n[Event "B"]\n[Result "*"]\n\n1. d4 {σχόλιο\n[%clk 0:01:00] συνέχεια} d5 *\n\n[Event "C"]\n\n1. c4 *\n';
    expect(findGameStarts(text).length).toBe(3);
    const games = parseGames(text);
    expect(games.map((g) => g.game.headers.Event)).toEqual(['Test, "quoted"', 'B', 'C']);
    expect(games[1].game.mainline()[0].clock).toBe('0:01:00');
  });

  it('σταματά σε άκυρη κίνηση με μήνυμα', () => {
    const r = parseGame('[Event "x"]\n\n1. e4 e5 2. Ke3 Nc6 *');
    expect(r.error).toContain('Ke3');
    expect(r.game.mainline().length).toBe(2);
  });

  it('θέση FEN και κολλητοί αριθμοί κινήσεων', () => {
    const r = parseGame('[FEN "8/8/8/8/8/5k2/8/4K2R w K - 0 40"]\n[SetUp "1"]\n\n40.O-O Kg4 41.Kh2 *');
    expect(r.error).toBeNull();
    // ο πύργος στο f1 κάνει σαχ στον βασιλιά του f3
    expect(r.game.mainline().map((n) => n.san)).toEqual(['O-O+', 'Kg4', 'Kh2']);
    expect(writeGame(r.game)).toContain('40. O-O+ Kg4 41. Kh2 *');
  });

  it('ετικέτα με μη λατινικό όνομα: κρατιέται, και οι επόμενες ετικέτες και οι κινήσεις διαβάζονται', () => {
    const pgn = '[Event "E"]\n[Σχόλιο "x y"]\n[Ελο_2 "5"]\n[White "Λευκός"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
    const { game, error } = parseGame(pgn);
    expect(error).toBeNull();
    expect(game.headers['Σχόλιο']).toBe('x y');
    expect(game.headers['Ελο_2']).toBe('5');
    expect(game.headers.White).toBe('Λευκός');
    expect(game.headers.Result).toBe('1-0');
    expect(game.mainline().map((n) => n.san)).toEqual(['e4', 'e5']);
    expect(writeGame(game)).toContain('[Σχόλιο "x y"]');
  });

  it('εντολές σχολίων', () => {
    const c = parseComment('κείμενο [%eval 0.35] [%emt 0:00:05] τέλος');
    expect(c.text).toBe('κείμενο τέλος');
    expect(c.evalText).toBe('0.35');
    expect(c.emt).toBe('0:00:05');
  });
});

describe('codec', () => {
  it('δέντρο → tokens → δέντρο', () => {
    const { game } = parseGame(SAMPLE);
    const enc = encodeGame(game);
    expect(enc.flags & GF_VARIATIONS).toBeTruthy();
    expect(enc.flags & GF_COMMENTS).toBeTruthy();
    const back = decodeGame(enc.tokens, enc.comments, START_FEN);
    back.headers = game.headers;
    expect(writeGame(back)).toBe(writeGame(game));
  });

  it('γρήγορη κωδικοποίηση από PGN = κωδικοποίηση δέντρου', () => {
    const { game } = parseGame(SAMPLE);
    const body = SAMPLE.indexOf('{Σχόλιο');
    const pos = new Position();
    const sink = createIndexSink(40);
    const fast = encodeMovetext(SAMPLE, body, SAMPLE.length, null, pos, sink);
    expect(fast.error).toBeNull();
    expect(fast.plies).toBe(17);
    expect(fast.result).toBe('1-0');
    const decoded = decodeGame(fast.tokens, fast.comments, START_FEN);
    decoded.headers = game.headers;
    expect(writeGame(decoded)).toBe(writeGame(game));
    // ευρετήριο: θέσεις πριν από κάθε κίνηση + τελική
    expect(sink.count).toBe(18);
    const p = Position.start();
    expect([sink.hashHi[0], sink.hashLo[0]]).toEqual([p.hashHi, p.hashLo]);
    // αναπαραγωγή κύριας γραμμής
    const seen: number[] = [];
    replayMainline(fast.tokens, new Position(), null, (_pos, ply) => {
      seen.push(ply);
    });
    expect(seen.length).toBe(18);
  });

  it('παραλείπει άκυρη βαριάντα χωρίς να χαλάσει την κύρια γραμμή', () => {
    const text = '1. e4 (1. Ke2 Ke7) (1. d4 Kxx 2. c4) e5 2. Nf3 *';
    const r = encodeMovetext(text, 0, text.length, null, new Position(), null);
    expect(r.error).toBeNull();
    const g = decodeGame(r.tokens, r.comments);
    expect(g.mainline().map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(g.root.children.map((n) => n.san)).toEqual(['e4', 'd4']);
  });
});
