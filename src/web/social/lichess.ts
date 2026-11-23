/**
 * Οι φίλοι στο Lichess (Watch Live, φάση 2): ποιος παίζει τώρα και ποια παρτίδα.
 * Polling κάθε 60″, μόνο όσο φαίνεται η στήλη «Φίλοι» και το παράθυρο δεν είναι κρυμμένο (και όχι αν το Watch Live
 * είναι κλειστό στις ρυθμίσεις). Ο αριθμός κίνησης ζητιέται μόνο με το ποντίκι πάνω στον φίλο.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '../api.ts';
import { L } from '../i18n.ts';
import { newTabId, useApp } from '../store.ts';
import { useSocial } from './social.ts';
import { loadLichess, useLichess } from '../watch/account.ts';

export interface LichessGame {
  /** null: το Lichess είπε μόνο ότι παίζει (χωρίς την παρτίδα) */
  id: string | null;
  clock: string | null;
  variant: string;
}

export interface LichessStatus {
  id: string;
  online: boolean;
  playing?: LichessGame;
}

interface GameInfo {
  move: number;
  white: string | null;
  black: string | null;
  at: number;
}

interface LichessFriends {
  /** username (μικρά) → κατάσταση */
  users: Record<string, LichessStatus>;
  /** παρτίδα → αριθμός κίνησης και παίκτες (cache ενός λεπτού) */
  games: Record<string, GameInfo>;
}

export const useLichessFriends = create<LichessFriends>(() => ({ users: {}, games: {} }));

const POLL = 60_000;

/**
 * Ρωτά το Lichess για αυτά τα usernames όσο το component που το καλεί φαίνεται (`active`: η στήλη «Φίλοι» ή το
 * Watch Live). Αν φαίνονται και τα δύο, ο server απαντά το δεύτερο από την cache του.
 */
export function useLichessPoll(names: string[], active = true): void {
  const enabled = useApp((s) => s.settings?.watchLive !== false);
  const key = [...new Set(names.map((n) => n.toLowerCase()))].sort().join(',');
  useEffect(() => {
    if (!enabled) {
      useLichessFriends.setState({ users: {} });
      return;
    }
    if (!key || !active) return;
    let last = 0;
    let stop = false;
    const poll = () => {
      if (stop || document.hidden || Date.now() - last < POLL - 2000) return;
      last = Date.now();
      api
        .get<{ users: LichessStatus[] }>(`/api/watch/friends?ids=${encodeURIComponent(key)}`)
        .then((r) => {
          if (!stop) useLichessFriends.setState({ users: Object.fromEntries(r.users.map((u) => [u.id, u])) });
        })
        // σιωπηλά (π.χ. 429 ή χωρίς internet): ξανά στο επόμενο λεπτό
        .catch(() => {});
    };
    poll();
    const t = setInterval(poll, 10_000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [enabled, key, active]);
}

const loading = new Set<string>();

/** Αριθμός κίνησης και παίκτες μιας παρτίδας (μία φορά το λεπτό το πολύ). */
export function loadGameInfo(game: string): void {
  const g = useLichessFriends.getState().games[game];
  if ((g && Date.now() - g.at < POLL) || loading.has(game)) return;
  loading.add(game);
  api
    .get<{ move: number; white: string | null; black: string | null }>(`/api/watch/moves/${game}`)
    .then((r) => useLichessFriends.setState((s) => ({ games: { ...s.games, [game]: { move: r.move, white: r.white, black: r.black, at: Date.now() } } })))
    .catch(() => {})
    .finally(() => loading.delete(game));
}

const VARIANTS: Record<string, string> = { chess960: 'Chess960', crazyhouse: 'Crazyhouse', antichess: 'Antichess', atomic: 'Atomic', horde: 'Horde', kingOfTheHill: 'King of the Hill', racingKings: 'Racing Kings', threeCheck: 'Three-check' };

/** «Παίζει 3+2 στο Lichess · κίνηση 15» και ότι η live σκακιέρα δείχνει την παρτίδα 3 κινήσεις πίσω. */
export function lichessGameText(g: LichessGame, move?: number): string {
  const variant = g.variant === 'fromPosition' ? L('από θέση', 'from position') : VARIANTS[g.variant];
  const what = [g.clock, variant].filter(Boolean).join(' ');
  const head = what ? L(`Παίζει ${what} στο Lichess`, `Playing ${what} on Lichess`) : L('Παίζει στο Lichess', 'Playing on Lichess');
  const mv = move && move > 1 ? L(` · κίνηση ${move}`, ` · move ${move}`) : '';
  const tail = g.id ? L('\n👁 Παρακολούθηση: το Lichess δείχνει τις παρτίδες σε εξέλιξη 3 κινήσεις πίσω.', '\n👁 Watch: Lichess shows games in progress 3 moves behind.') : '';
  return head + mv + tail;
}

/** Το δικό μου Lichess: όπως το δήλωσα στους Φίλους, αλλιώς ο λογαριασμός της «Σύνδεσης με Lichess». */
export function useMyLichess(): string | null {
  const declared = useSocial((s) => s.myAcc?.lichess ?? null);
  const connected = useLichess((s) => (s.connected && s.username && s.username !== '?' ? s.username : null));
  useEffect(() => loadLichess(), []);
  return declared ?? connected;
}

/** Live σκακιέρα της παρτίδας του φίλου (με τα κομμάτια του από κάτω, αν ξέρουμε ήδη ότι παίζει με τα μαύρα). */
export function watchLichessGame(lichessUser: string, g: LichessGame): void {
  if (!g.id) return;
  const info = useLichessFriends.getState().games[g.id];
  const black = Boolean(info?.black && info.black === lichessUser.toLowerCase());
  useApp.getState().openTab({ id: newTabId('live'), kind: 'game', title: `${lichessUser} · Lichess`, live: { game: g.id }, ...(black ? { orientation: 'black' as const } : {}) });
}

export const lichessProfile = (u: string) => `https://lichess.org/@/${encodeURIComponent(u)}`;
export const chesscomProfile = (u: string) => `https://www.chess.com/member/${encodeURIComponent(u)}`;
