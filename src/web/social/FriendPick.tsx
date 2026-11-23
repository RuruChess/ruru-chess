/**
 * Οι Φίλοι μέσα στις καρτέλες «Παίξε με φίλο» και «Κοινή ανάλυση»:
 *  - `GameFriendList`: οι online φίλοι κάτω από το «Φτιάξε link»· «Πρόσκληση» = παρτίδα με το χρώμα και το
 *    ρολόι της κάρτας.
 *  - `AnalysisInvitePick`: κουτάκια για φίλους και ομάδες· η πρόσκληση φεύγει μόλις ξεκινήσει η ανάλυση.
 *  - `ShareInvite`: «Κάλεσε φίλους» μέσα σε κοινή ανάλυση που τρέχει.
 */
import { useState } from 'react';
import { Check, Swords, UserPlus } from 'lucide-react';
import type { Friend, TeamRow } from '../../core/social.ts';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { accountOf, inviteToGame, inviteToRoom, SOCIAL_HERE, togglePending, useSocial, type InviteInfo } from './social.ts';
import { Avatar, statusLabel, TeamAvatar } from './FriendsPanel.tsx';
import './social.css';

type Color = 'white' | 'black' | 'random';

const ORDER = { analysis: 0, game: 1, online: 1, away: 2, offline: 3 } as const;
const sortFriends = (a: Friend, b: Friend) => ORDER[a.p.s] - ORDER[b.p.s] || a.name.localeCompare(b.name);
const trim = (s: string) => s.replace(/\/+$/, '');

/** Ο λογαριασμός των Φίλων, μόνο στο κύριο παράθυρο (εκεί είναι η σύνδεση). */
function useAccount() {
  const ui = useApp((s) => s.settings?.ui) as Record<string, unknown> | undefined;
  return SOCIAL_HERE ? accountOf(ui) : null;
}

function useFriends() {
  const friends = useSocial((s) => s.friends);
  const accepted = friends.filter((f) => f.state === 'friend');
  const online = accepted.filter((f) => f.p.s !== 'offline').sort(sortFriends);
  return { accepted, online, offline: accepted.length - online.length };
}

function Who({ f }: { f: Friend }) {
  return (
    <>
      <Avatar id={f.id} name={f.name} p={f.p} size={28} />
      <span className="fr-who">
        <span className="fr-name">
          {f.name}
          <span className="fr-tag">#{f.tag}</span>
        </span>
        <span className={`fr-status s-${f.p.s}`}>{statusLabel(f.p)}</span>
      </span>
    </>
  );
}

function TeamWho({ t }: { t: TeamRow }) {
  return (
    <>
      <TeamAvatar t={t} size={28} />
      <span className="fr-who">
        <span className="fr-name">{t.name}</span>
        <span className="fr-status">{L(`όλη η ομάδα · ${t.count} ${t.count === 1 ? 'μέλος' : 'μέλη'}`, `whole team · ${t.count} ${t.count === 1 ? 'member' : 'members'}`)}</span>
      </span>
    </>
  );
}

/** Μηνύματα όταν δεν υπάρχει ποιον να καλέσεις (ή null όταν υπάρχει). */
function emptyNote(status: string, accepted: number, online: number): string | null {
  if (status === 'terms') return L('Δέξου πρώτα τους όρους στη στήλη «Φίλοι» των Βάσεων.', 'First accept the terms in the Friends column of Databases.');
  if (status !== 'open') return L('Σύνδεση με τους Φίλους…', 'Connecting to Friends…');
  if (!accepted) return L('Δεν έχεις ακόμη φίλους· πρόσθεσέ τους στη στήλη «Φίλοι» των Βάσεων.', 'No friends yet; add them in the Friends column of Databases.');
  if (!online) return L('Κανείς φίλος δεν είναι online τώρα.', 'No friend is online right now.');
  return null;
}

// ---------------------------------------------------------------------------
// «Παίξε με φίλο»

export function GameFriendList({ color, tc, onSend }: { color: Color; tc: string; onSend?: () => void }) {
  const acc = useAccount();
  const status = useSocial((s) => s.status);
  const { accepted, online, offline } = useFriends();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!SOCIAL_HERE) return null;
  const head = (
    <div className="kb-card-h">
      <h2>{L('ή κάλεσε φίλο', 'or invite a friend')}</h2>
      {acc && status === 'open' && online.length > 0 && (
        <span className="kb-pill plain">
          <span className="kb-dot on" />
          {online.length} online
        </span>
      )}
    </div>
  );
  if (!acc)
    return (
      <section className="kb-card ff" aria-label={L('Κάλεσε φίλο', 'Invite a friend')}>
        {head}
        <p className="ff-hint">
          {L('Με λογαριασμό στους Φίλους (στήλη «Φίλοι» στις Βάσεις) καλείς φίλους κατευθείαν από εδώ.', 'With a Friends account (the Friends column in Databases) you can invite friends straight from here.')}
        </p>
      </section>
    );
  const note = emptyNote(status, accepted.length, online.length);

  const send = async (f: Friend) => {
    setBusy(f.id);
    setError(null);
    onSend?.();
    // η «Παίξε με φίλο» ανοίγει την παρτίδα (που περιμένει τον φίλο) μόλις φύγει η πρόσκληση
    const e = await inviteToGame(f.id, { color, tc });
    setBusy(null);
    if (e) setError(e);
  };

  return (
    <section className="kb-card ff" aria-label={L('Κάλεσε φίλο', 'Invite a friend')}>
      {head}
      {note ? (
        <p className="ff-hint">{note}</p>
      ) : (
        <div className="ff-list">
          {online.map((f) => (
            <div key={f.id} className="ff-row">
              <Who f={f} />
              <button type="button" className="kb-btn sm" disabled={busy !== null} onClick={() => void send(f)}>
                <Swords aria-hidden />
                {busy === f.id ? L('Αποστολή…', 'Sending…') : L('Πρόσκληση', 'Invite')}
              </button>
            </div>
          ))}
        </div>
      )}
      {status === 'open' && offline > 0 && <p className="ff-foot">{L(`${offline} εκτός σύνδεσης`, `${offline} offline`)}</p>}
      {error && <div className="kb-callout danger ff-err">{error}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// «Κοινή ανάλυση»: πριν ξεκινήσει

export function AnalysisInvitePick() {
  const acc = useAccount();
  const status = useSocial((s) => s.status);
  const pending = useSocial((s) => s.pending);
  const teams = useSocial((s) => s.teams);
  const friends = useSocial((s) => s.friends);
  const { accepted, online } = useFriends();
  if (!acc) return null;
  const myTeams = teams.filter((t) => t.state === 'member').sort((a, b) => a.name.localeCompare(b.name));
  // οι online φίλοι, και όσοι έχουν ήδη επιλεγεί (π.χ. από τη στήλη «Φίλοι») ακόμη κι αν είναι εκτός σύνδεσης
  const shown = [...online, ...friends.filter((f) => f.state === 'friend' && f.p.s === 'offline' && pending?.peers.includes(f.id))];
  const note = myTeams.length ? (status === 'open' ? null : emptyNote(status, 0, 0)) : emptyNote(status, accepted.length, shown.length);

  return (
    <section className="kb-card ff" aria-label={L('Κάλεσε φίλους', 'Invite friends')}>
      <div className="kb-card-h">
        <h2>{L('Κάλεσε φίλους', 'Invite friends')}</h2>
        {status === 'open' && online.length > 0 && (
          <span className="kb-pill plain">
            <span className="kb-dot on" />
            {online.length} online
          </span>
        )}
      </div>
      {note ? (
        <p className="ff-hint">{note}</p>
      ) : (
        <>
          <div className="ff-list">
            {myTeams.map((t) => (
              <label key={t.id} className="ff-row ff-check">
                <input type="checkbox" aria-label={t.name} checked={Boolean(pending?.teams.includes(t.id))} onChange={(e) => togglePending({ team: t.id }, e.target.checked)} />
                <TeamWho t={t} />
              </label>
            ))}
            {shown.map((f) => (
              <label key={f.id} className="ff-row ff-check">
                <input type="checkbox" aria-label={`${f.name}#${f.tag}`} checked={Boolean(pending?.peers.includes(f.id))} onChange={(e) => togglePending({ peer: f.id }, e.target.checked)} />
                <Who f={f} />
              </label>
            ))}
          </div>
          {!shown.length && <p className="ff-hint">{L('Κανείς φίλος δεν είναι online τώρα.', 'No friend is online right now.')}</p>}
          <p className="ff-foot">{L('Η πρόσκληση φεύγει μόλις ξεκινήσει η ανάλυση.', 'The invitation goes out as soon as the analysis starts.')}</p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// «Κοινή ανάλυση»: ενώ τρέχει

export function ShareInvite({ server, room, info }: { server: string; room: string; info?: InviteInfo }) {
  const acc = useAccount();
  const status = useSocial((s) => s.status);
  const teams = useSocial((s) => s.teams);
  const { accepted, online } = useFriends();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  // το δωμάτιο πρέπει να είναι στον ίδιο server με τους Φίλους, αλλιώς ο φίλος δεν μπορεί να μπει
  if (!acc || trim(acc.server) !== trim(server)) return null;
  const myTeams = teams.filter((t) => t.state === 'member').sort((a, b) => a.name.localeCompare(b.name));
  const note = myTeams.length ? (status === 'open' ? null : emptyNote(status, 0, 0)) : emptyNote(status, accepted.length, online.length);

  const send = (key: string, t: { peer?: string; team?: string }) => {
    if (inviteToRoom(t, 'analysis', room, info)) setSent((s) => [...s, key]);
  };
  const button = (key: string, t: { peer?: string; team?: string }) => {
    const done = sent.includes(key);
    return (
      <button type="button" className="sa-btn" disabled={done || status !== 'open'} onClick={() => send(key, t)}>
        {done ? <Check size={14} aria-hidden /> : <UserPlus size={14} aria-hidden />}
        {done ? L('Στάλθηκε', 'Sent') : L('Πρόσκληση', 'Invite')}
      </button>
    );
  };

  return (
    <>
      <button type="button" className="sa-toggle faint small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} {L('Κάλεσε φίλους', 'Invite friends')}
      </button>
      {open && (
        <div className="fp fp-live tx">
          {note ? (
            <p className="fp-hint faint small">{note}</p>
          ) : (
            <div className="fp-list">
              {myTeams.map((t) => (
                <div key={t.id} className="fp-row">
                  <TeamWho t={t} />
                  {button(`t:${t.id}`, { team: t.id })}
                </div>
              ))}
              {online.map((f) => (
                <div key={f.id} className="fp-row">
                  <Who f={f} />
                  {button(f.id, { peer: f.id })}
                </div>
              ))}
              {!online.length && <p className="fp-hint faint small">{L('Κανείς φίλος δεν είναι online τώρα.', 'No friend is online right now.')}</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
