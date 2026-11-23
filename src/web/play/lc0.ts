/** Το Lc0 στον server (Leela και Maia): κατάσταση, λήψη, ακύρωση και αφαίρεση, κοινά για όλα τα παράθυρα. */
import { useEffect, useState } from 'react';
import { api, onServerEvent } from '../api.ts';
import { reportError, useApp } from '../store.ts';

export interface Lc0Status {
  state: { status: 'downloading' | 'installing' | 'done' | 'error' | 'cancelled'; step: 'lc0' | 'leela' | 'maia' | 'check' | 'register'; got: number; total: number; error?: string } | null;
  version: string;
  /** το όνομα του δικτύου της Leela */
  net: string;
  /** περίπου πόσα bytes κατεβαίνουν */
  bytes: number;
  /** το id της μηχανής Leela (αν έχει εγκατασταθεί) */
  leela: string | null;
  /** οι μηχανές Maia */
  maia: Array<{ id: string; elo: number }>;
  dir: string;
}

let cache: Lc0Status | null = null;
const subs = new Set<(s: Lc0Status) => void>();
let started = false;

function publish(s: Lc0Status): void {
  cache = s;
  for (const f of subs) f(s);
}

function ensure(): void {
  if (started) return;
  started = true;
  api
    .get<Lc0Status>('/api/lc0')
    .then(publish)
    .catch(() => {});
  onServerEvent('lc0', (s: Lc0Status) => {
    publish(s);
    // οι νέες μηχανές μπήκαν στις ρυθμίσεις
    if (s.state?.status === 'done') void useApp.getState().loadSettings().catch(() => {});
  });
}

/** Η κατάσταση του Lc0 (null μέχρι να απαντήσει ο server). */
export function useLc0(): Lc0Status | null {
  const [s, setS] = useState<Lc0Status | null>(cache);
  useEffect(() => {
    ensure();
    subs.add(setS);
    if (cache) setS(cache);
    return () => {
      subs.delete(setS);
    };
  }, []);
  return s;
}

export const installLc0 = () => {
  api
    .post<Lc0Status>('/api/lc0/install', {})
    .then(publish)
    .catch(reportError);
};

export const cancelLc0 = () => {
  api.post('/api/lc0/cancel', {}).catch(reportError);
};

export const removeLc0 = () => {
  api
    .del<Lc0Status>('/api/lc0')
    .then((s) => {
      publish(s);
      void useApp.getState().loadSettings().catch(() => {});
    })
    .catch(reportError);
};
