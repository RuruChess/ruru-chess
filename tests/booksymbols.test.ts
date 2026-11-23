import { describe, expect, it } from 'vitest';
import { symbolOf } from '../src/server/books/symbols.ts';

/** Εικόνα από σχέδιο: «#» μαύρο, «+» γκρι (αντιστροφή άκρης), «.» ανοιχτό γκρι, κενό λευκό. */
const bmp = (art: string) => {
  const lines = art.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n');
  const w = Math.max(...lines.map((l) => l.length));
  const h = lines.length;
  const px = new Uint8Array(w * h).fill(255);
  lines.forEach((l, y) => [...l].forEach((c, x) => (px[y * w + x] = c === '#' ? 30 : c === '+' ? 120 : c === '.' ? 190 : 255)));
  return { w, h, px };
};

describe('σύμβολα αξιολόγησης ως εικόνες', () => {
  it('±, ∓, ⩲, ⩱, =', () => {
    const plus = '     .#.    \n     .#.    \n     .#.    \n     .#.    \n';
    const stem = '     .#.    \n     .#.    \n     .#.    \n     .#.    \n';
    const bar = '++#########+\n';
    expect(symbolOf(bmp(plus + bar + stem + bar))).toBe('±');
    expect(symbolOf(bmp(bar + stem + bar + stem))).toBe('∓');
    expect(symbolOf(bmp(plus + bar + stem + bar + '            \n' + bar))).toBe('⩲');
    expect(symbolOf(bmp(bar + '            \n' + bar + ' .+..++.....\n' + stem + bar + '..+..+#+.+..\n' + stem))).toBe('⩱');
    expect(symbolOf(bmp('            \n' + bar + '            \n' + bar + '            \n'))).toBe('=');
  });

  it('βέλη, αντιστάθμισμα, μοναδική κίνηση, γεμάτο τετράγωνο', () => {
    expect(
      symbolOf(
        bmp(`
           +#.
            +#+
.............+##+
#################
+++++++++++++###+
            .##+
           .#+   `),
      ),
    ).toBe('→');
    expect(
      symbolOf(
        bmp(`
   ++
  .##.
  +##+
 +####+
   ++
   ++
   ++
   ++
   ++
   ++
   ++
   ++
   ++   `),
      ),
    ).toBe('↑');
    expect(
      symbolOf(
        bmp(`
         +
         +#.
.+++++++++##+
.############.
    .     #+
  +#     +.
+##..........
#############
 +#.
   +.         `),
      ),
    ).toBe('⇄');
    expect(
      symbolOf(
        bmp(`
  +##+   +##+.
 +#++##.+##..+.
++    .###   .+
+.    .##     #
+.    +#+     #
++   +###.   .+
 #..+##.+#+.+#.
 .++#+.  .+#+.

.#############+
 +++++++++++++.


 #############+
 +#+++#++++#++.`),
      ),
    ).toBe('©');
    expect(
      symbolOf(
        bmp(`
.###########.
.+        .##
.+        .##.
.+        .##.
.+        .##.
.+        .##.
.+        .##.
.+        .##.
.#++++++++###.
 ############.
  +++++++++++.`),
      ),
    ).toBe('□');
    expect(symbolOf(bmp('#########\n'.repeat(9)))).toBeNull();
  });
});
