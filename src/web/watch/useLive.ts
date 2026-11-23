/**
 * Live σκακιέρα (Watch Live): το παράθυρο παρτίδας παίρνει τις κινήσεις από τον server (SSE `/api/watch/live`)
 * και τις βάζει στην κύρια γραμμή. Οι βαριάντες, τα σχόλια και η μηχανή του χρήστη μένουν· αν ο χρήστης είναι
 * στην τελευταία live κίνηση, ακολουθεί τις νέες: όταν φτάνουν πολλές μαζί, παίζονται μία-μία με το animation
 * της σκακιέρας (πάνω από `STEP_MAX` ή σε κρυφό παράθυρο: άλμα). Στο τέλος της παρτίδας η σύνδεση κλείνει
 * και η σκακιέρα μένει.
 */
import { useEffect, useRef, useState } from 'react';
import { liveClocks, mergeLive, pathBetween, type LiveClocks } from '../../core/live.ts';
import { parseGames } from '../../core/pgn.ts';
import type { GameNode } from '../../core/game.ts';
import type { GameController } from '../gameModel.ts';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';

/** Ως τόσες ημικινήσεις που περιμένουν παίζονται μία-μία· περισσότερες (π.χ. γύρισες μετά από ώρα): άλμα στην τελευταία. */
const STEP_MAX = 6;
/** παύση μετά το animation κάθε κίνησης, ώστε να φαίνεται πριν από την επόμενη */
const STEP_PAUSE_MS = 450;

/** Από πού έρχεται η live παρτίδα: παρτίδα του Lichess (`game`) ή παρτίδα ενός γύρου broadcast (`round` + `game`). */
export interface LiveSource {
  game: string;
  round?: string;
}

export interface LiveState {
  status: 'connecting' | 'live' | 'ended' | 'error';
  /** κωδικός σφάλματος του server (rate, auth, notfound, busy, disabled, net) */
  error?: string;
  clocks: LiveClocks | null;
  /** πότε ήρθε η τελευταία κατάσταση (από εκεί μετρά το ρολόι αυτού που παίζει) */
  at: number;
  /** κινήσεις στη live γραμμή */
  plies: number;
}

export function liveError(code: string | undefined): string {
  switch (code) {
    case 'rate':
      return L('Το Lichess ζήτησε να περιμένουμε ένα λεπτό.', 'Lichess asked us to wait a minute.');
    case 'auth':
      return L('Τα τουρνουά θέλουν «Σύνδεση με Lichess».', 'Tournaments need “Connect Lichess”.');
    case 'notfound':
      return L('Η παρτίδα δεν βρέθηκε στο Lichess.', 'The game was not found on Lichess.');
    case 'busy':
      return L('Πάρα πολλές live σκακιέρες ανοιχτές· κλείσε κάποια.', 'Too many live boards open; close one.');
    case 'disabled':
      return L('Τα Ζωντανά είναι κλειστά στις ρυθμίσεις.', 'Watch Live is turned off in the settings.');
    default:
      return L('Δεν υπάρχει σύνδεση με το Lichess.', 'No connection to Lichess.');
  }
}

/** Ο χρόνος που μένει σε κάθε πλευρά τώρα (το ρολόι αυτού που παίζει τρέχει όσο η παρτίδα είναι live). */
export function liveRemaining(st: LiveState, side: 'w' | 'b', now = Date.now()): number | null {
  const c = st.clocks;
  const v = c?.[side];
  if (v === null || v === undefined) return null;
  // στο Lichess το ρολόι ξεκινά αφού παίξουν και οι δύο την πρώτη τους κίνηση
  if (st.status !== 'live' || c!.turn !== side || st.plies < 2) return v;
  return Math.max(0, v - (now - st.at));
}

/** Ο κόμβος της κύριας γραμμής σε αυτή την ημικίνηση (μετά από «Αναίρεση» το δέντρο είναι καινούργιο). */
function mainAt(ctrl: GameController, ply: number): GameNode {
  let n = ctrl.game.root;
  while (n.ply < ply && n.children.length) n = n.children[0];
  return n;
}

export function useLive(src: LiveSource | undefined, ctrl: GameController): { state: LiveState | null; retry: () => void; toLive: (() => void) | null; newMoves: number; latestMove: string | null } {
  const [state, setState] = useState<LiveState | null>(src ? { status: 'connecting', clocks: null, at: 0, plies: 0 } : null);
  const [seq, setSeq] = useState(0);
  const [newMoves, setNewMoves] = useState(0);
  const end = useRef<GameNode | null>(null);
  const [, setTick] = useState(0);
  /** αναπαραγωγή: η κίνηση που έδειξε τελευταία (null: δεν παίζει) και το χρονόμετρο της επόμενης */
  const shown = useRef<GameNode | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const liveTarget = () => (end.current ? mainAt(ctrl, end.current.ply) : null);
  /** ο χρήστης ακολουθεί ακόμη την αναπαραγωγή: στην κίνηση που έδειξε, ή πιο μπροστά στη live γραμμή με τα βελάκια */
  const following = () => {
    const s = shown.current;
    if (!s) return false;
    if (ctrl.node === s) return true;
    const t = liveTarget();
    return t !== null && pathBetween(s, ctrl.node) !== null && pathBetween(ctrl.node, t) !== null;
  };

  /** Μία κίνηση προς το τέλος της live γραμμής και, αν μένουν κι άλλες, η επόμενη μετά το animation και μια παύση. */
  const step = () => {
    timer.current = undefined;
    const target = liveTarget();
    const path = target && following() ? pathBetween(ctrl.node, target) : [];
    // έφτασε στο τέλος, ή ο χρήστης πήγε σε άλλη κίνηση: δεν τον ενοχλούμε
    if (!target || path?.length === 0) {
      shown.current = null;
      return;
    }
    // null: η live γραμμή άλλαξε πιο πίσω (διόρθωση του broadcast)· πολλές μαζί ή κρυφό παράθυρο: άλμα
    const next = !path || path.length > STEP_MAX || document.hidden ? target : path[0];
    shown.current = next === target ? null : next;
    ctrl.goTo(next);
    if (shown.current) timer.current = setTimeout(step, (useApp.getState().settings?.animationMs ?? 250) + STEP_PAUSE_MS);
  };
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    shown.current = null;
  };

  useEffect(() => {
    if (!src) return;
    setState((s) => ({ clocks: null, at: 0, plies: 0, ...s, status: 'connecting', error: undefined }));
    const qs = new URLSearchParams({ game: src.game, ...(src.round ? { round: src.round } : {}) });
    const es = new EventSource(`/api/watch/live?${qs}`);
    es.addEventListener('game', (ev) => {
      const snap = JSON.parse((ev as MessageEvent<string>).data) as { pgn: string; ended: boolean; at: number };
      const parsed = parseGames(snap.pgn)[0];
      if (!parsed) return;
      const first = !end.current;
      const prevPly = end.current?.ply ?? 0;
      const atEnd = first || ctrl.node === mainAt(ctrl, prevPly) || following();
      if (ctrl.game.root.fen !== parsed.game.root.fen) {
        // άλλη αρχική θέση (παρτίδα από θέση): η live παρτίδα όπως είναι
        stop();
        ctrl.load(parsed.game);
        let n = ctrl.game.root;
        while (n.children.length) n = n.children[0];
        end.current = n;
        ctrl.goTo(n);
        setNewMoves(0);
      } else {
        const r = mergeLive(ctrl.game, parsed.game);
        end.current = r.end;
        if (r.changed) ctrl.emit();
        // στο άνοιγμα κατευθείαν η τρέχουσα θέση· μετά οι νέες κινήσεις μία-μία (αν ήδη παίζονται, μπαίνουν στη σειρά)
        if (atEnd && ctrl.node !== r.end) {
          setNewMoves(0);
          if (first) ctrl.goTo(r.end);
          else if (timer.current === undefined) {
            shown.current = ctrl.node;
            step();
          }
        } else if (!atEnd && r.end.ply > prevPly) {
          setNewMoves((c) => c + (r.end.ply - prevPly));
        }
      }
      setState({ status: snap.ended ? 'ended' : 'live', clocks: liveClocks(end.current, ctrl.game.headers), at: snap.at, plies: end.current.ply });
      if (snap.ended) es.close();
    });
    es.addEventListener('fail', (ev) => {
      const { code } = JSON.parse((ev as MessageEvent<string>).data) as { code: string };
      es.close();
      setState((s) => ({ clocks: null, at: 0, plies: 0, ...s, status: 'error', error: code }));
    });
    // ο EventSource ξανασυνδέεται μόνος του· αν τα παράτησε (π.χ. ο server απάντησε με σφάλμα), λάθος σύνδεσης
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setState((s) => (s?.status === 'ended' || s?.status === 'error' ? s : { clocks: null, at: 0, plies: 0, ...s, status: 'error', error: 'net' }));
    };
    return () => {
      es.close();
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src?.game, src?.round, seq]);

  // το ρολόι αυτού που παίζει
  const ticking = state?.status === 'live' && state.clocks !== null;
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [ticking]);

  const liveEnd = liveTarget();
  const atLive = Boolean(liveEnd && (ctrl.node === liveEnd || following()));
  useEffect(() => {
    if (atLive && newMoves) setNewMoves(0);
  }, [atLive, newMoves]);
  const latestMove =
    liveEnd && !liveEnd.isRoot
      ? `${liveEnd.moveNumber(ctrl.game.startFullmove, ctrl.game.startTurn)}${liveEnd.whiteMoved(ctrl.game.startTurn) ? '.' : '…'}${liveEnd.san}`
      : null;
  // όσο παίζονται κινήσεις δεν χρειάζεται το «Στο live» (θα αναβόσβηνε σε κάθε κίνηση)
  const toLive =
    liveEnd && !atLive
      ? () => {
          stop();
          setNewMoves(0);
          ctrl.goTo(liveEnd);
        }
      : null;
  return { state, retry: () => setSeq((x) => x + 1), toLive, newMoves: atLive ? 0 : newMoves, latestMove };
}
