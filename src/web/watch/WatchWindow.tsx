/**
 * Καρτέλα «Watch Live»: παρτίδες σε εξέλιξη από το Lichess (μόνο σκακιέρα: κινήσεις, ρολόγια, αποτέλεσμα).
 * - «GMs και μεγάλα τουρνουά»: τα επίσημα broadcasts του Lichess και οι παρτίδες κάθε γύρου.
 * Κάθε παρτίδα ανοίγει σε κανονικό παράθυρο ανάλυσης σε «live» λειτουργία (μηχανή, βαριάντες, αποθήκευση,
 * κοινή ανάλυση). Οι λίστες ανανεώνονται μόνο όσο η καρτέλα φαίνεται.
 */
import { useEffect, useState } from 'react';
import { Calendar, ChevronDown, ChevronRight, Eye, LogIn, LogOut, Radio, RefreshCw, Search, X } from 'lucide-react';
import { makeMoveCode, parseSquare, START_FEN } from '../../core/chess.ts';
import { Board } from '../components/Board.tsx';
import { useBoardSettings } from '../tactics/common.tsx';
import { L } from '../i18n.ts';
import { newTabId, useApp } from '../store.ts';
import type { LiveSource } from './useLive.ts';
import { liveError } from './useLive.ts';
import { usePoll } from './usePoll.ts';
import { FriendsLive } from './FriendsLive.tsx';
import { AccountsDialog } from '../social/FriendsPanel.tsx';
import { setAccounts, useSocial } from '../social/social.ts';
import { SOCIAL } from '../../core/features.ts';
import { lichessLogin, lichessLogout, loadLichess, useLichess } from './account.ts';
import './watch.css';

interface TourInfo {
  tour: { id: string; name: string; slug: string; tier: number; dates: number[]; info: { tc?: string; players?: string; location?: string; format?: string } };
  round: { id: string; name: string; ongoing: boolean; startsAt: number | null; finishedAt: number | null } | null;
  group: string | null;
}
interface Player {
  name: string;
  title: string | null;
  rating: number | null;
  fed: string | null;
  clock: number | null;
}
interface RoundInfo extends TourInfo {
  games: Array<{ id: string; players: Player[]; status: string; fen: string | null; lastMove: string | null }>;
}
const shortName = (n: string) => n.split(',')[0];
/** τίτλος + όνομα· στις κάρτες μόνο το επώνυμο («Firouzja, Alireza» → «GM Firouzja») */
const playerName = (p: Player | undefined, short = false) => (p ? `${p.title ? `${p.title} ` : ''}${short ? shortName(p.name) : p.name}` : '?');
/** η τελευταία κίνηση του Lichess (UCI, π.χ. e2e4) για τη μικρή σκακιέρα */
const uciMove = (u: string | null) => {
  const from = u ? parseSquare(u, 0) : -1;
  const to = u ? parseSquare(u, 2) : -1;
  return from >= 0 && to >= 0 ? makeMoveCode(from, to) : undefined;
};

/** Για αναζήτηση: χωρίς τόνους / διακριτικά, πεζά. */
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function WatchWindow({ active }: { active: boolean }) {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const openTab = useApp((s) => s.openTab);
  const activate = useApp((s) => s.activate);
  const pickForShare = useApp((s) => s.watchPickForShare);
  const setPickForShare = useApp((s) => s.setWatchPickForShare);
  const setShareLivePick = useApp((s) => s.setShareLivePick);
  const acct = useLichess();
  useEffect(() => loadLichess(), []);
  const enabled = settings?.watchLive !== false;

  const tours = usePoll<{ active: TourInfo[]; upcoming: TourInfo[] }>(enabled ? '/api/watch/broadcasts' : null, 120_000, active);
  const [open, setOpen] = useState<string | null>(null);
  const round = usePoll<RoundInfo>(enabled && open ? `/api/watch/round/${open}` : null, 30_000, active);
  /** αναζήτηση παίκτη στο ανοιχτό τουρνουά */
  const [query, setQuery] = useState('');
  const [searchFocus, setSearchFocus] = useState(false);
  const q = norm(query.trim());

  const social = useSocial((s) => s.status);
  const myAcc = useSocial((s) => s.myAcc);
  const [accDialog, setAccDialog] = useState(false);
  const bs = useBoardSettings();

  const watch = (title: string, live: LiveSource, orientation?: 'white' | 'black') => {
    if (pickForShare) {
      setPickForShare(false);
      setShareLivePick({ title, live, orientation });
      activate('share');
      return;
    }
    openTab({ id: newTabId('live'), kind: 'game', title, live, ...(orientation ? { orientation } : {}) });
  };
  const watchShared = (title: string, live: LiveSource, orientation?: 'white' | 'black') => {
    setPickForShare(false);
    openTab({ id: newTabId('live'), kind: 'game', title, live, share: 'new', ...(orientation ? { orientation } : {}) });
  };

  const list = [...(tours.data?.active ?? [])].sort((a, b) => Number(Boolean(b.round?.ongoing)) - Number(Boolean(a.round?.ongoing)));

  return (
    <div className="kb-wrap watch-page">
      <div className="kb-page">
        <header className="kb-head with-ic">
          <span className="kb-head-ic" aria-hidden>
            <Eye size={28} />
          </span>
          <div>
            <h1 className="kb-title" data-guide="watch">{L('Ζωντανά', 'Watch Live')}</h1>
            <p className="kb-sub">
              {L(
                'Παρτίδες σε εξέλιξη από τουρνουά σε όλο τον κόσμο. Κάθε παρτίδα ανοίγει σε παράθυρο ανάλυσης, με βαριάντες, μηχανή και αποθήκευση στη βάση σου.',
                'Games in progress from tournaments around the world. Each game opens in an analysis window, with variations, the engine and saving to your database.',
              )}
            </p>
          </div>
        </header>

        {pickForShare && (
          <div className="watch-pick-bar" role="status">
            <Radio size={18} aria-hidden />
            <span>{L('Διάλεξε μια ζωντανή παρτίδα για να ανοίξει κατευθείαν σε Κοινή ανάλυση.', 'Pick a live game to open it directly in Shared analysis.')}</span>
            <button
              type="button"
              className="kb-btn ghost sm"
              onClick={() => {
                setPickForShare(false);
                activate('share');
              }}
            >
              <X size={14} aria-hidden />
              {L('Άκυρο', 'Cancel')}
            </button>
          </div>
        )}

        {!enabled ? (
          <section className="kb-card watch-off">
            <p>{L('Τα Ζωντανά είναι κλειστά στις ρυθμίσεις, οπότε το Ruru δεν ρωτά το Lichess.', 'Watch Live is turned off in the settings, so Ruru does not contact Lichess.')}</p>
            <button type="button" className="kb-btn primary" onClick={() => void saveSettings({ watchLive: true })}>
              <Eye size={16} aria-hidden />
              {L('Άνοιγμα των Ζωντανών', 'Turn on Watch Live')}
            </button>
          </section>
        ) : (
          <div className="watch-grid">
            <div className="watch-main">
              <FriendsLive active={active} onPickLive={pickForShare ? watch : undefined} onShareLive={watchShared} />

              <section aria-label={L('GMs και μεγάλα τουρνουά', 'GMs and big tournaments')}>
                <h2 className="watch-sh">
                  {L('GMs και μεγάλα τουρνουά', 'GMs and big tournaments')}
                  <button type="button" className="kb-btn ghost sm icon" title={L('Ανανέωση', 'Refresh')} aria-label={L('Ανανέωση', 'Refresh')} onClick={tours.reload}>
                    <RefreshCw size={14} aria-hidden />
                  </button>
                </h2>
                {tours.error && <p className="watch-err">{liveError(tours.error)}</p>}
                {!tours.data && !tours.error && <p className="watch-cap">{L('Φόρτωση…', 'Loading…')}</p>}
                <div className="watch-tours">
                  {list.map((t) => {
                    const rid = t.round?.id ?? '';
                    const isOpen = open === rid && Boolean(rid);
                    const meta = [t.round?.name, t.tour.info.tc, t.tour.info.location, t.tour.info.players].filter(Boolean).join(' · ');
                    return (
                      <div key={t.tour.id} className={`kb-card watch-tour${isOpen ? ' is-open' : ''}`}>
                        <div className="watch-tour-top">
                          <button
                            type="button"
                            className="watch-tour-head"
                            aria-expanded={isOpen}
                            disabled={!rid}
                            onClick={() => {
                              setOpen(isOpen ? null : rid);
                              setQuery('');
                              setSearchFocus(false);
                            }}
                          >
                            {isOpen ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
                            <span className="watch-tour-main">
                              <span className="watch-tour-name">
                                {t.round?.ongoing && <span className="live-badge">LIVE</span>}
                                <span className="watch-ell" title={t.tour.name}>{t.tour.name}</span>
                              </span>
                              <span className="watch-tour-meta watch-ell" title={meta}>
                                {meta}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            className="kb-btn ghost sm icon"
                            disabled={!rid}
                            title={L('Βρες παίκτη σε αυτό το τουρνουά', 'Find a player in this tournament')}
                            aria-label={L('Βρες παίκτη σε αυτό το τουρνουά', 'Find a player in this tournament')}
                            onClick={() => {
                              if (!isOpen) setQuery('');
                              setOpen(rid);
                              setSearchFocus(true);
                            }}
                          >
                            <Search size={14} aria-hidden />
                          </button>
                        </div>
                        {isOpen && (
                          <div className="watch-games">
                            <label className="watch-search">
                              <Search size={14} aria-hidden />
                              <input
                                className="kb-input"
                                value={query}
                                ref={(el) => {
                                  if (el && searchFocus && document.activeElement !== el) el.focus();
                                }}
                                onBlur={() => setSearchFocus(false)}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={L('Βρες παίκτη…', 'Find a player…')}
                                aria-label={L('Βρες παίκτη', 'Find a player')}
                              />
                            </label>
                            {round.error && <p className="watch-err">{liveError(round.error)}</p>}
                            {round.error === 'auth' && !acct.connected && (
                              <button type="button" className="kb-btn primary sm" onClick={lichessLogin}>
                                <LogIn size={14} aria-hidden />
                                {L('Σύνδεση με Lichess', 'Connect Lichess')}
                              </button>
                            )}
                            {!round.data && !round.error && <p className="watch-cap">{L('Φόρτωση…', 'Loading…')}</p>}
                            {round.data?.round?.id === rid && !round.data.games.length && <p className="watch-cap">{L('Δεν υπάρχουν ακόμη παρτίδες σε αυτόν τον γύρο.', 'No games in this round yet.')}</p>}
                            {round.data?.round?.id === rid && round.data.games.length > 0 && (
                              <div className="watch-boards">
                                {round.data.games.map((g, i) => {
                                  if (q && !g.players.some((p) => norm(p.name).includes(q))) return null;
                                  const [w, b] = g.players;
                                  const title = `${shortName(w?.name ?? '?')} – ${shortName(b?.name ?? '?')}`;
                                  const playing = g.status === '*';
                                  return (
                                    <div key={g.id} className="watch-game-card">
                                      <button
                                        type="button"
                                        className="watch-game"
                                        onClick={() => watch(title, { round: rid, game: g.id })}
                                        title={pickForShare ? L('Άνοιγμα σε Κοινή ανάλυση', 'Open in Shared analysis') : L('Άνοιγμα της live σκακιέρας', 'Open the live board')}
                                      >
                                        <span className="watch-gp">
                                          <span className="watch-no">{i + 1}</span>
                                          <b title={playerName(b)}>{playerName(b, true)}</b>
                                          {b?.rating ? <span className="watch-rt">{b.rating}</span> : null}
                                          {playing && t.round?.ongoing && (
                                            <span className="watch-res">
                                              <span className="kb-dot live" aria-label="LIVE" />
                                            </span>
                                          )}
                                        </span>
                                        <span className="watch-mini">
                                          <Board fen={g.fen ?? START_FEN} orientation="white" movable="none" lastMove={uciMove(g.lastMove)} theme={bs.theme} pieceSet={bs.pieceSet} coordinates={false} animationMs={0} />
                                        </span>
                                        <span className="watch-gp">
                                          <span className="watch-no" />
                                          <b title={playerName(w)}>{playerName(w, true)}</b>
                                          {w?.rating ? <span className="watch-rt">{w.rating}</span> : null}
                                          {!(playing && t.round?.ongoing) && <span className="watch-res">{playing ? '–' : g.status.replace('1/2-1/2', '½-½')}</span>}
                                        </span>
                                      </button>
                                      {!pickForShare && (
                                        <button
                                          type="button"
                                          className="watch-game-share"
                                          onClick={() => watchShared(title, { round: rid, game: g.id })}
                                          title={L('Άνοιγμα αυτής της live παρτίδας σε Κοινή ανάλυση με φίλους', 'Open this live game in Shared analysis with friends')}
                                        >
                                          <Radio size={13} aria-hidden />
                                          {L('Κοινή ανάλυση', 'Shared analysis')}
                                        </button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {Boolean(tours.data?.upcoming.length) && (
                  <>
                    <h3 className="watch-sh2">{L('Ξεκινούν σύντομα', 'Starting soon')}</h3>
                    <ul className="watch-upcoming">
                      {tours.data!.upcoming.slice(0, 8).map((t) => (
                        <li key={t.tour.id}>
                          <Calendar size={14} aria-hidden />
                          <span>
                            {t.tour.name}
                            {t.round?.startsAt && <span className="faint small"> · {new Date(t.round.startsAt).toLocaleString(L('el-GR', 'en-GB'), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </div>

            <aside className="watch-side" aria-label="Lichess">
              <section className="kb-card watch-acct">
                <h2>Lichess</h2>
                {acct.connected ? (
                  <>
                    <div className="watch-row">
                      <span>
                        {L('Συνδεδεμένος ως', 'Connected as')} <b>{acct.username}</b>
                      </span>
                      <button type="button" className="kb-btn ghost sm" onClick={lichessLogout} title={L('Αποσύνδεση (ακυρώνει και το token στο Lichess)', 'Disconnect (also revokes the token on Lichess)')}>
                        <LogOut size={14} aria-hidden />
                        {L('Αποσύνδεση', 'Disconnect')}
                      </button>
                    </div>
                    <p className="watch-note">
                      {acct.expires
                        ? L(
                            `Η σύνδεση μένει σε αυτόν τον υπολογιστή έως ${new Date(acct.expires).toLocaleDateString('el-GR')}: δεν χρειάζεται ξανά έγκριση μέχρι τότε.`,
                            `The connection stays on this computer until ${new Date(acct.expires).toLocaleDateString('en-GB')}: no need to authorize again until then.`,
                          )
                        : L('Η σύνδεση μένει σε αυτόν τον υπολογιστή μέχρι να πατήσεις «Αποσύνδεση».', 'The connection stays on this computer until you press “Disconnect”.')}
                    </p>
                  </>
                ) : (
                  <>
                    <div>
                      <button type="button" className="kb-btn primary" onClick={lichessLogin} disabled={acct.waiting}>
                        <LogIn size={16} aria-hidden />
                        {L('Σύνδεση με Lichess', 'Connect Lichess')}
                      </button>
                    </div>
                    <p className="watch-note">
                      {acct.waiting
                        ? L('Άνοιξε η σελίδα του Lichess στον browser σου: πάτα εκεί «Έγκριση». Μετά γύρνα εδώ.', 'The Lichess page opened in your browser: press “Authorize” there, then come back.')
                        : L(
                            'Για τα τουρνουά (το Lichess το ζητά από το 2026). Μία φορά: το token μένει σε αυτόν τον υπολογιστή για περίπου έναν χρόνο. Μόνο ανάγνωση: δεν βλέπει τον κωδικό σου ούτε παίζει για σένα.',
                            'For the tournaments (Lichess requires it since 2026). Once: the token stays on this computer for about a year. Read-only: it never sees your password or plays for you.',
                          )}
                    </p>
                  </>
                )}
              </section>

              {SOCIAL && <section className="kb-card watch-acct">
                <h2>{L('Τα usernames μου', 'My usernames')}</h2>
                {social === 'off' ? (
                  <p className="watch-note">{L('Μπες πρώτα στους Φίλους (στήλη «Φίλοι» στις Βάσεις): εκεί τα βλέπουν οι φίλοι σου.', 'Sign in to Friends first (Friends column in Databases): your friends see them there.')}</p>
                ) : (
                  <>
                    <ul className="watch-users">
                      <li>
                        Lichess<span>{myAcc?.lichess ?? '—'}</span>
                      </li>
                      <li>
                        Chess.com<span>{myAcc?.chesscom ?? '—'}</span>
                      </li>
                    </ul>
                    <div className="watch-row">
                      <button type="button" className="kb-btn sm" disabled={social !== 'open'} onClick={() => setAccDialog(true)}>
                        {L('Αλλαγή…', 'Change…')}
                      </button>
                      {acct.connected && acct.username && acct.username !== '?' && myAcc?.lichess?.toLowerCase() !== acct.username.toLowerCase() && (
                        <button type="button" className="kb-btn ghost sm" disabled={social !== 'open'} onClick={() => setAccounts({ ...myAcc, lichess: acct.username! })}>
                          {L(`Lichess: ${acct.username}`, `Lichess: ${acct.username}`)}
                        </button>
                      )}
                    </div>
                    <p className="watch-note">{L('Τα βλέπουν μόνο οι φίλοι σου, για να σε βρίσκουν όταν παίζεις. Τα αλλάζεις ή τα σβήνεις όποτε θες.', 'Only your friends see them, to find you when you play. Change or remove them any time.')}</p>
                  </>
                )}
              </section>}
              {accDialog && <AccountsDialog onClose={() => setAccDialog(false)} />}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
