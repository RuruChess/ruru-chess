/**
 * «Παρτίδα με …»: πρόσκληση σε παρτίδα με ένα βήμα. Χρώμα και ρολόι (όπως την τελευταία φορά) και «Στείλε
 * πρόσκληση»: φτιάχνεται η παρτίδα, φεύγει η πρόσκληση και ανοίγει η «Παίξε με φίλο» να περιμένει τον φίλο.
 */
import { useState } from 'react';
import { Swords } from 'lucide-react';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';
import { Dialog } from '../components/ui.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { TIME_CONTROLS } from '../windows/FriendWindow.tsx';
import { gameInProgress, inviteToGame, useSocial } from './social.ts';
import { Avatar } from './FriendsPanel.tsx';
import '../tactics/tactics.css';
import '../play/play.css';
import './social.css';

type Color = 'white' | 'black' | 'random';

export function InviteGameDialog() {
  const peer = useSocial((s) => s.gameDialog);
  return peer ? <InviteGame key={peer} peer={peer} /> : null;
}

function InviteGame({ peer }: { peer: string }) {
  const f = useSocial((s) => s.friends.find((x) => x.id === peer));
  const ui = (useApp((s) => s.settings?.ui) ?? {}) as Record<string, unknown>;
  const mem = (ui.friend ?? {}) as { color?: Color; tc?: string };
  const [color, setColor] = useState<Color>(mem.color ?? 'random');
  const [tc, setTc] = useState(mem.tc ?? '5+3');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => useSocial.setState({ gameDialog: null });
  if (!f) return null;
  const playing = gameInProgress();

  const send = async () => {
    setBusy(true);
    setError(null);
    setUiLater({ friend: { ...(ui.friend as object | undefined), color, tc } });
    const e = await inviteToGame(peer, { color, tc });
    setBusy(false);
    if (e) setError(e);
  };

  return (
    <Dialog
      title={L(`Παρτίδα με ${f.name}`, `Game with ${f.name}`)}
      onClose={close}
      width={420}
      footer={
        <button className="primary gi-send" disabled={busy || playing} onClick={() => void send()} autoFocus>
          <Swords size={16} aria-hidden />
          {busy ? L('Αποστολή…', 'Sending…') : L('Στείλε πρόσκληση', 'Send invitation')}
        </button>
      }
    >
      <div className="tx gi-body">
        <div className="gi-who">
          <Avatar id={f.id} name={f.name} p={f.p} size={36} />
          <span className="fr-who">
            <span className="fr-name">
              {f.name}
              <span className="fr-tag">#{f.tag}</span>
            </span>
            <span className="faint small">{L('Μόλις πατήσει ✓ στην ειδοποίηση, ξεκινάτε.', 'As soon as they press ✓ on the notification, you start.')}</span>
          </span>
        </div>
        <div className="play-opt">
          <span className="field-label">{L('Παίζω με', 'I play')}</span>
          <Segmented
            label={L('Παίζω με', 'I play')}
            value={color}
            onChange={setColor}
            options={[
              { value: 'white', label: L('Λευκά', 'White') },
              { value: 'black', label: L('Μαύρα', 'Black') },
              { value: 'random', label: L('Τυχαία', 'Random') },
            ]}
          />
        </div>
        <label className="play-opt">
          <span className="field-label">{L('Ρολόι', 'Clock')}</span>
          <select className="select" value={tc} onChange={(e) => setTc(e.target.value)}>
            <option value="">{L('Χωρίς ρολόι', 'No clock')}</option>
            {TIME_CONTROLS.map((t) => {
              const m = Number(t.split('+')[0]);
              return (
                <option key={t} value={t}>
                  {t.replace('+', ' + ')} {m < 3 ? '(bullet)' : m < 10 ? '(blitz)' : '(rapid)'}
                </option>
              );
            })}
          </select>
        </label>
        {playing && <div className="play-note">{L('Έχεις παρτίδα σε εξέλιξη στην «Παίξε με φίλο». Τελείωσέ την (ή πάτα εκεί «Νέα πρόσκληση») και ξαναδοκίμασε.', 'You have a game in progress in “Play a friend”. Finish it (or press “New invitation” there) and try again.')}</div>}
        {error && <div className="play-note">{error}</div>}
      </div>
    </Dialog>
  );
}
