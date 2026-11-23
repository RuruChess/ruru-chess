/**
 * Γραμμές από δέντρο PGN (σχόλια, φωλιασμένες βαριάντες) όπου κάθε κίνηση πατιέται, για να δει ο χρήστης στη
 * σκακιέρα τις βαριάντες ενός σχολιαστή ή μιας λύσης. Τα ίδια και με τα βελάκια (`pgnStep`, `VariationChooser`).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { GameNode } from '../../core/game.ts';
import { isMoveNag, nagSymbol } from '../../core/nag.ts';
import { L } from '../i18n.ts';
import { displaySan, type NotationStyle } from './Notation.tsx';

/**
 * Βελάκια σε δέντρο: → η επόμενη κίνηση της γραμμής, ← η προηγούμενη, ↓ η επόμενη εναλλακτική της ίδιας κίνησης
 * (κυκλικά, μαζί με την κύρια), ↑ πίσω στη γραμμή από την οποία ξεκίνησε η βαριάντα (ένα επίπεδο).
 */
export function pgnStep(n: GameNode, key: string): GameNode {
  if (key === 'ArrowRight') return n.children[0] ?? n;
  if (key === 'ArrowLeft') return n.parent ?? n;
  if (key === 'ArrowDown') {
    const sibs = n.parent?.children ?? [n];
    return sibs[(sibs.indexOf(n) + 1) % sibs.length];
  }
  if (key === 'ArrowUp') {
    let x = n;
    while (x.parent && x.parent.children[0] === x) x = x.parent;
    return x.parent ? x.parent.children[0] : n;
  }
  return n;
}

/** Η αρχή της πιο εξωτερικής βαριάντας που περιέχει τον κόμβο (null: ο κόμβος είναι στην κύρια γραμμή). */
export function variationRoot(n: GameNode): GameNode | null {
  if (n.isMainline()) return null;
  let v = n;
  while (v.parent && !v.parent.isMainline()) v = v.parent;
  return v;
}

/** Αριθμός κίνησης και χρώμα από τη θέση πριν από την κίνηση. */
function numberOf(n: GameNode): { num: number; white: boolean } {
  const f = (n.parent?.fen ?? '').split(' ');
  return { num: Number(f[5]) || 1, white: f[1] !== 'b' };
}

/** «14.Rfd1», «13…bxc5» (τα μαύρα με αριθμό μόνο όταν ζητηθεί), με τα σύμβολα της κίνησης. */
function moveLabel(n: GameNode, force: boolean, style: NotationStyle): string {
  const { num, white } = numberOf(n);
  return `${white ? `${num}.` : force ? `${num}…` : ''}${displaySan(n.san, style)}${n.nags.filter(isMoveNag).map(nagSymbol).join('')}`;
}

/**
 * Επιλογή βαριάντας, όπως στο παράθυρο της παρτίδας: το → σε διακλάδωση δείχνει τις υποψήφιες
 * κινήσεις με τη συνέχειά τους. ↑ ↓ επιλογή, Enter / → συνέχεια, Esc / ← ακύρωση, 1–9 κατευθείαν. Κρατά την
 * εστίαση όσο είναι ανοιχτή, ώστε τα βελάκια να μη φτάνουν στην οθόνη από πίσω· κλείνει αν πατηθεί κάτι άλλο.
 */
export function VariationChooser({
  node,
  onPick,
  onClose,
  style = 'letters',
  ahead = () => 4,
  note,
}: {
  /** η θέση της διακλάδωσης: οι επιλογές είναι οι συνέχειές της */
  node: GameNode;
  onPick: (n: GameNode) => void;
  onClose: () => void;
  style?: NotationStyle;
  /** πόσες κινήσεις μετά την επιλογή φαίνονται (π.χ. όχι κινήσεις της παρτίδας που δεν έχουν φανεί ακόμη) */
  ahead?: (c: GameNode) => number;
  /** μικρή ετικέτα δίπλα στην κίνηση (π.χ. «παρτίδα») */
  note?: (c: GameNode) => string;
}) {
  const opts = node.children;
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  // στο κλείσιμο η εστίαση γυρνά εκεί που ήταν, εκτός αν ο χρήστης πάτησε κάπου αλλού
  const [before] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(
    () => () => {
      const a = document.activeElement;
      if (before?.isConnected && (!a || a === document.body)) before.focus();
    },
    [before],
  );
  useEffect(() => {
    box.current?.querySelectorAll('button')[index]?.focus();
  }, [index]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') setIndex((i) => (i + (k === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length);
    else if (k === 'Enter' || k === 'ArrowRight') onPick(opts[index]);
    else if (k === 'Escape' || k === 'ArrowLeft') onClose();
    else if (/^[1-9]$/.test(k) && Number(k) <= opts.length) onPick(opts[Number(k) - 1]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      ref={box}
      className="var-chooser"
      role="listbox"
      aria-label={L('Υποψήφιες κινήσεις', 'Candidate moves')}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      <div className="var-title">{L('Υποψήφιες κινήσεις', 'Candidate moves')}</div>
      {opts.map((c, i) => {
        const cont: string[] = [];
        for (let x = c.children[0], k = 0; x && k < ahead(c); x = x.children[0], k++) cont.push(moveLabel(x, false, style));
        const tag = note?.(c);
        return (
          <button key={c.id} type="button" role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onMouseEnter={() => setIndex(i)} onClick={() => onPick(c)}>
            <b>{moveLabel(c, true, style)}</b>
            {tag && <span className="var-note">{tag}</span>} <span className="cont">{cont.join(' ')}</span>
          </button>
        );
      })}
      <div className="var-hint">↑ ↓ · Enter · Esc</div>
    </div>
  );
}

export function PgnLine({
  first,
  withFirstAlts = false,
  current,
  onPick,
  style = 'letters',
}: {
  /** η πρώτη κίνηση της γραμμής */
  first: GameNode;
  /** και οι εναλλακτικές της πρώτης κίνησης (π.χ. όλη η λύση από τη ρίζα) */
  withFirstAlts?: boolean;
  current?: GameNode | null;
  onPick: (n: GameNode) => void;
  style?: NotationStyle;
}) {
  const move = (n: GameNode, force: boolean): ReactNode => {
    const { num, white } = numberOf(n);
    const label = white ? `${num}.` : force ? `${num}…` : '';
    return (
      <span key={`m${n.id}`} className="tx-mvw">
        {label && <span className="mn">{label}</span>}
        <button type="button" className={`tx-mv${n === current ? ' is-cur' : ''}`} onClick={() => onPick(n)} aria-current={n === current ? 'step' : undefined}>
          {displaySan(n.san, style)}
          {n.nags.filter(isMoveNag).map(nagSymbol).join('')}
        </button>
      </span>
    );
  };
  const line = (start: GameNode, withAlts: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let force = true;
    for (let n: GameNode | undefined = start; n; n = n.children[0]) {
      if (n.preComment) out.push(<span key={`p${n.id}`} className="tx-sol-c">{n.preComment}</span>);
      out.push(move(n, force));
      force = false;
      if (n.comment) {
        out.push(
          <span key={`c${n.id}`} className="tx-sol-c">
            {n.comment}
          </span>,
        );
        force = true;
      }
      // οι εναλλακτικές αυτής της κίνησης (της πρώτης μόνο αν ζητηθούν)
      const parent: GameNode | null = n.parent;
      if (parent && parent.children[0] === n && parent.children.length > 1 && (n !== start || withAlts)) {
        for (const alt of parent.children.slice(1))
          out.push(
            <span key={`v${alt.id}`} className="tx-sol-v">
              {line(alt, false)}
            </span>,
          );
        force = true;
      }
    }
    return out;
  };
  return <span className="tx-sol pgn-line">{line(first, withFirstAlts)}</span>;
}
