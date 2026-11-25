/**
 * Κοινή ανάλυση: ποιος είναι μέσα, «ίδια θέση», chat και (στη σελίδα του φίλου) οι γραμμές της μηχανής του
 * οικοδεσπότη. Τα ίδια κομμάτια τα χρησιμοποιεί το παράθυρο της παρτίδας στο Ruru και η σελίδα /a/<id>.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Crosshair, Send, Users, X } from 'lucide-react';
import { Position } from '../../core/chess.ts';
import { L } from '../i18n.ts';
import { CONTACT_EMAIL } from '../../core/features.ts';
import type { EngineInfo } from '../../core/share.ts';
import type { ShareConn } from './useShare.ts';
import { ShareMembers, ShareViewOnly, type ShareVideoControl } from './ShareMembers.tsx';
import '../online/online.css';

const FIG: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
export const figSan = (san: string) => san.replace(/[KQRBN]/g, (c) => FIG[c] ?? c);

/** Αξιολόγηση από τη μεριά των λευκών: «+0.35», «−1.20», «#3». */
export function evalText(cp: number | null, mate: number | null): string {
  if (mate !== null && mate !== undefined) return mate > 0 ? `#${mate}` : `−#${-mate}`;
  if (cp === null || cp === undefined) return '–';
  const v = cp / 100;
  if (Math.abs(v) < 0.005) return '0.00';
  return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2);
}

function statusText(c: ShareConn): string | null {
  if (c.status === 'connecting') return L('Σύνδεση…', 'Connecting…');
  if (c.status === 'retrying') return L('Χάθηκε η σύνδεση· ξαναπροσπαθώ…', 'Connection lost; reconnecting…');
  if (c.status === 'gone') return L('Η κοινή ανάλυση δεν υπάρχει πια (το link έληξε).', 'This shared analysis no longer exists (the link has expired).');
  if (c.status === 'full') return L('Η κοινή ανάλυση είναι γεμάτη.', 'This shared analysis is full.');
  if (c.status === 'kicked') return L('Ο οικοδεσπότης σε έβγαλε από την κοινή ανάλυση.', 'The host removed you from the shared analysis.');
  if (c.status === 'ended') return L('Ο οικοδεσπότης τερμάτισε την κοινή ανάλυση.', 'The host ended the shared analysis.');
  if (c.status === 'locked') return L('Η κοινή ανάλυση είναι κλειδωμένη. Ζήτα από τον οικοδεσπότη να την ξεκλειδώσει και ανανέωσε τη σελίδα.', 'This shared analysis is locked. Ask the host to unlock it, then reload the page.');
  return null;
}

/** Κεφαλίδα: link, ποιοι είναι μέσα, «ίδια θέση». */
export function ShareHead({ conn, link, video, onStop }: { conn: ShareConn; link?: string; video?: ShareVideoControl; onStop?: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const others = conn.presence.online.filter((p) => p !== conn.pid);
  const st = statusText(conn);
  return (
    <div className="sa-head">
      <div className="sa-row">
        <Users size={15} className="sa-ic" aria-hidden />
        <b>{L('Κοινή ανάλυση', 'Shared analysis')}</b>
        <span className="sa-spacer" />
        {onStop && (
          <button type="button" className="sa-icon-btn" title={L('Τέλος κοινής ανάλυσης (η παρτίδα μένει εδώ)', 'Stop sharing (the game stays here)')} onClick={onStop}>
            <X size={15} />
          </button>
        )}
      </div>
      {st && <div className={`sa-status${conn.status === 'kicked' || conn.status === 'ended' ? ' is-error' : ''}`}>{st}</div>}
      {conn.status !== 'kicked' && conn.status !== 'ended' && conn.presence.online.length > 0 && <ShareMembers conn={conn} video={video} />}
      <ShareViewOnly conn={conn} />
      {link && conn.status !== 'kicked' && conn.status !== 'ended' && (
        <div className="sa-row">
          <input className="sa-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
          <button
            type="button"
            className="sa-btn"
            onClick={() =>
              void navigator.clipboard?.writeText(link).then(
                () => setCopied(true),
                () => {},
              )
            }
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? L('Αντιγράφηκε', 'Copied') : L('Αντιγραφή', 'Copy')}
          </button>
        </div>
      )}
      {!others.length && conn.status === 'open' && <div className="sa-status muted">{L('Στείλε το link σε όποιον θέλεις να αναλύσετε μαζί.', 'Send the link to whoever you want to analyse with.')}</div>}
      <label className="sa-row sa-follow" title={L('Όταν κάποιος αλλάζει θέση ή παίζει κίνηση, πας κι εσύ εκεί', 'When someone moves or changes position, you go there too')}>
        <input type="checkbox" checked={conn.follow} onChange={(e) => conn.setFollow(e.target.checked)} />
        <Crosshair size={14} aria-hidden />
        {L('Ίδια θέση με τους άλλους', 'Same position as the others')}
      </label>
    </div>
  );
}

/** Οι γραμμές της μηχανής του οικοδεσπότη (στη σελίδα του φίλου). */
export function ShareEngine({ info, fen }: { info: EngineInfo | null; fen: string }) {
  if (!info || !info.lines.length) return <div className="sa-engine muted small">{L('Η μηχανή του οικοδεσπότη δεν τρέχει.', 'The host’s engine is not running.')}</div>;
  const same = info.fen.split(' ').slice(0, 4).join(' ') === fen.split(' ').slice(0, 4).join(' ');
  if (!same) return <div className="sa-engine muted small">{L('Η μηχανή του οικοδεσπότη αναλύει άλλη θέση.', 'The host’s engine is analysing another position.')}</div>;
  const p = Position.fromFen(info.fen);
  const num = p.fullmove;
  const black = p.turn === 1;
  return (
    <div className="sa-engine">
      <div className="faint small">
        {L('Μηχανή του οικοδεσπότη', 'Host’s engine')} · {L('βάθος', 'depth')} {info.depth}
      </div>
      {info.lines.map((l, i) => (
        <div key={i} className="sa-line">
          <b className="tnum">{evalText(l.cp, l.mate)}</b>
          <span>
            {l.san.slice(0, 10).map((s, k) => {
              const ply = k + (black ? 1 : 0);
              const n = num + Math.floor(ply / 2);
              const prefix = ply % 2 === 0 ? `${n}. ` : k === 0 ? `${n}… ` : '';
              return (
                <span key={k}>
                  {prefix}
                  {figSan(s)}{' '}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Τα emojis του chat (και σκακιστικά σύμβολα). */
export const EMOJIS = ['👍', '👏', '😂', '😅', '😮', '🤔', '😎', '🙏', '❤️', '🔥', '🎉', '👋', '💡', '⚡', '🤝', '😬', '😢', '😡', '✅', '❌', '‼️', '⁉️', '♟️', '👑'];

/** Τα emojis για διάλεγμα (και στα chat των Φίλων). */
export function EmojiPicker({ onPick }: { onPick: (em: string) => void }) {
  return (
    <div className="sa-emojis" role="listbox" aria-label="Emoji">
      {EMOJIS.map((em) => (
        <button key={em} type="button" role="option" aria-selected={false} className="sa-emoji" onClick={() => onPick(em)}>
          {em}
        </button>
      ))}
    </div>
  );
}

/** Μικρό chat. */
export function ShareChat({ conn }: { conn: ShareConn }) {
  const [text, setText] = useState('');
  const [emojis, setEmojis] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // emoji στη θέση του δρομέα
  const addEmoji = (em: string) => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    const next = (text.slice(0, at) + em + text.slice(end)).slice(0, 500);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(next.length, at + em.length);
      el?.setSelectionRange(pos, pos);
    });
  };
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conn.chat.length]);
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    conn.send({ t: 'chat', text: t });
    setText('');
  };
  return (
    <div className="sa-chat">
      <div className="sa-chat-list" ref={listRef} aria-live="polite">
        {conn.chat.length === 0 && <div className="faint small">{L('Γράψτε εδώ ό,τι θέλετε να πείτε.', 'Write here whatever you want to say.')}</div>}
        {conn.chat.map((m, i) => (
          <div key={i} className={`sa-msg${m.by === conn.pid ? ' me' : ''}`}>
            <b>{m.name}:</b> {m.text}
          </div>
        ))}
      </div>
      <p className="sa-notice faint small">
        {L(
          'Το βλέπει όποιος έχει το link και σβήνει περίπου μία μέρα μετά την τελευταία δραστηριότητα. Δεν είναι end-to-end κρυπτογραφημένο. Αναφορές: ',
          'Anyone with the link can read it; it is deleted about a day after the last activity. Not end-to-end encrypted. Reports: ',
        )}
        <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Ruru Chess report')}`}>{CONTACT_EMAIL}</a>
      </p>
      {emojis && <EmojiPicker onPick={addEmoji} />}
      <form
        className="sa-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
          setEmojis(false);
        }}
      >
        <button type="button" className={`sa-icon-btn sa-emoji-btn${emojis ? ' on' : ''}`} title="Emoji" aria-pressed={emojis} onClick={() => setEmojis((o) => !o)}>
          😊
        </button>
        <input ref={inputRef} className="sa-input" value={text} maxLength={500} placeholder={L('Μήνυμα…', 'Message…')} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') setEmojis(false);
        }} />
        <button type="submit" className="sa-btn" disabled={!text.trim() || conn.status !== 'open'} title={L('Αποστολή', 'Send')}>
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
