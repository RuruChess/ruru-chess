/** Κείμενο για αναζήτηση χωρίς τόνους και κεφαλαία (το τελικό ς μετρά ως σ). */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
}
