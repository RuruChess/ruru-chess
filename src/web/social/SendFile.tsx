/**
 * «Αποστολή σε φίλο ή ομάδα» (φάση 3): μια βάση (ή επιλεγμένες παρτίδες της) γίνεται PGN σε απλό κείμενο (έως 1 MB) και φτάνει
 * στο chat του φίλου ή της ομάδας ως μήνυμα με «Εισαγωγή». Πριν από την αποστολή: τα πνευματικά δικαιώματα.
 */
import { useState } from 'react';
import { Send } from 'lucide-react';
import { L, fmtNum } from '../i18n.ts';
import { useApp } from '../store.ts';
import { Dialog } from '../components/ui.tsx';
import { FILE_MAX_GAMES } from '../../core/social.ts';
import { fullName, gamesText, sendDatabase, useSocial, type SendRequest } from './social.ts';
import '../tactics/tactics.css';
import '../play/play.css';
import './social.css';

export function SendFileDialog() {
  const req = useSocial((s) => s.sendDialog);
  return req ? <SendFile req={req} /> : null;
}

function SendFile({ req }: { req: SendRequest }) {
  const library = useApp((s) => s.library);
  const toast = useApp((s) => s.toast);
  const friends = useSocial((s) => s.friends);
  const teams = useSocial((s) => s.teams);
  const ok = useSocial((s) => s.status === 'open');
  const [dbId, setDbId] = useState(req.dbId ?? '');
  const [to, setTo] = useState(req.team ? `t:${req.team}` : (req.peer ?? ''));
  const [stripClocks, setStripClocks] = useState(false);
  const [rights, setRights] = useState(false);
  const [stage, setStage] = useState<'pack' | 'upload' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = () => !stage && useSocial.setState({ sendDialog: null });

  const myFriends = friends.filter((f) => f.state === 'friend').sort((a, b) => a.name.localeCompare(b.name));
  const myTeams = teams.filter((t) => t.state === 'member').sort((a, b) => a.name.localeCompare(b.name));
  const dbs = library.filter((d) => d.games > 0 && !d.busy).sort((a, b) => a.name.localeCompare(b.name));
  const db = library.find((d) => d.id === dbId);
  const games = req.ids ? req.ids.length : (db?.games ?? 0);
  const name = db ? (req.ids ? L(`${db.name} (επιλογή)`, `${db.name} (selection)`) : db.name) : '';
  const team = to.startsWith('t:') ? myTeams.find((t) => `t:${t.id}` === to) : undefined;
  const friend = team ? undefined : myFriends.find((f) => f.id === to);
  const target = team ? `«${team.name}»` : friend ? fullName(friend) : '';
  const tooMany = games > FILE_MAX_GAMES;

  const send = async () => {
    if (!db || (!team && !friend)) return;
    setError(null);
    const e = await sendDatabase(team ? { team: team.id } : { peer: friend?.id }, { dbId: db.id, ids: req.ids, name, games, stripClocks }, setStage);
    setStage(null);
    if (e) return setError(e);
    toast(L(`Στάλθηκε: «${name}» → ${target}.`, `Sent: “${name}” → ${target}.`), 'ok');
    useSocial.setState({ sendDialog: null });
  };

  return (
    <Dialog
      title={L('Αποστολή σε φίλο ή ομάδα', 'Send to a friend or team')}
      onClose={close}
      width={480}
      footer={
        <button className="primary gi-send" disabled={!ok || !rights || !db || !target || tooMany || Boolean(stage)} onClick={() => void send()}>
          <Send size={15} aria-hidden />
          {stage === 'pack' ? L('Ετοιμασία και έλεγχος PGN…', 'Preparing and checking PGN…') : stage === 'upload' ? L('Ανέβασμα…', 'Uploading…') : L('Αποστολή', 'Send')}
        </button>
      }
    >
      <div className="tx tm-body">
        <label className="play-opt">
          <span className="field-label">{req.ids ? L('Παρτίδες', 'Games') : L('Βάση', 'Database')}</span>
          {req.dbId ? (
            <span className="sf-what">
              <b>{db?.name ?? '—'}</b>
              <span className="faint small">
                {' · '}
                {req.ids
                  ? L(games === 1 ? '1 επιλεγμένη παρτίδα' : `${fmtNum(games)} επιλεγμένες παρτίδες`, games === 1 ? '1 selected game' : `${fmtNum(games)} selected games`)
                  : gamesText(games)}
              </span>
            </span>
          ) : (
            <select className="select" value={dbId} onChange={(e) => setDbId(e.target.value)}>
              <option value="">{L('— Διάλεξε βάση —', '— Choose a database —')}</option>
              {dbs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({fmtNum(d.games)})
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="play-opt">
          <span className="field-label">{L('Σε', 'To')}</span>
          <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{L('— Διάλεξε φίλο ή ομάδα —', '— Choose a friend or team —')}</option>
            {myTeams.length > 0 && (
              <optgroup label={L('Ομάδες', 'Teams')}>
                {myTeams.map((t) => (
                  <option key={t.id} value={`t:${t.id}`}>
                    {t.name} ({t.count})
                  </option>
                ))}
              </optgroup>
            )}
            {myFriends.length > 0 && (
              <optgroup label={L('Φίλοι', 'Friends')}>
                {myFriends.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}#{f.tag}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="sf-rights">
          <input type="checkbox" checked={stripClocks} onChange={(e) => setStripClocks(e.target.checked)} />
          <span className="small">
            {L(
              'Χωρίς ρολόγια κινήσεων ([%clk]) — μικρότερο αρχείο (χωρά ~2× περισσότερες παρτίδες από Lichess / Chess.com στο 1 MB).',
              'Without move clocks ([%clk]) — smaller file (fits ~2× more Lichess / Chess.com games within 1 MB).',
            )}
          </span>
        </label>
        <label className="sf-rights">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
          <span className="small">
            {L(
              'Έχω το δικαίωμα να μοιραστώ αυτές τις παρτίδες. Οι εμπορικές βάσεις (π.χ. Mega Database, Corr Database) και οι παρτίδες από βιβλία προστατεύονται από πνευματικά δικαιώματα και δεν επιτρέπεται να μοιράζονται.',
              'I have the right to share these games. Commercial databases (e.g. Mega Database, Corr Database) and games from books are protected by copyright and must not be shared.',
            )}
          </span>
        </label>
        <p className="faint small" style={{ margin: 0 }}>
          {L(
            'Στέλνεται μόνο ως PGN σε απλό κείμενο, έως 1 MB, και ο server ελέγχει τη μορφή του. Ο παραλήπτης το βλέπει στο chat με «Εισαγωγή» και γίνεται νέα βάση στο Ruru του. Το αρχείο σβήνεται από τον server σε 7 μέρες.',
            'It is sent only as plain-text PGN, up to 1 MB, and the server checks its format. The recipient sees it in the chat with “Import”, and it becomes a new database in their Ruru. The file is deleted from the server after 7 days.',
          )}
        </p>
        {tooMany && (
          <div className="play-note">
            {L(
              `Πάνω από ${fmtNum(FILE_MAX_GAMES)} παρτίδες δεν χωρούν στο 1 MB. Άνοιξε τη βάση, διάλεξε τις παρτίδες που θέλεις και δεξί κλικ → «Αποστολή επιλεγμένων».`,
              `More than ${fmtNum(FILE_MAX_GAMES)} games do not fit in 1 MB. Open the database, select the games you want and right-click → “Send selected”.`,
            )}
          </div>
        )}
        {!ok && (
          <div className="play-note">
            {L('Δεν υπάρχει σύνδεση με τους Φίλους. Το κύριο παράθυρο του Ruru (Βάσεις) πρέπει να είναι ανοιχτό και συνδεδεμένο.', 'Not connected to Friends. The main Ruru window (Databases) must be open and connected.')}
          </div>
        )}
        {error && <div className="play-note">{error}</div>}
      </div>
    </Dialog>
  );
}
