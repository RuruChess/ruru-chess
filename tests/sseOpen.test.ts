import { expect, it, vi } from 'vitest';

// Εισαγωγή που ξεκίνησε πριν συνδεθεί το SSE: το γεγονός `job` χάθηκε. Μόλις ανοίξει
// η σύνδεση, η Βιβλιοθήκη και οι εργασίες πρέπει να ξαναδιαβαστούν από τον server.
it('με το άνοιγμα του SSE ξαναδιαβάζονται η Βιβλιοθήκη και οι εργασίες', async () => {
  const handlers = new Map<string, Array<(ev: unknown) => void>>();
  class FakeEventSource {
    addEventListener(type: string, fn: (ev: unknown) => void) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    }
  }
  const job = { id: 'j1', status: 'running', kind: 'import', name: 'x.pgn' };
  const calls: string[] = [];
  const fetchStub = vi.fn(async (url: string) => {
    calls.push(url);
    const body = url === '/api/library' ? { databases: [{ id: 'd1', name: 'x' }], jobs: [job] } : { version: '1' };
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  });
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', fetchStub);
  vi.stubGlobal('location', { hash: '', origin: 'http://127.0.0.1' });
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {} });
  vi.stubGlobal('document', { documentElement: {} });

  const { useApp } = await import('../src/web/store.ts');
  expect(useApp.getState().jobs).toEqual([]);
  for (const fn of handlers.get('open') ?? []) fn({});
  await vi.waitFor(() => expect(useApp.getState().jobs).toEqual([job]));
  expect(useApp.getState().library.map((d) => d.id)).toEqual(['d1']);
  expect(calls.filter((u) => u === '/api/library').length).toBe(1);
  vi.unstubAllGlobals();
});
