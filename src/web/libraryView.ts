/** Βάσεις: αναζήτηση, φίλτρα, ταξινόμηση και ετικέτες των καρτών (καθαρές συναρτήσεις για το LibraryWindow και τα τεστ). */
import type { DbInfo } from './api.ts';
import { normalize } from './search.ts';

export type LibFilter = 'all' | 'fav' | 'books' | 'big' | 'recent';
export type LibSort = 'recent' | 'name' | 'games';

export const LIB_FILTERS: LibFilter[] = ['all', 'fav', 'books', 'big', 'recent'];
export const LIB_SORTS: LibSort[] = ['recent', 'name', 'games'];

/** «Μεγάλες βάσεις»: από τόσες παρτίδες και πάνω. */
export const BIG_DB = 100_000;
/** «Πρόσφατες»: όσες άνοιξαν τις τελευταίες τόσες μέρες. */
export const RECENT_DAYS = 30;

export interface LibContext {
  /** τα αναγνωριστικά των αγαπημένων βάσεων */
  favorites: string[];
  now: number;
}

/** Ανήκει η βάση στο φίλτρο; */
export function inFilter(db: DbInfo, f: LibFilter, ctx: LibContext): boolean {
  switch (f) {
    case 'fav':
      return ctx.favorites.includes(db.id);
    case 'books':
      return db.origin === 'book';
    case 'big':
      return db.games >= BIG_DB;
    case 'recent':
      return db.lastOpened !== undefined && ctx.now - db.lastOpened <= RECENT_DAYS * 86_400_000;
    default:
      return true;
  }
}

/** Αναζήτηση στο όνομα της βάσης και στο όνομα του αρχείου από το οποίο ήρθε (χωρίς τόνους και κεφαλαία). */
export function matchesQuery(db: DbInfo, q: string): boolean {
  const words = normalize(q.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = normalize(`${db.name} ${db.source?.path.split(/[\\/]/).pop() ?? ''}`);
  return words.every((w) => hay.includes(w));
}

/** Ταξινόμηση: πιο πρόσφατο άνοιγμα (ή δημιουργία) πρώτα, όνομα (ελληνική σειρά), περισσότερες παρτίδες πρώτα. */
export function sortDbs(list: DbInfo[], sort: LibSort): DbInfo[] {
  const byName = (a: DbInfo, b: DbInfo) => a.name.localeCompare(b.name, 'el', { sensitivity: 'base', numeric: true });
  return [...list].sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'games') return b.games - a.games || byName(a, b);
    return (b.lastOpened ?? b.created) - (a.lastOpened ?? a.created) || byName(a, b);
  });
}

/** Οι βάσεις που φαίνονται: αναζήτηση, φίλτρο και ταξινόμηση. */
export function visibleDbs(list: DbInfo[], q: string, f: LibFilter, sort: LibSort, ctx: LibContext): DbInfo[] {
  return sortDbs(
    list.filter((d) => inFilter(d, f, ctx) && matchesQuery(d, q)),
    sort,
  );
}

export type BadgeKind = 'reference' | 'book' | 'mygames' | 'clipboard';

/** Οι ετικέτες μιας κάρτας: βάση αναφοράς, βιβλίο, «Οι παρτίδες μου», «Πρόχειρο». */
export function dbBadges(db: DbInfo, referenceDb: string | null | undefined): BadgeKind[] {
  const out: BadgeKind[] = [];
  if (referenceDb && db.id === referenceDb) out.push('reference');
  if (db.origin === 'book') out.push('book');
  if (db.kind === 'mygames') out.push('mygames');
  if (db.kind === 'clipboard') out.push('clipboard');
  return out;
}
