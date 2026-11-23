/**
 * Συμπίεση JSON για τη βάση (σχόλια, πρόσθετες ετικέτες). Πρώτο byte: 0 = απλό
 * UTF-8, 1 = deflate. Παλιές εγγραφές ως κείμενο διαβάζονται κανονικά.
 */
import zlib from 'node:zlib';

export function packJson(v: unknown): Uint8Array {
  const raw = Buffer.from(JSON.stringify(v), 'utf8');
  if (raw.length >= 96) {
    const z = zlib.deflateRawSync(raw, { level: 6 });
    if (z.length < raw.length - 8) {
      const out = new Uint8Array(z.length + 1);
      out[0] = 1;
      out.set(z, 1);
      return out;
    }
  }
  const out = new Uint8Array(raw.length + 1);
  out[0] = 0;
  out.set(raw, 1);
  return out;
}

export function unpackJson<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v ? (JSON.parse(v) as T) : null;
  const b = v as Uint8Array;
  if (!b.length) return null;
  const body = b.subarray(1);
  const text = b[0] === 1 ? zlib.inflateRawSync(body).toString('utf8') : Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8');
  return JSON.parse(text) as T;
}
