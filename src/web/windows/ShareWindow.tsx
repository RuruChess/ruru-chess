/**
 * Καρτέλα «Κοινή ανάλυση»: ξεκινάς ανάλυση live με όποιον θέλεις, μέσω link. Η ανάλυση γίνεται μέσα σε αυτή την
 * καρτέλα, στο κανονικό παράθυρο ανάλυσης του Ruru (βαριάντες, σύμβολα, σχόλια, μηχανή, αποθήκευση)·
 * ο άλλος τη βλέπει στον browser του.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ClipboardPaste, Database, Eye, FilePlus2, History, Link2, LogOut, Radio, Users, X, type LucideIcon } from 'lucide-react';
import { START_FEN, Position } from '../../core/chess.ts';
import { parseGames } from '../../core/pgn.ts';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import type { LiveSource } from '../watch/useLive.ts';
import { setUiLater } from '../tactics/store.ts';
import { lastShare, type ShareStart } from '../share/ShareHost.tsx';
import { controllerFor, dropController, GameController } from '../gameModel.ts';
import { BoardWindow } from './BoardWindow.tsx';
import { DbPicker, FilePicker } from '../share/GamePicker.tsx';
import { accountOf, cancelPending, useSocial } from '../social/social.ts';
import { AnalysisInvitePick } from '../social/FriendPick.tsx';
import { randomId } from '../../core/online.ts';
import '../tactics/tactics.css';
import '../play/play.css';
import '../online/online.css';
import '../share/share.css';

export function ShareWindow({ active }: { active: boolean }) {
  const settings = useApp((s) => s.settings);
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const friendMem = (ui.friend ?? {}) as { name?: string };
  const [name, setName] = useState(accountOf(ui)?.name ?? friendMem.name ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const last = lastShare();

  const saveName = () => {
    if ((friendMem.name ?? '') !== name.trim()) setUiLater({ friend: { ...friendMem, name: name.trim() } });
  };
  const title = L('Κοινή ανάλυση', 'Shared analysis');

  const [session, setSession] = useState<{ key: number; title: string; start: ShareStart; pgn?: string; fen?: string; live?: LiveSource; orientation?: 'white' | 'black' } | null>(null);
  const begin = (s: { start: ShareStart; pgn?: string; fen?: string; live?: LiveSource; orientation?: 'white' | 'black'; title?: string }) => {
    const h = s.pgn ? parseGames(s.pgn)[0]?.game.headers : undefined;
    const players = h && h.White && h.White !== '?' ? `${h.White} – ${h.Black}` : (s.title ?? title);
    setSession({ key: Date.now(), ...s, title: players });
  };
  /**
   * Κλείνει την ανάλυση που είναι ανοιχτή: ερώτηση `dirty` αν δεν αποθηκεύτηκε, αλλιώς `clean` (αν δοθεί).
   * false αν ο χρήστης είπε όχι.
   */
  const closeSession = (dirty: string, clean?: string): boolean => {
    if (!session) return true;
    const c = controllerFor(`share-${session.key}`, () => new GameController());
    if (c.dirty ? !window.confirm(dirty) : clean !== undefined && !window.confirm(clean)) return false;
    dropController(`share-${session.key}`);
    setSession(null);
    return true;
  };

  // «Κοινή ανάλυση με…» από τους Φίλους: άδεια σκακιέρα ή η τελευταία ανάλυση, αμέσως
  const autoStart = useSocial((s) => s.shareStart);
  useEffect(() => {
    if (!autoStart) return;
    useSocial.setState({ shareStart: null });
    if (
      !closeSession(
        L('Η τωρινή ανάλυση δεν αποθηκεύτηκε σε βάση. Να κλείσει για να ξεκινήσει η νέα;', 'The current analysis is not saved to a database. Close it and start the new one?'),
        L('Να κλείσει η τωρινή κοινή ανάλυση για να ξεκινήσει η νέα;', 'Close the current shared analysis and start the new one?'),
      )
    )
      return;
    if (autoStart === 'empty') begin({ start: 'new', fen: START_FEN });
    else if (last) begin({ start: { server: last.server, id: last.id, token: last.token }, title: last.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const startEmpty = () => {
    saveName();
    begin({ start: 'new', fen: START_FEN });
  };

  const startWatchLive = () => {
    saveName();
    useApp.getState().setWatchPickForShare(true);
    useApp.getState().activate('watch');
  };

  // επιλογή live παρτίδας από την καρτέλα «Ζωντανά» για κοινή ανάλυση
  const livePick = useApp((s) => s.shareLivePick);
  useEffect(() => {
    if (!livePick) return;
    useApp.getState().setShareLivePick(null);
    if (
      !closeSession(
        L('Η τωρινή ανάλυση δεν αποθηκεύτηκε σε βάση. Να κλείσει για να ξεκινήσει η ζωντανή;', 'The current analysis is not saved to a database. Close it and start the live one?'),
        L('Να κλείσει η τωρινή κοινή ανάλυση για να ξεκινήσει η ζωντανή;', 'Close the current shared analysis and start the live one?'),
      )
    )
      return;
    begin({ start: 'new', live: livePick.live, orientation: livePick.orientation, title: livePick.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePick]);

  const startFrom = () => {
    const t = text.trim();
    if (!t) return;
    saveName();
    // FEN ή PGN
    if (/^[rnbqkpRNBQKP1-8]+(\/[rnbqkpRNBQKP1-8]+){7}\s+[wb]\b/.test(t)) {
      try {
        Position.fromFen(t);
      } catch {
        setError(L('Το FEN δεν είναι σωστό.', 'The FEN is not valid.'));
        return;
      }
      begin({ start: 'new', fen: t });
      return;
    }
    const parsed = parseGames(t);
    if (!parsed.length || !parsed[0].game.root.children.length) {
      setError(L('Δεν βρέθηκε παρτίδα στο κείμενο (PGN ή FEN).', 'No game found in the text (PGN or FEN).'));
      return;
    }
    begin({ start: 'new', pgn: t });
  };

  const resume = () => {
    if (!last) return;
    begin({ start: { server: last.server, id: last.id, token: last.token }, title: last.title });
  };

  // πρόσκληση από τους Φίλους: μπαίνουμε ως καλεσμένος (το PGN έρχεται από τον server)
  const join = useSocial((s) => s.joinAnalysis);
  // πρόσκληση σε φίλους / ομάδες που περιμένει να ξεκινήσει η ανάλυση
  const pending = useSocial((s) => s.pending);
  const friends = useSocial((s) => s.friends);
  const teams = useSocial((s) => s.teams);
  const pendingFor = pending
    ? [
        ...pending.teams.map((id) => {
          const t = teams.find((x) => x.id === id);
          return t ? L(`όλη την ομάδα «${t.name}»`, `the whole team “${t.name}”`) : '';
        }),
        ...pending.peers.map((id) => friends.find((f) => f.id === id)?.name ?? ''),
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  useEffect(() => {
    if (!join) return;
    useSocial.setState({ joinAnalysis: null });
    // είμαστε ήδη μέσα (π.χ. δεύτερο κλικ στο «Μπες»)
    if (session && typeof session.start === 'object' && session.start.id === join.id) return;
    if (
      !closeSession(
        L('Η τωρινή ανάλυση δεν αποθηκεύτηκε σε βάση. Να κλείσει για να μπεις στη νέα;', 'The current analysis is not saved to a database. Close it and join the new one?'),
        L('Να κλείσει η τωρινή κοινή ανάλυση για να μπεις στη νέα;', 'Close the current shared analysis and join the new one?'),
      )
    )
      return;
    setSession({ key: Date.now(), title, start: { server: join.server, id: join.id, token: randomId(24), name: join.name } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [join]);

  if (session) {
    // το κανονικό παράθυρο ανάλυσης (βαριάντες, σύμβολα, σχόλια, μηχανή, αποθήκευση), μέσα σε αυτή την καρτέλα
    const tabId = `share-${session.key}`;
    const leave = () => closeSession(L('Η ανάλυση δεν αποθηκεύτηκε σε βάση. Να βγεις χωρίς αποθήκευση;', 'The analysis is not saved to a database. Leave without saving?'));
    return (
      <div className="share-embed">
        <div className="share-embed-bar">
          <span className="share-embed-title">
            <Radio size={18} className="share-embed-ic" aria-hidden />
            <b>{L('Κοινή ανάλυση', 'Shared analysis')}</b>
            {session.title !== title && <span className="share-embed-sub"> · {session.title}</span>}
          </span>
          <span className="kb-pill plain share-embed-hint">{L('Ό,τι αλλάζεις το βλέπουν και οι άλλοι. Αποθήκευση με Ctrl+S.', 'The others see what you change. Save with Ctrl+S.')}</span>
          <button type="button" className="kb-btn sm share-exit" onClick={leave} title={L('Έξοδος από την κοινή ανάλυση (πίσω στην επιλογή παρτίδας)', 'Leave the shared analysis (back to choosing a game)')}>
            <LogOut size={14} aria-hidden />
            {L('Έξοδος από την ανάλυση', 'Leave analysis')}
          </button>
        </div>
        <div className="share-embed-board">
          <BoardWindow
            key={session.key}
            tab={{ id: tabId, kind: 'game', title: session.title, pgn: session.pgn, fen: session.fen, live: session.live, orientation: session.orientation, share: session.start }}
            active={active}
          />
        </div>
      </div>
    );
  }

  const steps: [LucideIcon, ReactNode][] = [
    [Link2, L('Διάλεξε παρτίδα (εδώ, από αρχείο ή άδεια σκακιέρα) και αντίγραψε το link που εμφανίζεται. Στείλ’ το σε όποιον θέλεις.', 'Pick a game (here, from a file or an empty board) and copy the link that appears. Send it to anyone.')],
    [
      Radio,
      <>
        {L('Ή από ανοιχτή παρτίδα: πάτα', 'Or from an open game: press')} <Radio size={14} className="share-inline-ic" aria-hidden /> <b>{L('«Κοινή ανάλυση»', '“Shared analysis”')}</b>{' '}
        {L('στη γραμμή εργαλείων του παραθύρου της.', 'in its window toolbar.')}
      </>,
    ],
    [Users, L('Σχόλια, βαριάντες και βέλη της παρτίδας φαίνονται κανονικά. «Ίδια θέση»: όταν κάποιος παίζει ή αλλάζει θέση, πηγαίνετε όλοι εκεί.', 'The game’s comments, variations and arrows show as usual. “Same position”: when someone plays or moves, everyone goes there.')],
    [Database, L('Στο τέλος πάτα «Αποθήκευση» για να μείνει η ανάλυση σε μια βάση σου.', 'At the end press “Save” to keep the analysis in one of your databases.')],
  ];
  const pick = (pgn: string) => {
    saveName();
    begin({ start: 'new', pgn });
  };

  return (
    <div className="kb-wrap">
      <div className="kb-page">
        {pendingFor && (
          <div className="share-inv" role="status">
            <Radio size={18} aria-hidden />
            <span>
              {L('Πρόσκληση για', 'Invitation for')} <b>{pendingFor}</b>
              {L(': διάλεξε παρτίδα (εδώ, από αρχείο ή άδεια σκακιέρα). Φεύγει μόλις ξεκινήσει η ανάλυση.', ': pick a game (here, from a file or an empty board). It goes out as soon as the analysis starts.')}
            </span>
            <button type="button" className="kb-btn primary sm" onClick={startEmpty}>
              <FilePlus2 aria-hidden />
              {L('Άδεια σκακιέρα', 'Empty board')}
            </button>
            <button type="button" className="kb-btn ghost sm" title={L('Ακύρωση της πρόσκλησης', 'Cancel the invitation')} aria-label={L('Ακύρωση της πρόσκλησης', 'Cancel the invitation')} onClick={cancelPending}>
              <X aria-hidden />
            </button>
          </div>
        )}
        <header className="kb-head with-ic">
          <span className="kb-head-ic" aria-hidden>
            <Radio size={28} />
          </span>
          <div>
            <h1 className="kb-title" data-guide="share">
              {L('Κοινή ανάλυση', 'Shared analysis')}
            </h1>
            <p className="kb-sub">
              {L(
                'Αναλύστε μαζί μια παρτίδα, ζωντανά. Ο άλλος ανοίγει το link στον browser του και βλέπει ό,τι βλέπεις: βαριάντες, σχόλια, βέλη και τη μηχανή σου.',
                'Analyse a game together, live. The other person opens the link in their browser and sees what you see: variations, comments, arrows and your engine.',
              )}
            </p>
          </div>
        </header>

        <div className="share-grid">
          <section className="kb-card share-pick" aria-label={L('Διάλεξε παρτίδα', 'Pick a game')}>
            <div className="kb-card-h share-pick-h">
              <h2>{L('Διάλεξε παρτίδα από τις βάσεις σου', 'Pick a game from your databases')}</h2>
            </div>
            <DbPicker onPick={pick} />
          </section>

          <div className="share-side">
            <section className="kb-card" aria-label={L('Νέα κοινή ανάλυση', 'New shared analysis')}>
              <div className="kb-card-head">
                <span className="kb-card-av" aria-hidden>
                  <Radio size={22} />
                </span>
                <div>
                  <b>{L('Νέα κοινή ανάλυση', 'New shared analysis')}</b>
                </div>
              </div>
              <div className="kb-card-body">
                <label className="kb-field">
                  {L('Το όνομά σου (το βλέπουν οι άλλοι)', 'Your name (the others see it)')}
                  <input className="kb-input" value={name} maxLength={24} placeholder={L('Οικοδεσπότης', 'Host')} onChange={(e) => setName(e.target.value)} />
                </label>
                <p className="faint small">{L('Το όνομα και η παρτίδα που μοιράζεσαι περνούν από server (Cloudflare) και σβήνουν περίπου μία μέρα μετά.', 'The name and the game you share pass through a server (Cloudflare) and are deleted about a day later.')}</p>
                <div className="share-or">{L('ή ξεκίνα από', 'or start from')}</div>
                <div className="share-alt">
                  <FilePicker onPick={pick} />
                  <button type="button" className="kb-btn" onClick={startEmpty}>
                    <FilePlus2 aria-hidden />
                    {L('Άδεια σκακιέρα', 'Empty board')}
                  </button>
                  <button type="button" className="kb-btn" onClick={startWatchLive}>
                    <Eye aria-hidden />
                    {L('Ζωντανή παρτίδα (Watch Live)', 'Live game (Watch Live)')}
                  </button>
                  <details className="kb-more">
                    <summary>{L('Επικόλληση PGN / FEN', 'Paste a PGN / FEN')}</summary>
                    <div className="share-alt">
                      <textarea
                        className="kb-input share-paste"
                        rows={5}
                        value={text}
                        spellCheck={false}
                        aria-label="PGN / FEN"
                        onChange={(e) => {
                          setText(e.target.value);
                          setError(null);
                        }}
                      />
                      {error && <div className="kb-callout danger">{error}</div>}
                      <button type="button" className="kb-btn" disabled={!text.trim()} onClick={startFrom}>
                        <ClipboardPaste aria-hidden />
                        {L('Ξεκίνα με αυτό', 'Start with this')}
                      </button>
                    </div>
                  </details>
                  {last && (
                    <button type="button" className="kb-btn ghost" onClick={resume} title={last.title}>
                      <History aria-hidden />
                      {L('Συνέχισε την τελευταία κοινή ανάλυση', 'Resume the last shared analysis')}
                    </button>
                  )}
                </div>
              </div>
            </section>
            <AnalysisInvitePick />
          </div>
        </div>

        <ol className="kb-steps four">
          {steps.map(([Icon, text], i) => (
            <li key={i} className="kb-step">
              <span className="kb-step-ic">
                <Icon size={18} aria-hidden />
              </span>
              <div>
                <span>{text}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
