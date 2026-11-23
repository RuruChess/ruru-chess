/**
 * Κοινή ανάλυση, η σελίδα του καλεσμένου (/a/<id>): η ίδια παρτίδα με τον οικοδεσπότη, με βαριάντες, σχόλια,
 * σύμβολα και βέλη. Παίζει κινήσεις, ζωγραφίζει βέλη (δεξί κλικ και σύρσιμο), γράφει σχόλια (chat: features.ts)·
 * βλέπει και τη μηχανή του οικοδεσπότη.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpFromLine, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, FlipVertical2, MessageSquarePlus, Radio, Trash2, Undo2 } from 'lucide-react';
import { Board } from '../../src/web/components/Board.tsx';
import { Notation } from '../../src/web/components/Notation.tsx';
import { GameController, useController, useMoveSounds } from '../../src/web/gameModel.ts';
import { L } from '../../src/web/i18n.ts';
import { ShareChat, ShareEngine, ShareHead, figSan } from '../../src/web/share/SharePanel.tsx';
import { useShare } from '../../src/web/share/useShare.ts';
import type { GameNode } from '../../src/core/game.ts';
import { nagGroup, nagSymbol } from '../../src/core/nag.ts';
import { SHARE_CHAT } from '../../src/core/features.ts';

function fmtClock(ms: number, hours = false): string {
  const s = Math.max(0, ms) / 1000;
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  if (hours) return `${Math.floor(s / 3600)}:${mmss(s % 3600).padStart(5, '0')}`;
  return s < 10 ? s.toFixed(1) : mmss(s);
}

/** Οι επόμενες κινήσεις μιας βαριάντας (για τη λίστα επιλογής). */
function continuation(n: GameNode): string {
  const out: string[] = [];
  for (let c = n.children[0]; c && out.length < 4; c = c.children[0]) out.push(figSan(c.san));
  return out.join(' ');
}

export function AnalysisPage({ id, token, name, onToken }: { id: string; token: string | null; name: string; onToken: (t: string) => void }) {
  const ctrl = useMemo(() => new GameController(), []);
  useController(ctrl);
  useMoveSounds(ctrl);
  const conn = useShare(ctrl, location.origin, id, token, { name, onToken });
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  /** επιλογή υποβαριάντας (μόνο σε εμάς: οι άλλοι βλέπουν μόνο την κίνηση που θα διαλέξουμε) */
  const [pick, setPick] = useState<{ node: GameNode; index: number } | null>(null);
  const node = ctrl.node;
  const h = ctrl.game.headers;

  // → σε διακλάδωση: λίστα με τις βαριάντες, αλλιώς μία κίνηση μπροστά
  const forward = () => {
    const n = ctrl.node;
    if (n.children.length > 1) setPick({ node: n, index: 0 });
    else ctrl.forward();
  };
  const choose = (i: number) => {
    const c = pick?.node.children[i];
    setPick(null);
    if (c) ctrl.goTo(c);
  };
  useEffect(() => {
    if (pick && pick.node !== ctrl.node) setPick(null);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (pick) {
        const n = pick.node.children.length;
        if (e.key === 'ArrowDown') setPick({ ...pick, index: (pick.index + 1) % n });
        else if (e.key === 'ArrowUp') setPick({ ...pick, index: (pick.index + n - 1) % n });
        else if (e.key === 'Enter' || e.key === 'ArrowRight') choose(pick.index);
        else if (e.key === 'Escape' || e.key === 'ArrowLeft') setPick(null);
        else return;
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowLeft') ctrl.back();
      else if (e.key === 'ArrowRight') forward();
      else if (e.key === 'ArrowUp' || e.key === 'Home') ctrl.toStart();
      else if (e.key === 'ArrowDown' || e.key === 'End') ctrl.toEnd();
      else if (e.key === 'f' || e.key === 'F') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** σύμβολο κίνησης ή θέσης: ξανά το ίδιο το σβήνει */
  const nag = (n: number) => {
    if (node.isRoot) return;
    ctrl.setNag(node, node.nags.includes(n) ? 0 : n, nagGroup(n));
  };

  const onMove = (from: number, to: number, promo: number) => {
    const m = ctrl.position().findMove(from, to, promo);
    if (m) ctrl.play(m);
  };
  const comment = (n: GameNode, before = false) => {
    if (!edit) return;
    const t = window.prompt(before ? L('Σχόλιο πριν από την κίνηση', 'Comment before the move') : L('Σχόλιο μετά την κίνηση', 'Comment after the move'), before ? n.preComment : n.comment);
    if (t !== null) ctrl.setComment(n, t, before);
  };
  const players = h.White && h.White !== '?' ? `${h.White} – ${h.Black}` : '';
  const ready = conn.status === 'open';
  /** αλλάζει την ανάλυση (ο host μπορεί να το επιτρέπει μόνο σε κάποιους) */
  const edit = ready && conn.canEdit;

  // ζωντανή παρτίδα (Watch Live από τον οικοδεσπότη): ρολόγια που τρέχουν και «Στο live»
  const [, setTick] = useState(0);
  const live = conn.live;
  const liveTicking = live?.status === 'live' && (live.w !== null || live.b !== null);
  useEffect(() => {
    if (!liveTicking) return;
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [liveTicking]);

  const liveClockMs = (side: 'w' | 'b'): number | null => {
    if (!live) return null;
    const v = live[side];
    if (v === null) return null;
    if (live.status !== 'live' || live.turn !== side || live.plies < 2) return v;
    return Math.max(0, v - (Date.now() - live.at));
  };

  const liveBar = (color: 'white' | 'black') => {
    if (!live) return null;
    const s = color === 'white' ? 'w' : 'b';
    const ms = liveClockMs(s);
    const on = live.status === 'live' && live.turn === s;
    const pname = color === 'white' ? h.White : h.Black;
    const title = color === 'white' ? h.WhiteTitle : h.BlackTitle;
    const elo = color === 'white' ? h.WhiteElo : h.BlackElo;
    const res = h.Result && h.Result !== '*' ? h.Result.split('-')[color === 'white' ? 0 : 1].replace('1/2', '½') : '';
    return (
      <div className={`live-bar ${color}${on ? ' on' : ''}`}>
        <span className="live-who">
          <span className={`live-dot ${color}`} />
          {title && <b className="live-title">{title}</b>}
          <span className="live-name">{pname && pname !== '?' ? pname : color === 'white' ? L('Λευκά', 'White') : L('Μαύρα', 'Black')}</span>
          {elo && elo !== '?' && <span className="live-elo">{elo}</span>}
          {res && <b className="live-score">{res}</b>}
        </span>
        {ms !== null && <span className={`live-clock${on ? ' on' : ''}${on && ms < 60_000 ? ' low' : ''}`}>{fmtClock(ms, ms >= 3_600_000)}</span>}
      </div>
    );
  };

  let mainEnd = ctrl.game.root;
  while (mainEnd.children.length) mainEnd = mainEnd.children[0];

  return (
    <div className="sa-main">
      <section className="sa-boardcol" aria-label={L('Σκακιέρα', 'Board')}>
        {live && liveBar(orientation === 'white' ? 'black' : 'white')}
        <div className="sa-board">
          <Board fen={node.fen} orientation={orientation} movable={edit ? 'both' : 'none'} lastMove={node.isRoot ? undefined : node.move} shapes={node.shapes} onMove={onMove} onShape={(s) => ctrl.toggleShape(node, s)} animationMs={200} oneClick />
          {pick && (
            <div className="var-chooser" role="listbox" aria-label={L('Επιλογή βαριάντας', 'Choose a variation')}>
              <div className="var-title">{L('Βαριάντες', 'Variations')}</div>
              {pick.node.children.map((c, i) => (
                <button key={c.id} type="button" role="option" aria-selected={i === pick.index} className={i === pick.index ? 'on' : ''} onMouseEnter={() => setPick({ ...pick, index: i })} onClick={() => choose(i)}>
                  <b>{figSan(c.san)}</b> <span className="cont">{continuation(c)}</span>
                </button>
              ))}
              <div className="var-hint">↑ ↓ · Enter · Esc</div>
            </div>
          )}
        </div>
        {live && liveBar(orientation)}
        {live && (
          <div className={`mode-banner live s-${live.status}`}>
            <Radio size={15} />
            <span className="live-tag">
              {live.status === 'live' ? 'LIVE' : live.status === 'ended' ? L('Τέλος', 'Finished') : live.status === 'connecting' ? L('Σύνδεση…', 'Connecting…') : L('Διακόπηκε', 'Stopped')}
              {live.status === 'ended' && h.Result && h.Result !== '*' && <b> · {h.Result.replace('1/2-1/2', '½-½')}</b>}
            </span>
            <span className="msg" />
            {ctrl.node !== mainEnd && <button onClick={() => ctrl.goTo(mainEnd)}>{L('Στο live', 'Back to live')}</button>}
          </div>
        )}
        <div className="sa-nav">
          <button type="button" className="sa-icon-btn" title={L('Αρχή', 'Start')} onClick={() => ctrl.toStart()}>
            <ChevronFirst size={18} />
          </button>
          <button type="button" className="sa-icon-btn" title={L('Πίσω (←)', 'Back (←)')} onClick={() => ctrl.back()}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="sa-icon-btn" title={L('Μπροστά (→)', 'Forward (→)')} onClick={forward}>
            <ChevronRight size={18} />
          </button>
          <button type="button" className="sa-icon-btn" title={L('Τέλος', 'End')} onClick={() => ctrl.toEnd()}>
            <ChevronLast size={18} />
          </button>
          <button type="button" className="sa-icon-btn" title={L('Γύρισμα σκακιέρας (F)', 'Flip board (F)')} onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            <FlipVertical2 size={17} />
          </button>
          <span className="sa-spacer" />
          {edit && <span className="faint small">{L('Δεξί κλικ και σύρσιμο: βέλη', 'Right-click and drag: arrows')}</span>}
        </div>
      </section>

      <aside className="sa-side">
        <div className="sa-panel sa-card">
          <ShareHead conn={conn} link={location.origin + location.pathname} />
        </div>
        <ShareEngine info={conn.engine} fen={node.fen} />
        <div className="sa-card sa-notes">
          {players && <div className="sa-players">{players}</div>}
          {edit && (
          <div className="sa-tools">
            <button type="button" className="sa-icon-btn" title={L('Σχόλιο μετά την κίνηση', 'Comment after the move')} onClick={() => comment(node)}>
              <MessageSquarePlus size={16} />
            </button>
            <button type="button" className="sa-icon-btn" title={L('Η βαριάντα γίνεται κύρια', 'Promote the variation')} disabled={node.isRoot || node.isMainline()} onClick={() => ctrl.promote(node)}>
              <ArrowUpFromLine size={16} />
            </button>
            <button type="button" className="sa-icon-btn" title={L('Διαγραφή της βαριάντας', 'Delete the variation')} disabled={node.isRoot || node.isMainline()} onClick={() => ctrl.deleteVariation(node)}>
              <Trash2 size={16} />
            </button>
            <button type="button" className="sa-icon-btn" title={L('Αναίρεση', 'Undo')} disabled={!ctrl.canUndo} onClick={() => ctrl.undo()}>
              <Undo2 size={16} />
            </button>
            <span className="sa-sep" />
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button key={n} type="button" className={`sa-nag${node.nags.includes(n) ? ' on' : ''}`} disabled={node.isRoot} title={L('Σύμβολο κίνησης', 'Move symbol')} onClick={() => nag(n)}>
                {nagSymbol(n)}
              </button>
            ))}
          </div>
          )}
          {edit && (
          <div className="sa-tools sa-evals">
            {[18, 16, 14, 10, 13, 15, 17, 19].map((n) => (
              <button key={n} type="button" className={`sa-nag${node.nags.includes(n) ? ' on' : ''}`} disabled={node.isRoot} title={L('Αξιολόγηση θέσης', 'Position evaluation')} onClick={() => nag(n)}>
                {nagSymbol(n)}
              </button>
            ))}
          </div>
          )}
          <div className="notation-wrap">
            <Notation ctrl={ctrl} style="figurine" onEditComment={(n, before) => comment(n, before)} />
          </div>
        </div>
        {SHARE_CHAT && (
          <div className="sa-card">
            <ShareChat conn={conn} />
          </div>
        )}
      </aside>
    </div>
  );
}
