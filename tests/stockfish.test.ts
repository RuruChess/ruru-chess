import { describe, expect, it } from 'vitest';
import { stockfishAssets } from '../src/server/downloads.ts';

describe('επιλογή αρχείου Stockfish για Windows', () => {
  it('προτιμά την «universal» (Stockfish 18+)', () => {
    const names = ['stockfish-windows-arm64-universal.zip', 'stockfish-windows-x86-64-universal.zip', 'stockfish-ubuntu-x86-64-avx2.tar'];
    expect(stockfishAssets(names, 'x64')).toEqual(['stockfish-windows-x86-64-universal.zip']);
    expect(stockfishAssets(names, 'arm64')[0]).toBe('stockfish-windows-arm64-universal.zip');
  });

  it('παλαιότερες εκδόσεις: AVX2, μετά SSE4.1, μετά η απλή', () => {
    const names = ['stockfish-windows-x86-64.zip', 'stockfish-windows-x86-64-sse41-popcnt.zip', 'stockfish-windows-x86-64-avx2.zip', 'stockfish-windows-x86-64-bmi2.zip'];
    expect(stockfishAssets(names, 'x64')).toEqual(['stockfish-windows-x86-64-avx2.zip', 'stockfish-windows-x86-64-sse41-popcnt.zip', 'stockfish-windows-x86-64.zip']);
  });
});
