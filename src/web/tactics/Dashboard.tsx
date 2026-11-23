/** Στατιστικά της τακτικής (μαθηματικά του PuzzleDashboard του Lichess): βαθμός στον χρόνο, επίδοση ανά θέμα με αδύναμα και δυνατά, χρόνοι λύσης, ρεκόρ των γρήγορων τρόπων και επανάληψη όσων χάθηκαν. */
import { useEffect, useState } from 'react';
import { ChartLine, RotateCcw } from 'lucide-react';
import { L, fmtNum, language } from '../i18n.ts';
import { reportError } from '../store.ts';
import { Segmented } from '../components/ui/Segmented.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Spinner } from '../components/ui/Progress.tsx';
import { BarChart } from '../components/BarChart.tsx';
import { tacticsApi, type Dashboard, type HistoryItem, type Results, type ThemeResult } from './api.ts';
import { RatingChart } from './RatingChart.tsx';
import { fmtRating, themeLabel } from './common.tsx';
import { useTactics } from './store.ts';

const DAY_PRESETS = [7, 30, 90];

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tx-tile">
      <div className="section-label">{label}</div>
      <div className="tx-tile-v">{value}</div>
      {sub && <div className="faint tx-tile-s">{sub}</div>}
    </div>
  );
}

function Verdict({ t, weak, strong }: { t: ThemeResult; weak: Set<string>; strong: Set<string> }) {
  if (weak.has(t.key)) return <span className="tag tag-danger">{L('αδύναμο', 'weak')}</span>;
  if (strong.has(t.key)) return <span className="tag tag-ok">{L('δυνατό', 'strong')}</span>;
  return null;
}

function Pct({ r }: { r: Results }) {
  return (
    <span className="tx-pct">
      <span className="th-bar" aria-hidden>
        <i style={{ width: `${r.firstWinPercent}%` }} />
      </span>
      <span className="tnum">{r.firstWinPercent}%</span>
    </span>
  );
}

export function DashboardView({ days, onDays, series, onSeries, onReplay, onRetry, onStart }: { days: number; onDays: (d: number) => void; series: 'standard' | 'blitz'; onSeries: (s: 'standard' | 'blitz') => void; onReplay: (theme: string) => void; onRetry: (ids: string[]) => void; onStart: () => void }) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [misses, setMisses] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const streak = useTactics((s) => s.streak);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([tacticsApi.dashboard(days), tacticsApi.history(true, 40)])
      .then(([x, h]) => {
        if (!alive) return;
        setD(x);
        // ένα ανά puzzle, τα πιο πρόσφατα πρώτα
        const seen = new Set<string>();
        setMisses(h.items.filter((i) => !seen.has(i.puzzle) && seen.add(i.puzzle)).slice(0, 12));
      })
      .catch(reportError)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days]);

  if (!d) {
    return (
      <div className="tx-center">
        <Spinner label={L('Φόρτωση στατιστικών', 'Loading statistics')} />
      </div>
    );
  }
  const weak = new Set(d.weakThemes.map((t) => t.key));
  const strong = new Set(d.strongThemes.map((t) => t.key));
  const r = d.ratings[series];
  // σε σειρά ημέρας (ο server τα δίνει με τη σειρά των προσπαθειών)
  const points = [...d.ratingHistory].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).map((h) => ({ day: h.day, value: series === 'standard' ? h.standard : (h.blitz ?? h.standard), n: h.n }));
  const el = language() === 'el';
  const replayTotal = new Set(d.themes.flatMap((t) => t.replay)).size;
  const runs: Array<[string, string]> = [
    ['storm', L('3 λεπτά', '3 minutes')],
    ['streak', 'Streak'],
    ['rush:3', L('3 λάθη · 3′', '3 strikes · 3′')],
    ['rush:5', L('3 λάθη · 5′', '3 strikes · 5′')],
    ['rush:survival', L('3 λάθη · επιβίωση', '3 strikes · survival')],
  ];
  const sec = (s: number) => (s < 60 ? `${s}″` : `${s / 60}′`);

  return (
    <div className={`tx-dash${loading ? ' is-loading' : ''}`}>
      <div className="tx-dash-in">
        <div className="tx-dash-filters">
          <Segmented
            value={String(DAY_PRESETS.includes(days) ? days : 30)}
            label={L('Διάστημα', 'Period')}
            onChange={(v) => onDays(Number(v))}
            options={DAY_PRESETS.map((n) => ({ value: String(n), label: L(`${n} μέρες`, `${n} days`) }))}
          />
          <Segmented
            value={series}
            label={L('Βαθμός', 'Rating')}
            onChange={onSeries}
            options={[
              { value: 'standard', label: L('Κανονικός βαθμός', 'Standard rating'), title: L('Σύστημα Glicko-2', 'Glicko-2 system') },
              { value: 'blitz', label: L('Blitz', 'Blitz'), title: L('Μετρά και ο χρόνος λύσης', 'The solving time also counts') },
            ]}
          />
        </div>

        {d.global.nb === 0 && d.totals.attempts === 0 ? (
          <div className="panel">
            <EmptyState
              icon={ChartLine}
              title={L('Δεν υπάρχουν ακόμη στατιστικά', 'No statistics yet')}
              action={
                <button type="button" className="btn btn-primary" onClick={onStart}>
                  {L('Ξεκίνα με βαθμολογημένα puzzles', 'Start with rated puzzles')}
                </button>
              }
            >
              {L('Λύσε μερικά puzzles: εδώ θα δεις τον βαθμό σου στον χρόνο, τα αδύναμα θέματα και ό,τι έχασες για επανάληψη.', 'Solve a few puzzles: here you will see your rating over time, your weak themes and what you missed, for review.')}
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="tx-tiles">
              <Tile label={series === 'standard' ? L('Βαθμός', 'Rating') : 'Blitz'} value={fmtRating(r.rating)} sub={r.provisional ? L(`προσωρινός · ±${Math.round(r.deviation)}`, `provisional · ±${Math.round(r.deviation)}`) : `±${Math.round(r.deviation)}`} />
              <Tile label={L('Puzzles στο διάστημα', 'Puzzles in period')} value={fmtNum(d.global.nb)} sub={L(`${fmtNum(d.totals.puzzles)} συνολικά`, `${fmtNum(d.totals.puzzles)} in total`)} />
              <Tile label={L('Σωστά με την πρώτη', 'First-try correct')} value={`${d.global.firstWinPercent}%`} sub={L(`${fmtNum(d.global.firstWins)} από ${fmtNum(d.global.nb)}`, `${fmtNum(d.global.firstWins)} of ${fmtNum(d.global.nb)}`)} />
              <Tile label={L('Επίδοση', 'Performance')} value={d.global.nb ? fmtRating(d.global.performance) : '—'} sub={L(`μέσος βαθμός puzzles ${fmtRating(d.global.puzzleRatingAvg)}`, `average puzzle ${fmtRating(d.global.puzzleRatingAvg)}`)} />
              <Tile label={L('Διάμεσος χρόνος', 'Median time')} value={d.solveTime.median !== null ? `${Math.round(d.solveTime.median / 1000)}″` : '—'} sub={L('στα σωστά', 'on solved ones')} />
              <Tile label={L('Σερί ημερών', 'Day streak')} value={fmtNum(streak)} sub={streak === 1 ? L('μέρα', 'day') : L('μέρες', 'days')} />
            </div>

            <RatingChart title={series === 'standard' ? L('Βαθμός ανά ημέρα', 'Rating per day') : L('Βαθμός Blitz ανά ημέρα', 'Blitz rating per day')} points={points} unitLabel={L('Βαθμός', 'Rating')} />

            <div className="tx-dash-cols">
              <section className="panel tx-dash-themes" aria-labelledby="tx-th-title">
                <div className="panel-head">
                  <span className="panel-title" id="tx-th-title">
                    {L('Επίδοση ανά θέμα', 'Performance by theme')}
                  </span>
                  <span className="faint tx-head-note">{L(`τελευταίες ${d.days} μέρες`, `last ${d.days} days`)}</span>
                  {replayTotal > 0 && (
                    <button type="button" className="btn btn-secondary btn-sm tx-head-btn" onClick={() => onReplay('')}>
                      <RotateCcw className="ic" aria-hidden />
                      {L(`Ξαναδοκίμασε όσα έχασες (${replayTotal})`, `Retry what you missed (${replayTotal})`)}
                    </button>
                  )}
                </div>
                {d.themes.length ? (
                  <div className="tx-table-wrap">
                    <table className="table tx-theme-table">
                      <colgroup>
                        <col />
                        <col style={{ width: 72 }} />
                        <col style={{ width: 150 }} />
                        <col style={{ width: 90 }} />
                        <col style={{ width: 150 }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>{L('Θέμα', 'Theme')}</th>
                          <th className="r">{L('Puzzles', 'Puzzles')}</th>
                          <th>{L('Με την πρώτη', 'First try')}</th>
                          <th className="r" title={L('Μέσος βαθμός − 500 + 1000 × ποσοστό σωστών με την πρώτη', 'Average rating − 500 + 1000 × first-try rate')}>
                            {L('Επίδοση', 'Perf.')}
                          </th>
                          <th className="r">{L('Χαμένα', 'Missed')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.themes.map((t) => (
                          <tr key={t.key}>
                            <td>
                              <span className="tx-th-name">
                                <span className="ellipsis">{themeLabel(t)}</span>
                                <Verdict t={t} weak={weak} strong={strong} />
                              </span>
                            </td>
                            <td className="r">{fmtNum(t.results.nb)}</td>
                            <td>
                              <Pct r={t.results} />
                            </td>
                            <td className="r">{fmtRating(t.results.performance)}</td>
                            <td className="r">
                              {t.replay.length ? (
                                <button type="button" className="link-btn" onClick={() => onReplay(t.key)} aria-label={L(`Ξαναδοκίμασε ${t.replay.length} χαμένα: ${themeLabel(t)}`, `Retry ${t.replay.length} missed: ${themeLabel(t)}`)}>
                                  {L(`Ξαναδοκίμασε ${t.replay.length}`, `Retry ${t.replay.length}`)}
                                </button>
                              ) : (
                                <span className="faint">{t.results.fixed ? L(`${t.results.fixed} διορθώθηκαν`, `${t.results.fixed} fixed`) : '—'}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted pad-x">{L('Κανένα puzzle στο διάστημα.', 'No puzzles in the period.')}</p>
                )}
                <p className="faint tx-note pad-x">
                  {L('Αδύναμο: τουλάχιστον 3 λάθη και επίδοση κάτω από τη συνολική σου. Δυνατό: τουλάχιστον 3 σωστά με την πρώτη και επίδοση πάνω από τη συνολική.', 'Weak: at least 3 misses and a performance below your overall one. Strong: at least 3 first-try solves and a performance above it.')}
                </p>
              </section>

              <div className="tx-dash-right">
                <section className="panel tx-stats" aria-label={L('Φάσεις και χρώμα', 'Phases and colour')}>
                  <div className="th-head">
                    <span className="section-label">{L('Φάση και χρώμα', 'Phase and colour')}</span>
                    <span className="faint th-legend">{L('με την πρώτη · πλήθος', 'first try · count')}</span>
                  </div>
                  {[...d.byPhase, ...d.byColor.map((c) => ({ ...c, el: c.key === 'white' ? 'Με τα λευκά' : 'Με τα μαύρα', en: c.key === 'white' ? 'As White' : 'As Black' }))].map((x) => (
                    <div key={x.key} className="th-row">
                      <span className="ellipsis">{el ? x.el : x.en}</span>
                      <span className="th-bar" aria-hidden>
                        <i style={{ width: `${x.results.firstWinPercent}%` }} />
                      </span>
                      <span className="tnum th-p">{x.results.firstWinPercent}%</span>
                      <span className="tnum faint th-c">{fmtNum(x.results.nb)}</span>
                    </div>
                  ))}
                </section>

                <section className="panel tx-stats" aria-label={L('Ρεκόρ', 'Records')}>
                  <div className="section-label">{L('Ρεκόρ γρήγορων τρόπων', 'Fast-mode records')}</div>
                  <div className="tx-records">
                    {runs.map(([k, name]) => (
                      <div key={k} className="tx-record">
                        <span>{name}</span>
                        <b className="tnum">{d.runs[k] ? fmtNum(d.runs[k].best) : '—'}</b>
                        <span className="faint tnum">{d.runs[k] ? L(`${fmtNum(d.runs[k].runs)} ${d.runs[k].runs === 1 ? 'γύρος' : 'γύροι'}`, `${fmtNum(d.runs[k].runs)} ${d.runs[k].runs === 1 ? 'run' : 'runs'}`) : ''}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {misses.length > 0 && (
                  <section className="panel tx-stats" aria-label={L('Πρόσφατα χαμένα', 'Recently missed')}>
                    <div className="th-head">
                      <span className="section-label">{L('Πρόσφατα χαμένα', 'Recently missed')}</span>
                      <button type="button" className="link-btn" onClick={() => onRetry(misses.map((m) => m.puzzle))}>
                        {L('Ξαναδοκίμασε όλα', 'Retry all')}
                      </button>
                    </div>
                    <div className="tx-strip">
                      {misses.map((m) => (
                        <button key={m.id} type="button" className="tx-pz is-bad" onClick={() => onRetry([m.puzzle])} title={L(`Ξαναδοκίμασε #${m.puzzle}`, `Retry #${m.puzzle}`)}>
                          <span className="tnum">{fmtRating(m.p_rating)}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {d.solveTime.count > 0 && (
                  <BarChart
                    title={L('Χρόνος λύσης (σωστά)', 'Solving time (solved)')}
                    orientation="vertical"
                    bars={d.solveTime.buckets.map((b) => ({ label: b.to === null ? `${sec(b.from)}+` : `${b.from ? sec(b.from) : '0'}–${sec(b.to)}`, value: b.n, note: L(`${fmtNum(b.n)} puzzles`, `${fmtNum(b.n)} puzzles`) }))}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
