import { describe, expect, it } from 'vitest';
import { Position } from '../src/core/chess.ts';
import { descriptiveMove, squeezeDescriptive } from '../src/core/descriptive.ts';
import { normalizeBookText, parseBook, type BookParagraph } from '../src/core/bookparse.ts';
import { WinOcr } from '../src/server/books/ocr.ts';

const san = (fen: string, text: string) => {
  const pos = Position.fromFen(fen);
  const m = descriptiveMove(pos, text);
  return m ? pos.san(m) : null;
};
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('περιγραφική σημειογραφία', () => {
  it('οι γραμμές μετρούν από τη μεριά αυτού που παίζει', () => {
    expect(san(START, 'P-K4')).toBe('e4');
    expect(san('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'P-K4')).toBe('e5');
    expect(san(START, 'Kt-KB3')).toBe('Nf3');
    expect(san(START, 'N-QB3')).toBe('Nc3');
  });

  it('στήλη χωρίς πλευρά (B3 = QB3 ή KB3): αποφασίζει η νομιμότητα', () => {
    // μόνο ο ίππος του g1 φτάνει στο f3, μόνο ο αξιωματικός του f1 στο c4
    expect(san(START, 'Kt-B3')).toBeNull(); // Nc3 και Nf3: δεν ξεχωρίζει
    expect(san('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'B-B4')).toBe('Bc4');
  });

  it('αιχμαλωσίες με το κομμάτι-στόχο, και διευκρινίσεις', () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/3p4/2P1P3/8/PP1P1PPP/RNBQKBNR w KQkq - 0 3';
    expect(san(fen, 'PxP')).toBeNull(); // cxd5 ή exd5
    expect(san(fen, 'BPxP')).toBe('cxd5');
    expect(san(fen, 'KPxP')).toBe('exd5');
    expect(san('rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'KtxP')).toBe('Nxe5');
  });

  it('ροκέ, προαγωγή, πύργοι με διευκρίνιση', () => {
    expect(san('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'Castles')).toBeNull(); // και τα δύο νόμιμα
    expect(san('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'Castles(K)')).toBe('O-O');
    expect(san('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'P-Kt8(Q)')).toBe('b8=Q+');
    expect(san('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'P-Kt8=Kt')).toBe('b8=N');
    expect(san('4k3/8/8/8/8/8/8/R3K2R w - - 0 1', 'KR-Q1')).toBe('Rd1'); // η διευκρίνιση μετρά μόνο όταν μένει κάτι
    expect(san('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1', 'KR-K1')).toBe('Rfe1+');
    expect(san('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1', 'QR-K1')).toBe('Rae1+');
    expect(san('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1', 'R(Q1)-K1')).toBeNull(); // δεν υπάρχει πύργος στο d1
    expect(san('4k3/8/8/8/8/8/8/R4RK1 w - - 0 1', 'R(R1)-K1')).toBe('Rae1+');
  });

  it('τα λάθη του OCR: κενά, παύλες, «X», «I» αντί για 1', () => {
    expect(squeezeDescriptive('1. P—K 4 Kt — K B 3 2. Q x P P XP K—BI')).toBe('1. P-K4 Kt-KB3 2. QxP PxP K-B1');
    expect(normalizeBookText('I.Qa4+ wins')).toBe('1.Qa4+ wins');
  });

  it('παρτίδα σε περιγραφική γίνεται αλγεβρική', () => {
    const p = (text: string): BookParagraph => ({ page: 1, indent: 0, heading: false, caption: false, runs: [{ text, main: false }], text });
    const res = parseBook([p('1. P-K4 P-K4 2. Kt-KB3 Kt-QB3 3. B-Kt5 P-QR3 4. BxKt QPxB 5. Castles B-KKt5 6. P-KR3 P-KR4 7. PxB PxP 8. Kt-K1 Q-R5 9. P-KB3 P-Kt6 10. Q-K2 Q-R7 ch')], { title: 'T', author: '' });
    expect(res.stats.moves).toBe(20);
    expect(res.pgn.replace(/\s+/g, ' ')).toContain('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. O-O Bg4 6. h3 h5 7. hxg4 hxg4 8. Ne1 Qh4 9. f3 g3 10. Qe2 Qh2#');
    expect(res.pgn).not.toContain('{ch}');
  });
});

describe.runIf(process.platform === 'win32')('OCR των Windows', () => {
  it('το script ξεκινά και βρίσκει γλώσσα', async () => {
    const ocr = new WinOcr(null);
    try {
      const r = await ocr.ready;
      expect(r.pages).toBe(0);
      expect(typeof r.lang).toBe('string');
    } finally {
      ocr.close();
    }
  }, 30000);
});
