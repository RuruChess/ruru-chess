/** «Θέματα και δυσκολία»: αναδυόμενο πάνελ με δυσκολία, χρώμα, πηγή (Lichess ή συλλογή), θέματα (στα ελληνικά, ανά κατηγορία) και άνοιγμα. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { L, fmtNum, language } from '../i18n.ts';
import { reportError } from '../store.ts';
import { normalize } from '../search.ts';
import { Segmented } from '../components/ui/Segmented.tsx';
import { useDialogStack, trapTab } from '../components/ui/Dialog.tsx';
import type { Section } from './sections.ts';
import { NO_FILTERS, tacticsApi, type OpeningFamily, type PickFilters, type ThemesInfo } from './api.ts';
import { useTactics } from './store.ts';

let themesCache: Promise<ThemesInfo> | null = null;
/** Τα θέματα με τα πλήθη τους (μία φορά ανά παράθυρο· μετά από εισαγωγή ξαναδιαβάζονται). */
export function loadThemes(fresh = false): Promise<ThemesInfo> {
  if (!themesCache || fresh) themesCache = tacticsApi.themes().catch((e) => {
    themesCache = null;
    throw e;
  });
  return themesCache;
}

const CATEGORY_ORDER = ['motifs', 'advanced', 'mates', 'mateThemes', 'phases', 'specialMoves', 'goals', 'lengths', 'origin'];

export function SetupPopover({ filters, onChange, onApply, onClose, onCollections, section = 'tactics', fallback = '' }: { filters: PickFilters; onChange: (f: PickFilters) => void; onApply: () => void; onClose: () => void; onCollections?: () => void; section?: Section; fallback?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // οι πηγές αυτής της σελίδας με θέσεις στη βάση
  const allSources = useTactics((s) => s.sources);
  const sources = allSources.filter((s) => s.section === section);
  const lichessCount = useTactics((s) => s.puzzles);
  const [info, setInfo] = useState<ThemesInfo | null>(null);
  const [q, setQ] = useState('');
  const [oq, setOq] = useState('');
  const [openings, setOpenings] = useState<OpeningFamily[]>([]);
  useDialogStack(ref, onClose);
  useEffect(() => {
    loadThemes().then(setInfo).catch(reportError);
  }, []);
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest?.('[data-setup-toggle]')) onClose();
    };
    const t = setTimeout(() => window.addEventListener('mousedown', fn), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', fn);
    };
  }, [onClose]);
  // ανοίγματα: αναζήτηση στον server (οι οικογένειες με τα περισσότερα puzzles πρώτα)
  useEffect(() => {
    if (!oq.trim()) {
      setOpenings([]);
      return;
    }
    const t = setTimeout(() => {
      tacticsApi
        .openings(oq.trim())
        .then((r) => setOpenings(r.families.slice(0, 8)))
        .catch(() => setOpenings([]));
    }, 180);
    return () => clearTimeout(t);
  }, [oq]);

  const el = language() === 'el';
  const set = (patch: Partial<PickFilters>) => onChange({ ...filters, ...patch });
  const toggle = (key: string) => set({ themes: filters.themes.includes(key) ? filters.themes.filter((k) => k !== key) : [...filters.themes, key] });

  const groups = useMemo(() => {
    if (!info) return [];
    const nq = normalize(q.trim());
    // στα Φινάλε μόνο τα είδη φινάλε
    const themes = info.themes.filter((t) => t.bit !== null && (section !== 'endgame' || t.group === 'endgame') && (!nq || normalize(t.el).includes(nq) || normalize(t.en).includes(nq)));
    return CATEGORY_ORDER.map((cat) => ({ cat, name: info.categories[cat], themes: themes.filter((t) => t.cat === cat) })).filter((g) => g.themes.length);
  }, [info, q, section]);

  const diffs = info ? Object.entries(info.difficulties) : [];
  // «Βαθύς υπολογισμός»: πολύ μακριά τακτικά πάνω από τον βαθμό σου (μέτρημα σε βάθος, όπως στο Woodpecker)
  const deep = filters.themes.length === 1 && filters.themes[0] === 'veryLong' && filters.difficulty === 'harder' && !filters.source;

  return (
    <div ref={ref} className="popover tx-setup" role="dialog" aria-label={L('Θέματα και δυσκολία', 'Themes and difficulty')} tabIndex={-1} onKeyDown={(e) => trapTab(e, ref.current)}>
      <div className="tx-setup-head">
        <b>{L('Θέματα και δυσκολία', 'Themes and difficulty')}</b>
        <button type="button" className="btn btn-icon btn-sm btn-ghost" onClick={onClose} aria-label={L('Κλείσιμο', 'Close')}>
          <X className="ic" aria-hidden />
        </button>
      </div>
      <div className="tx-setup-body">
        {section === 'tactics' && (
          <div className="tx-setup-row">
            <span className="label">{L('Έτοιμο', 'Preset')}</span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              aria-pressed={deep}
              title={L('Πολύ μακριά τακτικά (4+ δικές σου κινήσεις), πάνω από τον βαθμό σου', 'Very long puzzles (4+ of your moves), above your rating')}
              onClick={() => set({ themes: ['veryLong'], difficulty: 'harder', source: '' })}
            >
              {L('Βαθύς υπολογισμός', 'Deep calculation')}
            </button>
          </div>
        )}
        <div className="tx-setup-row">
          <span className="label">{L('Δυσκολία', 'Difficulty')}</span>
          <Segmented
            value={filters.difficulty}
            label={L('Δυσκολία', 'Difficulty')}
            onChange={(v) => set({ difficulty: v })}
            options={(diffs.length ? diffs : [['normal', { delta: 0, el: 'Κανονικό', en: 'Normal' }]] as Array<[string, { delta: number; el: string; en: string }]>).map(([k, d]) => ({
              value: k,
              label: el ? d.el : d.en,
              title: d.delta ? L(`${d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)} από τον βαθμό σου`, `${d.delta > 0 ? '+' : '−'}${Math.abs(d.delta)} from your rating`) : L('Γύρω από τον βαθμό σου', 'Around your rating'),
            }))}
          />
        </div>
        <div className="tx-setup-row">
          <span className="label">{L('Χρώμα', 'Colour')}</span>
          <Segmented<'' | 'white' | 'black'>
            value={filters.color}
            label={L('Χρώμα', 'Colour')}
            onChange={(v) => set({ color: v })}
            options={[
              { value: '', label: L('Οποιοδήποτε', 'Any') },
              { value: 'white', label: L('Λευκά', 'White') },
              { value: 'black', label: L('Μαύρα', 'Black') },
            ]}
          />
        </div>
        <div className="tx-setup-row">
          <label className="label" htmlFor="tx-source">
            {L('Πηγή', 'Source')}
          </label>
          <select id="tx-source" className="select select-sm tx-source" value={filters.source || fallback} onChange={(e) => set({ source: e.target.value })}>
            {section === 'tactics' && (
              <option value="">
                {L('Κύρια συλλογή', 'Main collection')}
                {lichessCount ? ` (${fmtNum(lichessCount)})` : ''}
              </option>
            )}
            {section === 'endgame' && Boolean(lichessCount) && <option value="">{L('Κύρια συλλογή: φινάλε', 'Main collection: endgames')}</option>}
            {(['solve', 'test', 'practice'] as const).map((m) => {
              const list = sources.filter((s) => s.key !== 'lichess' && s.mode === m);
              if (!list.length) return null;
              return (
                <optgroup key={m} label={m === 'solve' ? L('Συλλογές: λύση', 'Collections: solve') : m === 'test' ? L('Τεστ: η καλύτερη κίνηση', 'Tests: the best move') : L('Εξάσκηση: η γραμμή της λύσης', 'Practice: the solution line')}>
                  {list.map((s) => (
                    <option key={s.key} value={s.key}>
                      {el ? s.name.el : s.name.en} ({fmtNum(s.count)})
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {!sources.some((s) => s.key !== 'lichess') && onCollections && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                onClose();
                onCollections();
              }}
            >
              {L('Πρόσθεσε συλλογές…', 'Add collections…')}
            </button>
          )}
        </div>
        {section === 'tactics' && (
          <div className="tx-setup-row">
            <span className="label">{L('Άνοιγμα', 'Opening')}</span>
            {filters.opening ? (
              <span className="chip">
                {filters.opening}
                <button type="button" className="chip-x" aria-label={L('Αφαίρεση ανοίγματος', 'Remove opening')} onClick={() => set({ opening: '' })}>
                  <X className="ic ic-sm" aria-hidden />
                </button>
              </span>
            ) : (
              <div className="tx-opening">
                <div className="field-icon">
                  <Search className="ic ic-sm" aria-hidden />
                  <input name="tx-opening" className="input input-sm" value={oq} onChange={(e) => setOq(e.target.value)} placeholder={L('π.χ. Sicilian, French, Italian', 'e.g. Sicilian, French, Italian')} aria-label={L('Αναζήτηση ανοίγματος', 'Search opening')} />
                </div>
                {openings.length > 0 && (
                  <div className="tx-opening-list" role="listbox" aria-label={L('Ανοίγματα', 'Openings')}>
                    {openings.map((o) => (
                      <button
                        key={o.family}
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="tx-opening-item"
                        onClick={() => {
                          set({ opening: o.family });
                          setOq('');
                        }}
                      >
                        <span className="ellipsis">{o.family.replace(/_/g, ' ')}</span>
                        <span className="faint tnum">{fmtNum(o.count)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {section !== 'strategy' && (
          <>
          <div className="tx-setup-row tx-setup-themes-head">
            <span className="label">{L('Θέματα', 'Themes')}</span>
            <div className="field-icon">
              <Search className="ic ic-sm" aria-hidden />
              <input name="tx-theme-search" className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L('Βρες θέμα', 'Find a theme')} aria-label={L('Αναζήτηση θέματος', 'Search themes')} />
            </div>
            {filters.themes.length > 1 && (
              <Segmented<'any' | 'all'>
                value={filters.match}
                label={L('Ταίριασμα θεμάτων', 'Theme matching')}
                onChange={(v) => set({ match: v })}
                options={[
                  { value: 'any', label: L('Ένα από αυτά', 'Any of them') },
                  { value: 'all', label: L('Όλα μαζί', 'All of them') },
                ]}
              />
            )}
          </div>
          <div className="tx-setup-themes">
            {!info && <span className="faint">{L('Φόρτωση θεμάτων…', 'Loading themes…')}</span>}
            {groups.map((g) => (
              <div key={g.cat} className="tx-theme-group">
                <div className="section-label">{g.name ? (el ? g.name.el : g.name.en) : g.cat}</div>
                <div className="tx-theme-chips">
                  {g.themes.map((t) => {
                    const on = filters.themes.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        className={`chip tx-theme${on ? ' is-on' : ''}${t.verdict === 'weak' ? ' is-weak' : ''}`}
                        aria-pressed={on}
                        title={`${el ? t.descEl : t.descEn}${t.verdict === 'weak' ? L(' · αδύναμο θέμα σου', ' · one of your weak themes') : t.verdict === 'strong' ? L(' · δυνατό θέμα σου', ' · one of your strong themes') : ''}`}
                        onClick={() => toggle(t.key)}
                      >
                        {el ? t.el : t.en}
                        {t.verdict === 'weak' && <span className="tx-weak-mark">{L('αδύναμο', 'weak')}</span>}
                        {t.count !== null && <span className="faint tnum">{fmtNum(t.count)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          </>
        )}
      </div>
      <div className="tx-setup-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(NO_FILTERS)}>
          {L('Καθαρισμός', 'Clear')}
        </button>
        <span className="faint">{L('Ισχύουν από το επόμενο puzzle', 'Apply from the next puzzle')}</span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            onApply();
            onClose();
          }}
        >
          {L('Νέο puzzle με αυτά', 'New puzzle with these')}
        </button>
      </div>
    </div>
  );
}
