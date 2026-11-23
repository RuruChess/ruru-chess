/**
 * Βελτίωση βάσης (ImproveDB, τοπικά): ενοποίηση παραλλαγών ονομάτων παικτών και
 * συμπλήρωση Elo / FIDE ID από την ίδια τη βάση ή από βάση αναφοράς. Πρώτα ανάλυση
 * (χωρίς αλλαγές), μετά εφαρμογή μόνο όσων κράτησε ο χρήστης.
 */
import { eloNear, isVariantOf, matchReference, parseName, sameForm, unifyNames, untidy, type NameCount, type NameParts, type Rename } from '../core/improve.ts';
import type { GameDatabase } from './db/store.ts';
import { searchKey } from './text.ts';

export interface ImproveOptions {
  names: boolean;
  elo: boolean;
  fide: boolean;
}

export interface PlannedRename extends Rename {
  games: number;
  /** ενοποίηση μέσα στη βάση ή γραφή της βάσης αναφοράς */
  source: 'db' | 'ref';
  /** μόνο γραφή (κεφαλαία, τελείες, παύλες…) ή συμπλήρωση ονόματος (αρχικά → πλήρες) */
  kind: 'spelling' | 'complete';
}

export interface RenamePlan {
  renames: PlannedRename[];
  ambiguous: number;
  /** τελικό όνομα → όνομα στην αναφορά (για Elo / FIDE ID στην προεπισκόπηση) */
  refByFinal: Map<string, string>;
  /** όνομα → όνομα στην αναφορά, όταν διαφέρει μόνο η γραφή (ισχύει και χωρίς μετονομασία) */
  spelling: Map<string, string>;
}

export interface Fills {
  elo: Array<{ id: number; side: 'w' | 'b'; elo: number; player: string; date: number; source: 'db' | 'ref' }>;
  fide: Array<{ player: string; fideId: string; source: 'db' | 'ref'; games: Array<{ id: number; side: 'w' | 'b' }> }>;
}

/** Πρόοδος· επιστρέφει αφού δώσει σειρά στον server (και πετά αν ακυρώθηκε). */
export type Tick = (done: number, total: number, message: string) => Promise<void>;

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
};

/**
 * Προτάσεις μετονομασίας: πρώτα ενοποίηση μέσα στη βάση, μετά (με βάση αναφοράς) η
 * γραφή της αναφοράς, εκτός αν είναι «θορυβώδης». Κάθε αρχικό όνομα πάει κατευθείαν
 * στο τελικό.
 */
export async function planRenames(target: GameDatabase, ref: GameDatabase | null, unify: boolean, tick: Tick): Promise<RenamePlan> {
  const list: NameCount[] = [...target.playerGameCounts()].map(([name, games]) => ({ name, games }));
  const first = new Map<string, string>();
  const unified = unifyNames(list);
  if (unify) for (const r of unified.renames) first.set(r.from, r.to);

  // όνομα (μετά την ενοποίηση) → όνομα στην αναφορά
  const second = new Map<string, string>();
  if (ref) {
    const groups = new Map<string, Array<{ id: number; name: string; p: NameParts }>>();
    const counts = new Map<number, number>();
    const names = [...new Set(list.map((n) => first.get(n.name) ?? n.name))];
    for (let i = 0; i < names.length; i++) {
      if (i % 500 === 0) await tick(i, names.length, 'Ονόματα: σύγκριση με τη βάση αναφοράς');
      const name = names[i];
      const p = parseName(name);
      if (!p) continue;
      let g = groups.get(p.sur);
      if (!g) {
        g = [];
        for (const r of ref.playersByKeyPrefix(searchKey(p.sur) + ',')) {
          const rp = parseName(r.name);
          if (rp?.sur === p.sur) g.push({ ...r, p: rp });
        }
        groups.set(p.sur, g);
      }
      // παρτίδες μόνο για τις συμβατές μορφές (οι ομάδες επωνύμων της αναφοράς είναι μεγάλες)
      const cands: NameCount[] = [];
      for (const r of g) {
        if (!isVariantOf(p, r.p)) continue;
        let n = counts.get(r.id);
        if (n === undefined) counts.set(r.id, (n = ref.playerGames(r.id)));
        cands.push({ name: r.name, games: n });
      }
      const m = matchReference(name, cands);
      if (m && m !== name) second.set(name, m);
    }
  }

  const renames: PlannedRename[] = [];
  const refByFinal = new Map<string, string>();
  const spelling = new Map<string, string>();
  for (const n of list) {
    const a = first.get(n.name) ?? n.name;
    const r = second.get(a);
    const b = unify && r && !untidy(r) ? r : a;
    // ταυτότητα στην αναφορά: όταν μετονομάζεται εκεί ή διαφέρει μόνο η γραφή
    if (r && (b === r || sameForm(a, r))) refByFinal.set(b, r);
    if (r && sameForm(a, r)) spelling.set(a, r);
    if (b !== n.name) renames.push({ from: n.name, to: b, games: n.games, source: b !== a ? 'ref' : 'db', kind: sameForm(n.name, b) ? 'spelling' : 'complete' });
  }
  renames.sort((x, y) => x.to.localeCompare(y.to) || y.games - x.games);
  return { renames, ambiguous: unify ? unified.ambiguous.length : 0, refByFinal, spelling };
}

/**
 * Συμπληρώσεις Elo / FIDE ID, με τα ονόματα όπως θα είναι μετά το `rename`. Elo: το
 * πιο κοντινό (≤6 μήνες) από τις παρτίδες του ίδιου παίκτη στη βάση, αλλιώς στην
 * αναφορά. FIDE ID: από τις ετικέτες της βάσης (αν είναι ένα), αλλιώς από την αναφορά.
 */
export async function computeFills(
  target: GameDatabase,
  ref: GameDatabase | null,
  rename: ReadonlyMap<string, string>,
  refName: ReadonlyMap<string, string>,
  opts: ImproveOptions,
  tick: Tick,
): Promise<Fills> {
  const names = target.playerNames();
  const finalOf = (id: number) => {
    const n = names.get(id) ?? '';
    return rename.get(n) ?? n;
  };
  const group = new Map<string, number[]>();
  for (const [id, n] of names) push(group, rename.get(n) ?? n, id);
  const refIds = new Map<string, number | null>();
  const refOf = (name: string): number | null => {
    if (!ref) return null;
    if (!refIds.has(name)) refIds.set(name, ref.playerIdByName(refName.get(name) ?? name));
    return refIds.get(name)!;
  };
  const fills: Fills = { elo: [], fide: [] };

  if (opts.elo) {
    const need = new Map<string, Array<{ id: number; side: 'w' | 'b'; date: number }>>();
    for (const g of target.missingElo()) {
      if (!g.welo && g.white) push(need, finalOf(g.white), { id: g.id, side: 'w', date: g.date });
      if (!g.belo && g.black) push(need, finalOf(g.black), { id: g.id, side: 'b', date: g.date });
    }
    let i = 0;
    for (const [player, list] of need) {
      if (i++ % 200 === 0) await tick(i, need.size, 'Elo');
      const own = (group.get(player) ?? []).flatMap((id) => target.eloHistory(id));
      const rid = refOf(player);
      const theirs = rid !== null ? ref!.eloHistory(rid) : [];
      for (const m of list) {
        const mine = eloNear(own, m.date);
        const elo = mine || eloNear(theirs, m.date);
        if (elo) fills.elo.push({ ...m, elo, player, source: mine ? 'db' : 'ref' });
      }
    }
  }

  if (opts.fide) {
    const known = new Map<string, Set<string>>();
    const lacking = new Map<string, Array<{ id: number; side: 'w' | 'b' }>>();
    let i = 0;
    for (const g of target.fideTags()) {
      if (i++ % 5000 === 0) await tick(i, 0, 'FIDE ID: ετικέτες της βάσης');
      for (const [pid, v, side] of [
        [g.white, g.wf, 'w'],
        [g.black, g.bf, 'b'],
      ] as const) {
        if (!pid) continue;
        const player = finalOf(pid);
        if (!v) push(lacking, player, { id: g.id, side });
        else {
          const s = known.get(player);
          if (s) s.add(v);
          else known.set(player, new Set([v]));
        }
      }
    }
    i = 0;
    for (const [player, games] of lacking) {
      if (i++ % 200 === 0) await tick(i, lacking.size, 'FIDE ID');
      const own = known.get(player);
      // διαφορετικά FIDE ID για το ίδιο όνομα: δύο παίκτες, όχι συμπλήρωση
      if (own && own.size !== 1) continue;
      const rid = own ? null : refOf(player);
      const fideId = own ? [...own][0] : rid !== null ? ref!.fideIdOf(rid) : '';
      if (fideId) fills.fide.push({ player, fideId, source: own ? 'db' : 'ref', games });
    }
  }
  return fills;
}
