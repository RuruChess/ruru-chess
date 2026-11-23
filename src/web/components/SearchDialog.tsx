/** Αναζήτηση παρτίδων (κεφαλίδα και θέση). */
import { useState } from 'react';
import { START_FEN } from '../../core/chess.ts';
import type { SearchCriteria } from '../api.ts';
import { L } from '../i18n.ts';
import { MEDALS } from '../../core/medals.ts';
import { describePawns, parsePawns } from '../../core/pawns.ts';
import { Dialog, Field } from './ui.tsx';
import { SetupDialog } from './GameDialogs.tsx';

export interface SearchSpec {
  filter: SearchCriteria;
  fen: string | null;
}

/** Ρυθμοί παιχνιδιού (μάσκα, όπως στο server/db/speed.ts). */
const SPEEDS: ReadonlyArray<[bit: number, el: string, en: string, elTitle: string, enTitle: string]> = [
  [1, 'Κλασικό', 'Classical', 'Τουρνουά χωρίς rapid/blitz στο όνομα ή με χρόνο από 60′ (για 60 κινήσεις)', 'Events without rapid/blitz in the name, or 60′ or more for 60 moves'],
  [2, 'Rapid', 'Rapid', 'Rapid, active, quickplay, Schnellschach… ή χρόνος 10′–60′', 'Rapid, active, quickplay… or 10′–60′'],
  [4, 'Blitz / bullet', 'Blitz / bullet', 'Blitz, bullet, armageddon, speed chess… ή χρόνος έως 10′', 'Blitz, bullet, armageddon, speed chess… or up to 10′'],
  [8, 'Αλληλογραφία', 'Correspondence', 'ICCF, e-mail, ταχυδρομικά τουρνουά κ.λπ.', 'ICCF, e-mail, postal events etc.'],
];
const SPEED_ALL = 15;

/** Τρόποι της δομής πιονιών (όπως στο core/pawns.ts). */
export const PAWN_MODE_LABELS: ReadonlyArray<[mode: NonNullable<SearchCriteria['pawnsMode']>, el: string, en: string]> = [
  ['exact', 'ακριβώς, και τα δύο χρώματα', 'exact, both colours'],
  ['white', 'μόνο τα λευκά πιόνια', 'White pawns only'],
  ['black', 'μόνο τα μαύρα πιόνια', 'Black pawns only'],
  ['files', 'μόνο οι στήλες', 'files only'],
];

export function SearchDialog({ initial, onClose, onSearch }: { initial: SearchSpec; onClose: () => void; onSearch: (s: SearchSpec) => void }) {
  const [f, setF] = useState<SearchCriteria>({ ...initial.filter });
  const [fen, setFen] = useState<string | null>(initial.fen);
  const [usePos, setUsePos] = useState(Boolean(initial.fen));
  const [setup, setSetup] = useState<null | 'pos' | 'pawns'>(null);
  const set = <K extends keyof SearchCriteria>(k: K, v: SearchCriteria[K]) => setF((x) => ({ ...x, [k]: v }));
  const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const results = f.results ?? [];
  const toggleResult = (r: number) => set('results', results.includes(r) ? results.filter((x) => x !== r) : [...results, r]);
  // χωρίς τιμή = όλοι οι ρυθμοί· όλοι ή κανένας επιλεγμένος = χωρίς φίλτρο
  const speeds = f.speeds ?? SPEED_ALL;
  const toggleSpeed = (bit: number) => {
    const next = speeds ^ bit;
    set('speeds', next === 0 || next === SPEED_ALL ? undefined : next);
  };

  return (
    <Dialog
      title={L('Αναζήτηση παρτίδων', 'Search games')}
      onClose={onClose}
      width={700}
      footer={
        <>
          <button
            onClick={() => {
              setF({});
              setFen(null);
              setUsePos(false);
            }}
          >
            {L('Καθαρισμός', 'Reset')}
          </button>
          <button onClick={onClose}>{L('Άκυρο', 'Cancel')}</button>
          <button className="primary" onClick={() => onSearch({ filter: f, fen: usePos ? fen ?? START_FEN : null })}>
            {L('Αναζήτηση', 'Search')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={L('Λευκά', 'White')}>
          <input value={f.white ?? ''} onChange={(e) => set('white', e.target.value)} placeholder={L('επώνυμο (π.χ. Μπανίκας ή Banikas)', 'surname')} autoFocus />
        </Field>
        <Field label={L('Μαύρα', 'Black')}>
          <input value={f.black ?? ''} onChange={(e) => set('black', e.target.value)} />
        </Field>
        <label className="check wide">
          <input type="checkbox" checked={Boolean(f.ignoreColors)} onChange={(e) => set('ignoreColors', e.target.checked)} /> {L('Αγνόησε τα χρώματα', 'Ignore colours')}
        </label>
        <Field label={L('Τουρνουά', 'Event')}>
          <input value={f.event ?? ''} onChange={(e) => set('event', e.target.value)} />
        </Field>
        <Field label={L('Τόπος', 'Site')}>
          <input value={f.site ?? ''} onChange={(e) => set('site', e.target.value)} />
        </Field>
        <Field label={L('Σχολιαστής', 'Annotator')}>
          <input value={f.annotator ?? ''} onChange={(e) => set('annotator', e.target.value)} />
        </Field>
        <Field label={L('Κείμενο στα σχόλια', 'Text in comments')}>
          <input value={f.commentText ?? ''} onChange={(e) => set('commentText', e.target.value)} placeholder={L('π.χ. καινοτομία', 'e.g. novelty')} />
        </Field>
        <Field label={L('Υλικό (κάποια στιγμή)', 'Material (at some point)')}>
          <input
            value={f.material ?? ''}
            onChange={(e) => set('material', e.target.value)}
            placeholder="KRP-KR · R*-R* · QM-Q"
            title={L('Λευκά-Μαύρα με K Q R B N P· * = οσαδήποτε πιόνια, M = αξιωματικός ή ίππος', 'White-Black with K Q R B N P; * = any pawns, M = bishop or knight')}
          />
        </Field>
        <label className="check">
          <input type="checkbox" checked={Boolean(f.materialAnyColor)} onChange={(e) => set('materialAnyColor', e.target.checked)} /> {L('Υλικό και με αντίστροφα χρώματα', 'Material with either colour')}
        </label>
        <Field label={L('Ελιγμός κομματιού', 'Piece maneuver')}>
          <input value={f.maneuver ?? ''} onChange={(e) => set('maneuver', e.target.value)} placeholder="Nd2 Nf1 Ng3" title={L('Το ίδιο κομμάτι κάνει με τη σειρά τις κινήσεις (στο μεταξύ κινούνται άλλα)', 'The same piece makes these moves in order (other pieces may move in between)')} />
        </Field>
        <Field label={L('Ελιγμός από', 'Maneuver by')}>
          <select value={f.maneuverSide ?? ''} onChange={(e) => set('maneuverSide', e.target.value === '' ? undefined : Number(e.target.value))}>
            <option value="">{L('οποιοδήποτε χρώμα', 'either colour')}</option>
            <option value={0}>{L('λευκά', 'White')}</option>
            <option value={1}>{L('μαύρα', 'Black')}</option>
          </select>
        </Field>
        <Field label={L('Μετάλλιο', 'Medal')}>
          <select value={f.medals ? Math.log2(f.medals) : ''} onChange={(e) => set('medals', e.target.value === '' ? undefined : 1 << Number(e.target.value))}>
            <option value="">—</option>
            {MEDALS.map((m, i) => (
              <option key={m.key} value={i}>
                {L(m.el, m.en)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={L('Έτος από', 'Year from')}>
          <input type="number" value={f.yearFrom ?? ''} onChange={(e) => set('yearFrom', numOrUndef(e.target.value))} />
        </Field>
        <Field label={L('έως', 'to')}>
          <input type="number" value={f.yearTo ?? ''} onChange={(e) => set('yearTo', numOrUndef(e.target.value))} />
        </Field>
        <Field label={L('Elo από', 'Elo from')}>
          <input type="number" value={f.eloFrom ?? ''} onChange={(e) => set('eloFrom', numOrUndef(e.target.value))} />
        </Field>
        <Field label={L('έως', 'to')}>
          <input type="number" value={f.eloTo ?? ''} onChange={(e) => set('eloTo', numOrUndef(e.target.value))} />
        </Field>
        <label className="check wide">
          <input type="checkbox" checked={Boolean(f.eloBoth)} onChange={(e) => set('eloBoth', e.target.checked)} /> {L('Το όριο Elo ισχύει και για τους δύο παίκτες', 'Elo limit applies to both players')}
        </label>
        <Field label={L('ECO από', 'ECO from')}>
          <input value={f.ecoFrom ?? ''} onChange={(e) => set('ecoFrom', e.target.value.toUpperCase())} placeholder="B20" maxLength={3} />
        </Field>
        <Field label={L('έως', 'to')}>
          <input value={f.ecoTo ?? ''} onChange={(e) => set('ecoTo', e.target.value.toUpperCase())} placeholder="B99" maxLength={3} />
        </Field>
        <Field label={L('Κινήσεις από', 'Moves from')}>
          <input type="number" value={f.minPlies ? Math.ceil(f.minPlies / 2) : ''} onChange={(e) => set('minPlies', e.target.value ? Number(e.target.value) * 2 - 1 : undefined)} />
        </Field>
        <Field label={L('έως', 'to')}>
          <input type="number" value={f.maxPlies ? Math.ceil(f.maxPlies / 2) : ''} onChange={(e) => set('maxPlies', e.target.value ? Number(e.target.value) * 2 : undefined)} />
        </Field>
      </div>
      <div className="row gap wrap">
        <span>{L('Αποτέλεσμα:', 'Result:')}</span>
        {[
          [1, '1-0'],
          [2, '½-½'],
          [3, '0-1'],
          [0, '*'],
        ].map(([r, label]) => (
          <label key={r} className="check">
            <input type="checkbox" checked={!results.length || results.includes(r as number)} onChange={() => toggleResult(r as number)} /> {label}
          </label>
        ))}
        <label className="check">
          <input type="checkbox" checked={Boolean(f.annotated)} onChange={(e) => set('annotated', e.target.checked)} /> {L('Μόνο σχολιασμένες', 'Annotated only')}
        </label>
      </div>
      <div className="row gap wrap" title={L('Από το όνομα του τουρνουά και, όπου υπάρχει, την ετικέτα TimeControl', 'From the event name and, where present, the TimeControl tag')}>
        <span>{L('Ρυθμός:', 'Time control:')}</span>
        {SPEEDS.map(([bit, el, en, elTitle, enTitle]) => (
          <label key={bit} className="check" title={L(elTitle, enTitle)}>
            <input type="checkbox" checked={(speeds & bit) !== 0} onChange={() => toggleSpeed(bit)} /> {L(el, en)}
          </label>
        ))}
      </div>
      <div className="search-pos">
        <label className="check">
          <input type="checkbox" checked={usePos} onChange={(e) => setUsePos(e.target.checked)} /> {L('Αναζήτηση θέσης', 'Position search')}
        </label>
        {usePos && (
          <>
            <code className="fen-small">{fen ?? START_FEN}</code>
            <button onClick={() => setSetup('pos')}>{L('Θέση…', 'Set up…')}</button>
          </>
        )}
      </div>
      <div className="search-pos" title={L('Η κύρια γραμμή περνά κάποια στιγμή από αυτή τη δομή πιονιών, όπου κι αν είναι τα κομμάτια', 'The main line reaches this pawn structure at some point, wherever the pieces are')}>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(f.pawns)}
            onChange={(e) => {
              setF((x) => ({ ...x, pawns: e.target.checked ? fen ?? START_FEN : undefined, pawnsMode: undefined }));
              if (e.target.checked && !fen) setSetup('pawns');
            }}
          />{' '}
          {L('Δομή πιονιών', 'Pawn structure')}
        </label>
        {f.pawns && (
          <>
            <select value={f.pawnsMode ?? 'exact'} onChange={(e) => set('pawnsMode', e.target.value === 'exact' ? undefined : (e.target.value as SearchCriteria['pawnsMode']))}>
              {PAWN_MODE_LABELS.map(([m, el, en]) => (
                <option key={m} value={m}>
                  {L(el, en)}
                </option>
              ))}
            </select>
            <code className="fen-small">{pawnsText(f.pawns)}</code>
            <button onClick={() => setSetup('pawns')}>{L('Δομή…', 'Set up…')}</button>
          </>
        )}
      </div>
      {setup && (
        <SetupDialog
          initialFen={(setup === 'pawns' ? f.pawns : fen) ?? START_FEN}
          onClose={() => setSetup(null)}
          onDone={(x) => {
            if (setup === 'pawns') set('pawns', x);
            else setFen(x);
            setSetup(null);
          }}
        />
      )}
    </Dialog>
  );
}

/** Τα τετράγωνα των πιονιών (λευκά – μαύρα). */
function pawnsText(fen: string): string {
  const p = parsePawns(fen);
  return p ? describePawns(p) : '?';
}

/** Σύντομη περιγραφή φίλτρου για τη γραμμή κατάστασης. */
export function describeFilter(s: SearchSpec): string {
  const f = s.filter;
  const parts: string[] = [];
  if (f.white) parts.push(`${L('Λευκά', 'White')}: ${f.white}`);
  if (f.black) parts.push(`${L('Μαύρα', 'Black')}: ${f.black}`);
  if (f.player) parts.push(`${L('Παίκτης', 'Player')}: ${f.player}`);
  if (f.event) parts.push(`${L('Τουρνουά', 'Event')}: ${f.event}`);
  if (f.site) parts.push(`${L('Τόπος', 'Site')}: ${f.site}`);
  if (f.annotator) parts.push(`${L('Σχολ.', 'Annot.')}: ${f.annotator}`);
  if (f.yearFrom || f.yearTo) parts.push(`${f.yearFrom ?? ''}–${f.yearTo ?? ''}`);
  if (f.eloFrom || f.eloTo) parts.push(`Elo ${f.eloFrom ?? ''}–${f.eloTo ?? ''}`);
  if (f.ecoFrom || f.ecoTo) parts.push(`ECO ${f.ecoFrom ?? ''}–${f.ecoTo ?? ''}`);
  if (f.minPlies || f.maxPlies) {
    parts.push(`${L('Κινήσεις', 'Moves')} ${f.minPlies ? Math.ceil(f.minPlies / 2) : ''}–${f.maxPlies ? Math.ceil(f.maxPlies / 2) : ''}`);
  }
  if (f.annotated) parts.push(L('σχολιασμένες', 'annotated'));
  if (f.speeds && f.speeds !== SPEED_ALL) parts.push(SPEEDS.filter(([bit]) => f.speeds! & bit).map(([, el, en]) => L(el, en)).join(' + '));
  if (f.commentText) parts.push(`«${f.commentText}»`);
  if (f.maneuver) parts.push(`${L('Ελιγμός', 'Maneuver')} ${f.maneuver}${f.maneuverSide === 0 ? L(' (λευκά)', ' (White)') : f.maneuverSide === 1 ? L(' (μαύρα)', ' (Black)') : ''}`);
  if (f.medals) parts.push(MEDALS.filter((_, i) => f.medals! & (1 << i)).map((m) => L(m.el, m.en)).join(', '));
  if (f.material) parts.push(`${L('Υλικό', 'Material')} ${f.material.toUpperCase()}${f.materialAnyColor ? ' ⇄' : ''}`);
  if (f.pawns) {
    const m = PAWN_MODE_LABELS.find(([x]) => x === (f.pawnsMode ?? 'exact'));
    parts.push(`${L('Δομή πιονιών', 'Pawn structure')} ${pawnsText(f.pawns)}${m && m[0] !== 'exact' ? ` (${L(m[1], m[2])})` : ''}`);
  }
  if (s.fen) parts.push(L('θέση', 'position'));
  return parts.join(' · ');
}
