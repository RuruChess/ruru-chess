/**
 * Ο τοπικός server εκτελεί προγράμματα (μηχανές, διάλογοι) και διαβάζει αρχεία, άρα δέχεται μόνο την ίδια
 * την εφαρμογή και τοπικά προγράμματα, όχι σελίδες που έτυχε να έχει ανοιχτές ο browser:
 * - Host: μόνο 127.0.0.1 / localhost στη δική του θύρα (DNS rebinding)
 * - Origin: αν υπάρχει, το ίδιο με το Host (αιτήματα άλλης σελίδας)
 * - Sec-Fetch-Site: στο /api όχι αιτήματα άλλης σελίδας, που έρχονται και χωρίς Origin (εικόνα, σύνδεσμος).
 *   Εξαίρεση μόνο η επιστροφή από τη σύνδεση Lichess, ως κανονική πλοήγηση.
 */
import type { IncomingMessage } from 'node:http';

const LOGIN_RETURN = '/api/watch/callback';

export function isOwnRequest(req: IncomingMessage): boolean {
  const h = req.headers;
  const port = req.socket.localPort;
  const host = (h.host ?? '').toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  if (h.origin !== undefined && h.origin.toLowerCase() !== `http://${host}`) return false;
  let path: string;
  try {
    // όπως το διαβάζει ο Router, ώστε «/x/../api/…» να μετρά ως /api
    path = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return false;
  }
  // η σελίδα ανοίγει και από σύνδεσμο· τα στατικά αρχεία δεν κάνουν τίποτα
  if (!path.startsWith('/api/')) return true;
  const site = h['sec-fetch-site'];
  if (site === undefined || site === 'same-origin' || site === 'none') return true;
  return req.method === 'GET' && path === LOGIN_RETURN && h['sec-fetch-mode'] === 'navigate' && h['sec-fetch-dest'] === 'document';
}
