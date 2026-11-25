/**
 * Η στήλη «Φίλοι» στις Βάσεις (όπως η λίστα φίλων του League of Legends): το δικό μου Όνομα#TAG, προσθήκη φίλου,
 * αιτήματα, οι ομάδες μου, ποιος είναι online και τι κάνει, και με δεξί κλικ μήνυμα, προσκλήσεις, αφαίρεση, μπλοκ.
 */
import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Eye, KeyRound, MessageSquare, MoreVertical, Radio, Swords, UserPlus, Users, X } from 'lucide-react';
import { cleanSiteUser, parseInvite, parseNameTag, recoveryCode, type Accounts, type Friend, type Presence, type TeamRole, type TeamRow } from '../../core/social.ts';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';
import { ContextMenu, Dialog, type MenuItem } from '../components/ui.tsx';
import { openLink } from '../components/About.tsx';
import { DEFAULT_PLAY_SERVER, playServer } from '../online/server.ts';
import { acceptInvite, accountOf, clearAddResult, declineInvite, downloadMyData, fullName, inviteFriend, inviteTeamAnalysis, joinRoom, openChat, openReport, openSend, recoverSocial, registerSocial, setAccounts, signOutSocial, socialSend, teamKey, useSocial, type SocialAccount } from './social.ts';
import { chesscomProfile, lichessGameText, lichessProfile, loadGameInfo, useLichessFriends, useLichessPoll, useMyLichess, watchLichessGame, type LichessGame } from './lichess.ts';
import '../tactics/tactics.css';
import '../play/play.css';
import '../online/online.css';
import './social.css';
import { inviteDetail } from './ChatDock.tsx';
import { ConsentChecks, TermsGate } from './Safety.tsx';
import { legalTitle } from '../components/LegalText.tsx';

export function statusLabel(p: Presence): string {
  switch (p.s) {
    case 'online':
      return 'Online';
    case 'away':
      return L('Λείπει', 'Away');
    case 'game':
      // σε παρτίδα: απλώς «Online» (όπως ζήτησε ο χρήστης)
      return 'Online';
    case 'analysis':
      return 'Analysis';
    default:
      return L('Εκτός σύνδεσης', 'Offline');
  }
}

/** Αρχικό με χρώμα από το αναγνωριστικό (ίδιο παντού). */
export function Avatar({ id, name, p, size = 32 }: { id: string; name: string; p?: Presence; size?: number }) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="fr-av" style={{ width: size, height: size, background: `hsl(${h} 45% 45%)`, fontSize: size * 0.45 }} aria-hidden>
      {[...name][0]?.toUpperCase()}
      {p && <span className={`fr-dot s-${p.s}`} />}
    </span>
  );
}

/** Η «ασπίδα» μιας ομάδας: το αρχικό της σε τετράγωνο με στρογγυλές γωνίες. */
export function TeamAvatar({ t, size = 32 }: { t: { id: string; name: string }; size?: number }) {
  let h = 0;
  for (const c of t.id) h = (h * 17 + c.charCodeAt(0)) % 360;
  return (
    <span className="fr-av fr-team-av" style={{ width: size, height: size, background: `hsl(${h} 40% 38%)`, fontSize: size * 0.45 }} aria-hidden>
      {[...t.name][0]?.toUpperCase()}
    </span>
  );
}

export const roleLabel = (r: TeamRole) => (r === 'owner' ? L('Ιδιοκτήτης', 'Owner') : r === 'admin' ? L('Διαχειριστής', 'Admin') : L('Μέλος', 'Member'));

/** Αποχώρηση από ομάδα (με ερώτηση). */
export function leaveTeam(t: TeamRow): void {
  const msg =
    t.role === 'owner' && t.count > 1
      ? L(`Να φύγεις από την ομάδα «${t.name}»; Ιδιοκτήτης θα γίνει ένας διαχειριστής (ή το πιο παλιό μέλος).`, `Leave “${t.name}”? An admin (or the longest-standing member) becomes the owner.`)
      : t.count <= 1
        ? L(`Να φύγεις από την ομάδα «${t.name}»; Είσαι το τελευταίο μέλος, οπότε η ομάδα και το chat της θα σβηστούν.`, `Leave “${t.name}”? You are the last member, so the team and its chat will be deleted.`)
        : L(`Να φύγεις από την ομάδα «${t.name}»;`, `Leave “${t.name}”?`);
  if (window.confirm(msg)) socialSend({ t: 'team_leave', team: t.id });
}

function useAccount(): SocialAccount | null {
  const ui = useApp((s) => s.settings?.ui) as Record<string, unknown> | undefined;
  return accountOf(ui);
}

export function FriendsPanel() {
  const acc = useAccount();
  const terms = useSocial((s) => s.status === 'terms');
  if (!acc) return <SignUp />;
  return terms ? <TermsGate acc={acc} /> : <FriendList acc={acc} />;
}

// ---------------------------------------------------------------------------
// πρώτη φορά

function SignUp() {
  const ui = (useApp((s) => s.settings?.ui) ?? {}) as Record<string, unknown>;
  const [mode, setMode] = useState<'new' | 'recover'>('new');
  const [name, setName] = useState(((ui.friend as { name?: string } | undefined)?.name ?? '').slice(0, 16));
  const [code, setCode] = useState('');
  const [server, setServer] = useState(playServer(ui));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  // με κωδικό ανάκτησης τα ζητά ο server, αν λείπουν (TermsGate)
  const ready = mode === 'new' ? !!name.trim() && age && terms : !!code.trim();

  const go = async () => {
    const srv = server.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s/]+/.test(srv)) return setError(L('Η διεύθυνση του server δεν είναι σωστή.', 'The server address is not valid.'));
    // ο ίδιος server και για «Παίξε με φίλο» / «Κοινή ανάλυση», ώστε να δουλεύουν οι προσκλήσεις
    if (srv !== playServer(ui)) setUiLater({ playServer: srv === DEFAULT_PLAY_SERVER ? '' : srv });
    setBusy(true);
    setError(null);
    setError(mode === 'new' ? await registerSocial(srv, name) : await recoverSocial(srv, code));
    setBusy(false);
  };

  return (
    <div className="fr-signup tx">
      <p className="small">
        {L(
          'Φτιάξε το όνομά σου για να βρίσκεις φίλους, να βλέπεις ποιος είναι online, να συνομιλείτε και να παίζετε ή να αναλύετε μαζί. Χωρίς email και κωδικό.',
          'Choose your name to find friends, see who is online, chat, and play or analyse together. No email, no password.',
        )}
      </p>
      {mode === 'new' ? (
        <label className="play-opt">
          <span className="field-label">{L('Το όνομά σου', 'Your name')}</span>
          <input className="input" value={name} maxLength={16} placeholder={L('π.χ. Νίκος', 'e.g. Magnus')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && ready && void go()} />
          <span className="faint small">{L('Ο server προσθέτει έναν αριθμό, π.χ. Νίκος#4821. Αυτό το δίνεις στους φίλους σου.', 'The server adds a number, e.g. Magnus#4821. That is what you give your friends.')}</span>
        </label>
      ) : (
        <label className="play-opt">
          <span className="field-label">{L('Κωδικός ανάκτησης', 'Recovery code')}</span>
          <input className="input tnum" value={code} spellCheck={false} placeholder="ABCD-EFGH-…" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && ready && void go()} />
        </label>
      )}
      {mode === 'new' && <ConsentChecks age={age} terms={terms} onAge={setAge} onTerms={setTerms} />}
      {error && <div className="play-note">{error}</div>}
      <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={() => void go()}>
        {mode === 'new' ? <UserPlus className="ic ic-sm" aria-hidden /> : <KeyRound className="ic ic-sm" aria-hidden />}
        {busy ? L('Περίμενε…', 'Please wait…') : mode === 'new' ? L('Δημιουργία', 'Create') : L('Σύνδεση', 'Sign in')}
      </button>
      <button
        type="button"
        className="link-btn small"
        onClick={() => {
          setMode(mode === 'new' ? 'recover' : 'new');
          setError(null);
        }}
      >
        {mode === 'new' ? L('Έχω ήδη όνομα (κωδικός ανάκτησης)', 'I already have a name (recovery code)') : L('Νέο όνομα', 'New name')}
      </button>
      <details className="friend-adv">
        <summary className="faint small">{L('Για προχωρημένους', 'Advanced')}</summary>
        <label className="play-opt">
          <span className="field-label">{L('Server', 'Server')}</span>
          <input className="input" value={server} spellCheck={false} onChange={(e) => setServer(e.target.value)} />
        </label>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// η λίστα

const ORDER: Record<Presence['s'], number> = { analysis: 0, game: 1, online: 1, away: 2, offline: 3 };
const byName = (a: Friend, b: Friend) => a.name.localeCompare(b.name);

function FriendList({ acc }: { acc: SocialAccount }) {
  const status = useSocial((s) => s.status);
  const friends = useSocial((s) => s.friends);
  const teams = useSocial((s) => s.teams);
  const invites = useSocial((s) => s.invites);
  const addResult = useSocial((s) => s.addResult);
  const showCode = useSocial((s) => s.showCode);
  const [add, setAdd] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dialog, setDialog] = useState<'blocked' | 'accounts' | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const liUsers = useLichessFriends((s) => s.users);
  const liGames = useLichessFriends((s) => s.games);

  // φίλοι που παίζουν στο Lichess (polling κάθε 60″ όσο φαίνεται η στήλη: οι Βάσεις μένουν ανοιχτές και πίσω από άλλες καρτέλες)
  const visible = useApp((s) => s.tabs.find((t) => t.id === s.active)?.kind === 'library');
  // και η δική μου παρτίδα (από το Lichess μου)
  const myLichess = useMyLichess();
  const myGame = myLichess ? liUsers[myLichess.toLowerCase()]?.playing : undefined;
  useLichessPoll(
    [...friends.flatMap((f) => (f.state === 'friend' && f.acc?.lichess ? [f.acc.lichess] : [])), ...(myLichess ? [myLichess] : [])],
    visible,
  );
  const liGame = (f: Friend): LichessGame | undefined => (f.acc?.lichess ? liUsers[f.acc.lichess.toLowerCase()]?.playing : undefined);
  /** εκτός Ruru αλλά σε παρτίδα στο Lichess: στους online, με την πράσινη τελεία */
  const shown = (f: Friend): Presence => (f.p.s === 'offline' && liGame(f) ? { s: 'game' } : f.p);
  const watchLichess = (f: Friend, g: LichessGame) => watchLichessGame(f.acc?.lichess ?? f.name, g);

  const requests = friends.filter((f) => f.state !== 'friend').sort((a, b) => (a.state === b.state ? byName(a, b) : a.state === 'in' ? -1 : 1));
  const accepted = friends.filter((f) => f.state === 'friend');
  const online = accepted.filter((f) => shown(f).s !== 'offline').sort((a, b) => ORDER[shown(a).s] - ORDER[shown(b).s] || byName(a, b));
  const offline = accepted.filter((f) => shown(f).s === 'offline').sort(byName);
  const teamInvites = teams.filter((t) => t.state === 'invited');
  const myTeams = teams.filter((t) => t.state === 'member').sort((a, b) => a.name.localeCompare(b.name));
  // ομάδες όπου μπορώ να καλέσω (ιδιοκτήτης ή διαχειριστής)
  const leadTeams = myTeams.filter((t) => t.role !== 'member');
  const ok = status === 'open';

  const submitAdd = () => {
    const nt = parseNameTag(add);
    if (!nt) return setAddError(L('Γράψε όνομα και αριθμό, π.χ. Μαρία#4821.', 'Type a name and number, e.g. Maria#4821.'));
    setAddError(null);
    clearAddResult();
    if (socialSend({ t: 'add', name: nt.name, tag: nt.tag })) setAdd('');
  };

  const meMenu = (x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { label: L('Νέα ομάδα…', 'New team…'), onClick: () => useSocial.setState({ newTeam: true }), disabled: !ok },
        { label: L('Lichess και Chess.com…', 'Lichess and Chess.com…'), onClick: () => setDialog('accounts'), disabled: !ok },
        { label: L('Κωδικός ανάκτησης…', 'Recovery code…'), onClick: () => useSocial.setState({ showCode: true }) },
        { label: L('Μπλοκαρισμένοι…', 'Blocked…'), onClick: () => setDialog('blocked') },
        { separator: true, label: '' },
        { label: legalTitle('terms'), onClick: () => useSocial.setState({ legal: 'terms' }) },
        { label: legalTitle('privacy'), onClick: () => useSocial.setState({ legal: 'privacy' }) },
        { label: L('Λήψη των δεδομένων μου', 'Download my data'), onClick: () => void downloadMyData(acc) },
        { separator: true, label: '' },
        { label: L('Διαγραφή λογαριασμού…', 'Delete account…'), danger: true, onClick: () => useSocial.setState({ deleting: true }) },
        {
          label: L('Αποσύνδεση από αυτόν τον υπολογιστή', 'Sign out on this computer'),
          danger: true,
          onClick: () => {
            if (window.confirm(L('Να βγεις από τους Φίλους σε αυτόν τον υπολογιστή; Για να ξαναμπείς θα χρειαστείς τον κωδικό ανάκτησης.', 'Sign out of Friends on this computer? To sign in again you will need the recovery code.'))) signOutSocial();
          },
        },
      ],
    });

  const reportItem = (f: Friend): MenuItem => ({ label: L('Αναφορά…', 'Report…'), disabled: !ok, onClick: () => openReport({ id: f.id }, fullName(f)) });

  const friendMenu = (f: Friend, x: number, y: number) => {
    const items: MenuItem[] =
      f.state === 'in'
        ? [
            { label: L('Αποδοχή', 'Accept'), onClick: () => socialSend({ t: 'accept', id: f.id }) },
            { label: L('Απόρριψη', 'Decline'), onClick: () => socialSend({ t: 'remove', id: f.id }) },
            { separator: true, label: '' },
            reportItem(f),
            { label: L('Μπλοκ', 'Block'), danger: true, onClick: () => confirmBlock(f) },
          ]
        : f.state === 'out'
          ? [{ label: L('Ακύρωση αιτήματος', 'Cancel request'), onClick: () => socialSend({ t: 'remove', id: f.id }) }]
          : [
              { label: L('Μήνυμα', 'Message'), onClick: () => openChat(f.id) },
              { label: L('Προφίλ…', 'Profile…'), onClick: () => setProfile(f.id) },
              ...(liGame(f)?.id ? [{ label: L('Παρακολούθηση στο Lichess', 'Watch on Lichess'), onClick: () => watchLichess(f, liGame(f)!) }] : []),
              { label: L('Πρόσκληση σε παρτίδα…', 'Invite to a game…'), onClick: () => inviteFriend(f.id, 'game'), disabled: !ok || f.p.s === 'offline' },
              { label: L('Πρόσκληση σε κοινή ανάλυση…', 'Invite to a shared analysis…'), onClick: () => inviteFriend(f.id, 'analysis'), disabled: !ok || f.p.s === 'offline' },
              { label: L('Αποστολή βάσης…', 'Send a database…'), onClick: () => openSend({ peer: f.id }), disabled: !ok },
              ...(f.p.s === 'analysis' && f.p.room ? [{ label: L('Μπες στην κοινή ανάλυσή του/της', 'Join their shared analysis'), onClick: () => joinRoom('analysis', f.p.room ?? '') }] : []),
              ...(f.p.s === 'game' && f.p.room && !f.p.open ? [{ label: L('Παρακολούθηση της παρτίδας', 'Watch the game'), onClick: () => joinRoom('game', f.p.room ?? '', true) }] : []),
              ...(leadTeams.length
                ? [
                    {
                      label: L('Πρόσκληση σε ομάδα', 'Invite to a team'),
                      disabled: !ok,
                      submenu: leadTeams.map((t) => ({ label: t.name, onClick: () => socialSend({ t: 'team_invite', team: t.id, peer: f.id }) })),
                    },
                  ]
                : []),
              { separator: true, label: '' },
              {
                label: L('Αφαίρεση από τους φίλους', 'Remove friend'),
                danger: true,
                onClick: () => window.confirm(L(`Να αφαιρεθεί ο/η ${fullName(f)} από τους φίλους σου;`, `Remove ${fullName(f)} from your friends?`)) && socialSend({ t: 'remove', id: f.id }),
              },
              reportItem(f),
              { label: L('Μπλοκ', 'Block'), danger: true, onClick: () => confirmBlock(f) },
            ];
    setMenu({ x, y, items });
  };

  const confirmBlock = (f: Friend) => {
    if (window.confirm(L(`Μπλοκ στον/στην ${fullName(f)}; Δεν θα είστε πια φίλοι και δεν θα μπορεί να σου στείλει αίτημα ή μήνυμα.`, `Block ${fullName(f)}? You will no longer be friends and they cannot send you requests or messages.`)))
      socialSend({ t: 'block', id: f.id });
  };

  const group = (key: string, title: string, rows: ReactNode[]) =>
    rows.length > 0 && (
      <section className="fr-group">
        <button type="button" className="fr-group-head" aria-expanded={!closed[key]} onClick={() => setClosed((c) => ({ ...c, [key]: !c[key] }))}>
          {closed[key] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          {title} ({rows.length})
        </button>
        {!closed[key] && rows}
      </section>
    );

  const teamMenu = (t: TeamRow, x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { label: L('Συνομιλία', 'Chat'), onClick: () => openChat(teamKey(t.id)) },
        { label: L('Κοινή ανάλυση ομάδας', 'Team shared analysis'), onClick: () => inviteTeamAnalysis(t.id), disabled: !ok },
        { label: L('Αποστολή βάσης στην ομάδα…', 'Send a database to the team…'), onClick: () => openSend({ team: t.id }), disabled: !ok },
        { label: L('Μέλη και ρυθμίσεις…', 'Members and settings…'), onClick: () => useSocial.setState({ teamView: t.id }) },
        { separator: true, label: '' },
        { label: L('Αναφορά ομάδας…', 'Report team…'), disabled: !ok, onClick: () => openReport({ team: t.id }, t.name) },
        { label: L('Αποχώρηση από την ομάδα…', 'Leave the team…'), danger: true, disabled: !ok, onClick: () => leaveTeam(t) },
      ],
    });

  const teamRow = (t: TeamRow) => (
    <div
      key={t.id}
      className="fr-row"
      role="button"
      tabIndex={0}
      title={L('Κλικ: chat της ομάδας · δεξί κλικ: περισσότερα', 'Click: team chat · right-click: more')}
      onClick={() => openChat(teamKey(t.id))}
      onKeyDown={(e) => e.key === 'Enter' && openChat(teamKey(t.id))}
      onContextMenu={(e) => {
        e.preventDefault();
        teamMenu(t, e.clientX, e.clientY);
      }}
    >
      <TeamAvatar t={t} />
      <span className="fr-who">
        <span className="fr-name">{t.name}</span>
        <span className="fr-status">
          {L(`${t.count} ${t.count === 1 ? 'μέλος' : 'μέλη'}`, `${t.count} ${t.count === 1 ? 'member' : 'members'}`)}
          {t.role !== 'member' ? ` · ${roleLabel(t.role)}` : ''}
        </span>
      </span>
      {t.unread > 0 && <span className="fr-unread">{t.unread}</span>}
      <button
        type="button"
        className="icon-btn fr-more"
        aria-label={L('Περισσότερα', 'More')}
        onClick={(e) => {
          e.stopPropagation();
          teamMenu(t, e.clientX, e.clientY);
        }}
      >
        <MoreVertical size={15} />
      </button>
    </div>
  );

  const teamInviteRow = (t: TeamRow) => (
    <div key={`ti-${t.id}`} className="fr-row fr-req">
      <TeamAvatar t={t} />
      <span className="fr-who">
        <span className="fr-name">{t.name}</span>
        <span className="fr-status">{t.by ? L(`Πρόσκληση σε ομάδα από ${t.by}`, `Team invitation from ${t.by}`) : L('Πρόσκληση σε ομάδα', 'Team invitation')}</span>
      </span>
      <button type="button" className="icon-btn fr-yes" title={L('Αποδοχή', 'Accept')} aria-label={L('Αποδοχή', 'Accept')} disabled={!ok} onClick={() => socialSend({ t: 'team_accept', team: t.id })}>
        <Check size={16} />
      </button>
      <button type="button" className="icon-btn" title={L('Απόρριψη', 'Decline')} aria-label={L('Απόρριψη', 'Decline')} disabled={!ok} onClick={() => socialSend({ t: 'team_decline', team: t.id })}>
        <X size={16} />
      </button>
    </div>
  );

  const row = (f: Friend) => {
    const g = liGame(f);
    const sp = shown(f);
    // πρόσκληση του φίλου που περιμένει απάντηση: ✓/✗ πάνω στη γραμμή (ίδια με την ειδοποίηση πάνω δεξιά)
    const pend = invites.find((i) => !i.team && i.peer === f.id && Date.now() - i.m.at < 15 * 60_000);
    const inv = pend ? parseInvite(pend.m) : null;
    const detail = inv ? inviteDetail(inv) : '';
    return (
      <div
        key={f.id}
        className={`fr-row s-${sp.s}${inv ? ' fr-inv' : ''}`}
        role="button"
        tabIndex={0}
        title={L('Κλικ: μήνυμα · δεξί κλικ: περισσότερα', 'Click: message · right-click: more')}
        onMouseEnter={() => g?.id && loadGameInfo(g.id)}
        onClick={() => openChat(f.id)}
        onKeyDown={(e) => e.key === 'Enter' && openChat(f.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          friendMenu(f, e.clientX, e.clientY);
        }}
      >
        <Avatar id={f.id} name={f.name} p={sp} />
        <span className="fr-who">
          <span className="fr-name">
            {f.name}
            <span className="fr-tag">#{f.tag}</span>
          </span>
          {pend && inv ? (
            <span className="fr-status s-inv" title={detail || undefined}>
              {inv.kind === 'game' ? <Swords size={11} aria-hidden /> : <Radio size={11} aria-hidden />}{' '}
              {inv.kind === 'game' ? L('Σε καλεί σε παρτίδα', 'Invites you to a game') : L('Σε καλεί σε κοινή ανάλυση', 'Invites you to a shared analysis')}
              {detail && ` · ${detail}`}
            </span>
          ) : g ? (
            <span className="fr-status s-game" title={lichessGameText(g, g.id ? liGames[g.id]?.move : undefined)}>
              In game
            </span>
          ) : (
            <span className={`fr-status s-${f.p.s}`}>{statusLabel(f.p)}</span>
          )}
        </span>
        {g?.id && (
          <button
            type="button"
            className="icon-btn fr-watch"
            title={lichessGameText(g, liGames[g.id]?.move)}
            aria-label={L('Παρακολούθηση της παρτίδας στο Lichess', 'Watch the game on Lichess')}
            onClick={(e) => {
              e.stopPropagation();
              watchLichess(f, g);
            }}
          >
            <Eye size={15} />
          </button>
        )}
        {pend && inv && (
          <span className="fr-inv-acts" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <button type="button" className="icon-btn fr-yes" title={L('Αποδοχή', 'Accept')} aria-label={L('Αποδοχή', 'Accept')} disabled={!ok} onClick={() => acceptInvite(pend.m)}>
              <Check size={16} strokeWidth={3} />
            </button>
            <button type="button" className="icon-btn fr-no" title={L('Όχι τώρα', 'Not now')} aria-label={L('Όχι τώρα', 'Not now')} onClick={() => declineInvite(pend.m)}>
              <X size={16} strokeWidth={3} />
            </button>
          </span>
        )}
        {f.unread > 0 && <span className="fr-unread">{f.unread}</span>}
        {/* γρήγορες ενέργειες (φαίνονται με το ποντίκι πάνω στη γραμμή) */}
        <span className="fr-quick" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {f.p.s !== 'offline' && (
            <>
              <button type="button" className="icon-btn" title={L('Πρόσκληση σε παρτίδα…', 'Invite to a game…')} aria-label={L('Πρόσκληση σε παρτίδα…', 'Invite to a game…')} disabled={!ok} onClick={() => inviteFriend(f.id, 'game')}>
                <Swords size={15} />
              </button>
              <button type="button" className="icon-btn" title={L('Πρόσκληση σε κοινή ανάλυση…', 'Invite to a shared analysis…')} aria-label={L('Πρόσκληση σε κοινή ανάλυση…', 'Invite to a shared analysis…')} disabled={!ok} onClick={() => inviteFriend(f.id, 'analysis')}>
                <Radio size={15} />
              </button>
            </>
          )}
          <button type="button" className="icon-btn" title={L('Μήνυμα', 'Message')} aria-label={L('Μήνυμα', 'Message')} onClick={() => openChat(f.id)}>
            <MessageSquare size={15} />
          </button>
        </span>
        <button
          type="button"
          className="icon-btn fr-more"
          aria-label={L('Περισσότερα', 'More')}
          onClick={(e) => {
            e.stopPropagation();
            friendMenu(f, e.clientX, e.clientY);
          }}
        >
          <MoreVertical size={15} />
        </button>
      </div>
    );
  };

  const requestRow = (f: Friend) => (
    <div
      key={f.id}
      className="fr-row fr-req"
      onContextMenu={(e) => {
        e.preventDefault();
        friendMenu(f, e.clientX, e.clientY);
      }}
    >
      <Avatar id={f.id} name={f.name} />
      <span className="fr-who">
        <span className="fr-name">
          {f.name}
          <span className="fr-tag">#{f.tag}</span>
        </span>
        <span className="fr-status">{f.state === 'in' ? L('Θέλει να γίνετε φίλοι', 'Wants to be friends') : L('Περιμένει απάντηση', 'Waiting for an answer')}</span>
      </span>
      {f.state === 'in' && (
        <button type="button" className="icon-btn fr-yes" title={L('Αποδοχή', 'Accept')} aria-label={L('Αποδοχή', 'Accept')} disabled={!ok} onClick={() => socialSend({ t: 'accept', id: f.id })}>
          <Check size={16} />
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        title={f.state === 'in' ? L('Απόρριψη', 'Decline') : L('Ακύρωση αιτήματος', 'Cancel request')}
        aria-label={f.state === 'in' ? L('Απόρριψη', 'Decline') : L('Ακύρωση αιτήματος', 'Cancel request')}
        disabled={!ok}
        onClick={() => socialSend({ t: 'remove', id: f.id })}
      >
        <X size={16} />
      </button>
    </div>
  );

  const conn =
    status === 'open'
      ? null
      : status === 'bad'
        ? L('Ο server δεν δέχτηκε το κλειδί αυτού του υπολογιστή. Βγες (μενού ⋮) και μπες με τον κωδικό ανάκτησης.', 'The server rejected this computer’s key. Sign out (menu ⋮) and sign in with the recovery code.')
        : status === 'gone'
          ? L('Ο λογαριασμός δεν υπάρχει σε αυτόν τον server.', 'This account does not exist on this server.')
          : status === 'retrying'
            ? L('Χωρίς σύνδεση· ξαναπροσπαθώ…', 'Offline; reconnecting…')
            : L('Σύνδεση…', 'Connecting…');

  return (
    <div className="fr-panel tx">
      <div className="fr-me" onMouseEnter={() => myGame?.id && loadGameInfo(myGame.id)}>
        <Avatar id={acc.userId} name={acc.name} p={{ s: myGame ? 'game' : ok ? 'online' : 'offline' }} size={36} />
        <span className="fr-who">
          <span className="fr-name">
            {acc.name}
            <span className="fr-tag">#{acc.tag}</span>
          </span>
          {myGame ? (
            <span className="fr-status s-game" title={lichessGameText(myGame, myGame.id ? liGames[myGame.id]?.move : undefined)}>
              In game
            </span>
          ) : (
            <span className={`fr-status s-${ok ? 'online' : 'offline'}`}>{ok ? 'Online' : conn}</span>
          )}
        </span>
        {myGame?.id && myLichess && (
          <button
            type="button"
            className="icon-btn fr-watch"
            title={lichessGameText(myGame, liGames[myGame.id]?.move)}
            aria-label={L('Η παρτίδα μου στο Lichess (live σκακιέρα)', 'My game on Lichess (live board)')}
            onClick={() => watchLichessGame(myLichess, myGame)}
          >
            <Eye size={15} />
          </button>
        )}
        <button type="button" className="icon-btn" title={L('Νέα ομάδα', 'New team')} aria-label={L('Νέα ομάδα', 'New team')} disabled={!ok} onClick={() => useSocial.setState({ newTeam: true })}>
          <Users size={15} />
        </button>
        <button type="button" className="icon-btn" title={L('Αντιγραφή του ονόματός σου', 'Copy your name')} aria-label={L('Αντιγραφή του ονόματός σου', 'Copy your name')} onClick={() => void navigator.clipboard?.writeText(`${acc.name}#${acc.tag}`)}>
          <Copy size={15} />
        </button>
        <button type="button" className="icon-btn" title={L('Περισσότερα', 'More')} aria-label={L('Περισσότερα', 'More')} onClick={(e) => meMenu(e.clientX, e.clientY)}>
          <MoreVertical size={16} />
        </button>
      </div>
      {conn && status !== 'connecting' && status !== 'retrying' && <div className="play-note fr-note">{conn}</div>}

      <form
        className="fr-add"
        onSubmit={(e) => {
          e.preventDefault();
          submitAdd();
        }}
      >
        <input
          className="input"
          value={add}
          placeholder={L('Προσθήκη φίλου: Όνομα#1234', 'Add a friend: Name#1234')}
          aria-label={L('Προσθήκη φίλου (Όνομα#TAG)', 'Add a friend (Name#TAG)')}
          onChange={(e) => {
            setAdd(e.target.value);
            setAddError(null);
            if (addResult) clearAddResult();
          }}
        />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={!ok || !add.trim()} title={L('Αποστολή αιτήματος φιλίας', 'Send a friend request')}>
          <UserPlus className="ic ic-sm" aria-hidden />
        </button>
      </form>
      {(addError || addResult) && <div className={`fr-add-result small${addError || !addResult?.ok ? ' is-error' : ''}`}>{addError ?? addResult?.text}</div>}

      <div className="fr-list">
        {group('req', L('Αιτήματα', 'Requests'), [...teamInvites.map(teamInviteRow), ...requests.map(requestRow)])}
        {group('teams', L('Ομάδες', 'Teams'), myTeams.map(teamRow))}
        {group('on', 'Online', online.map(row))}
        {group('off', L('Εκτός σύνδεσης', 'Offline'), offline.map(row))}
        {ok && !friends.length && (
          <p className="faint small fr-empty">
            {L(
              `Δεν έχεις φίλους ακόμη. Γράψε πάνω το Όνομα#TAG ενός φίλου σου, και στείλε του το δικό σου: ${acc.name}#${acc.tag}.`,
              `No friends yet. Type a friend’s Name#TAG above, and send them yours: ${acc.name}#${acc.tag}.`,
            )}
          </p>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {showCode && <CodeDialog acc={acc} onClose={() => useSocial.setState({ showCode: false })} />}
      {dialog === 'blocked' && <BlockedDialog onClose={() => setDialog(null)} />}
      {dialog === 'accounts' && <AccountsDialog onClose={() => setDialog(null)} />}
      {profile && <ProfileDialog id={profile} game={(f) => liGame(f)} onWatch={watchLichess} onClose={() => setProfile(null)} />}
    </div>
  );
}

/** Τα usernames μου σε Lichess / Chess.com: τα βλέπουν οι φίλοι μου (και αν παίζω στο Lichess). */
export function AccountsDialog({ onClose }: { onClose: () => void }) {
  const myAcc = useSocial((s) => s.myAcc);
  const [li, setLi] = useState(myAcc?.lichess ?? '');
  const [cc, setCc] = useState(myAcc?.chesscom ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const acc: Accounts = {};
    for (const [k, v, site] of [['lichess', li, 'Lichess'], ['chesscom', cc, 'Chess.com']] as const) {
      if (!v.trim()) continue;
      const u = cleanSiteUser(v);
      if (!u) return setError(L(`Το username στο ${site} θέλει λατινικά γράμματα, ψηφία, _ ή - (2–25).`, `The ${site} username needs Latin letters, digits, _ or - (2–25).`));
      acc[k] = u;
    }
    if (!setAccounts(acc.lichess || acc.chesscom ? acc : null)) return setError(L('Δεν υπάρχει σύνδεση με τον server των Φίλων.', 'Not connected to the Friends server.'));
    onClose();
  };
  return (
    <Dialog
      title={L('Lichess και Chess.com', 'Lichess and Chess.com')}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button onClick={onClose}>{L('Άκυρο', 'Cancel')}</button>
          <button className="primary" onClick={save}>
            {L('Αποθήκευση', 'Save')}
          </button>
        </>
      }
    >
      <form
        className="fr-acc-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="small muted">
          {L(
            'Τα usernames σου τα βλέπουν μόνο οι φίλοι σου. Όταν παίζεις στο Lichess, βλέπουν ότι είσαι σε παρτίδα και μπορούν να την παρακολουθήσουν.',
            'Only your friends see your usernames. When you play on Lichess, they see that you are in a game and can watch it.',
          )}
        </p>
        <label className="fr-acc-field">
          <span>Lichess</span>
          <input
            className="input"
            value={li}
            placeholder="username"
            autoFocus
            onChange={(e) => {
              setLi(e.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="fr-acc-field">
          <span>Chess.com</span>
          <input
            className="input"
            value={cc}
            placeholder="username"
            onChange={(e) => {
              setCc(e.target.value);
              setError(null);
            }}
          />
        </label>
        {error && <div className="small is-error fr-add-result">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Προφίλ φίλου: Όνομα#TAG, τι κάνει και τα usernames του σε Lichess / Chess.com (με link). */
function ProfileDialog({ id, game, onWatch, onClose }: { id: string; game: (f: Friend) => LichessGame | undefined; onWatch: (f: Friend, g: LichessGame) => void; onClose: () => void }) {
  const f = useSocial((s) => s.friends.find((x) => x.id === id));
  const games = useLichessFriends((s) => s.games);
  if (!f) return null;
  const g = game(f);
  const link = (site: string, u: string, url: string) => (
    <div className="fr-acc-link">
      <span className="muted">{site}</span>
      <button type="button" className="btn btn-ghost btn-sm" title={url} onClick={() => openLink(url)}>
        {u}
        <ExternalLink className="ic ic-sm" aria-hidden />
      </button>
    </div>
  );
  return (
    <Dialog title={L('Προφίλ', 'Profile')} onClose={onClose} width={380}>
      <div className="fr-row fr-profile">
        <Avatar id={f.id} name={f.name} p={f.p.s === 'offline' && g ? { s: 'game' } : f.p} size={40} />
        <span className="fr-who">
          <span className="fr-name">
            {f.name}
            <span className="fr-tag">#{f.tag}</span>
          </span>
          <span className={`fr-status s-${g ? 'game' : f.p.s}`}>{g ? lichessGameText(g, g.id ? games[g.id]?.move : undefined).split('\n')[0] : statusLabel(f.p)}</span>
        </span>
        {g?.id && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onWatch(f, g)}>
            <Eye className="ic ic-sm" aria-hidden />
            {L('Παρακολούθηση', 'Watch')}
          </button>
        )}
      </div>
      {f.acc?.lichess && link('Lichess', f.acc.lichess, lichessProfile(f.acc.lichess))}
      {f.acc?.chesscom && link('Chess.com', f.acc.chesscom, chesscomProfile(f.acc.chesscom))}
      {!f.acc && <p className="small muted">{L('Δεν έχει δηλώσει username σε Lichess ή Chess.com.', 'No Lichess or Chess.com username yet.')}</p>}
    </Dialog>
  );
}

function CodeDialog({ acc, onClose }: { acc: SocialAccount; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const code = recoveryCode(acc.key);
  return (
    <Dialog
      title={L('Κωδικός ανάκτησης', 'Recovery code')}
      onClose={onClose}
      width={460}
      footer={
        <button className="primary" onClick={onClose}>
          {L('Τον κράτησα', 'I have saved it')}
        </button>
      }
    >
      <p className="small">
        {L(
          `Το όνομά σου είναι ${acc.name}#${acc.tag}. Με αυτόν τον κωδικό μπαίνεις στον λογαριασμό σου από άλλον υπολογιστή (ή αν ξαναστήσεις τον δικό σου). Κράτησέ τον κάπου ασφαλή και μην τον δίνεις σε κανέναν.`,
          `Your name is ${acc.name}#${acc.tag}. With this code you can use your account on another computer (or after reinstalling this one). Keep it somewhere safe and do not give it to anyone.`,
        )}
      </p>
      <div className="fr-code">
        <code className="tnum">{code}</code>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() =>
            void navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          {copied ? <Check className="ic ic-sm" aria-hidden /> : <Copy className="ic ic-sm" aria-hidden />}
          {copied ? L('Αντιγράφηκε', 'Copied') : L('Αντιγραφή', 'Copy')}
        </button>
      </div>
    </Dialog>
  );
}

function BlockedDialog({ onClose }: { onClose: () => void }) {
  const blocked = useSocial((s) => s.blocked);
  return (
    <Dialog title={L('Μπλοκαρισμένοι', 'Blocked')} onClose={onClose} width={420}>
      {!blocked.length && <p className="muted small">{L('Δεν έχεις μπλοκάρει κανέναν.', 'You have not blocked anyone.')}</p>}
      {blocked.map((p) => (
        <div key={p.id} className="fr-row">
          <Avatar id={p.id} name={p.name} />
          <span className="fr-who">
            <span className="fr-name">
              {p.name}
              <span className="fr-tag">#{p.tag}</span>
            </span>
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => (onClose(), openReport({ id: p.id }, fullName(p)))}>
            {L('Αναφορά', 'Report')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => socialSend({ t: 'unblock', id: p.id })}>
            {L('Ξεμπλοκάρισμα', 'Unblock')}
          </button>
        </div>
      ))}
    </Dialog>
  );
}
