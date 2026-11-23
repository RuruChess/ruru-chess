/** Ruru Chess: νέα εγκατάσταση → φάκελοι Ruru· όποιος είχε KnightBase κρατά τους δικούς του, χωρίς μετακίνηση. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home = '';
const env = { ...process.env };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ruru-dirs-'));
  Object.assign(process.env, { USERPROFILE: home, HOME: home, LOCALAPPDATA: path.join(home, 'Local'), APPDATA: path.join(home, 'Roaming') });
  fs.mkdirSync(path.join(home, 'Documents'));
  vi.resetModules();
});
afterEach(() => {
  for (const k of ['USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA']) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  fs.rmSync(home, { recursive: true, force: true });
});

const load = async () => ({
  ...(await import('../src/server/paths.ts')),
  ...(await import('../src/server/rename.ts')),
  ...(await import('../src/server/browser.ts')),
});

describe('φάκελοι του Ruru', () => {
  it('νέα εγκατάσταση: Ruru', async () => {
    const m = await load();
    m.migrateFromSkakiBase(1);
    expect(m.defaultDatabasesDir()).toBe(path.join(home, 'Documents', 'Ruru'));
    expect(m.APP_DIR).toBe(path.join(home, 'Documents', 'Ruru', '.knightbase'));
    expect(m.appLocalDir()).toBe(path.join(home, 'Local', 'Ruru'));
    expect(m.browserProfileDir()).toBe(path.join(home, 'Local', 'Ruru', 'browser'));
  });

  it('υπάρχει KnightBase: μένει εκεί που είναι, ακόμη κι αν υπάρχει και φάκελος Ruru', async () => {
    const data = path.join(home, 'Documents', 'KnightBase');
    fs.mkdirSync(path.join(data, '.knightbase'), { recursive: true });
    fs.writeFileSync(path.join(data, '.knightbase', 'library.json'), '[]');
    fs.mkdirSync(path.join(home, 'Local', 'KnightBase', 'ocr'), { recursive: true });
    fs.mkdirSync(path.join(home, 'Documents', 'Ruru'));
    const m = await load();
    m.migrateFromSkakiBase(1);
    expect(m.defaultDatabasesDir()).toBe(data);
    expect(m.APP_DIR).toBe(path.join(data, '.knightbase'));
    expect(m.appLocalDir()).toBe(path.join(home, 'Local', 'KnightBase'));
    expect(m.browserProfileDir()).toBe(path.join(home, 'Local', 'KnightBase', 'browser'));
    expect(fs.readFileSync(path.join(data, '.knightbase', 'library.json'), 'utf8')).toBe('[]');
  });
});
