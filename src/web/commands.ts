/**
 * Εντολές της εφαρμογής: κάθε οθόνη δηλώνει τις δικές της (μενού, παλέτα Ctrl K) και το κέλυφος
 * τις γενικές. Οι λίστες διαβάζονται τη στιγμή που χρειάζονται, άρα είναι πάντα φρέσκες.
 */
import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Τα μενού της γραμμής μενού, με τη σειρά τους. */
export type MenuId = 'file' | 'edit' | 'analysis' | 'training' | 'export' | 'view';

export interface Command {
  id: string;
  /** τίτλος στη γλώσσα του χρήστη */
  title: string;
  /** ο τίτλος στην άλλη γλώσσα και λέξεις-κλειδιά, μόνο για την αναζήτηση */
  extra?: string[];
  /** ομάδα στην παλέτα (π.χ. «Ανάλυση») */
  group: string;
  /** σε ποιο μενού μπαίνει (χωρίς: μόνο στην παλέτα) */
  menu?: MenuId;
  /** υπομενού μέσα στο μενού (π.χ. «Συντήρηση» για τις επικίνδυνες ενέργειες) */
  submenu?: string;
  icon?: LucideIcon;
  /** συντόμευση για εμφάνιση (π.χ. «Ctrl+Shift+A»)· το πλήκτρο το χειρίζεται η οθόνη */
  keys?: string;
  run: () => void;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
}

type Provider = () => Command[];

/** Πάροχοι εντολών ανά περιοχή (π.χ. 'global', ή το id της ενεργής καρτέλας). */
const providers = new Map<string, Provider>();

export function registerCommands(scope: string, provider: Provider): () => void {
  providers.set(scope, provider);
  return () => {
    if (providers.get(scope) === provider) providers.delete(scope);
  };
}

/** Όλες οι εντολές τώρα: πρώτα της ενεργής οθόνης, μετά οι γενικές. */
export function allCommands(activeScope: string | null): Command[] {
  const out: Command[] = [];
  if (activeScope) out.push(...(providers.get(activeScope)?.() ?? []));
  for (const [scope, p] of providers) if (scope !== activeScope && scope.startsWith('global')) out.push(...p());
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/**
 * Δηλώνει τις εντολές μιας οθόνης όσο είναι ενεργή. Η συνάρτηση μπορεί να αλλάζει σε κάθε
 * απόδοση: η παλέτα καλεί πάντα την τελευταία.
 */
export function useCommandScope(scope: string, active: boolean, build: Provider): void {
  const ref = useRef(build);
  ref.current = build;
  useEffect(() => {
    if (!active) return;
    return registerCommands(scope, () => ref.current());
  }, [scope, active]);
}

/** «Ctrl+Shift+A» → ['Ctrl', 'Shift', 'A'] (για τα πλήκτρα `kbd`). */
export function splitKeys(keys: string): string[] {
  if (keys === '+') return ['+'];
  return keys
    .split(/\+(?=.)/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Ταιριάζει το πάτημα με συντόμευση της μορφής «Ctrl+Shift+A» (το Cmd του Mac μετρά ως Ctrl). */
export function matchesKeys(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, keys: string): boolean {
  const parts = splitKeys(keys);
  const want = { ctrl: false, shift: false, alt: false };
  let key = '';
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'ctrl') want.ctrl = true;
    else if (l === 'shift') want.shift = true;
    else if (l === 'alt') want.alt = true;
    else key = p;
  }
  if ((e.ctrlKey || e.metaKey) !== want.ctrl || e.altKey !== want.alt) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const target = key === 'Space' ? ' ' : key.length === 1 ? key.toLowerCase() : key;
  // χαρακτήρες που θέλουν Shift για να γραφτούν (?, !) δεν ελέγχουν το Shift
  if (key.length === 1 && !/[a-z0-9]/i.test(key)) return k === target;
  return e.shiftKey === want.shift && k === target;
}
