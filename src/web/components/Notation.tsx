/** Σημειογραφία παρτίδας: κύρια γραμμή, βαριάντες σε εσοχές, σχόλια, σύμβολα. */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { L } from '../i18n.ts';
import type { GameNode } from '../../core/game.ts';
import { isMoveNag, isPrefixNag, nagSymbol } from '../../core/nag.ts';
import { type GameController, useController } from '../gameModel.ts';

export type NotationStyle = 'figurine' | 'letters' | 'greek';

const FIGURINES: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const GREEK: Record<string, string> = { K: 'Ρ', Q: 'Β', R: 'Π', B: 'Α', N: 'Ι' };

export function displaySan(san: string, style: NotationStyle): string {
  if (style === 'letters') return san;
  const map = style === 'figurine' ? FIGURINES : GREEK;
  return san.replace(/[KQRBN]/g, (c) => map[c] ?? c);
}

interface Props {
  ctrl: GameController;
  style: NotationStyle;
  onMoveContext?: (node: GameNode, x: number, y: number) => void;
  onEditComment?: (node: GameNode, before: boolean) => void;
  /** εκπαίδευση: μόνο οι κινήσεις ως την τρέχουσα, χωρίς βαριάντες */
  hideFuture?: boolean;
  /** μάθημα: η κύρια γραμμή ως αυτή την ημικίνηση (με τα σχόλια και τις βαριάντες της), η συνέχεια κρυφή */
  revealPly?: number;
}

export function Notation({ ctrl, style, onMoveContext, onEditComment, hideFuture, revealPly }: Props) {
  useController(ctrl);
  const game = ctrl.game;
  const current = ctrl.node;
  const ref = useRef<HTMLDivElement>(null);
  // κλειστές βαριάντες (▸): φαίνεται μόνο η πρώτη κίνηση· ανοίγει μόνη της όταν η τρέχουσα κίνηση είναι πιο μέσα
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  const onPath = new Set<number>();
  for (let n: GameNode | null = current; n; n = n.parent) onPath.add(n.id);
  const inside = (alt: GameNode) => onPath.has(alt.id) && current !== alt;
  // κλείσιμο με την τρέχουσα κίνηση μέσα: πάει στην πρώτη κίνηση της βαριάντας, που μένει ορατή
  const toggle = (alt: GameNode, shut: boolean) => {
    if (!shut && inside(alt)) ctrl.goTo(alt);
    setClosed((s) => {
      const next = new Set(s);
      if (shut) next.delete(alt.id);
      else next.add(alt.id);
      return next;
    });
  };
  const size = (n: GameNode): number => n.children.reduce((s, c) => s + size(c), 1);

  useEffect(() => {
    const el = ref.current?.querySelector('.move.current');
    el?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const moveSpan = (n: GameNode, force: boolean): ReactNode => {
    const white = n.whiteMoved(game.startTurn);
    const num = n.moveNumber(game.startFullmove, game.startTurn);
    const label = white ? `${num}.` : force ? `${num}...` : '';
    const moveNags = n.nags.filter(isMoveNag);
    const posNags = n.nags.filter((g) => !isMoveNag(g) && !isPrefixNag(g));
    const preNags = n.nags.filter(isPrefixNag);
    return (
      <Fragment key={n.id}>
        {n.preComment && (
          <span className="comment pre" onDoubleClick={() => onEditComment?.(n, true)}>
            {n.preComment}{' '}
          </span>
        )}
        {preNags.map((g) => (
          <span key={g} className="nag pos pre">
            {nagSymbol(g)}{' '}
          </span>
        ))}
        <span
          className={`move${n === current ? ' current' : ''}${n.isMainline() ? ' main' : ''}`}
          onClick={() => ctrl.goTo(n)}
          onContextMenu={(e) => {
            e.preventDefault();
            ctrl.goTo(n);
            onMoveContext?.(n, e.clientX, e.clientY);
          }}
          title={n.evalText ? `[%eval ${n.evalText}]` : undefined}
        >
          {label && <span className="num">{label}</span>}
          {displaySan(n.san, style)}
          {moveNags.map((g) => (
            <span key={g} className="nag">
              {nagSymbol(g)}
            </span>
          ))}
        </span>
        {posNags.map((g) => (
          <span key={g} className="nag pos">
            {nagSymbol(g)}
          </span>
        ))}
        {(n.comment || n.clock || n.evalText) && (
          <span className="comment" onDoubleClick={() => onEditComment?.(n, false)}>
            {n.evalText && <span className="eval-tag">{formatEvalTag(n.evalText)}</span>}
            {n.clock && <span className="clock-tag">⏱ {n.clock}</span>}
            {n.comment}
          </span>
        )}{' '}
      </Fragment>
    );
  };

  const line = (parent: GameNode, depth: number, firstForce: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let n = parent;
    let force = firstForce;
    while (n.children.length) {
      const main = n.children[0];
      if (depth === 0 && revealPly !== undefined && main.ply > revealPly) {
        out.push(
          <span key="hidden" className="hidden-moves">
            …
          </span>,
        );
        break;
      }
      out.push(moveSpan(main, force));
      force = Boolean(main.comment);
      if (n.children.length > 1) {
        out.push(
          <div key={`v${main.id}`} className={`variations d${Math.min(depth + 1, 6)}`}>
            {n.children.slice(1).map((alt) => {
              const more = size(alt) - 1;
              const shut = more > 0 && closed.has(alt.id) && !inside(alt);
              return (
                <div key={alt.id} className={`variation${shut ? ' closed' : ''}`}>
                  {more > 0 && (
                    <button type="button" className="var-fold" onClick={() => toggle(alt, shut)} title={shut ? L('Άνοιγμα της βαριάντας', 'Expand the variation') : L('Κλείσιμο της βαριάντας', 'Collapse the variation')} aria-expanded={!shut}>
                      {shut ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                    </button>
                  )}
                  <span className="paren">(</span>
                  {moveSpan(alt, true)}
                  {shut ? (
                    <span className="var-more" onClick={() => toggle(alt, shut)}>
                      … +{more}{' '}
                    </span>
                  ) : (
                    line(alt, depth + 1, Boolean(alt.comment))
                  )}
                  <span className="paren">)</span>
                </div>
              );
            })}
          </div>,
        );
        force = true;
      }
      n = main;
    }
    return out;
  };

  const h = game.headers;
  if (hideFuture) {
    const path: GameNode[] = [];
    for (let n: GameNode | null = current; n && !n.isRoot; n = n.parent) path.unshift(n);
    return (
      <div className="notation" ref={ref}>
        <div className="mainline">
          {path.map((n, i) => moveSpan(n, i === 0 || Boolean(path[i - 1].comment)))}
          {current.children.length > 0 && <span className="hidden-moves">…</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="notation" ref={ref}>
      {game.root.comment && (
        <div className="comment game-comment" onDoubleClick={() => onEditComment?.(game.root, false)}>
          {game.root.comment}
        </div>
      )}
      <div className="mainline">
        {line(game.root, 0, true)}
        <span className="result">{h.Result && h.Result !== '*' && (revealPly === undefined || !hasMainAfter(game.root, revealPly)) ? h.Result.replace('1/2-1/2', '½-½') : ''}</span>
      </div>
    </div>
  );
}

/** Υπάρχει κίνηση της κύριας γραμμής μετά από αυτή την ημικίνηση; */
function hasMainAfter(root: GameNode, ply: number): boolean {
  let n = root;
  while (n.children.length) n = n.children[0];
  return n.ply > ply;
}

function formatEvalTag(e: string): string {
  if (e.startsWith('#')) return e;
  const v = Number(e.split(',')[0]);
  if (!Number.isFinite(v)) return e;
  const pawns = e.includes(',') ? v / 100 : v;
  return (pawns > 0 ? '+' : '') + pawns.toFixed(2);
}
