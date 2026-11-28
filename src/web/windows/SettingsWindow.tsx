/**
 * Ρυθμίσεις: γλώσσα, εμφάνιση, ήχος, σημειογραφία, μηχανές, online υπηρεσίες.
 * Οι αλλαγές γίνονται πρώτα σε πρόχειρο: «Εφαρμογή» τις δείχνει σε όλα τα παράθυρα χωρίς να τις
 * κρατά, «Αποθήκευση» τις κρατά. Αν το παράθυρο κλείσει χωρίς αποθήκευση, όλα γυρίζουν πίσω.
 * Οι μηχανές αλλάζουν αμέσως (προσθήκη, αφαίρεση, προεπιλογή).
 */
import { useEffect, useRef, useState } from 'react';
import { Trash2, Plus, Check, Volume2 } from 'lucide-react';
import { START_FEN } from '../../core/chess.ts';
import { WINDOW_ID, api, pickFiles, type EngineConfig, type Settings } from '../api.ts';
import { L } from '../i18n.ts';
import { reportError, useApp } from '../store.ts';
import { BOARD_THEMES, Board } from '../components/Board.tsx';
import { Field } from '../components/ui.tsx';
import { StockfishInstall } from '../components/StockfishInstall.tsx';
import { Lc0Install } from '../components/Lc0Install.tsx';
import { AboutSection, useAppInfo } from '../components/About.tsx';
import { MyGamesSetting } from '../components/MyGamesSetting.tsx';
import { previewSound, soundThemeName, soundThemeNote } from '../components/SoundControl.tsx';
import { CUSTOM_SLOTS, SOUND_THEMES, playSound, soundConfig, type CustomSlot, type SoundConfig } from '../sounds.ts';

const PREVIEW_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

// (το βιβλίο Polyglot, `bookPath`, επιλέγεται στην καρτέλα «Βιβλίο» του δέντρου: αν ήταν και εδώ, ένα ανοιχτό παράθυρο
// Ρυθμίσεων θα έγραφε την παλιά τιμή πάνω από την καινούργια)
const DRAFT_KEYS = ['language', 'boardTheme', 'pieceSet', 'showCoordinates', 'animationMs', 'onlineLookups', 'watchLive', 'myGames', 'updateCheck', 'ui'] as const;
type Draft = Pick<Settings, (typeof DRAFT_KEYS)[number]>;
const pickDraft = (s: Settings): Draft => JSON.parse(JSON.stringify(Object.fromEntries(DRAFT_KEYS.map((k) => [k, s[k]])))) as Draft;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Τι άλλαξε σε σχέση με τις αποθηκευμένες (στο `ui` μόνο τα κλειδιά που άλλαξαν). */
function diff(draft: Draft, saved: Draft): { patch: Record<string, unknown>; ui: Record<string, unknown> } {
  const patch: Record<string, unknown> = {};
  for (const k of DRAFT_KEYS) if (k !== 'ui' && !same(draft[k], saved[k])) patch[k] = draft[k];
  const d = (draft.ui ?? {}) as Record<string, unknown>;
  const s = (saved.ui ?? {}) as Record<string, unknown>;
  const ui: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(d), ...Object.keys(s)])) if (!same(d[k], s[k])) ui[k] = d[k];
  return { patch, ui };
}

const revertPreview = () => api.post('/api/settings/preview', {}).catch(() => {});

export function SettingsWindow() {
  const live = useApp((s) => s.settings);
  const library = useApp((s) => s.library);
  const load = useApp((s) => s.loadSettings);
  const toast = useApp((s) => s.toast);
  const appInfo = useAppInfo();
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [previewed, setPreviewed] = useState(false);
  const previewedRef = useRef(false);
  previewedRef.current = previewed;

  useEffect(() => {
    api.get<{ discovered: string[] }>('/api/engines').then((r) => setDiscovered(r.discovered)).catch(() => {});
  }, [live?.engines.length]);

  // οι αποθηκευμένες ρυθμίσεις από τον server (το store μπορεί να δείχνει «Εφαρμογή» χωρίς αποθήκευση)
  useEffect(() => {
    api
      .get<Settings>('/api/settings')
      .then((s) => {
        setSaved(pickDraft(s));
        setDraft(pickDraft(s));
      })
      .catch(reportError);
  }, []);

  // κλείσιμο χωρίς αποθήκευση μετά από «Εφαρμογή»: όλα τα παράθυρα γυρίζουν στις αποθηκευμένες
  useEffect(() => {
    const onHide = () => {
      if (previewedRef.current) navigator.sendBeacon('/api/settings/preview', new Blob(['{}'], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      if (previewedRef.current) void revertPreview();
    };
  }, []);

  if (!live || !draft || !saved) return null;
  const ui = (draft.ui ?? {}) as Record<string, unknown>;
  const snd = soundConfig(ui);
  const set = (patch: Partial<Draft>) => setDraft((d) => d && { ...d, ...patch });
  const setUi = (k: string, v: unknown) => setDraft((d) => d && { ...d, ui: { ...((d.ui ?? {}) as Record<string, unknown>), [k]: v } });
  const changed = diff(draft, saved);
  const dirty = Object.keys(changed.patch).length > 0 || Object.keys(changed.ui).length > 0;

  // το ui στέλνεται ολόκληρο: οι τρέχουσες τιμές του server (π.χ. καρτέλες που άλλαξαν σε άλλα
  // παράθυρα) και από πάνω μόνο ό,τι άλλαξε εδώ
  const payload = async () => {
    const cur = await api.get<Settings>('/api/settings');
    return { ...changed.patch, ui: { ...((cur.ui ?? {}) as Record<string, unknown>), ...changed.ui } };
  };
  const apply = async () => {
    try {
      // μόνο ό,τι άλλαξε· ο server το δείχνει πάνω από τις αποθηκευμένες και το αναιρεί όταν
      // κλείσει αυτό το παράθυρο χωρίς «Αποθήκευση»
      await api.post('/api/settings/preview', { win: WINDOW_ID, settings: { ...changed.patch, ui: changed.ui } });
      setPreviewed(true);
    } catch (e) {
      reportError(e);
    }
  };
  const saveAll = async () => {
    try {
      const s = await api.put<Settings>('/api/settings', await payload());
      setSaved(pickDraft(s));
      setDraft(pickDraft(s));
      setPreviewed(false);
      toast(L('Οι ρυθμίσεις αποθηκεύτηκαν', 'Settings saved'), 'ok');
    } catch (e) {
      reportError(e);
    }
  };
  // η γλώσσα αλλάζει και αποθηκεύεται αμέσως, σε όλα τα παράθυρα (χωρίς «Εφαρμογή»/«Αποθήκευση»,
  // που με το κλείσιμο του παραθύρου θα γύριζαν πίσω)
  const setLanguage = async (language: 'el' | 'en') => {
    try {
      const s = await api.put<Settings>('/api/settings', { language });
      setSaved((x) => x && { ...x, language: s.language });
      setDraft((d) => d && { ...d, language: s.language });
    } catch (e) {
      reportError(e);
    }
  };
  const discard = async () => {
    setDraft(saved);
    if (previewed) await revertPreview();
    setPreviewed(false);
  };

  const addEngine = async (path?: string) => {
    try {
      const p = path ?? (await pickFiles('exe'))[0];
      if (!p) return;
      setBusy(true);
      await api.post('/api/engines', { path: p });
      await load();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const updateEngine = async (e: EngineConfig, patch: Partial<EngineConfig> & { makeDefault?: boolean }) => {
    try {
      await api.put(`/api/engines/${e.id}`, patch);
      await load();
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <div className="settings-window">
      <section>
        <h2>{L('Γενικά', 'General')}</h2>
        <div className="form-grid">
          <Field label={L('Γλώσσα', 'Language')}>
            <select value={draft.language} onChange={(e) => void setLanguage(e.target.value as 'el' | 'en')}>
              <option value="el">Ελληνικά</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label={L('Σημειογραφία κινήσεων', 'Move notation')}>
            <select value={(ui.notation as string) ?? 'figurine'} onChange={(e) => setUi('notation', e.target.value)}>
              <option value="figurine">{L('Εικονίδια (♘f3)', 'Figurines (♘f3)')}</option>
              <option value="letters">{L('Αγγλικά γράμματα (Nf3)', 'English letters (Nf3)')}</option>
              <option value="greek">{L('Ελληνικά γράμματα (Ιf3)', 'Greek letters (Ιf3)')}</option>
            </select>
          </Field>
          <Field label={L('Θέμα εμφάνισης', 'Appearance')}>
            <select value={(ui.theme as string) ?? 'light'} onChange={(e) => setUi('theme', e.target.value)}>
              <option value="light">{L('Φωτεινό', 'Light')}</option>
              <option value="dark">{L('Σκοτεινό', 'Dark')}</option>
              <option value="system">{L('Όπως το σύστημα', 'System')}</option>
            </select>
          </Field>
          <Field label={L('Βάση αναφοράς (καρτέλα «Αναφορά»: δέντρο και παρτίδες της θέσης)', 'Reference database (“Reference” tab: tree and games of the position)')}>
            <select value={(ui.referenceDb as string) ?? ''} onChange={(e) => setUi('referenceDb', e.target.value || undefined)}>
              <option value="">{L('— η μεγαλύτερη βάση —', '— the largest database —')}</option>
              {library
                .filter((d) => d.games > 0)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.games.toLocaleString('el-GR')})
                  </option>
                ))}
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={draft.onlineLookups} onChange={(e) => set({ onlineLookups: e.target.checked })} />
            {L('Online tablebases και αξιολογήσεις από το Lichess (στέλνει μόνο τη θέση)', 'Online tablebases and evaluations from Lichess (sends only the position)')}
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.watchLive !== false} onChange={(e) => set({ watchLive: e.target.checked })} />
            {L('Ζωντανά: παρτίδες από το Lichess (όσο είναι ανοιχτό, ρωτά το Lichess και για μεγάλα τουρνουά σε εξέλιξη)', 'Watch Live: games from Lichess (while on, it also asks Lichess about big tournaments in progress)')}
          </label>
          <MyGamesSetting value={draft.myGames} saved={saved.myGames} onChange={(v) => set({ myGames: v })} />
          {appInfo?.links.releases && (
            <label className="check">
              <input type="checkbox" checked={draft.updateCheck !== false} onChange={(e) => set({ updateCheck: e.target.checked })} />
              {L('Έλεγχος για νέα έκδοση στην εκκίνηση (ρωτά μόνο το GitHub)', 'Check for a new version at startup (asks GitHub only)')}
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={ui.windows !== 'tabs'} onChange={(e) => setUi('windows', e.target.checked ? 'separate' : 'tabs')} />
            {L('Κάθε βάση και παρτίδα σε δικό της παράθυρο', 'Each database and game in its own window')}
          </label>
        </div>
      </section>

      <section>
        <h2>{L('Σκακιέρα', 'Board')}</h2>
        <div className="board-themes">
          {Object.keys(BOARD_THEMES).map((t) => (
            <button key={t} className={`theme-swatch${draft.boardTheme === t ? ' on' : ''}`} onClick={() => set({ boardTheme: t })} title={t}>
              <span style={{ background: BOARD_THEMES[t].light }} />
              <span style={{ background: BOARD_THEMES[t].dark }} />
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label={L('Κομμάτια', 'Pieces')}>
            <select value={draft.pieceSet} onChange={(e) => set({ pieceSet: e.target.value })}>
              <option value="cburnett">Cburnett</option>
              <option value="merida">Merida</option>
            </select>
          </Field>
          <label className="check">
            <input type="checkbox" checked={draft.showCoordinates} onChange={(e) => set({ showCoordinates: e.target.checked })} /> {L('Συντεταγμένες', 'Coordinates')}
          </label>
          <label className="check">
            <input type="checkbox" checked={ui.oneClick !== false} onChange={(e) => setUi('oneClick', e.target.checked)} />{' '}
            {L('Κίνηση με ένα κλικ στον προορισμό (όταν πάει εκεί ένα μόνο κομμάτι)', 'One-click move on the target square (when only one piece can go there)')}
          </label>
          <label className="check">
            <input type="checkbox" checked={ui.lastMoveHighlight !== false} onChange={(e) => setUi('lastMoveHighlight', e.target.checked)} />{' '}
            {L('Χρώμα στην τελευταία κίνηση', 'Highlight the last move')}
          </label>
          <label className="check">
            <input type="checkbox" checked={ui.legalDots !== false} onChange={(e) => setUi('legalDots', e.target.checked)} />{' '}
            {L('Κουκκίδες στις νόμιμες κινήσεις', 'Dots on legal moves')}
          </label>
          <label className="check">
            <input type="checkbox" checked={ui.variationDialog !== false} onChange={(e) => setUi('variationDialog', e.target.checked)} />{' '}
            {L('Παράθυρο επιλογής βαριάντας (→ σε διακλάδωση)', 'Variation chooser (→ at a branch)')}
          </label>
          <Field label={L(`Κίνηση κομματιών: ${draft.animationMs ? `${draft.animationMs} ms` : 'χωρίς'}`, `Piece movement: ${draft.animationMs ? `${draft.animationMs} ms` : 'off'}`)}>
            <input type="range" min={0} max={600} step={25} value={draft.animationMs} onChange={(e) => set({ animationMs: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="settings-preview">
          <Board fen={PREVIEW_FEN || START_FEN} orientation="white" movable="none" theme={draft.boardTheme} pieceSet={draft.pieceSet} coordinates={draft.showCoordinates} />
        </div>
      </section>

      <section>
        <h2>{L('Ήχος', 'Sound')}</h2>
        <div className="form-grid">
          <label className="check">
            <input type="checkbox" checked={snd.on} onChange={(e) => setUi('sound', { ...snd, on: e.target.checked })} /> {L('Ήχοι στις κινήσεις (διαφορετικός ήχος όταν τρώγεται κομμάτι)', 'Move sounds (a different sound for captures)')}
          </label>
          <Field label={L(`Ένταση: ${snd.volume}%`, `Volume: ${snd.volume}%`)}>
            <input type="range" min={0} max={100} step={5} value={snd.volume} disabled={!snd.on} onChange={(e) => setUi('sound', { ...snd, volume: Number(e.target.value) })} onPointerUp={(e) => previewSound({ ...snd, volume: Number(e.currentTarget.value), on: true })} onKeyUp={(e) => previewSound({ ...snd, volume: Number(e.currentTarget.value), on: true })} />
          </Field>
        </div>
        <div className="sound-themes" role="radiogroup" aria-label={L('Σετ ήχων', 'Sound set')}>
          {SOUND_THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={snd.theme === t}
              className={`sound-theme${snd.theme === t ? ' on' : ''}`}
              disabled={!snd.on}
              onClick={() => {
                setUi('sound', { ...snd, theme: t });
                previewSound({ ...snd, theme: t, on: true });
              }}
            >
              <b>
                <Volume2 size={14} aria-hidden /> {soundThemeName(t)}
              </b>
              <span className="muted small">{soundThemeNote(t)}</span>
            </button>
          ))}
        </div>
        {snd.theme === 'custom' && <CustomSounds snd={snd} onChange={(custom) => setUi('sound', { ...snd, custom })} />}
        <p className="muted small">{L('Πάτα ένα σετ για να το ακούσεις. Την ένταση και το σετ τα αλλάζεις και από το ηχείο της πάνω γραμμής.', 'Click a set to hear it. You can also change the volume and the set from the speaker in the top bar.')}</p>
      </section>

      <section>
        <h2>{L('Μηχανές ανάλυσης (UCI)', 'Analysis engines (UCI)')}</h2>
        <p className="muted small">{L('Οι αλλαγές στις μηχανές ισχύουν αμέσως.', 'Engine changes take effect immediately.')}</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>{L('Όνομα', 'Name')}</th>
              <th>Threads</th>
              <th>Hash (MB)</th>
              <th>{L('Προεπιλογή', 'Default')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {/* οι μηχανές Maia φαίνονται στην κάρτα του Lc0 */}
            {live.engines.filter((e) => !e.human).map((e) => (
              <tr key={e.id}>
                <td title={e.path}>
                  <b>{e.name}</b>
                  <div className="muted tiny">{e.path}</div>
                </td>
                <td>
                  <input type="number" min={1} max={64} value={Number(e.options.Threads ?? 1)} onChange={(ev) => void updateEngine(e, { options: { ...e.options, Threads: Number(ev.target.value) } })} />
                </td>
                <td>
                  <input type="number" min={16} max={16384} step={16} value={Number(e.options.Hash ?? 64)} onChange={(ev) => void updateEngine(e, { options: { ...e.options, Hash: Number(ev.target.value) } })} />
                </td>
                <td>
                  {live.defaultEngine === e.id ? (
                    <Check size={16} />
                  ) : (
                    <button className="small-btn" onClick={() => void updateEngine(e, { makeDefault: true })}>
                      {L('Ορισμός', 'Set')}
                    </button>
                  )}
                </td>
                <td>
                  <button
                    className="icon-btn danger"
                    title={L('Αφαίρεση', 'Remove')}
                    onClick={async () => {
                      await api.del(`/api/engines/${e.id}`).catch(reportError);
                      await load();
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <StockfishInstall />
        <Lc0Install />
        <div className="row gap wrap">
          <button disabled={busy} onClick={() => void addEngine()}>
            <Plus size={16} /> {L('Προσθήκη μηχανής (.exe)…', 'Add engine (.exe)…')}
          </button>
          {discovered.map((d) => (
            <button key={d} disabled={busy} onClick={() => void addEngine(d)} title={d}>
              <Plus size={14} /> {d.split(/[\\/]/).pop()}
            </button>
          ))}
        </div>
        <p className="muted small">
          {L(
            'Το Stockfish κατεβαίνει από τις επίσημες εκδόσεις του (github.com/official-stockfish, GPLv3) και γίνεται η προεπιλεγμένη μηχανή.',
            'Stockfish is downloaded from its official releases (github.com/official-stockfish, GPLv3) and becomes the default engine.',
          )}
        </p>
      </section>

      <AboutSection databasesDir={live.databasesDir} />

      <div className="settings-actions">
        <span className="muted small">
          {dirty ? (previewed ? L('Εφαρμόστηκαν χωρίς αποθήκευση', 'Applied, not saved') : L('Υπάρχουν αλλαγές που δεν εφαρμόστηκαν', 'There are changes not applied yet')) : L('Όλα αποθηκευμένα', 'Everything is saved')}
        </span>
        <button disabled={!dirty && !previewed} onClick={() => void discard()}>
          {L('Ακύρωση αλλαγών', 'Discard changes')}
        </button>
        <button disabled={!dirty} onClick={() => void apply()} title={L('Δες τις αλλαγές σε όλα τα παράθυρα χωρίς να αποθηκευτούν', 'Preview the changes in all windows without saving')}>
          {L('Εφαρμογή', 'Apply')}
        </button>
        <button className="primary" disabled={!dirty} onClick={() => void saveAll()}>
          {L('Αποθήκευση', 'Save')}
        </button>
      </div>
    </div>
  );
}

/** «Δικοί μου ήχοι»: ένα αρχείο ήχου για κίνηση, αιχμαλωσία, σαχ και ματ (ό,τι λείπει παίζει από το Ξύλο). */
function CustomSounds({ snd, onChange }: { snd: SoundConfig; onChange: (custom: Partial<Record<CustomSlot, number>>) => void }) {
  const [busy, setBusy] = useState<CustomSlot | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<CustomSlot>('move');
  const custom = snd.custom ?? {};
  const name = (k: CustomSlot) => ({ move: L('Κίνηση', 'Move'), capture: L('Αιχμαλωσία', 'Capture'), check: L('Σαχ', 'Check'), mate: L('Ματ', 'Checkmate') })[k];
  const hear = (k: CustomSlot, c = custom) => playSound(k, { preview: { ...snd, on: true, custom: c } });

  const upload = async (k: CustomSlot, file: File) => {
    setBusy(k);
    try {
      const r = await fetch(`/api/sounds/custom/${k}`, { method: 'POST', headers: { 'Content-Type': file.type || 'audio/mpeg' }, body: file });
      const out = (await r.json()) as { version?: number; error?: string };
      if (!r.ok || !out.version) throw new Error(out.error || L('Δεν ανέβηκε ο ήχος', 'The sound was not uploaded'));
      const next = { ...custom, [k]: out.version };
      onChange(next);
      hear(k, next);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (k: CustomSlot) => {
    await api.del(`/api/sounds/custom/${k}`).catch(reportError);
    const next = { ...custom };
    delete next[k];
    onChange(next);
  };

  return (
    <div className="custom-sounds">
      <input
        ref={input}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload(target.current, f);
        }}
      />
      {CUSTOM_SLOTS.map((k) => (
        <div key={k} className="row gap">
          <span style={{ minWidth: 90 }}>{name(k)}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy !== null}
            onClick={() => {
              target.current = k;
              input.current?.click();
            }}
          >
            {busy === k ? L('Ανεβαίνει…', 'Uploading…') : custom[k] ? L('Άλλο αρχείο…', 'Other file…') : L('Διάλεξε αρχείο…', 'Choose file…')}
          </button>
          <button type="button" className="icon-btn" title={L('Άκουσέ το', 'Listen')} aria-label={L('Άκουσέ το', 'Listen')} onClick={() => hear(k)}>
            <Volume2 size={14} />
          </button>
          {custom[k] ? (
            <button type="button" className="icon-btn" title={L('Αφαίρεση (παίζει το Ξύλο)', 'Remove (Wood plays)')} aria-label={L('Αφαίρεση', 'Remove')} disabled={busy !== null} onClick={() => void remove(k)}>
              <Trash2 size={14} />
            </button>
          ) : (
            <span className="muted small">{k === 'mate' ? L('χωρίς: ο ήχος σαχ', 'none: the check sound') : k === 'check' ? L('χωρίς: ο ήχος κίνησης', 'none: the move sound') : L('χωρίς: Ξύλο', 'none: Wood')}</span>
          )}
        </div>
      ))}
      <p className="muted small">{L('Αρχεία mp3, wav ή ogg ως 2 MB. Καλύτερα σύντομα (κάτω από 1 δευτερόλεπτο).', 'mp3, wav or ogg files up to 2 MB. Short ones work best (under a second).')}</p>
    </div>
  );
}
