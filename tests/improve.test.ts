import { describe, expect, it } from 'vitest';
import { eloNear, isVariantOf, matchReference, nameKey, parseName, sameForm, unifyNames, untidy } from '../src/core/improve.ts';

const n = (name: string, games = 1) => ({ name, games });

describe('ονόματα', () => {
  it('ανάλυση και σύγκριση', () => {
    expect(nameKey('  BANÍKAS,   Hrístos ')).toBe('banikas, hristos');
    expect(parseName('Banikas, H.')).toEqual({ sur: 'banikas', given: ['h'] });
    expect(parseName('Kasparov,G.K.')).toEqual({ sur: 'kasparov', given: ['g', 'k'] });
    expect(parseName('Magnus Carlsen')).toBeNull();
    expect(isVariantOf(parseName('Banikas, H')!, parseName('Banikas, Hristos')!)).toBe(true);
    expect(isVariantOf(parseName('Banikas, Hristos')!, parseName('Banikas, H')!)).toBe(false);
    expect(isVariantOf(parseName('Smith, J A')!, parseName('Smith, John A')!)).toBe(true);
    // όχι πρόσθετα μεσαία ονόματα, όχι συνονόματοι με αριθμό
    expect(isVariantOf(parseName('Smith, J')!, parseName('Smith, John A')!)).toBe(false);
    expect(isVariantOf(parseName('Zubarev, Alexander')!, parseName('Zubarev, Alexander2')!)).toBe(false);
    expect(sameForm('Stefanidi, Maria Anna', 'Stefanidi, Maria-Anna')).toBe(true);
    expect(sameForm('Banikas, H', 'Banikas, Hristos')).toBe(false);
    expect(untidy('Vozinaki, Anthi - Maria')).toBe(true);
    expect(untidy('Agnos, D..')).toBe(true);
    expect(untidy('Vozinaki, Anthi-Maria')).toBe(false);
  });

  it('ενοποίηση μέσα στη βάση', () => {
    const { renames, ambiguous } = unifyNames([
      n('Banikas, Hristos', 40),
      n('Banikas, H', 3),
      n('Banikas,H.', 1),
      n('BANIKAS, Hristos', 2),
      n('Smith, John', 5),
      n('Smith, Jane', 5),
      n('Smith, J', 2),
      n('Kotronias, Vasilios', 9),
      n('Kotronias, Vasileios', 4),
      n('Carlsen Magnus'),
      // σπάνια πληρέστερη μορφή: καμία αλλαγή (ούτε «υποβάθμιση» της John)
      n('Doe, J', 500),
      n('Doe, John', 2),
    ]);
    expect(renames).toEqual([
      { from: 'BANIKAS, Hristos', to: 'Banikas, Hristos' },
      { from: 'Banikas, H', to: 'Banikas, Hristos' },
      { from: 'Banikas,H.', to: 'Banikas, Hristos' },
    ]);
    // δύο πληρέστερες μορφές: καμία πρόταση· διαφορετική ορθογραφία: καμία
    expect(ambiguous).toEqual(['Smith, J']);
  });

  it('βάση αναφοράς', () => {
    const refs = [n('Banikas, Hristos', 900), n('Banikas, Haris', 2), n('Banikas, Hristos G', 1), n('Papadopoulos, Georgios', 30), n('Agnos, D..', 50), n('Agnos, D', 5)];
    // «Banikas, H»: δύο πληρέστερες στην αναφορά → τίποτα
    expect(matchReference('Banikas, H', refs)).toBeNull();
    // το μεσαίο αρχικό «G» είναι άλλη μορφή, όχι συμπλήρωση
    expect(matchReference('Banikas, Hristos', refs)).toBe('Banikas, Hristos');
    // «καθαρή» γραφή πριν από τη συχνότερη
    expect(matchReference('Agnos, D.', refs)).toBe('Agnos, D');
    expect(matchReference('Banikas, Hristos', [n('Banikas, Hristos', 1), n('Banikas, Hristos-Georgios', 9)])).toBe('Banikas, Hristos');
    expect(matchReference('papadopoulos, g.', refs)).toBe('Papadopoulos, Georgios');
    expect(matchReference('Vachier-Lagrave, M', [n('Vachier-Lagrave, M', 50), n('Vachier-Lagrave, Maxime', 400)])).toBe('Vachier-Lagrave, Maxime');
    expect(matchReference('Nobody, X', refs)).toBeNull();
    expect(matchReference('Carlsen Magnus', [n('Carlsen Magnus')])).toBe('Carlsen Magnus');
  });
});

describe('Elo κατά την ημερομηνία', () => {
  const h = [
    { date: 20190300, elo: 2400 },
    { date: 20200115, elo: 2450 },
    { date: 20200600, elo: 2470 },
  ];
  it('το πιο κοντινό μέσα σε 6 μήνες', () => {
    expect(eloNear(h, 20200201)).toBe(2450);
    expect(eloNear(h, 20200500)).toBe(2470);
    // άγνωστος μήνας: μέσα του έτους
    expect(eloNear(h, 20200000)).toBe(2470);
    expect(eloNear(h, 20210601)).toBe(0);
    expect(eloNear(h, 0)).toBe(0);
    expect(eloNear([], 20200101)).toBe(0);
  });
});
