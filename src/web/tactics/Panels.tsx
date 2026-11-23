/** Πλάγια πάνελ κάτω από τη λύση: βαθμός με τάση και αδύναμα θέματα, τράπουλες επανάληψης, puzzle της ημέρας. */
import { useEffect, useState } from 'react';
import { L, fmtNum } from '../i18n.ts';
import { reportError } from '../store.ts';
import { tacticsApi, type Deck, type ThemeResult } from './api.ts';
import { useTactics } from './store.ts';
import { Sparkline } from './RatingChart.tsx';
import { fmtRating, signed, themeLabel } from './common.tsx';

function ThemeRow({ t }: { t: ThemeResult }) {
  const pct = t.results.firstWinPercent;
  return (
    <div className="th-row">
      <span className="ellipsis">{themeLabel(t)}</span>
      <span className="th-bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="tnum th-p">{pct}%</span>
      <span className="tnum faint th-c">{fmtNum(t.results.nb)}</span>
    </div>
  );
}

/** Ο βαθμός και η τάση του (για το πάνελ και την οθόνη έναρξης): σημείωση κάτω από τον αριθμό και το sparkline. */
export function useRatingTrend() {
  const { ratings, dashboard: d } = useTactics();
  const r = ratings?.standard;
  const hist = [...(d?.ratingHistory ?? [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const from = hist[0]?.standard;
  const delta = r && from !== undefined ? Math.round(r.rating) - from : null;
  const days = d?.days ?? 30;
  return {
    value: r ? fmtRating(r.rating) : '—',
    note: r?.provisional
      ? L(`προσωρινός · ±${Math.round(r.deviation)}`, `provisional · ±${Math.round(r.deviation)}`)
      : delta !== null && hist.length > 1
        ? L(`${signed(delta)} σε ${days} μέρες`, `${signed(delta)} in ${days} days`)
        : L(`${fmtNum(r?.n ?? 0)} βαθμολογημένα`, `${fmtNum(r?.n ?? 0)} rated`),
    up: delta !== null && hist.length > 1 && !r?.provisional ? delta >= 0 : null,
    spark: (
      <Sparkline
        values={hist.map((h) => h.standard)}
        label={hist.length > 1 ? L(`Βαθμός τις τελευταίες ${days} μέρες, από ${fmtNum(hist[0].standard)} σε ${fmtNum(hist[hist.length - 1].standard)}`, `Rating in the last ${days} days, from ${fmtNum(hist[0].standard)} to ${fmtNum(hist[hist.length - 1].standard)}`) : L('Βαθμός', 'Rating')}
      />
    ),
  };
}

/** Βαθμός, τάση 30 ημερών, σήμερα, σύνολα και θέματα που θέλουν δουλειά (όπως στο σχέδιο). */
export function RatingPanel({ onStats }: { onStats?: () => void }) {
  const { dashboard: d, today, due } = useTactics();
  const trend = useRatingTrend();
  const weak = d?.weakThemes ?? [];
  const strong = d?.strongThemes ?? [];
  const most = d?.mostPlayed ?? [];
  const todayPct = today.attempts ? Math.round((today.wins * 100) / today.attempts) : null;
  return (
    <div className="panel tx-stats tx-rating">
      <div className="st-top">
        <div>
          <div className="section-label">{L('Βαθμός', 'Rating')}</div>
          <div className="st-rating">{trend.value}</div>
          <div className="st-delta faint tnum">{trend.note}</div>
        </div>
        {trend.spark}
      </div>
      <div className="st-grid">
        <div>
          <div className="st-n tnum">{todayPct === null ? '—' : `${todayPct}%`}</div>
          <div className="faint st-l">{L('σωστά σήμερα', 'correct today')}</div>
        </div>
        <div>
          <div className="st-n tnum">{fmtNum(d?.totals.wins ?? 0)}</div>
          <div className="faint st-l">{L('λυμένα συνολικά', 'solved in total')}</div>
        </div>
        <div>
          <div className="st-n tnum">{fmtNum(due)}</div>
          <div className="faint st-l">{L('για επανάληψη', 'due for review')}</div>
        </div>
      </div>
      {weak.length > 0 || strong.length > 0 ? (
        <>
          <div className="th-head">
            <span className="section-label">{L('Θέματα που θέλουν δουλειά', 'Themes that need work')}</span>
            <span className="faint th-legend">{L('σωστά · πλήθος', 'correct · count')}</span>
          </div>
          {weak.slice(0, 3).map((t) => (
            <ThemeRow key={t.key} t={t} />
          ))}
          {!weak.length && <div className="faint th-sep">{L('Κανένα αδύναμο θέμα ακόμη.', 'No weak theme yet.')}</div>}
          {strong.length > 0 && (
            <>
              <div className="th-sep faint">{L('Δυνατά', 'Strong')}</div>
              {strong.slice(0, 2).map((t) => (
                <div key={t.key} className="strong-wrap">
                  <ThemeRow t={t} />
                </div>
              ))}
            </>
          )}
        </>
      ) : most.length > 0 ? (
        <>
          <div className="th-head">
            <span className="section-label">{L('Θέματα που έπαιξες', 'Themes you played')}</span>
            <span className="faint th-legend">{L('σωστά · πλήθος', 'correct · count')}</span>
          </div>
          {most.slice(0, 3).map((t) => (
            <ThemeRow key={t.key} t={t} />
          ))}
          <div className="faint th-sep">{L('Τα αδύναμα και δυνατά θέματα φαίνονται μετά από αρκετά puzzles.', 'Weak and strong themes show after enough puzzles.')}</div>
        </>
      ) : null}
      {onStats && (
        <button type="button" className="link-btn" onClick={onStats}>
          {L('Όλα τα στατιστικά', 'All statistics')}
        </button>
      )}
    </div>
  );
}

/** Τράπουλες επανάληψης (FSRS): πόσες κάρτες είναι για τώρα. */
export function ReviewPanel({ deck, onDeck, version }: { deck: number | null; onDeck: (d: number | null) => void; version: number }) {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [tomorrow, setTomorrow] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([tacticsApi.decks(), tacticsApi.due()])
      .then(([d, due]) => {
        if (!alive) return;
        setDecks(d.decks.filter((x) => x.kind !== 'woodpecker'));
        setTomorrow(due.tomorrow);
      })
      .catch(reportError);
    return () => {
      alive = false;
    };
  }, [version]);
  const total = decks?.reduce((a, d) => a + d.due, 0) ?? 0;
  return (
    <div className="panel tx-stats">
      <div className="th-head">
        <span className="section-label">{L('Τράπουλες επανάληψης', 'Review decks')}</span>
        <span className="faint th-legend">{L('τώρα · κάρτες', 'now · cards')}</span>
      </div>
      <div className="tx-decks" role="radiogroup" aria-label={L('Τράπουλα', 'Deck')}>
        <button type="button" role="radio" aria-checked={deck === null} className={`tx-deck${deck === null ? ' is-on' : ''}`} onClick={() => onDeck(null)}>
          <span className="ellipsis">{L('Όλες', 'All')}</span>
          <span className="tnum">{fmtNum(total)}</span>
          <span className="tnum faint">{fmtNum(decks?.reduce((a, d) => a + d.cards, 0) ?? 0)}</span>
        </button>
        {(decks ?? []).map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={deck === d.id} className={`tx-deck${deck === d.id ? ' is-on' : ''}`} onClick={() => onDeck(d.id)}>
            <span className="ellipsis">{d.kind === 'failed' ? L('Αποτυχημένα', 'Failed') : d.kind === 'mistakes' ? L('Τα λάθη μου', 'My mistakes') : d.name}</span>
            <span className="tnum">{fmtNum(d.due)}</span>
            <span className="tnum faint">{fmtNum(d.cards)}</span>
          </button>
        ))}
      </div>
      <p className="faint tx-note">
        {L('Ό,τι χάνεις μπαίνει μόνο του στα «Αποτυχημένα» και ξαναέρχεται λίγο πριν το ξεχάσεις (FSRS).', 'Whatever you miss goes into “Failed” and comes back just before you would forget it (FSRS).')}
        {tomorrow ? L(` Αύριο: ${fmtNum(tomorrow)}.`, ` Tomorrow: ${fmtNum(tomorrow)}.`) : ''}
      </p>
    </div>
  );
}

/** Puzzle της ημέρας: από πού είναι και αν λύθηκε σήμερα. */
export function DailyPanel({ day, origin, solved }: { day: string; origin: string | null; solved: boolean }) {
  const date = new Date(`${day}T12:00:00`).toLocaleDateString(L('el-GR', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long' });
  const past = origin?.startsWith('lichess-daily:') ? origin.slice('lichess-daily:'.length) : null;
  return (
    <div className="panel tx-stats">
      <div className="section-label">{L('Της ημέρας', 'Of the day')}</div>
      <div className="tx-daily-date">{date}</div>
      <p className="faint tx-note">
        {past
          ? L(`Το puzzle της ημέρας της ${new Date(`${past}T12:00:00`).toLocaleDateString('el-GR')}.`, `Daily puzzle of ${new Date(`${past}T12:00:00`).toLocaleDateString('en-GB')}.`)
          : L('Ένα puzzle 1.500–2.000 για όλη τη μέρα· το ίδιο ξανά μέχρι τα μεσάνυχτα.', 'One 1500–2000 puzzle for the whole day; the same until midnight.')}
        {solved ? L(' Το έλυσες ήδη σήμερα.', ' You already solved it today.') : ''}
      </p>
    </div>
  );
}
