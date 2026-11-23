/**
 * «Προετοιμασία για αντίπαλο» από άλλο σημείο (π.χ. η αναζήτηση των Βάσεων): ο αντίπαλος συμπληρώνεται στη φόρμα της
 * καρτέλας. Η καρτέλα μπορεί να μην έχει ανοίξει ακόμη, οπότε το αίτημα μένει εδώ ώσπου να το πάρει.
 */
export interface PrepRequest {
  /** όνομα παίκτη μιας βάσης (π.χ. «Carlsen, Magnus») */
  name: string;
}

let pending: PrepRequest | null = null;

export function requestPrep(r: PrepRequest): void {
  pending = r;
  window.dispatchEvent(new CustomEvent('knightbase:prep'));
}

export function takePrep(): PrepRequest | null {
  const r = pending;
  pending = null;
  return r;
}
