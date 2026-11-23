/**
 * Ομάδες: «Νέα ομάδα» και το παράθυρο μιας ομάδας (μέλη με παρουσία και ρόλους, πρόσκληση φίλων, μετονομασία,
 * κοινή ανάλυση για όλη την ομάδα, αποχώρηση). Ανοίγουν από τη στήλη «Φίλοι» ή από το chat της ομάδας.
 */
import { useEffect, useRef, useState } from 'react';
import { Crown, MessageSquare, MoreVertical, Pencil, Radio, Shield, X } from 'lucide-react';
import { cleanTeamName, type TeamMember } from '../../core/social.ts';
import { L } from '../i18n.ts';
import { ContextMenu, Dialog, type MenuItem } from '../components/ui.tsx';
import { inviteTeamAnalysis, openChat, openReport, socialSend, teamKey, useSocial } from './social.ts';
import { Avatar, leaveTeam, roleLabel, statusLabel, TeamAvatar } from './FriendsPanel.tsx';
import '../tactics/tactics.css';
import '../play/play.css';
import './social.css';

export function TeamDialogs() {
  const view = useSocial((s) => s.teamView);
  const creating = useSocial((s) => s.newTeam);
  return (
    <>
      {creating && <NewTeam />}
      {view && <TeamView key={view} id={view} />}
    </>
  );
}

function NewTeam() {
  const teams = useSocial((s) => s.teams);
  const ok = useSocial((s) => s.status === 'open');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const before = useRef(new Set(teams.map((t) => t.id)));
  const close = () => useSocial.setState({ newTeam: false });

  // η νέα ομάδα εμφανίστηκε στη λίστα: ανοίγει το παράθυρό της, για να καλέσεις φίλους
  useEffect(() => {
    const t = teams.find((x) => !before.current.has(x.id) && x.role === 'owner');
    if (t) useSocial.setState({ newTeam: false, teamView: t.id });
  }, [teams]);

  const create = () => {
    const n = cleanTeamName(name);
    if (!n) return setError(L('Το όνομα θέλει 3–24 γράμματα ή ψηφία (και κενά, - _ . ανάμεσα).', 'The name needs 3–24 letters or digits (spaces, - _ . allowed in between).'));
    setError(null);
    if (socialSend({ t: 'team_create', name: n })) setBusy(true);
    // αν ο server πει όχι (όριο, όνομα), έρχεται μήνυμα και το κουμπί ξαναενεργοποιείται
    setTimeout(() => setBusy(false), 4000);
  };

  return (
    <Dialog
      title={L('Νέα ομάδα', 'New team')}
      onClose={close}
      width={420}
      footer={
        <button className="primary" disabled={!ok || busy || !name.trim()} onClick={create}>
          {busy ? L('Δημιουργία…', 'Creating…') : L('Δημιουργία', 'Create')}
        </button>
      }
    >
      <div className="tx tm-body">
        <p className="small" style={{ margin: 0 }}>
          {L(
            'Η ομάδα έχει δικό της chat και κοινή ανάλυση για όλα τα μέλη με ένα κουμπί. Μετά καλείς όποιους φίλους σου θέλεις.',
            'A team has its own chat, and a shared analysis for all members with one button. Then you invite the friends you want.',
          )}
        </p>
        <label className="play-opt">
          <span className="field-label">{L('Όνομα της ομάδας', 'Team name')}</span>
          <input
            className="input"
            autoFocus
            maxLength={24}
            value={name}
            placeholder={L('π.χ. Σκακιστές Θεσσαλονίκης', 'e.g. Chess Club')}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && !busy && create()}
          />
        </label>
        {error && <div className="play-note">{error}</div>}
      </div>
    </Dialog>
  );
}

const RANK = { owner: 0, admin: 1, member: 2 } as const;

function TeamView({ id }: { id: string }) {
  const t = useSocial((s) => s.teams.find((x) => x.id === id));
  const info = useSocial((s) => s.teamInfo[id]);
  const friends = useSocial((s) => s.friends);
  const blocked = useSocial((s) => s.blocked);
  const me = useSocial((s) => s.me);
  const ok = useSocial((s) => s.status === 'open');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const close = () => useSocial.setState({ teamView: null });

  // μέλη και παρουσία: τώρα, και ξανά κάθε μισό λεπτό όσο είναι ανοιχτό
  useEffect(() => {
    socialSend({ t: 'team_get', team: id });
    const timer = setInterval(() => socialSend({ t: 'team_get', team: id }), 30_000);
    return () => clearInterval(timer);
  }, [id]);

  // η ομάδα δεν υπάρχει πια για μένα (αποχώρηση, αφαίρεση): κλείνει
  useEffect(() => {
    if (!t || t.state !== 'member') close();
  }, [t]);
  if (!t || t.state !== 'member') return null;

  const owner = t.role === 'owner';
  const lead = t.role !== 'member';
  const members = [...(info?.members ?? [])].sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name));
  const inside = new Set([...(info?.members ?? []).map((m) => m.id), ...(info?.invites ?? []).map((p) => p.id)]);
  const invitable = friends.filter((f) => f.state === 'friend' && !inside.has(f.id)).sort((a, b) => a.name.localeCompare(b.name));

  const memberItems = (m: TeamMember): MenuItem[] => {
    const items: MenuItem[] = [];
    if (m.id === me?.id) return items;
    if (friends.some((f) => f.id === m.id && f.state === 'friend')) items.push({ label: L('Μήνυμα', 'Message'), onClick: () => openChat(m.id) });
    else if (!friends.some((f) => f.id === m.id)) items.push({ label: L('Αίτημα φιλίας', 'Send a friend request'), onClick: () => socialSend({ t: 'add', name: m.name, tag: m.tag }), disabled: !ok });
    if (owner) {
      items.push({ separator: true, label: '' });
      if (m.role === 'member') items.push({ label: L('Κάνε τον/την διαχειριστή', 'Make admin'), onClick: () => socialSend({ t: 'team_role', team: id, id: m.id, role: 'admin' }), disabled: !ok });
      if (m.role === 'admin') items.push({ label: L('Κάνε τον/την απλό μέλος', 'Make member'), onClick: () => socialSend({ t: 'team_role', team: id, id: m.id, role: 'member' }), disabled: !ok });
      items.push({
        label: L('Κάνε τον/την ιδιοκτήτη…', 'Make owner…'),
        disabled: !ok,
        onClick: () => {
          if (window.confirm(L(`Ιδιοκτήτης της ομάδας θα γίνει ο/η ${m.name}#${m.tag} κι εσύ διαχειριστής. Συνέχεια;`, `${m.name}#${m.tag} becomes the team owner and you become an admin. Continue?`)))
            socialSend({ t: 'team_role', team: id, id: m.id, role: 'owner' });
        },
      });
    }
    if (owner || (t.role === 'admin' && m.role === 'member')) {
      items.push({ separator: true, label: '' });
      items.push({
        label: L('Αφαίρεση από την ομάδα', 'Remove from the team'),
        danger: true,
        disabled: !ok,
        onClick: () => {
          if (window.confirm(L(`Να αφαιρεθεί ο/η ${m.name}#${m.tag} από την ομάδα;`, `Remove ${m.name}#${m.tag} from the team?`))) socialSend({ t: 'team_kick', team: id, id: m.id });
        },
      });
    }
    items.push({ separator: true, label: '' });
    if (blocked.some((p) => p.id === m.id)) items.push({ label: L('Ξεμπλοκάρισμα', 'Unblock'), disabled: !ok, onClick: () => socialSend({ t: 'unblock', id: m.id }) });
    else
      items.push({
        label: L('Μπλοκ', 'Block'),
        danger: true,
        disabled: !ok,
        onClick: () => {
          if (window.confirm(L(`Μπλοκ στον/στην ${m.name}#${m.tag}; Δεν θα βλέπεις τα μηνύματά του/της στις ομάδες, δεν θα βλέπει αν είσαι online και δεν θα μπορεί να σου στείλει αίτημα.`, `Block ${m.name}#${m.tag}? You will not see their team messages, they will not see when you are online, and they cannot send you requests.`)))
            socialSend({ t: 'block', id: m.id, team: id });
        },
      });
    items.push({ label: L('Αναφορά…', 'Report…'), disabled: !ok, onClick: () => openReport({ team: id, id: m.id }, `${m.name}#${m.tag}`) });
    return items;
  };

  const rename = () => {
    const n = cleanTeamName(renaming ?? '');
    if (!n) return;
    if (n !== t.name) socialSend({ t: 'team_rename', team: id, name: n });
    setRenaming(null);
  };

  return (
    <Dialog
      title={L('Ομάδα', 'Team')}
      onClose={close}
      width={520}
      footer={
        <div className="tm-footer">
          <button className="danger-text" disabled={!ok} onClick={() => leaveTeam(t)}>
            {L('Αποχώρηση από την ομάδα…', 'Leave the team…')}
          </button>
          <button onClick={close}>{L('Κλείσιμο', 'Close')}</button>
        </div>
      }
    >
      <div className="tx tm-body">
        <div className="tm-head">
          <TeamAvatar t={t} size={44} />
          <span className="fr-who">
            <span className="tm-title">{t.name}</span>
            <span className="faint small">
              {L(`${t.count} ${t.count === 1 ? 'μέλος' : 'μέλη'} · εσύ: ${roleLabel(t.role)}`, `${t.count} ${t.count === 1 ? 'member' : 'members'} · you: ${roleLabel(t.role)}`)}
            </span>
          </span>
          {lead && renaming === null && (
            <button type="button" className="icon-btn" title={L('Μετονομασία', 'Rename')} aria-label={L('Μετονομασία', 'Rename')} disabled={!ok} onClick={() => setRenaming(t.name)}>
              <Pencil size={15} />
            </button>
          )}
        </div>
        {renaming !== null && (
          <form
            className="tm-rename"
            onSubmit={(e) => {
              e.preventDefault();
              rename();
            }}
          >
            <input className="input" autoFocus maxLength={24} value={renaming} aria-label={L('Νέο όνομα', 'New name')} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setRenaming(null))} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!cleanTeamName(renaming)}>
              OK
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(null)}>
              {L('Άκυρο', 'Cancel')}
            </button>
          </form>
        )}

        <div className="tm-actions">
          <button type="button" className="btn btn-primary btn-sm" disabled={!ok} onClick={() => inviteTeamAnalysis(id)} title={L('Ξεκίνα κοινή ανάλυση: όλα τα μέλη παίρνουν «Μπες»', 'Start a shared analysis: every member gets “Join”')}>
            <Radio className="ic ic-sm" aria-hidden />
            {L('Κοινή ανάλυση ομάδας', 'Team shared analysis')}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              openChat(teamKey(id));
              close();
            }}
          >
            <MessageSquare className="ic ic-sm" aria-hidden />
            {L('Συνομιλία', 'Chat')}
          </button>
        </div>

        <section className="tm-sec">
          <h4>
            {L('Μέλη', 'Members')} ({info?.members.length ?? t.count})
          </h4>
          <div className="tm-list">
            {!info && <div className="faint small">{L('Φόρτωση…', 'Loading…')}</div>}
            {members.map((m) => {
              const items = memberItems(m);
              return (
                <div
                  key={m.id}
                  className={`fr-row s-${m.p.s}`}
                  onContextMenu={(e) => {
                    if (!items.length) return;
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, items });
                  }}
                >
                  <Avatar id={m.id} name={m.name} p={m.p} />
                  <span className="fr-who">
                    <span className="fr-name">
                      {m.name}
                      <span className="fr-tag">#{m.tag}</span>
                      {m.id === me?.id && <span className="faint"> ({L('εσύ', 'you')})</span>}
                    </span>
                    <span className={`fr-status s-${m.p.s}`}>{statusLabel(m.p)}</span>
                  </span>
                  {m.role !== 'member' && (
                    <span className={`tm-role ${m.role}`}>
                      {m.role === 'owner' ? <Crown size={11} aria-hidden /> : <Shield size={11} aria-hidden />} {roleLabel(m.role)}
                    </span>
                  )}
                  {items.length > 0 && (
                    <button type="button" className="icon-btn" aria-label={L('Περισσότερα', 'More')} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, items })}>
                      <MoreVertical size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {lead ? (
          <section className="tm-sec">
            <h4>{L('Πρόσκληση φίλων', 'Invite friends')}</h4>
            <div className="tm-list">
              {info?.invites.map((p) => (
                <div key={p.id} className="fr-row">
                  <Avatar id={p.id} name={p.name} />
                  <span className="fr-who">
                    <span className="fr-name">
                      {p.name}
                      <span className="fr-tag">#{p.tag}</span>
                    </span>
                    <span className="fr-status">{L('Στάλθηκε πρόσκληση· περιμένει απάντηση', 'Invitation sent; waiting for an answer')}</span>
                  </span>
                  <button type="button" className="icon-btn" title={L('Ακύρωση της πρόσκλησης', 'Cancel the invitation')} aria-label={L('Ακύρωση της πρόσκλησης', 'Cancel the invitation')} disabled={!ok} onClick={() => socialSend({ t: 'team_kick', team: id, id: p.id })}>
                    <X size={15} />
                  </button>
                </div>
              ))}
              {invitable.map((f) => (
                <div key={f.id} className={`fr-row s-${f.p.s}`}>
                  <Avatar id={f.id} name={f.name} p={f.p} />
                  <span className="fr-who">
                    <span className="fr-name">
                      {f.name}
                      <span className="fr-tag">#{f.tag}</span>
                    </span>
                    <span className={`fr-status s-${f.p.s}`}>{statusLabel(f.p)}</span>
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!ok || !info} onClick={() => socialSend({ t: 'team_invite', team: id, peer: f.id })}>
                    {L('Πρόσκληση', 'Invite')}
                  </button>
                </div>
              ))}
              {info && !invitable.length && (
                <p className="faint small" style={{ margin: '4px 8px' }}>
                  {friends.some((f) => f.state === 'friend')
                    ? L('Όλοι οι φίλοι σου είναι ήδη μέσα ή έχουν πρόσκληση.', 'All your friends are already in or invited.')
                    : L('Πρώτα γίνε φίλος με όποιον θέλεις να καλέσεις (στήλη «Φίλοι» → Όνομα#TAG).', 'First become friends with whoever you want to invite (Friends column → Name#TAG).')}
                </p>
              )}
            </div>
          </section>
        ) : (
          <p className="faint small" style={{ margin: 0 }}>
            {L('Νέα μέλη καλεί ο ιδιοκτήτης ή ένας διαχειριστής της ομάδας.', 'New members are invited by the team owner or an admin.')}
          </p>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </Dialog>
  );
}
