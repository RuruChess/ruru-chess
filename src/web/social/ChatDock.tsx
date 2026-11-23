/**
 * Τα παράθυρα chat των Φίλων κάτω δεξιά (σε όλες τις καρτέλες, όπως στο LoL): με έναν φίλο ή με μια ομάδα. Και οι
 * ειδοποιήσεις πάνω δεξιά: αιτήματα φιλίας, προσκλήσεις σε ομάδα, σε παρτίδα, σε κοινή ανάλυση (και της ομάδας).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Database, Flag, Minus, MoreVertical, Paperclip, Radio, Send, Swords, Trash2, UserPlus, Users, X } from 'lucide-react';
import { parseFile, parseInvite, SOCIAL_MAX_TEXT, type DmMsg, type Friend, type Invite, type TeamRow } from '../../core/social.ts';
import { L, fmtBytes, language } from '../i18n.ts';
import { ContextMenu, type MenuItem } from '../components/ui.tsx';
import { EmojiPicker } from '../share/SharePanel.tsx';
import { acceptInvite, closeChat, declineInvite, dismissFile, fullName, gamesText, importShared, inviteFriend, inviteTeamAnalysis, olderMessages, openReport, openSend, socialSend, teamKey, toggleChat, useSocial } from './social.ts';
import { Avatar, statusLabel, TeamAvatar } from './FriendsPanel.tsx';
import '../tactics/tactics.css';
import '../online/online.css';
import './social.css';

/** οι προσκλήσεις ισχύουν λίγη ώρα (μετά το δωμάτιο μπορεί να έχει γεμίσει ή λήξει) */
const INVITE_FRESH = 15 * 60_000;

/** «5 + 3 · παίζεις μαύρα» ή ο τίτλος της ανάλυσης (`mine`: η πρόσκληση που έστειλα εγώ). */
export function inviteDetail(inv: Invite, mine = false): string {
  if (inv.kind === 'analysis') return inv.title ?? '';
  const parts: string[] = [];
  if (inv.tc !== undefined) parts.push(inv.tc ? inv.tc.replace('+', ' + ') : L('χωρίς ρολόι', 'no clock'));
  // το χρώμα είναι του καλεσμένου· σε όποιον έστειλε την πρόσκληση δείχνουμε το δικό του
  const c = mine && inv.color && inv.color !== 'random' ? (inv.color === 'white' ? 'black' : 'white') : inv.color;
  if (c) parts.push(c === 'white' ? L('παίζεις λευκά', 'you play White') : c === 'black' ? L('παίζεις μαύρα', 'you play Black') : L('τυχαία χρώματα', 'random colours'));
  return parts.join(' · ');
}

const time = (at: number) => new Date(at).toLocaleTimeString(language() === 'el' ? 'el-GR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
const day = (at: number) => new Date(at).toLocaleDateString(language() === 'el' ? 'el-GR' : 'en-GB', { day: 'numeric', month: 'short', year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

/**
 * Ειδοποιήσεις όπως στο LoL, πάνω δεξιά σε όλες τις καρτέλες, με ένα μικρό ✓ (αποδοχή) και ✗ (απόρριψη / όχι
 * τώρα) πάνω στην ίδια την ειδοποίηση.
 */
export function SocialNotices() {
  const friends = useSocial((s) => s.friends);
  const teams = useSocial((s) => s.teams);
  const invites = useSocial((s) => s.invites);
  const files = useSocial((s) => s.files);
  const ok = useSocial((s) => s.status === 'open');
  // οι προσκλήσεις λήγουν: ξανά σχεδίαση κάθε λεπτό
  const [, tick] = useState(0);
  useEffect(() => {
    if (!invites.length) return;
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [invites.length]);
  const requests = friends.filter((f) => f.state === 'in');
  const teamInvites = teams.filter((t) => t.state === 'invited');
  const live = invites.filter((i) => Date.now() - i.m.at < INVITE_FRESH);
  const liveFiles = files.filter((i) => (parseFile(i.m)?.exp ?? 0) > Date.now());
  if (!ok || (!requests.length && !live.length && !teamInvites.length && !liveFiles.length)) return null;

  const note = (key: string, avatar: ReactNode, icon: ReactNode, what: string, who: ReactNode, cls: string, yes: () => void, no: () => void, noLabel: string, detail?: string) => (
    <div key={key} className={`nt-card ${cls}`} role="alert">
      {avatar}
      <span className="nt-text">
        <span className="nt-kind">
          {icon}
          {what}
        </span>
        <b className="nt-name">{who}</b>
        {detail && <span className="nt-detail">{detail}</span>}
      </span>
      <button type="button" className="nt-btn nt-yes" title={L('Αποδοχή', 'Accept')} aria-label={L('Αποδοχή', 'Accept')} onClick={yes}>
        <Check size={16} strokeWidth={3} />
      </button>
      <button type="button" className="nt-btn nt-no" title={noLabel} aria-label={noLabel} onClick={no}>
        <X size={16} strokeWidth={3} />
      </button>
    </div>
  );
  const nameTag = (name: string, tag?: string) => (
    <>
      {name}
      {tag && <span className="fr-tag">#{tag}</span>}
    </>
  );

  return (
    <div className="nt-stack tx" aria-live="polite">
      {live.map((i) => {
        const inv = parseInvite(i.m);
        if (!inv) return null;
        const key = `inv-${i.team ?? ''}-${i.m.id}`;
        if (i.team) {
          const t = teams.find((x) => x.id === i.team);
          if (!t) return null;
          return note(
            key,
            <TeamAvatar t={t} size={34} />,
            <Radio size={12} aria-hidden />,
            L('Κοινή ανάλυση ομάδας', 'Team shared analysis'),
            <>
              {nameTag(i.m.name ?? '', i.m.tag)}
              <span className="fr-tag"> · {t.name}</span>
            </>,
            'nt-analysis',
            () => acceptInvite(i.m, i.team),
            () => declineInvite(i.m, i.team),
            L('Όχι τώρα', 'Not now'),
            inviteDetail(inv),
          );
        }
        const f = friends.find((x) => x.id === i.peer);
        if (!f) return null;
        return note(
          key,
          <Avatar id={f.id} name={f.name} p={f.p} size={34} />,
          inv.kind === 'game' ? <Swords size={12} aria-hidden /> : <Radio size={12} aria-hidden />,
          inv.kind === 'game' ? L('Πρόσκληση σε παρτίδα', 'Game invitation') : L('Πρόσκληση σε κοινή ανάλυση', 'Shared analysis invitation'),
          nameTag(f.name, f.tag),
          `nt-${inv.kind}`,
          () => acceptInvite(i.m),
          () => declineInvite(i.m),
          L('Όχι τώρα', 'Not now'),
          inviteDetail(inv),
        );
      })}
      {liveFiles.map((i) => {
        const f = parseFile(i.m);
        if (!f) return null;
        const t = i.team ? teams.find((x) => x.id === i.team) : undefined;
        const fr = i.team ? undefined : friends.find((x) => x.id === i.peer);
        if (i.team ? !t : !fr) return null;
        return note(
          `file-${i.team ?? ''}-${i.m.id}`,
          t ? <TeamAvatar t={t} size={34} /> : fr ? <Avatar id={fr.id} name={fr.name} p={fr.p} size={34} /> : null,
          <Database size={12} aria-hidden />,
          t ? L('Βάση στην ομάδα', 'Database for the team') : L('Βάση από φίλο', 'Database from a friend'),
          <>
            {f.name}
            <span className="fr-tag">
              {' · '}
              {gamesText(f.games)} · {t ? `${i.m.name ?? ''} · ${t.name}` : fr?.name}
            </span>
          </>,
          'nt-file',
          () => void importShared(i.m, i.team),
          () => dismissFile(i.m, i.team),
          L('Όχι τώρα (μένει στο chat)', 'Not now (stays in the chat)'),
        );
      })}
      {teamInvites.map((t) =>
        note(
          `team-${t.id}`,
          <TeamAvatar t={t} size={34} />,
          <Users size={12} aria-hidden />,
          L('Πρόσκληση σε ομάδα', 'Team invitation'),
          <>
            {t.name}
            {t.by && <span className="fr-tag"> · {L('από', 'from')} {t.by}</span>}
          </>,
          'nt-request',
          () => socialSend({ t: 'team_accept', team: t.id }),
          () => socialSend({ t: 'team_decline', team: t.id }),
          L('Απόρριψη', 'Decline'),
        ),
      )}
      {requests.map((f) =>
        note(
          `req-${f.id}`,
          <Avatar id={f.id} name={f.name} size={34} />,
          <UserPlus size={12} aria-hidden />,
          L('Αίτημα φιλίας', 'Friend request'),
          nameTag(f.name, f.tag),
          'nt-request',
          () => socialSend({ t: 'accept', id: f.id }),
          () => socialSend({ t: 'remove', id: f.id }),
          L('Απόρριψη', 'Decline'),
        ),
      )}
    </div>
  );
}

export function ChatDock() {
  const chats = useSocial((s) => s.chats);
  const friends = useSocial((s) => s.friends);
  const teams = useSocial((s) => s.teams);
  if (!chats.length) return null;
  return (
    <div className="cd-dock tx">
      <div className="cd-chats">
        {chats.map((c) => {
          if (c.peer.startsWith('t:')) {
            const t = teams.find((x) => teamKey(x.id) === c.peer && x.state === 'member');
            return t ? <TeamChat key={c.peer} t={t} min={c.min} /> : null;
          }
          const f = friends.find((x) => x.id === c.peer);
          return f ? <FriendChat key={c.peer} f={f} min={c.min} /> : null;
        })}
      </div>
    </div>
  );
}

function FriendChat({ f, min }: { f: Friend; min: boolean }) {
  const ok = useSocial((s) => s.status === 'open');
  return (
    <ChatWin
      ckey={f.id}
      min={min}
      unread={f.unread}
      avatar={<Avatar id={f.id} name={f.name} p={f.p} size={24} />}
      title={f.name}
      sub={<span className={`fr-status s-${f.p.s}`}>{statusLabel(f.p)}</span>}
      label={`${L('Συνομιλία', 'Chat')}: ${fullName(f)}`}
      empty={L(`Γράψε κάτι στον/στην ${f.name} 👋`, `Say something to ${f.name} 👋`)}
      onSend={(text) => socialSend({ t: 'send', peer: f.id, text })}
      onRead={() => socialSend({ t: 'read', peer: f.id })}
      onDelete={(mid) => socialSend({ t: 'delmsg', peer: f.id, mid })}
      menu={() => [
        { label: L('Πρόσκληση σε παρτίδα…', 'Invite to a game…'), onClick: () => inviteFriend(f.id, 'game'), disabled: !ok || f.p.s === 'offline' },
        { label: L('Πρόσκληση σε κοινή ανάλυση…', 'Invite to a shared analysis…'), onClick: () => inviteFriend(f.id, 'analysis'), disabled: !ok || f.p.s === 'offline' },
        { label: L('Αποστολή βάσης…', 'Send a database…'), onClick: () => openSend({ peer: f.id }), disabled: !ok },
        { separator: true, label: '' },
        { label: L('Αναφορά…', 'Report…'), disabled: !ok, onClick: () => openReport({ id: f.id }, fullName(f)) },
        {
          label: L('Διαγραφή συνομιλίας…', 'Delete conversation…'),
          danger: true,
          disabled: !ok,
          onClick: () => {
            if (window.confirm(L(`Να σβηστεί όλη η συνομιλία με τον/την ${fullName(f)}; Σβήνεται και για τους δύο, οριστικά.`, `Delete the whole conversation with ${fullName(f)}? It is deleted for both of you, permanently.`)))
              socialSend({ t: 'clear', peer: f.id });
          },
        },
      ]}
    />
  );
}

function TeamChat({ t, min }: { t: TeamRow; min: boolean }) {
  const ok = useSocial((s) => s.status === 'open');
  const lead = t.role !== 'member';
  return (
    <ChatWin
      ckey={teamKey(t.id)}
      min={min}
      unread={t.unread}
      names
      avatar={<TeamAvatar t={t} size={24} />}
      title={t.name}
      sub={<span className="fr-status">{L(`${t.count} μέλη`, `${t.count} members`)}</span>}
      label={`${L('Συνομιλία', 'Chat')}: ${t.name}`}
      empty={L(`Γράψε κάτι στην ομάδα «${t.name}» 👋`, `Say something to “${t.name}” 👋`)}
      onSend={(text) => socialSend({ t: 'team_send', team: t.id, text })}
      onRead={() => socialSend({ t: 'team_read', team: t.id })}
      onDelete={(mid) => socialSend({ t: 'team_delmsg', team: t.id, mid })}
      team={t.id}
      menu={() => [
        { label: L('Κοινή ανάλυση ομάδας', 'Team shared analysis'), onClick: () => inviteTeamAnalysis(t.id), disabled: !ok },
        { label: L('Αποστολή βάσης στην ομάδα…', 'Send a database to the team…'), onClick: () => openSend({ team: t.id }), disabled: !ok },
        { label: L('Μέλη και ρυθμίσεις…', 'Members and settings…'), onClick: () => useSocial.setState({ teamView: t.id }) },
        { label: L('Αναφορά ομάδας…', 'Report team…'), disabled: !ok, onClick: () => openReport({ team: t.id }, t.name) },
        ...(lead
          ? [
              { separator: true, label: '' },
              {
                label: L('Διαγραφή του chat της ομάδας…', 'Delete the team chat…'),
                danger: true,
                disabled: !ok,
                onClick: () => {
                  if (window.confirm(L(`Να σβηστεί όλο το chat της ομάδας «${t.name}»; Σβήνεται για όλα τα μέλη, οριστικά.`, `Delete the whole chat of “${t.name}”? It is deleted for all members, permanently.`)))
                    socialSend({ t: 'team_clear', team: t.id });
                },
              },
            ]
          : []),
      ]}
    />
  );
}

interface ChatWinProps {
  /** κλειδί του chat στο store (φίλος ή «t:<ομάδα>») */
  ckey: string;
  min: boolean;
  unread: number;
  avatar: ReactNode;
  title: string;
  sub: ReactNode;
  label: string;
  empty: string;
  /** chat ομάδας: φαίνεται ποιος γράφει */
  names?: boolean;
  team?: string;
  onSend: (text: string) => boolean;
  onRead: () => void;
  onDelete: (mid: number) => void;
  menu: () => MenuItem[];
}

function ChatWin({ ckey, min, unread, avatar, title, sub, label, empty, names, team, onSend, onRead, onDelete, menu: menuItems }: ChatWinProps) {
  const me = useSocial((s) => s.me);
  const log = useSocial((s) => s.logs[ckey]);
  const ok = useSocial((s) => s.status === 'open');
  const [text, setText] = useState('');
  const [emojis, setEmojis] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const msgs = log?.msgs ?? [];
  const lastId = msgs.at(-1)?.id ?? 0;
  const readRef = useRef(onRead);
  readRef.current = onRead;

  // αδιάβαστα: διαβάστηκαν όταν το chat είναι ανοιχτό και το παράθυρο έχει την εστίαση
  useEffect(() => {
    if (min || !unread) return;
    const mark = () => document.hasFocus() && readRef.current();
    mark();
    window.addEventListener('focus', mark);
    return () => window.removeEventListener('focus', mark);
  }, [min, unread]);

  // κάτω-κάτω με κάθε νέο μήνυμα (αν ήμασταν ήδη κάτω)
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, min, log?.loaded]);

  useEffect(() => {
    if (!min) inputRef.current?.focus();
  }, [min]);

  const addEmoji = (em: string) => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    const next = (text.slice(0, at) + em + text.slice(end)).slice(0, SOCIAL_MAX_TEXT);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(next.length, at + em.length);
      el?.setSelectionRange(pos, pos);
    });
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    atBottom.current = true;
    if (onSend(t)) {
      setText('');
      setEmojis(false);
    }
  };

  let lastDay = '';
  let lastFrom = '';
  return (
    <div className={`cd-win${min ? ' is-min' : ''}`} role="dialog" aria-label={label}>
      <div className="cd-head" onClick={() => toggleChat(ckey)}>
        {avatar}
        <span className="cd-who">
          <b>{title}</b>
          {sub}
        </span>
        {min && unread > 0 && <span className="fr-unread">{unread}</span>}
        <span className="cd-head-btns" onClick={(e) => e.stopPropagation()}>
          {!min && (
            <button type="button" className="icon-btn" title={L('Περισσότερα', 'More')} aria-label={L('Περισσότερα', 'More')} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items: menuItems() })}>
              <MoreVertical size={15} />
            </button>
          )}
          <button type="button" className="icon-btn" title={min ? L('Άνοιγμα', 'Open') : L('Μάζεμα', 'Minimise')} aria-label={min ? L('Άνοιγμα', 'Open') : L('Μάζεμα', 'Minimise')} onClick={() => toggleChat(ckey)}>
            <Minus size={15} />
          </button>
          <button type="button" className="icon-btn" title={L('Κλείσιμο', 'Close')} aria-label={L('Κλείσιμο', 'Close')} onClick={() => closeChat(ckey)}>
            <X size={15} />
          </button>
        </span>
      </div>
      {!min && (
        <>
          <div
            className="cd-list"
            ref={listRef}
            aria-live="polite"
            onScroll={(e) => {
              const el = e.currentTarget;
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
            }}
          >
            {log?.more && (
              <button type="button" className="link-btn small cd-older" onClick={() => olderMessages(ckey)}>
                {L('Παλαιότερα μηνύματα', 'Older messages')}
              </button>
            )}
            {!log?.loaded && <div className="faint small">{L('Φόρτωση…', 'Loading…')}</div>}
            {log?.loaded && !msgs.length && <div className="faint small cd-empty">{empty}</div>}
            {log?.loaded && !log.more && (
              <div className="faint small cd-notice">
                {L('Τα μηνύματα μένουν στον server ώσπου να σβηστούν και δεν είναι end-to-end κρυπτογραφημένα.', 'Messages stay on the server until deleted and are not end-to-end encrypted.')}
              </div>
            )}
            {msgs.map((m) => {
              const d = day(m.at);
              const sep = d !== lastDay;
              lastDay = d;
              const mine = m.from === me?.id;
              // στην ομάδα: το όνομα πάνω από τα μηνύματα κάποιου άλλου (μία φορά για συνεχόμενα)
              const showName = names && !mine && (sep || lastFrom !== m.from);
              lastFrom = m.from;
              return (
                <div key={m.id}>
                  {sep && <div className="cd-day faint small">{d}</div>}
                  {showName && <div className="cd-from">{m.name ?? '?'}</div>}
                  <Bubble
                    m={m}
                    mine={mine}
                    team={team}
                    onDelete={() => onDelete(m.id)}
                    onReport={() => openReport(team ? { team, mid: m.id } : { id: ckey, mid: m.id }, `${L('Μήνυμα από', 'Message from')} ${names ? (m.name ?? '?') : title}`)}
                  />
                </div>
              );
            })}
          </div>
          {emojis && <EmojiPicker onPick={addEmoji} />}
          <form
            className="cd-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <button type="button" className={`sa-icon-btn sa-emoji-btn${emojis ? ' on' : ''}`} title="Emoji" aria-pressed={emojis} onClick={() => setEmojis((o) => !o)}>
              😊
            </button>
            {/* chat φίλου: το ckey είναι ο φίλος· chat ομάδας: το team */}
            <button type="button" className="sa-icon-btn" disabled={!ok} title={L('Αποστολή βάσης ή βιβλίου…', 'Send a database or book…')} aria-label={L('Αποστολή βάσης ή βιβλίου', 'Send a database or book')} onClick={() => openSend(team ? { team } : { peer: ckey })}>
              <Paperclip size={15} />
            </button>
            <input
              ref={inputRef}
              className="sa-input"
              title={L('Δεν είναι end-to-end κρυπτογραφημένο (δες Φίλοι → ⋮ → Πολιτική απορρήτου).', 'Not end-to-end encrypted (see Friends → ⋮ → Privacy policy).')}
              value={text}
              maxLength={SOCIAL_MAX_TEXT}
              placeholder={ok ? L('Μήνυμα…', 'Message…') : L('Χωρίς σύνδεση…', 'Offline…')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') setEmojis(false);
              }}
            />
            <button type="submit" className="sa-btn" disabled={!text.trim() || !ok} title={L('Αποστολή', 'Send')}>
              <Send size={14} />
            </button>
          </form>
        </>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Bubble({ m, mine, team, onDelete, onReport }: { m: DmMsg; mine: boolean; team?: string; onDelete: () => void; onReport: () => void }) {
  const inv = parseInvite(m);
  const file = parseFile(m);
  const del = mine ? (
    <button type="button" className="cd-del" title={L('Διαγραφή μηνύματος', 'Delete message')} aria-label={L('Διαγραφή μηνύματος', 'Delete message')} onClick={onDelete}>
      <Trash2 size={12} />
    </button>
  ) : (
    <button type="button" className="cd-del cd-report" title={L('Αναφορά μηνύματος', 'Report message')} aria-label={L('Αναφορά μηνύματος', 'Report message')} onClick={onReport}>
      <Flag size={12} />
    </button>
  );
  if (file) {
    const days = Math.ceil((file.exp - Date.now()) / 86_400_000);
    return (
      <div className={`cd-msg cd-inv cd-file${mine ? ' me' : ''}`} title={time(m.at)}>
        <Database size={15} aria-hidden />
        <span>
          <b>{file.name}</b>
          <span className="faint small">
            <br />
            {gamesText(file.games)} · {fmtBytes(file.size)} · {days > 0 ? L(`λήγει σε ${days} ${days === 1 ? 'μέρα' : 'μέρες'}`, `expires in ${days} ${days === 1 ? 'day' : 'days'}`) : L('έληξε', 'expired')}
          </span>
        </span>
        {days > 0 && !mine && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void importShared(m, team)}>
            {L('Εισαγωγή', 'Import')}
          </button>
        )}
        {del}
      </div>
    );
  }
  if (inv) {
    const fresh = Date.now() - m.at < INVITE_FRESH;
    return (
      <div className={`cd-msg cd-inv${mine ? ' me' : ''}`} title={time(m.at)}>
        {inv.kind === 'game' ? <Swords size={15} aria-hidden /> : <Radio size={15} aria-hidden />}
        <span>
          {inv.kind === 'game'
            ? L('Πρόσκληση σε παρτίδα', 'Invitation to a game')
            : team
              ? L('Κοινή ανάλυση για την ομάδα', 'Shared analysis for the team')
              : L('Πρόσκληση σε κοινή ανάλυση', 'Invitation to a shared analysis')}
          <span className="faint small">
            {' · '}
            {time(m.at)}
            {!fresh && ` · ${L('έληξε', 'expired')}`}
          </span>
          {inviteDetail(inv, mine) && (
            <span className="faint small cd-inv-detail">
              <br />
              {inviteDetail(inv, mine)}
            </span>
          )}
        </span>
        {!mine && fresh && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => acceptInvite(m, team)}>
            {L('Μπες', 'Join')}
          </button>
        )}
        {del}
      </div>
    );
  }
  return (
    <div className={`cd-msg${mine ? ' me' : ''}`} title={time(m.at)}>
      <span className="cd-text">{m.text}</span>
      <span className="cd-time faint">{time(m.at)}</span>
      {del}
    </div>
  );
}
