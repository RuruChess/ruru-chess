// Το προαιρετικό πακέτο θέσεων διαγραμμάτων (diagramnet.ts): εύρεση, διεργασία, και οι θέσεις του που δεν αλλάζουν.
// Το πραγματικό πακέτο δεν χρειάζεται: ένα ψεύτικο `recognize.js` σε προσωρινό φάκελο απαντά με τη μέση φωτεινότητα.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findDiagramNet, readDiagrams } from '../src/server/books/diagramnet.ts';
import { placements, type BookBoards } from '../src/server/books/pieces.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-cdn-'));
fs.mkdirSync(path.join(dir, 'diagram'));
fs.writeFileSync(
  path.join(dir, 'diagram', 'recognize.js'),
  `export function recognize(img) {
    let s = 0;
    for (const v of img.d) s += v;
    return s / img.d.length > 0.5 ? { ok: true, placement: '4k3/8/8/8/8/8/8/4K3', confidence: 0.9 } : { ok: false };
  }`,
);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('πακέτο θέσεων διαγραμμάτων', () => {
  it('βρίσκεται μόνο όταν υπάρχει το recognize.js', () => {
    const was = process.env.KNIGHTBASE_CDN_DIR;
    process.env.KNIGHTBASE_CDN_DIR = dir;
    expect(findDiagramNet()).toBe(path.join(dir, 'diagram', 'recognize.js'));
    process.env.KNIGHTBASE_CDN_DIR = path.join(dir, 'missing');
    expect(findDiagramNet()).toBeNull();
    if (was === undefined) delete process.env.KNIGHTBASE_CDN_DIR;
    else process.env.KNIGHTBASE_CDN_DIR = was;
  });

  it('διαβάζει τα αποκόμματα σε δική του διεργασία· null όπου δεν βρέθηκε ή δεν υπάρχει απόκομμα', async () => {
    const light = { w: 4, h: 4, px: new Uint8Array(16).fill(255) };
    const dark = { w: 4, h: 4, px: new Uint8Array(16) };
    const out = await readDiagrams(path.join(dir, 'diagram', 'recognize.js'), [light, null, dark, light]);
    expect(out.map((r) => r?.placement ?? null)).toEqual(['4k3/8/8/8/8/8/8/4K3', null, null, '4k3/8/8/8/8/8/8/4K3']);
  }, 30000);

  it('οι θέσεις του πακέτου περνούν πάνω από τις ομάδες σχήματος', () => {
    const r: BookBoards = { boards: [[], []], cluster: [Array(64).fill(-1), Array(64).fill(-1)], clusters: [], fixed: new Map([[1, '8/8/8/8/8/8/8/K6k']]) };
    expect(placements(r)).toEqual(['8/8/8/8/8/8/8/8', '8/8/8/8/8/8/8/K6k']);
  });

  it('δύο βασίλισσες ενός χρώματος και καμία του άλλου σε θέση μέσης παρτίδας: αλλάζει αυτή που είναι πιο βαθιά στο άλλο στρατόπεδο', () => {
    // (η μαύρη βασίλισσα του e7 διαβάστηκε λευκή)
    const pl = 'r4rk1/1b2Qppp/ppnppb2/2n5/2P1P3/N1N1B3/PPQ1BPPP/2RR2K1';
    const r: BookBoards = { boards: [[]], cluster: [Array(64).fill(-1)], clusters: [], fixed: new Map([[0, pl]]) };
    expect(placements(r)).toEqual(['r4rk1/1b2qppp/ppnppb2/2n5/2P1P3/N1N1B3/PPQ1BPPP/2RR2K1']);
    // (τελικό με λίγα κομμάτια: δύο βασίλισσες από προαγωγή γίνονται, η θέση μένει)
    const end: BookBoards = { boards: [[]], cluster: [Array(64).fill(-1)], clusters: [], fixed: new Map([[0, '2n5/2n5/p1R2p1p/2q5/1kP5/pRB3N1/2P5/K1q5']]) };
    expect(placements(end)).toEqual(['2n5/2n5/p1R2p1p/2q5/1kP5/pRB3N1/2P5/K1q5']);
  });
});
