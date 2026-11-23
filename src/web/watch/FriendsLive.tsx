/**
 * Watch Live (φάση 3): κάρτες «Φίλοι live».
 * - Lichess: οι φίλοι που παίζουν τώρα, με 👁 για τη live σκακιέρα (το Lichess τη δίνει 3 κινήσεις πίσω).
 * - Chess.com: το δημόσιο API τους δεν δίνει live παρτίδες σε εξέλιξη, οπότε οι daily (αλληλογραφίας) σε εξέλιξη
 *   και η παρτίδα που μόλις τελείωσε (τις τελευταίες 3 ώρες), που ανοίγει στο Ruru.
 */
import { useEffect, type ReactNode } from 'react';
import { ExternalLink, Eye, FolderOpen, Radio } from 'lucide-react';
import type { Friend } from '../../core/social.ts';
import { L } from '../i18n.ts';
import { newTabId, useApp } from '../store.ts';
import type { LiveSource } from './useLive.ts';
import { openLink } from '../components/About.tsx';
import { Avatar } from '../social/FriendsPanel.tsx';
import { useSocial } from '../social/social.ts';
import { SOCIAL } from '../../core/features.ts';
import { lichessGameText, loadGameInfo, useLichessFriends, useLichessPoll, useMyLichess, watchLichessGame } from '../social/lichess.ts';
import { usePoll } from './usePoll.ts';

interface CcSide {
  user: string;
  rating: number | null;
  result: string;
}
interface CcGame {
  url: string;
  tc: string;
  cls: string;
  rules: string;
  white: CcSide;
  black: CcSide;
  end: number | null;
  turn: 'white' | 'black' | null;
  moveBy: number | null;
  pgn: string;
}
interface CcUser {
  user: string;
  daily: CcGame[];
  recent: CcGame[];
  error?: string;
}

/** «180+2» → «3+2», «1/86400» → «Daily 1 μέρα». */
function ccClock(g: CcGame): string {
  const [a, b] = g.tc.split(/[+/]/).map(Number);
  if (g.tc.includes('/')) return L(`Daily ${Math.round((b || 86400) / 86400)} μέρ.`, `Daily ${Math.round((b || 86400) / 86400)}d`);
  if (!Number.isFinite(a)) return g.cls;
  const base = a >= 60 ? String(a / 60) : `${a}″`;
  return `${base}+${Number.isFinite(b) ? b : 0}`;
}

function ccResult(g: CcGame): string {
  if (g.white.result === 'win') return '1-0';
  if (g.black.result === 'win') return '0-1';
  return '½-½';
}

function ago(t: number): string {
  const m = Math.max(1, Math.round((Date.now() - t) / 60_000));
  return m < 60 ? L(`πριν ${m}′`, `${m} min ago`) : L(`πριν ${Math.round(m / 60)} ώρ.`, `${Math.round(m / 60)} h ago`);
}

export function FriendsLive({
  active,
  onPickLive,
  onShareLive,
}: {
  active: boolean;
  onPickLive?: (title: string, live: LiveSource, orientation?: 'white' | 'black') => void;
  onShareLive?: (title: string, live: LiveSource, orientation?: 'white' | 'black') => void;
}) {
  const status = useSocial((s) => s.status);
  const all = useSocial((s) => s.friends);
  const users = useLichessFriends((s) => s.users);
  const games = useLichessFriends((s) => s.games);
  const openTab = useApp((s) => s.openTab);
  const friends = all.filter((f) => f.state === 'friend');
  const li = friends.filter((f) => f.acc?.lichess);
  const cc = friends.filter((f) => f.acc?.chesscom);

  // και η δική μου παρτίδα (κάρτα «εσύ»)
  const me = useSocial((s) => s.me);
  const myLichess = useMyLichess();
  const myGame = myLichess ? users[myLichess.toLowerCase()]?.playing : undefined;
  useLichessPoll(
    [...li.map((f) => f.acc!.lichess!), ...(myLichess ? [myLichess] : [])],
    active,
  );
  const ccKey = [...new Set(cc.map((f) => f.acc!.chesscom!.toLowerCase()))].sort().join(',');
  const ccData = usePoll<{ users: CcUser[] }>(ccKey ? `/api/watch/chesscom?users=${encodeURIComponent(ccKey)}` : null, 300_000, active);

  const playing = li.flatMap((f) => {
    const g = users[f.acc!.lichess!.toLowerCase()]?.playing;
    return g ? [{ f, g }] : [];
  });
  // ο αριθμός κίνησης στις κάρτες (ένα αίτημα ανά παρτίδα, το πολύ μία φορά το λεπτό)
  const ids = [...(myGame?.id ? [myGame.id] : []), ...playing.flatMap((p) => (p.g.id ? [p.g.id] : []))].slice(0, 8);
  useEffect(() => {
    if (active) for (const id of ids) loadGameInfo(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ids.join(',')]);

  const byCc = new Map((ccData.data?.users ?? []).map((u) => [u.user, u]));
  const ccCards = cc.flatMap((f) => {
    const u = byCc.get(f.acc!.chesscom!.toLowerCase());
    if (!u) return [];
    // daily: έως 3 ανά φίλο, πρώτα όσες λήγουν νωρίτερα
    const daily = [...u.daily].sort((a, b) => (a.moveBy ?? Infinity) - (b.moveBy ?? Infinity)).slice(0, 3);
    return [...u.recent.map((g) => ({ f, g, kind: 'recent' as const })), ...daily.map((g) => ({ f, g, kind: 'daily' as const }))];
  });

  const openCc = (g: CcGame) => g.pgn && openTab({ id: newTabId('cc'), kind: 'game', title: `${g.white.user} – ${g.black.user}`, pgn: g.pgn });

  const card = (f: Pick<Friend, 'id' | 'name' | 'tag'>, body: ReactNode, actions: ReactNode, key: string, live = false, self = false) => (
    <div key={key} className={`kb-card fl-card${live ? ' is-live' : ''}`}>
      <div className="fl-head">
        <Avatar id={f.id} name={f.name} size={40} />
        <span className="fl-name">
          {f.name}
          {f.tag && <span className="fr-tag">#{f.tag}</span>}
          {self && <span className="faint"> · {L('εσύ', 'you')}</span>}
          {live && <span className="live-badge">LIVE</span>}
        </span>
      </div>
      <div className="fl-body small">{body}</div>
      <div className="fl-actions">{actions}</div>
    </div>
  );

  let note: string | null = null;
  if (status === 'off' || (status === 'open' && !friends.length)) note = L('Πρόσθεσε φίλους στη στήλη «Φίλοι» (στις Βάσεις): όσοι δηλώσουν Lichess ή Chess.com εμφανίζονται εδώ όταν παίζουν.', 'Add friends in the Friends column (in Databases): those who add Lichess or Chess.com show up here when they play.');
  else if (status === 'terms') note = L('Δέξου πρώτα τους όρους στη στήλη «Φίλοι» (στις Βάσεις).', 'First accept the terms in the Friends column (in Databases).');
  else if (status === 'open' && !li.length && !cc.length) note = L('Κανένας φίλος δεν έχει δηλώσει ακόμη Lichess ή Chess.com.', 'No friend has added Lichess or Chess.com yet.');
  else if (!playing.length && !ccCards.length) note = L('Κανένας φίλος δεν παίζει αυτή τη στιγμή.', 'No friend is playing right now.');

  // χωρίς Φίλους μένει μόνο η δική μου παρτίδα, όταν παίζω
  if (!SOCIAL && !myGame) return null;
  const title = SOCIAL ? L('Φίλοι live', 'Friends live') : L('Η παρτίδα μου', 'My game');
  return (
    <section aria-label={title}>
      <h2 className="watch-sh">{title}</h2>
      {SOCIAL && note && <p className="watch-cap">{note}</p>}
      {(myGame || playing.length > 0 || ccCards.length > 0) && (
        <div className="fl-cards">
          {myGame &&
            myLichess &&
            card(
              { id: me?.id ?? `li:${myLichess}`, name: me?.name ?? myLichess, tag: me?.tag ?? '' },
              <>
                {lichessGameText(myGame, myGame.id ? games[myGame.id]?.move : undefined).split('\n')[0]}
                {myGame.id && <span className="faint"> · {L('3 κινήσεις πίσω', '3 moves behind')}</span>}
              </>,
              myGame.id ? (
                <>
                  <button
                    type="button"
                    className="kb-btn primary sm"
                    onClick={() => (onPickLive ? onPickLive(`${myLichess} · Lichess`, { game: myGame.id! }) : watchLichessGame(myLichess, myGame))}
                  >
                    {onPickLive ? <Radio size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                    {onPickLive ? L('Κοινή ανάλυση', 'Shared analysis') : L('Live σκακιέρα', 'Live board')}
                  </button>
                  {!onPickLive && onShareLive && (
                    <button
                      type="button"
                      className="kb-btn sm"
                      title={L('Άνοιγμα σε Κοινή ανάλυση', 'Open in Shared analysis')}
                      onClick={() => onShareLive(`${myLichess} · Lichess`, { game: myGame.id! })}
                    >
                      <Radio size={14} aria-hidden />
                    </button>
                  )}
                </>
              ) : null,
              'me',
              true,
              true,
            )}
          {playing.map(({ f, g }) =>
            card(
              f,
              <>
                {lichessGameText(g, g.id ? games[g.id]?.move : undefined).split('\n')[0]}
                {g.id && <span className="faint"> · {L('3 κινήσεις πίσω', '3 moves behind')}</span>}
              </>,
              g.id ? (
                <>
                  <button
                    type="button"
                    className="kb-btn primary sm"
                    onClick={() => (onPickLive ? onPickLive(`${f.acc!.lichess!} · Lichess`, { game: g.id! }) : watchLichessGame(f.acc!.lichess!, g))}
                  >
                    {onPickLive ? <Radio size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                    {onPickLive ? L('Κοινή ανάλυση', 'Shared analysis') : L('Παρακολούθηση', 'Watch')}
                  </button>
                  {!onPickLive && onShareLive && (
                    <button
                      type="button"
                      className="kb-btn sm"
                      title={L('Άνοιγμα σε Κοινή ανάλυση', 'Open in Shared analysis')}
                      onClick={() => onShareLive(`${f.acc!.lichess!} · Lichess`, { game: g.id! })}
                    >
                      <Radio size={14} aria-hidden />
                    </button>
                  )}
                </>
              ) : null,
              `li:${f.id}`,
              true,
            ),
          )}
          {ccCards.map(({ f, g, kind }) => {
            const me = f.acc!.chesscom!.toLowerCase();
            const mine = g.white.user.toLowerCase() === me ? 'white' : 'black';
            const opp = mine === 'white' ? g.black : g.white;
            const toMove = g.turn ? (g.turn === mine ? f.name : opp.user) : null;
            return card(
              f,
              kind === 'daily' ? (
                <>
                  {L(`${ccClock(g)} στο Chess.com με ${opp.user}`, `${ccClock(g)} on Chess.com vs ${opp.user}`)}
                  {toMove && <span className="faint"> · {L(`στην κίνηση: ${toMove}`, `to move: ${toMove}`)}</span>}
                </>
              ) : (
                <>
                  {L(`Έπαιξε ${ccClock(g)} στο Chess.com με ${opp.user}`, `Played ${ccClock(g)} on Chess.com vs ${opp.user}`)} · <b>{ccResult(g)}</b>
                  {g.end && <span className="faint"> · {ago(g.end)}</span>}
                </>
              ),
              <>
                {g.pgn && (
                  <button type="button" className="kb-btn sm" onClick={() => openCc(g)} title={L('Άνοιγμα στο Ruru (ανάλυση, μηχανή, αποθήκευση)', 'Open in Ruru (analysis, engine, save)')}>
                    <FolderOpen size={14} aria-hidden />
                    {L('Άνοιγμα', 'Open')}
                  </button>
                )}
                {g.url && (
                  <button type="button" className="kb-btn ghost sm" onClick={() => openLink(g.url)} title={g.url}>
                    Chess.com
                    <ExternalLink size={14} aria-hidden />
                  </button>
                )}
              </>,
              `cc:${f.id}:${g.url}`,
            );
          })}
        </div>
      )}
      {ccData.error && ccData.error !== 'disabled' && <p className="watch-cap">{L('Το Chess.com δεν απάντησε· ξαναδοκιμάζει σε λίγα λεπτά.', 'Chess.com did not answer; trying again in a few minutes.')}</p>}
    </section>
  );
}
