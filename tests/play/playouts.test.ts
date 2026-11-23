/** «Παίξε τη θέση»: τα δεδομένα των θέσεων φινάλε (νόμιμες θέσεις και γραμμές, στόχοι, είδη, πηγές). */
import { describe, expect, it } from 'vitest';
import { Position } from '../../src/core/chess.ts';
import { CAT_ORDER, PLAYOUTS, goalLine, materialLine, sideOf, sourceLine } from '../../src/web/play/playouts.ts';

describe('θέσεις φινάλε για παιχνίδι', () => {
  it('αρκετές θέσεις, μοναδικά id, όλα τα είδη', () => {
    expect(PLAYOUTS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(PLAYOUTS.map((p) => p.id)).size).toBe(PLAYOUTS.length);
    for (const c of CAT_ORDER) expect(PLAYOUTS.filter((p) => p.cat === c).length).toBeGreaterThanOrEqual(3);
    expect(PLAYOUTS.some((p) => p.goal === 'win')).toBe(true);
    expect(PLAYOUTS.some((p) => p.goal === 'draw')).toBe(true);
  });

  it('κάθε θέση: νόμιμη, σε εξέλιξη, χωρίς σαχ στον αντίπαλο, με νόμιμη γραμμή της μηχανής', () => {
    for (const p of PLAYOUTS) {
      const pos = Position.fromFen(p.fen);
      expect(pos.status(), p.id).toBe('ongoing');
      expect(['win', 'draw']).toContain(p.goal);
      expect(p.level, p.id).toBeGreaterThanOrEqual(1);
      expect(p.level, p.id).toBeLessThanOrEqual(3);
      for (const san of p.pv) {
        const m = pos.parseSan(san);
        expect(m, `${p.id}: ${san}`).toBeTruthy();
        pos.makeMove(m);
      }
    }
  });

  it('οι στόχοι συμφωνούν με την αξιολόγηση του ελέγχου', () => {
    for (const p of PLAYOUTS) {
      if (p.goal === 'win') expect(p.eval, p.id).toBeGreaterThanOrEqual(150);
      else expect(Math.abs(p.eval), p.id).toBeLessThanOrEqual(60);
    }
  });

  it('πηγή, τίτλοι και κείμενα', () => {
    for (const p of PLAYOUTS) {
      if (p.source.kind === 'game') {
        expect(p.source.white && p.source.black, p.id).toBeTruthy();
        expect(p.source.year, p.id).toBeGreaterThan(1800);
      } else {
        expect(p.title?.el && p.title?.en && p.idea?.el && p.idea?.en, p.id).toBeTruthy();
      }
      expect(sourceLine(p)).toBeTruthy();
      expect(goalLine(p)).toBeTruthy();
      expect(materialLine(p.fen)).toContain('–');
      expect(['white', 'black']).toContain(sideOf(p));
    }
  });

  it('το υλικό με σύμβολα', () => {
    expect(materialLine('8/8/8/8/8/8/1r6/3K1B1R b - - 0 1')).toBe('♖♗ – ♜');
    expect(materialLine('8/5k2/8/3pp3/8/8/PPP5/4K3 w - - 0 1')).toBe('3♙ – 2♟');
  });
});
