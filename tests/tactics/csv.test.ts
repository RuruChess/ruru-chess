/** Τεστ: ανάγνωση του CSV των puzzles του Lichess (κεφαλίδα, ακραίες περιπτώσεις, URL, φίλτρο ποιότητας). */
import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS, parseGameUrl, parseHeader, parseLichessLine, passesQuality, qualityFrom, splitCsv } from '../../src/server/tactics/csv.ts';

const HEADER = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate';
const ROW = '00008,r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24,f2g3 e6e7 b2b1 b3c1 b1c1 h6c1,1811,76,95,10282,crushing hangingPiece long middlegame,https://lichess.org/787zsVup/black#48,,';

describe('κεφαλίδα', () => {
  it('βρίσκει τις 11 στήλες', () => {
    expect(parseHeader(HEADER)).toEqual(DEFAULT_COLUMNS);
  });
  it('δέχεται BOM, CRLF και άλλη σειρά στηλών', () => {
    const m = parseHeader('﻿FEN,PuzzleId,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags\r');
    expect(m.FEN).toBe(0);
    expect(m.PuzzleId).toBe(1);
    expect(m.DailyDate).toBe(-1);
  });
  it('πετά σφάλμα όταν λείπει υποχρεωτική στήλη', () => {
    expect(() => parseHeader('PuzzleId,FEN,Moves')).toThrow(/Rating/);
  });
});

describe('γραμμές', () => {
  it('διαβάζει κανονική γραμμή', () => {
    const { row } = parseLichessLine(ROW);
    expect(row).not.toBeNull();
    expect(row!.id).toBe('00008');
    expect(row!.moves).toEqual(['f2g3', 'e6e7', 'b2b1', 'b3c1', 'b1c1', 'h6c1']);
    expect(row!.rating).toBe(1811);
    expect(row!.rd).toBe(76);
    expect(row!.popularity).toBe(95);
    expect(row!.plays).toBe(10282);
    expect(row!.themes).toEqual(['crushing', 'hangingPiece', 'long', 'middlegame']);
    expect(row!.openingTags).toBe('');
    expect(row!.dailyDate).toBe(0);
  });
  it('CRLF, ετικέτες ανοίγματος και DailyDate', () => {
    const line = '000aY,r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4,h5f7,800,80,96,500,mate mateIn1 oneMove opening,https://lichess.org/abcdefgh#7,Italian_Game Italian_Game_Two_Knights_Defense,1609459200000\r';
    const { row } = parseLichessLine(line);
    expect(row!.openingTags).toBe('Italian_Game Italian_Game_Two_Knights_Defense');
    expect(row!.dailyDate).toBe(1609459200000);
    expect(row!.gameUrl).toBe('https://lichess.org/abcdefgh#7');
  });
  it('παλιά μορφή χωρίς DailyDate (10 στήλες)', () => {
    const cols = parseHeader('PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags');
    const { row } = parseLichessLine(ROW.slice(0, -1), cols);
    expect(row!.id).toBe('00008');
    expect(row!.dailyDate).toBe(0);
  });
  it('κενή γραμμή, κεφαλίδα, λίγες στήλες, λάθος αριθμοί', () => {
    expect(parseLichessLine('').why).toBe('empty');
    expect(parseLichessLine('   \r').why).toBe('empty');
    expect(parseLichessLine(HEADER).why).toBe('header');
    expect(parseLichessLine('00008,fen,e2e4').why).toBe('columns');
    expect(parseLichessLine(ROW.replace(',1811,', ',abc,')).why).toBe('number');
    expect(parseLichessLine(ROW.replace(',10282,', ',,')).why).toBe('number');
  });
  it('πεδία σε εισαγωγικά (με κόμμα και διπλά εισαγωγικά)', () => {
    expect(splitCsv('a,"b,c","d ""e""",f')).toEqual(['a', 'b,c', 'd "e"', 'f']);
    const { row } = parseLichessLine(ROW.replace('crushing hangingPiece long middlegame', '"crushing long"'));
    expect(row!.themes).toEqual(['crushing', 'long']);
  });
  it('πολλαπλά κενά στις κινήσεις', () => {
    const { row } = parseLichessLine(ROW.replace('f2g3 e6e7', 'f2g3  e6e7'));
    expect(row!.moves.length).toBe(6);
  });
});

describe('URL παρτίδας', () => {
  it('διαβάζει παρτίδα, προσανατολισμό και ημικίνηση', () => {
    expect(parseGameUrl('https://lichess.org/787zsVup/black#48')).toEqual({ game: '787zsVup', black: true, ply: 48 });
    expect(parseGameUrl('https://lichess.org/787zsVup#7')).toEqual({ game: '787zsVup', black: false, ply: 7 });
    expect(parseGameUrl('https://example.com/x')).toBeNull();
  });
});

describe('φίλτρο ποιότητας', () => {
  it('προεπιλογή: δημοτικότητα ≥ 80 και ≥ 100 προσπάθειες', () => {
    const { key, filter } = qualityFrom(undefined);
    expect(key).toBe('default');
    const { row } = parseLichessLine(ROW);
    expect(passesQuality(row!, filter)).toBe(true);
    expect(passesQuality({ ...row!, popularity: 79 }, filter)).toBe(false);
    expect(passesQuality({ ...row!, plays: 99 }, filter)).toBe(false);
  });
  it('«all» δέχεται τα πάντα· προσαρμοσμένο φίλτρο με RD', () => {
    const { row } = parseLichessLine(ROW);
    expect(passesQuality({ ...row!, popularity: -100, plays: 0 }, qualityFrom('all').filter)).toBe(true);
    const c = qualityFrom({ minPopularity: 90, minPlays: 1000, maxRd: 75 });
    expect(c.key).toBe('custom:90/1000/75');
    expect(passesQuality(row!, c.filter)).toBe(false);
  });
});
