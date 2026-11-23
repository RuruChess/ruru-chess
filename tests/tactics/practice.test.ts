/** Τεστ: οι θέσεις χωρίς λύση παίζονται με τη μηχανή (στόχος, κρίση κινήσεων, υπόδειξη, θέματα του STS). */
import { describe, expect, it } from 'vitest';
import { MATE_CP, gameStatus, hintFromUci, keepsGoal, practiceGoal, solverEval, stsTheme } from '../../src/web/tactics/practice.ts';
import type { Puzzle } from '../../src/web/tactics/api.ts';

const puzzle = (goal: Puzzle['goal']) => ({ goal }) as Puzzle;

describe('εξάσκηση με τη μηχανή', () => {
  it('αξιολόγηση από τη σκοπιά του λύτη (η μηχανή μετρά από τα λευκά)', () => {
    expect(solverEval({ cp: 120, mate: null }, true)).toBe(120);
    expect(solverEval({ cp: 120, mate: null }, false)).toBe(-120);
    expect(solverEval({ cp: null, mate: 3 }, true)).toBe(MATE_CP - 30);
    expect(solverEval({ cp: null, mate: -2 }, true)).toBe(-(MATE_CP - 20));
    expect(solverEval(undefined, true)).toBeNull();
  });

  it('στόχος: από τα δεδομένα, αλλιώς από την εκτίμηση της μηχανής', () => {
    expect(practiceGoal(puzzle({ kind: 'play', result: 'draw' }), 400)).toBe('draw');
    expect(practiceGoal(puzzle({ kind: 'play' }), 250)).toBe('win');
    expect(practiceGoal(puzzle(null), 40)).toBe('draw');
    expect(practiceGoal(puzzle(null), -260)).toBe('defend');
  });

  it('κρίση: η νίκη πρέπει να μένει νίκη, η ισοπαλία να μη γίνει ήττα', () => {
    expect(keepsGoal('win', 350, 300)).toBe(true);
    expect(keepsGoal('win', 350, 40)).toBe(false);
    expect(keepsGoal('win', 120, 90)).toBe(true);
    // μεγάλο πλεονέκτημα: δεν επιτρέπεται να χαθεί κομμάτι (+10,1 → +1,8)
    expect(keepsGoal('win', 1010, 183)).toBe(false);
    expect(keepsGoal('win', 1010, 942)).toBe(true);
    expect(keepsGoal('win', MATE_CP - 30, 200)).toBe(false);
    expect(keepsGoal('win', MATE_CP - 30, MATE_CP - 50)).toBe(true);
    expect(keepsGoal('draw', 0, -50)).toBe(true);
    expect(keepsGoal('draw', 0, -200)).toBe(false);
    expect(keepsGoal('win', 300, null)).toBe(true);
    // άμυνα σε χειρότερη θέση: κρίνεται σε σχέση με την αρχή
    expect(keepsGoal('defend', -260, -300)).toBe(true);
    expect(keepsGoal('defend', -260, -500)).toBe(false);
    expect(keepsGoal('draw', -70, -100)).toBe(true);
  });

  it('τέλος παρτίδας και υπόδειξη από την κίνηση της μηχανής', () => {
    expect(gameStatus('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1')).toBe('checkmate');
    expect(gameStatus('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toBe('stalemate');
    expect(gameStatus('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1')).toBe('ongoing');
    const h = hintFromUci('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1', 'e1d2', 2)!;
    expect(h.piece.letter).toBe('K');
    expect(h.from).toBe('e1');
    expect(h.to).toBe('d2');
    expect(h.san).toBeUndefined();
    expect(hintFromUci('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1', 'e2e4', 3)!.san).toBe('e4');
  });

  it('θέματα του STS με πλάνο', () => {
    expect(stsTheme('Undermine')!.plan.length).toBeGreaterThan(20);
    expect(stsTheme('7th Rank')!.name).toBeTruthy();
    expect(stsTheme(undefined)).toBeNull();
  });
});
