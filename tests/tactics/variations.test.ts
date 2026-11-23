/** Τεστ: οι υποβαριάντες της λύσης μιας πηγής γίνονται γραμμές που παίζονται (άμυνες του αντιπάλου). */
import { describe, expect, it } from 'vitest';
import { lineNotes, subLines } from '../../src/web/tactics/variations.ts';

// Auerswald #176 (Zamit–Karaynis 1981): λευκά παίζουν
const FEN = 'r1n1rbk1/ppqn2pp/5p2/3PpR2/2p1P1Q1/2P1B3/PPBN2PP/R6K w - - 0 1';

describe('υποβαριάντες της λύσης', () => {
  it('μία άμυνα του αντιπάλου → μία γραμμή, από τη θέση πριν από την άμυνα', () => {
    const sub = subLines(FEN, '1. Nxc4 Qxc4 (1... b5 2. d6 Nxd6 3. Nxd6 Bxd6 4. Bb3+) 2. Bb3 Qd3 1-0', 'white');
    expect(sub).toHaveLength(1);
    expect(sub[0].label).toBe('1…b5');
    expect(sub[0].moves[0]).toBe('b7b5');
    expect(sub[0].moves).toHaveLength(6);
  });

  it('χωρίς παρενθέσεις ή με εναλλακτική του λύτη: τίποτα να παιχτεί', () => {
    expect(subLines(FEN, '1. Nxc4 Qxc4 2. Bb3 Qd3', 'white')).toEqual([]);
    expect(subLines(FEN, '1. Nxc4 (1. Bb3 Kh8) 1... Qxc4 2. Bb3', 'white')).toEqual([]);
  });

  it('φωλιασμένες άμυνες με τη σειρά της ανάγνωσης', () => {
    const sub = subLines(FEN, '1. Nxc4 Qxc4 (1... b5 2. d6 Nxd6 (2... Kh8 3. dxc7) 3. Nxd6) 2. Bb3 Qd3 (2... Qc5 3. d6+) 3. d6+', 'white');
    expect(sub.map((x) => x.label)).toEqual(['1…b5', '2…Kh8', '2…Qc5']);
  });

  it('τα σχόλια: ένα ανά ημικίνηση, στην κύρια γραμμή και στις υποβαριάντες', () => {
    const sol = '1. Nxc4 {πρώτα} Qxc4 (1... b5 {άμυνα} 2. d6 Nxd6 3. Nxd6 Bxd6 4. Bb3+ {κερδίζει}) 2. Bb3 Qd3';
    expect(lineNotes(FEN, sol)).toEqual(['πρώτα', '', '', '']);
    expect(subLines(FEN, sol, 'white')[0].notes).toEqual(['άμυνα', '', '', '', '', 'κερδίζει']);
    expect(lineNotes(FEN, '1. Nxc4 Qxc4 2. Bb3 Qd3')).toEqual([]);
  });
});
