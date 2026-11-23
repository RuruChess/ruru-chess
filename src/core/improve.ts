/**
 * Βελτίωση βάσης (ImproveDB): ανάλυση ονομάτων «Επώνυμο, Όνομα», ενοποίηση παραλλαγών
 * (π.χ. «Banikas, H» → «Banikas, Hristos»), αντιστοίχιση σε βάση αναφοράς και Elo
 * κοντά σε μια ημερομηνία. Χωρίς εξαρτήσεις.
 */

/** Κλειδί σύγκρισης: πεζά, χωρίς τόνους, «ς» → «σ», ένα κενό. */
export function nameKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface NameParts {
  sur: string;
  /** ονόματα ή αρχικά, με τη σειρά */
  given: string[];
}

/** «Επώνυμο, Όνομα Μεσαίο» → μέρη· null χωρίς κόμμα (η σειρά των λέξεων είναι άγνωστη). */
export function parseName(name: string): NameParts | null {
  const k = nameKey(name);
  const c = k.indexOf(',');
  if (c <= 0) return null;
  const sur = k.slice(0, c).trim();
  return sur ? { sur, given: k.slice(c + 1).split(/[\s.\-]+/).filter(Boolean) } : null;
}

const hasDigit = (s: string) => /\d/.test(s);

/**
 * Το `a` είναι ελλιπής (ή ίδια) μορφή του `b`: ίδιο επώνυμο, ίδιος αριθμός ονομάτων (όχι
 * πρόσθετα μεσαία ονόματα), κάθε όνομα του `a` αρχή του αντίστοιχου του `b`. Ονόματα με
 * ψηφία (π.χ. «Alexander2», για συνονόματους) πρέπει να είναι ίδια.
 */
export function isVariantOf(a: NameParts, b: NameParts): boolean {
  if (a.sur !== b.sur || (a.given.length && a.given.length !== b.given.length)) return false;
  return a.given.every((g, i) => (hasDigit(g) || hasDigit(b.given[i]) ? g === b.given[i] : b.given[i].startsWith(g)));
}

const fullKey = (p: NameParts) => `${p.sur},${p.given.join(' ')}`;

/** Ίδιο όνομα με άλλη μόνο γραφή (κεφαλαία, τόνοι, τελείες, παύλες, κενά). */
export function sameForm(a: string, b: string): boolean {
  const pa = parseName(a);
  const pb = parseName(b);
  return pa && pb ? fullKey(pa) === fullKey(pb) : nameKey(a) === nameKey(b);
}

/** Γραφή με «θόρυβο»: κενά γύρω από παύλες, διπλά κενά ή τελείες, παρενθέσεις. */
export const untidy = (s: string): boolean => /\s-|-\s|\s{2}|\.\.|[()]|^\s|\s$/.test(s);

export interface NameCount {
  name: string;
  games: number;
}

export interface Rename {
  from: string;
  to: string;
}

type Form = { best: NameCount & { p: NameParts }; all: Array<NameCount & { p: NameParts }> };

/** Μορφές ενός επωνύμου: ίδιο πλήρες κλειδί = ίδια μορφή (γραφή: η πιο συχνή από τις «καθαρές»). */
function formsOf(list: Array<NameCount & { p: NameParts }>): Form[] {
  const byKey = new Map<string, Form>();
  const better = (x: NameCount, y: NameCount) => (untidy(x.name) !== untidy(y.name) ? !untidy(x.name) : x.games > y.games);
  for (const x of list) {
    const k = fullKey(x.p);
    const f = byKey.get(k);
    if (!f) byKey.set(k, { best: x, all: [x] });
    else {
      f.all.push(x);
      if (better(x, f.best)) f.best = x;
    }
  }
  return [...byKey.values()];
}

/** Οι πληρέστερες μορφές: όσες δεν είναι ελλιπής μορφή κάποιας άλλης. */
const maximalOf = (forms: Form[]) => forms.filter((f) => !forms.some((o) => o !== f && isVariantOf(f.best.p, o.best.p)));

const formGames = (f: Form) => f.all.reduce((s, x) => s + x.games, 0);

/**
 * Κανονική μορφή μιας ομάδας συμβατών μορφών (όλες ελλιπείς μορφές της `full`): η
 * πληρέστερη, εκτός αν είναι σπάνια (<10% της συχνότερης)· τότε η συχνότερη.
 */
function canonicalOf(cluster: Form[], full: Form): Form {
  const top = cluster.reduce((a, f) => (formGames(f) > formGames(a) ? f : a));
  return formGames(full) * 10 >= formGames(top) ? full : top;
}

/**
 * Προτάσεις ενοποίησης μέσα σε μια βάση: (1) ίδιο όνομα με άλλη γραφή (κεφαλαία, τόνοι,
 * τελείες, κενά) → η πιο συχνή γραφή· (2) ελλιπής μορφή → η κανονική της ομάδας της,
 * ποτέ προς λιγότερο πλήρη μορφή. Όταν μια μορφή ταιριάζει σε πολλές πληρέστερες (π.χ.
 * «Smith, J» → John ή Jane) δεν προτείνεται τίποτα.
 */
export function unifyNames(names: NameCount[]): { renames: Rename[]; ambiguous: string[] } {
  const groups = new Map<string, Array<NameCount & { p: NameParts }>>();
  for (const n of names) {
    const p = parseName(n.name);
    if (!p) continue;
    const g = groups.get(p.sur);
    if (g) g.push({ ...n, p });
    else groups.set(p.sur, [{ ...n, p }]);
  }
  const renames: Rename[] = [];
  const ambiguous: string[] = [];
  const add = (f: Form, to: string) => {
    for (const x of f.all) if (x.name !== to) renames.push({ from: x.name, to });
  };
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const forms = formsOf(g);
    const maximal = maximalOf(forms);
    const clusters = new Map<Form, Form[]>(maximal.map((m) => [m, [m]]));
    for (const f of forms) {
      if (clusters.has(f)) continue;
      const cands = maximal.filter((m) => isVariantOf(f.best.p, m.best.p));
      if (cands.length === 1) clusters.get(cands[0])!.push(f);
      else {
        ambiguous.push(f.best.name);
        add(f, f.best.name);
      }
    }
    for (const [full, cluster] of clusters) {
      const c = canonicalOf(cluster, full);
      for (const f of cluster) add(f, isVariantOf(f.best.p, c.best.p) ? c.best.name : f.best.name);
    }
  }
  return { renames, ambiguous };
}

/**
 * Το όνομα σε βάση αναφοράς: η κανονική μορφή της αναφοράς, αν όλες οι συμβατές μορφές
 * της είναι ένας παίκτης (μία πληρέστερη)· αλλιώς μόνο η ίδια μορφή, αν υπάρχει.
 */
export function matchReference(name: string, refs: NameCount[]): string | null {
  const p = parseName(name);
  if (!p) return refs.some((r) => r.name === name) ? name : null;
  const list: Array<NameCount & { p: NameParts }> = [];
  for (const r of refs) {
    const rp = parseName(r.name);
    if (rp && isVariantOf(p, rp)) list.push({ ...r, p: rp });
  }
  if (!list.length) return null;
  const forms = formsOf(list);
  const maximal = maximalOf(forms);
  if (maximal.length === 1) return canonicalOf(forms, maximal[0]).best.name;
  return forms.find((f) => fullKey(f.best.p) === fullKey(p))?.best.name ?? null;
}

// ---------------------------------------------------------------------------
// Elo κατά την ημερομηνία

const monthOf = (date: number) => {
  const y = Math.floor(date / 10000);
  const m = Math.floor(date / 100) % 100;
  return y ? y * 12 + (m ? m - 1 : 6) : 0;
};

/**
 * Elo από το ιστορικό ενός παίκτη (date YYYYMMDD, elo) για παρτίδα της `date`: το πιο
 * κοντινό χρονικά, μέσα σε `maxMonths` μήνες· 0 αν δεν υπάρχει.
 */
export function eloNear(history: ReadonlyArray<{ date: number; elo: number }>, date: number, maxMonths = 6): number {
  const t = monthOf(date);
  if (!t) return 0;
  let best = 0;
  let dist = Infinity;
  for (const h of history) {
    const m = monthOf(h.date);
    if (!m || !h.elo) continue;
    const d = Math.abs(m - t);
    if (d < dist || (d === dist && h.date > date)) {
      dist = d;
      best = h.elo;
    }
  }
  return dist <= maxMonths ? best : 0;
}
