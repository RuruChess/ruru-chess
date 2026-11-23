/**
 * Η σελίδα του φίλου: ανοίγει από το link /g/<id> που έστειλε ο οικοδεσπότης από το Ruru. Δεν χρειάζεται
 * εγκατάσταση ούτε λογαριασμό· το κλειδί του φίλου μένει στον browser του, ώστε να ξαναμπαίνει στην ίδια παρτίδα.
 */
import { StrictMode, Suspense, lazy, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Copy, Download, Swords } from 'lucide-react';
import { CONTACT_EMAIL } from '../../src/core/features.ts';
import { L, language, setLanguage } from '../../src/web/i18n.ts';
import { OnlineGame } from '../../src/web/online/OnlineGame.tsx';
import { useOnlineRoom } from '../../src/web/online/useRoom.ts';
import { AnalysisPage } from './analysis.tsx';
import { LegalText, legalTitle, type LegalDoc } from '../../src/web/components/LegalText.tsx';
import '../../src/web/styles.css';
import '../../src/web/tactics/tactics.css';
import '../../src/web/play/play.css';
import '../../src/web/online/online.css';
import '../../src/web/watch/watch.css';

// χωριστό κομμάτι: τα κείμενα των αδειών δεν κατεβαίνουν σε όποιον έρχεται να παίξει
const Licenses = lazy(() => import('./licenses.tsx'));

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // ιδιωτική περιήγηση: η παρτίδα συνεχίζει όσο μένει ανοιχτή η σελίδα
  }
};

const LANG_KEY = 'kb.online.lang';
const saved = read(LANG_KEY);
setLanguage(saved === 'el' || saved === 'en' ? saved : navigator.languages.some((l) => l.toLowerCase().startsWith('el')) ? 'el' : 'en');

const ROOM = /^\/g\/([a-z2-9]{8})\/?$/.exec(location.pathname)?.[1] ?? null;
const SHARED = /^\/a\/([a-z2-9]{8})\/?$/.exec(location.pathname)?.[1] ?? null;

const LEGAL = (/^\/(terms|privacy)\/?$/.exec(location.pathname)?.[1] ?? null) as LegalDoc | null;
const LICENSES = /^\/licenses\/?$/.test(location.pathname);

function Page() {
  const [lang, setLang] = useState(language());
  const toggle = () => {
    const next = lang === 'el' ? 'en' : 'el';
    setLanguage(next);
    write(LANG_KEY, next);
    setLang(next);
  };
  const licensesTitle = L('Κώδικας και άδειες', 'Code and licences');
  const docTitle = LICENSES ? licensesTitle : LEGAL ? legalTitle(LEGAL) : null;
  document.title = docTitle ? `${docTitle} — Ruru Chess` : SHARED ? L('Κοινή ανάλυση — Ruru', 'Shared analysis — Ruru') : L('Παρτίδα σκάκι — Ruru', 'Chess game — Ruru');
  return (
    <div className="ol-page" key={lang}>
      <header className="ol-top">
        <img src="/icon.png" alt="" />
        <span>Ruru</span>
        <span className="faint small">· {docTitle ?? (SHARED ? L('Κοινή ανάλυση', 'Shared analysis') : L('Παρτίδα με φίλο', 'Game with a friend'))}</span>
        <span className="ol-spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} title={L('Switch to English', 'Αλλαγή σε ελληνικά')}>
          {lang === 'el' ? 'EN' : 'ΕΛ'}
        </button>
      </header>
      {ROOM ? (
        <Join id={ROOM} kind="game" />
      ) : SHARED ? (
        <Join id={SHARED} kind="analysis" />
      ) : LICENSES ? (
        <main className="ol-legal">
          <Suspense fallback={null}>
            <Licenses />
          </Suspense>
        </main>
      ) : LEGAL ? (
        <main className="ol-legal">
          <LegalText doc={LEGAL} />
        </main>
      ) : (
        <div className="tx">
          <NoRoom />
        </div>
      )}
      <p className="faint small" style={{ textAlign: 'center', padding: '0 16px 12px' }}>
        {L(
          'Το όνομα που γράφεις, οι κινήσεις, η παρτίδα και το chat περνούν από server (Cloudflare) και σβήνουν περίπου μία μέρα μετά την τελευταία δραστηριότητα. Χωρίς λογαριασμό, cookies ή παρακολούθηση. Επικοινωνία και αναφορές: ',
          'The name you type, the moves, the game and the chat pass through a server (Cloudflare) and are deleted about a day after the last activity. No account, cookies or tracking. Contact and reports: ',
        )}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        {' · '}
        <a href="/terms" target="_blank" rel="noreferrer">
          {legalTitle('terms')}
        </a>
        {' · '}
        <a href="/privacy" target="_blank" rel="noreferrer">
          {legalTitle('privacy')}
        </a>
        {' · '}
        <a href="/licenses" target="_blank" rel="noreferrer">
          {licensesTitle}
        </a>
      </p>
    </div>
  );
}

function NoRoom() {
  return (
    <div className="ol-join">
      <h1>{L('Παρτίδα με φίλο', 'Game with a friend')}</h1>
      <p className="muted">{L('Άνοιξε το link της παρτίδας που σου έστειλαν από το Ruru.', 'Open the game link you were sent from Ruru.')}</p>
    </div>
  );
}

function Join({ id, kind }: { id: string; kind: 'game' | 'analysis' }) {
  const tokenKey = `kb.${kind === 'game' ? 'online' : 'share'}.${id}`;
  const [token] = useState(() => read(tokenKey));
  const [name, setName] = useState(() => read('kb.online.name') ?? '');
  const [joined, setJoined] = useState(Boolean(token));

  if (!joined) {
    const go = () => {
      write('kb.online.name', name.trim());
      setJoined(true);
    };
    return (
      <div className="tx">
      <form
        className="ol-join"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <h1>{kind === 'game' ? L('Σε προσκάλεσαν σε μια παρτίδα σκάκι', 'You are invited to a chess game') : L('Σε προσκάλεσαν σε κοινή ανάλυση', 'You are invited to a shared analysis')}</h1>
        <label className="field">
          <span className="field-label">{L('Το όνομά σου', 'Your name')}</span>
          <input className="input" autoFocus maxLength={24} value={name} placeholder={L('Φίλος', 'Friend')} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary bots-start">
          <Swords className="ic" aria-hidden />
          {kind === 'game' ? L('Μπες στην παρτίδα', 'Join the game') : L('Μπες στην ανάλυση', 'Join the analysis')}
        </button>
        <span className="faint small">{L('Δεν χρειάζεται λογαριασμός ούτε εγκατάσταση.', 'No account or installation needed.')}</span>
      </form>
      </div>
    );
  }
  const who = name.trim() || L('Φίλος', 'Friend');
  if (kind === 'analysis') return <AnalysisPage id={id} token={token} name={who} onToken={(t) => write(tokenKey, t)} />;
  return <Game id={id} token={token} name={who} onToken={(t) => write(tokenKey, t)} />;
}

function Game({ id, token, name, onToken }: { id: string; token: string | null; name: string; onToken: (t: string) => void }) {
  const conn = useOnlineRoom(location.origin, id, token, { name, onToken });
  const [copied, setCopied] = useState(false);
  const download = (pgn: string) => {
    const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ruru-chess-${id}.pgn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="tx bots">
      <OnlineGame
        conn={conn}
        active
        event={L('Παρτίδα με φίλο', 'Game with a friend')}
        look={{ sounds: true, figurines: true }}
        endActions={(pgn) => (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                void navigator.clipboard?.writeText(pgn).then(
                  () => setCopied(true),
                  () => {},
                )
              }
            >
              <Copy className="ic ic-sm" aria-hidden />
              {copied ? L('Αντιγράφηκε', 'Copied') : L('Αντιγραφή PGN', 'Copy PGN')}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => download(pgn)}>
              <Download className="ic ic-sm" aria-hidden />
              {L('Κατέβασμα PGN', 'Download PGN')}
            </button>
          </>
        )}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
