// Η διεργασία του πακέτου διαγραμμάτων (βλ. diagramnet.ts): φορτώνει το `recognize.js` του πακέτου (όρισμα) και
// απαντά σε μηνύματα { id, w, h, px } με τη θέση. Τερματίζεται μόνο με kill.
import { pathToFileURL } from 'node:url';

type Recognize = (img: { w: number; h: number; d: Float32Array }) => { ok: boolean; placement?: string; confidence?: number };
let recognize: Recognize | null = null;
let failed = '';
try {
  recognize = ((await import(pathToFileURL(process.argv[2]).href)) as { recognize: Recognize }).recognize;
} catch (e) {
  failed = String((e as Error)?.message ?? e);
}

process.on('message', (m: { id: number; w: number; h: number; px: Uint8Array }) => {
  if (!recognize) {
    process.send!({ id: m.id, error: failed || 'no recognize' });
    return;
  }
  try {
    const d = new Float32Array(m.w * m.h);
    for (let i = 0; i < d.length; i++) d[i] = m.px[i] / 255;
    const r = recognize({ w: m.w, h: m.h, d });
    process.send!({ id: m.id, ok: r.ok && Boolean(r.placement), placement: r.placement, confidence: r.confidence ?? 0 });
  } catch (e) {
    process.send!({ id: m.id, error: String((e as Error)?.message ?? e) });
  }
});
