/** Πηγή «Τα λάθη μου» και τράπουλα FSRS της Τράπεζας λαθών: τα σοβαρά λάθη του χρήστη από τις αναλυμένες παρτίδες του γίνονται puzzles της Τακτικής. */
import { saveSource } from './catalog.ts';
import { storeCollection, type CollectionReport } from './collections.ts';
import type { Tactics } from './context.ts';
import { otherId } from './pack.ts';
import type { TacticsService } from './service.ts';
import { SOURCE_BY_KEY, type SourceDef } from './sources.ts';
import { F_INACTIVE, F_OWN } from './store.ts';

export const MINE_KEY = 'mine';

/** Η πηγή «Τα λάθη μου» (σταθερό id 60 στο sources.ts). */
export function mineSource(): SourceDef {
  const def = SOURCE_BY_KEY.get(MINE_KEY);
  if (!def) throw new Error('Λείπει η πηγή «Τα λάθη μου»');
  return def;
}

/** Μία κάρτα λάθους όπως την παραδίδει η ανασκόπηση. */
export interface OwnMistake {
  /** σταθερό id του λάθους (γίνεται id του puzzle: 1e9 + 60·1e7 + id) */
  id: number;
  /** θέση έναρξης: μία κίνηση πριν από το λάθος (με `pre`) */
  fen: string;
  /** γραμμή σε UCI: η κίνηση του αντιπάλου (με `pre`) και η λύση */
  line: string[];
  pre: boolean;
  /** θέματα (κλειδιά του puzzle-themes.json): φάση, μοτίβα */
  themes: string[];
  rating: number;
  /** στοιχεία της παρτίδας για τον λύτη (παίκτες, ημερομηνία, η κίνηση που παίχτηκε…) */
  meta: Record<string, unknown>;
}

/** Το id του puzzle ενός λάθους. */
export const mistakePuzzleId = (mistakeId: number): number => otherId(mineSource().id, mistakeId);

/**
 * Γράφει όλα τα λάθη του χρήστη ως την πηγή «Τα λάθη μου» (upsert με σταθερά ids· όσα δεν υπάρχουν
 * πια σβήνονται ή γίνονται ανενεργά, αν έχουν ιστορικό) και κάνει την τράπουλα «Τα λάθη μου» να έχει
 * ακριβώς αυτές τις κάρτες (οι νέες είναι για σήμερα, οι παλιές κρατούν το FSRS τους). Πρέπει να τρέχει
 * μέσα στην ουρά εργασιών της Τακτικής (μία εγγραφή στη puzzles.sqlite τη φορά).
 */
export async function storeOwnMistakes(t: Tactics, svc: TacticsService, items: readonly OwnMistake[]): Promise<{ report: CollectionReport; deck: number; added: number; removed: number; active: number }> {
  const def = mineSource();
  const report = await storeCollection(
    t,
    def,
    items.map((m) => ({ seq: m.id, fen: m.fen, line: m.line, pre: m.pre, themes: m.themes, rating: m.rating, meta: m.meta, flags: F_OWN })),
  );
  saveSource(t.puzzles, def, { version: new Date().toISOString().slice(0, 10), info: { report: { ...report, samples: undefined } } });
  // οι κάρτες με τη σειρά των λαθών (τα νεότερα πρώτα, όπως δίνονται)
  const active = new Set((t.puzzles.prep(`SELECT id FROM puzzle WHERE source_id = ? AND source_id <> 1 AND (flags & ${F_INACTIVE}) = 0`).all(def.id) as Array<{ id: number }>).map((r) => r.id));
  const ids = items.map((m) => otherId(def.id, m.id)).filter((id) => active.has(id));
  const deck = svc.mistakesDeck();
  const { added, removed } = svc.setDeckPuzzles(deck, ids);
  t.puzzlesChanged();
  return { report, deck, added, removed, active: ids.length };
}
