/**
 * Οθόνη έναρξης των τρόπων με puzzles (Βαθμολογημένα / Εξάσκηση, Επανάληψη, Της ημέρας): κανένας γρίφος δεν
 * ανοίγει πριν πατήσεις «Έναρξη». Στα βαθμολογημένα το επίπεδο δυσκολίας διαλέγεται εδώ, σε κάρτες με τον βαθμό
 * των γρίφων που θα έρθουν (ο βαθμός σου ± η μετατόπιση του επιπέδου)· δίπλα ο βαθμός σου και τα σημερινά.
 */
import { useEffect, useRef } from 'react';
import { CalendarDays, Check, Flame, Play, Puzzle, Repeat, SlidersHorizontal, Target, X } from 'lucide-react';
import { L, fmtNum } from '../i18n.ts';
import { Keys } from '../components/ui/Kbd.tsx';
import { DIFFICULTY_LEVELS, DIFFICULTY_SCALE, type TacticsMode } from './prefs.ts';
import { useTactics } from './store.ts';
import { useRatingTrend } from './Panels.tsx';

/** Ο βαθμός των γρίφων ενός επιπέδου: ο βαθμός σου ± η μετατόπιση (όχι κάτω από 400). */
export const levelRating = (rating: number, delta: number): number => Math.max(400, Math.round(rating + delta));

export interface StartScreenProps {
  mode: TacticsMode;
  /** όνομα και περιγραφή του τρόπου */
  title: string;
  about: string;
  active: boolean;
  /** βαθμολογημένα: το επίπεδο (κλειδί δυσκολίας) και ο βαθμός του χρήστη */
  difficulty: string;
  rating: number;
  onDifficulty: (key: string) => void;
  /** πόσα θέματα / φίλτρα είναι ενεργά εκτός από τη δυσκολία, και άνοιγμα του πάνελ τους */
  filters: number;
  onFilters?: () => void;
  /** επανάληψη: πόσα περιμένουν τώρα */
  due: number;
  /** δίπλα: κάρτες «Βαθμός» και «Σήμερα» (μόνο στα Τακτικά) */
  aside?: boolean;
  onStart: () => void;
}

export function StartScreen({ mode, title, about, active, difficulty, rating, onDifficulty, filters, onFilters, due, aside, onStart }: StartScreenProps) {
  const startRef = useRef<HTMLButtonElement>(null);
  // Enter = Έναρξη (η εστίαση πάει στο κουμπί όταν φαίνεται η οθόνη)
  useEffect(() => {
    if (active) startRef.current?.focus({ preventScroll: true });
  }, [active, mode]);
  const Icon = mode === 'review' ? Repeat : mode === 'daily' ? CalendarDays : Target;
  return (
    <div className="tk-start">
      <div className={`tk-start-grid${aside ? '' : ' one'}`}>
        <section className="kb-card tk-start-card">
          <div className="kb-card-head">
            <span className="kb-card-av tk-av">
              <Icon aria-hidden />
            </span>
            <div>
              <b>{title}</b>
              <span>{about}</span>
            </div>
          </div>

          {mode === 'rated' && (
            <div className="kb-card-body">
              <div className="tk-lvh">
                <span>{L('Επίπεδο δυσκολίας', 'Difficulty level')}</span>
                <span className="tnum">{L(`ο βαθμός σου: ${Math.round(rating)}`, `your rating: ${Math.round(rating)}`)}</span>
              </div>
              <div className="tk-levels" data-guide="levels" role="radiogroup" aria-label={L('Επίπεδο δυσκολίας', 'Difficulty level')}>
                {DIFFICULTY_LEVELS.map((d) => {
                  const step = DIFFICULTY_SCALE.indexOf(d);
                  return (
                    <button key={d.key} type="button" role="radio" aria-checked={difficulty === d.key} className="tk-lv" onClick={() => onDifficulty(d.key)}>
                      {step < 0 ? (
                        <Puzzle className="tk-lv-std" aria-hidden />
                      ) : (
                        <span className="tk-bars" aria-hidden>
                          {DIFFICULTY_SCALE.map((_, k) => (
                            <i key={k} className={k <= step ? 'on' : ''} />
                          ))}
                        </span>
                      )}
                      <b>{L(d.el, d.en)}</b>
                      {/* ο βαθμός (δυσκολία) των γρίφων, χωρίς διαχωριστικό χιλιάδων: δεν είναι πλήθος */}
                      <span className="tnum">{step < 0 ? L('απλά τακτικά, γύρω από τον βαθμό σου', 'plain tactics around your rating') : L(`βαθμός γρίφων ≈ ${levelRating(rating, d.delta)}`, `puzzle rating ≈ ${levelRating(rating, d.delta)}`)}</span>
                    </button>
                  );
                })}
              </div>
              <p className="tk-note">
                {L(
                  '«Στάνταρ»: απλά τακτικά γύρω από τον βαθμό σου, από όλη τη συλλογή, χωρίς θέματα και φίλτρα. Στα άλλα επίπεδα ο αριθμός είναι η δυσκολία (ο βαθμός) των γρίφων που θα σου έρθουν, όχι πόσοι είναι· όλα παίρνουν γρίφους από όλη τη συλλογή.',
                  '“Standard”: plain tactics around your rating, from the whole collection, with no themes or filters. On the other levels the number is the difficulty (rating) of the puzzles you will get, not how many there are; all of them draw from the whole collection.',
                )}
              </p>
              {onFilters && (
                <div>
                  <button type="button" className="kb-btn ghost sm tk-filters" onClick={onFilters}>
                    <SlidersHorizontal aria-hidden />
                    {difficulty === 'standard'
                      ? L('Θέματα, άνοιγμα, χρώμα (στο «Στάνταρ» δεν ισχύουν)', 'Themes, opening, colour (not used in “Standard”)')
                      : filters > 0
                        ? L(`Θέματα και φίλτρα (${filters} ενεργά)`, `Themes and filters (${filters} on)`)
                        : L('Θέματα, άνοιγμα, χρώμα (όλα)', 'Themes, opening, colour (all)')}
                  </button>
                </div>
              )}
            </div>
          )}
          {mode === 'review' && (
            <div className="kb-card-body">
              <p className="tk-due tnum">{due > 0 ? L(`Περιμένουν ${fmtNum(due)} για επανάληψη.`, `${fmtNum(due)} waiting for review.`) : L('Τίποτα για επανάληψη αυτή τη στιγμή.', 'Nothing to review right now.')}</p>
            </div>
          )}

          <div className="kb-card-foot tk-go">
            <button ref={startRef} type="button" className="kb-btn primary lg" onClick={onStart}>
              <Play aria-hidden />
              {L('Έναρξη', 'Start')}
            </button>
            <span>
              {L('ή', 'or')} <Keys keys="Enter" />
            </span>
          </div>
        </section>
        {aside && <StartAside />}
      </div>
    </div>
  );
}

/** Δίπλα στην έναρξη: ο βαθμός με την τάση του και τα σημερινά (σερί ημερών, σωστά, λάθη). */
function StartAside() {
  const { streak, today } = useTactics();
  const trend = useRatingTrend();
  return (
    <div className="tk-aside">
      <section className="kb-card tk-rating">
        <div className="tk-rating-h">
          <span>{L('Βαθμός (Glicko-2)', 'Rating (Glicko-2)')}</span>
          <span className={`tnum${trend.up === null ? '' : trend.up ? ' up' : ' down'}`}>{trend.note}</span>
        </div>
        <div className="tk-big tnum">{trend.value}</div>
        {trend.spark}
      </section>
      <section className="kb-card tk-today">
        <div className="kb-card-h">
          <h2>{L('Σήμερα', 'Today')}</h2>
        </div>
        <div className="tk-today-b">
          <div>
            <Flame className="f" aria-hidden />
            <b className="tnum">{fmtNum(streak)}</b>
            <span>{streak === 1 ? L('μέρα στη σειρά', 'day in a row') : L('μέρες στη σειρά', 'days in a row')}</span>
          </div>
          <div>
            <Check className="c" aria-hidden />
            <b className="tnum">{fmtNum(today.wins)}</b>
            <span>{L('σωστά', 'correct')}</span>
          </div>
          <div>
            <X className="x" aria-hidden />
            <b className="tnum">{fmtNum(today.attempts - today.wins)}</b>
            <span>{L('λάθη', 'wrong')}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
