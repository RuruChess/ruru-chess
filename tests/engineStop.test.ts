/** «Στάση» ενώ η μηχανή ετοιμάζεται για νέα θέση: δεν πρέπει να ακολουθήσει «go» (η μηχανή θα έτρεχε αθέατη). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UciEngine } from '../src/server/engine.ts';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// ψεύτικη μηχανή UCI: αργό readyok, αναφέρει κάθε «go»
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-uci-'));
const script = path.join(dir, 'fake.mjs');
fs.writeFileSync(
  script,
  `import readline from 'node:readline';
const out = (s) => process.stdout.write(s + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (l) => {
  if (l === 'uci') out('id name Fake\\nuciok');
  else if (l === 'isready') setTimeout(() => out('readyok'), 150);
  else if (l.startsWith('go')) out('info string GO');
  else if (l === 'stop') out('bestmove e2e4');
  else if (l === 'quit') process.exit(0);
});
`,
);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('UciEngine stop', () => {
  it('stop() όσο η analyse περιμένει το readyok: καμία αναζήτηση', async () => {
    const e = new UciEngine(process.execPath, [script]);
    await e.start();
    let go = 0;
    e.onLine((l) => {
      if (l === 'info string GO') go++;
    });
    const run = e.analyse(START, { infinite: true }, 1, () => {});
    await new Promise((r) => setTimeout(r, 20));
    await e.stop();
    const u = await run;
    await new Promise((r) => setTimeout(r, 100));
    expect(u.done).toBe(true);
    expect(go).toBe(0);
    e.quit();
  });

  it('νεότερη analyse προσπερνά την παλιά που περιμένει ακόμα', async () => {
    const e = new UciEngine(process.execPath, [script]);
    await e.start();
    let go = 0;
    e.onLine((l) => {
      if (l === 'info string GO') go++;
    });
    void e.analyse(START, { infinite: true }, 1, () => {});
    void e.analyse(START, { infinite: true }, 1, () => {});
    await new Promise((r) => setTimeout(r, 500));
    expect(go).toBe(1);
    await e.stop();
    e.quit();
  });
});
