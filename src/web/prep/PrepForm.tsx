/**
 * Η φόρμα της «Προετοιμασίας»: ποιος, τι να ψάξει, ρυθμοί.
 * - Τρεις ίδιες γραμμές (FIDE / OTB, Lichess, Chess.com), χωρίς κουμπιά και χωρίς λίστα βάσεων· αρκεί μία.
 * - Τα φίλτρα είναι κοινά και για τις τρεις.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Download, Target, X } from 'lucide-react';
import {
  PREP_DEFAULTS,
  PREP_PICK_SPEEDS,
  inPeriod,
  periodStart,
  type OtbMatch,
  type OtbSuggestion,
  type PrepColor,
  type PrepInfo,
  type PrepOpts,
  type PrepOtb,
  type PrepSpeed,
} from '../../core/prep.ts';
import { cleanSiteUser } from '../../core/social.ts';
import { api } from '../api.ts';
import { L, fmtDate, fmtNum } from '../i18n.ts';
import { reportError } from '../store.ts';
import { useSocial } from '../social/social.ts';
import { colorName, errText, speedName } from './text.ts';

/** Με τι ανοίγει η φόρμα: όνομα από την αναζήτηση των Βάσεων, ή προετοιμασία που αλλάζει φίλτρα. */
export interface FormStart {
  name?: string;
  prev?: PrepInfo;
}

const PERIODS = [0, 6, 12, 24];
const LIMITS = [100, 250, 500, 0];
const COLORS: PrepColor[] = ['both', 'white', 'black'];

const years = (r: OtbSuggestion) => {
  const [from, to] = [r.first, r.last].map((d) => Math.floor(d / 10000));
  return !from ? '' : from === to ? `${from}` : `${from}–${to}`;
};

/** Μία γραμμή της φόρμας: ετικέτα αριστερά, πεδίο και μήνυμα δεξιά. Ίδια για όλες. */
function Row({ id, label, hint, children, note }: { id?: string; label: string; hint?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="prep-row">
      <label className="prep-label" htmlFor={id}>
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </label>
      <div className="prep-control">
        {children}
        {note}
      </div>
    </div>
  );
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="prep-sec">
      <h2>
        <span className="prep-sec-n" aria-hidden>
          {n}
        </span>
        {title}
        {hint && <small>{hint}</small>}
      </h2>
      {children}
    </section>
  );
}

/** Το πεδίο FIDE / OTB: γράφεις όνομα ή FIDE ID και διαλέγεις τον παίκτη από τη λίστα. */
function OtbField({
  text,
  who,
  startDay,
  onText,
  onWho,
  onGames,
}: {
  text: string;
  who: PrepOtb | null;
  startDay: number;
  onText: (text: string) => void;
  onWho: (who: PrepOtb | null) => void;
  /** πόσες παρτίδες έχει ο επιλεγμένος στις βάσεις (null: μετρώνται ακόμη) */
  onGames: (games: number | null) => void;
}) {
  const id = useId();
  const [list, setList] = useState<OtbSuggestion[] | null>(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [err, setErr] = useState('');
  const [match, setMatch] = useState<OtbMatch | null>(null);

  const q = text.trim();
  const byId = /^\d+$/.test(q);
  const searchable = !who && q.length >= (byId ? 4 : 3);

  // προτάσεις όσο γράφεις (το ID περιμένει λίγο παραπάνω, να γραφτεί ολόκληρο)
  useEffect(() => {
    setList(null);
    setErr('');
    setHi(0);
    if (!searchable) return;
    let live = true;
    const t = setTimeout(
      () => {
        api
          .get<OtbSuggestion[]>(`/api/prep/players?q=${encodeURIComponent(q)}`)
          .then((r) => live && setList(r))
          .catch((e: Error) => {
            if (!live) return;
            setErr(
              byId
                ? `${errText(e.message.includes('rate') ? 'rate' : 'net', 'lichess')} ${L('Γράψε το όνομα αντί για το ID.', 'Type the name instead of the ID.')}`
                : errText('failed', 'otb'),
            );
          });
      },
      byId ? 600 : 300,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, byId, searchable]);

  // ο επιλεγμένος: παρτίδες σε όλες τις βάσεις
  useEffect(() => {
    setMatch(null);
    onGames(null);
    if (!who) return;
    let live = true;
    api
      .post<OtbMatch>('/api/prep/player', who)
      .then((r) => {
        if (!live) return;
        setMatch(r);
        onGames(r.games);
      })
      .catch(() => live && setErr(errText('failed', 'otb')));
    return () => {
      live = false;
    };
  }, [who, onGames]);

  const pick = (s: OtbSuggestion) => {
    onText(s.name);
    onWho({ name: s.name, ...(s.fideId ? { fideId: s.fideId } : {}) });
    setOpen(false);
  };
  const extra = who?.extra ?? [];
  const toggleExtra = (name: string) => who && onWho({ ...who, extra: extra.includes(name) ? extra.filter((x) => x !== name) : [...extra, name] });

  const menu = open && searchable && list !== null && list.length > 0;
  const outside = match !== null && match.games > 0 && !inPeriod(match.last, startDay);

  let status: ReactNode = null;
  if (err) status = <p className="prep-note is-bad" role="alert">{err}</p>;
  else if (who && !match) status = <p className="prep-note">{L('Μετρώ τις παρτίδες στις βάσεις σου…', 'Counting the games in your databases…')}</p>;
  else if (who && match && !match.games) status = <p className="prep-note is-bad">{L('Δεν έχεις παρτίδες του στις βάσεις σου. Συμπλήρωσε Lichess ή Chess.com.', 'Your databases have no games of this player. Fill in Lichess or Chess.com.')}</p>;
  else if (who && match)
    status = (
      <p className={`prep-note ${outside ? 'is-bad' : 'is-ok'}`} title={[...match.dbs, '', ...match.names].join('\n')}>
        {fmtNum(match.games)} {L('παρτίδες', 'games')} · {match.dbs.length} {match.dbs.length === 1 ? L('βάση', 'database') : L('βάσεις', 'databases')}
        {match.last ? ` · ${L('τελευταία', 'last')} ${fmtDate(match.last)}` : ''}
        {match.fideId ? ` · FIDE ${match.fideId}` : ''}
        {outside ? ` — ${L('καμία μέσα στην περίοδο που διάλεξες', 'none within the period you chose')}` : ''}
      </p>
    );
  else if (searchable && !list) status = <p className="prep-note">{L('Αναζήτηση…', 'Searching…')}</p>;
  else if (searchable && list && !list.length)
    status = (
      <p className="prep-note is-bad">
        {byId ? L('Δεν υπάρχει παίκτης με αυτό το FIDE ID.', 'No player has this FIDE ID.') : L('Κανένας με αυτό το όνομα στις βάσεις σου. Γράψε πρώτα το επώνυμο, με λατινικά.', 'Nobody with this name in your databases. Try the surname first.')}
      </p>
    );
  else if (searchable && !menu) status = <p className="prep-note is-bad">{L('Διάλεξε τον παίκτη από τη λίστα.', 'Pick the player from the list.')}</p>;

  return (
    <Row
      id={id}
      label="FIDE / OTB"
      hint={L('όνομα ή FIDE ID', 'name or FIDE ID')}
      note={
        <>
          {status}
          {who && match && match.namesakes.length > 0 && (
            <div className="prep-maybe">
              <span>{L('Συνονόματοι, ποιος είναι;', 'Namesakes, which one?')}</span>
              {match.namesakes.map((x) => (
                <button key={x.id} type="button" className="kb-chip" onClick={() => onWho({ ...who, fideId: x.id })}>
                  FIDE {x.id} <span>{fmtNum(x.games)}</span>
                </button>
              ))}
            </div>
          )}
          {who && match && (extra.length > 0 || match.maybe.length > 0) && (
            <div className="prep-maybe">
              <span>{L('Ίσως και:', 'Maybe also:')}</span>
              {extra.map((name) => (
                <button key={name} type="button" className="kb-chip" aria-pressed="true" onClick={() => toggleExtra(name)}>
                  {name}
                </button>
              ))}
              {match.maybe.map((m) => (
                <button key={m.name} type="button" className="kb-chip" aria-pressed="false" onClick={() => toggleExtra(m.name)}>
                  {m.name} <span>{fmtNum(m.games)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      }
    >
      <div className="prep-combo">
        <input
          id={id}
          className="kb-input"
          value={text}
          role="combobox"
          aria-expanded={menu}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder={L('π.χ. Carlsen ή 1503014', 'e.g. Carlsen or 1503014')}
          onChange={(e) => {
            onText(e.target.value);
            if (who) onWho(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'ArrowDown' && list?.length) {
              e.preventDefault();
              setOpen(true);
              setHi((h) => Math.min(list.length - 1, h + 1));
            } else if (e.key === 'ArrowUp' && list?.length) {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter' && !who && q) {
              // με μισό όνομα το Enter διαλέγει, δεν στέλνει τη φόρμα
              e.preventDefault();
              if (menu) pick(list[hi]);
              else setOpen(true);
            }
          }}
        />
        {menu && (
          <div className="prep-menu" id={`${id}-list`} role="listbox">
            {list.map((s, i) => (
              <div
                key={`${s.name}:${s.fideId ?? ''}`}
                className={`prep-option${i === hi ? ' is-hi' : ''}`}
                role="option"
                aria-selected={i === hi}
                ref={i === hi ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                // πριν από το blur του πεδίου
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
              >
                <b>
                  {s.fide?.title ? <span className="prep-title-badge">{s.fide.title} </span> : null}
                  {s.name}
                </b>
                <span>
                  {[
                    s.fide ? s.fide.federation : `${fmtNum(s.games)} ${L('παρτ.', 'g.')}`,
                    s.maxElo ? `Elo ${s.maxElo}` : '',
                    s.fide?.year ?? years(s),
                    s.fideId ? `FIDE ${s.fideId}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Row>
  );
}

function SiteField({ label, value, onChange, warn }: { label: string; value: string; onChange: (v: string) => void; warn?: string }) {
  const id = useId();
  const invalid = value.trim().length > 1 && !cleanSiteUser(value);
  const note = invalid ? L('Γράψε μόνο το username ή το link του προφίλ.', 'Type just the username or the profile link.') : warn;
  return (
    <Row id={id} label={label} hint="username" note={note && <p className="prep-note is-bad">{note}</p>}>
      <input className="kb-input" id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={L('username ή link προφίλ', 'username or profile link')} autoComplete="off" spellCheck={false} />
    </Row>
  );
}

export function PrepForm({ start, canClose, onClose, onStarted }: { start: FormStart; canClose: boolean; onClose: () => void; onStarted: (p: PrepInfo) => void }) {
  const friends = useSocial((s) => s.friends).filter((f) => f.state === 'friend' && (f.acc?.lichess || f.acc?.chesscom));
  const { prev } = start;
  const init: PrepOpts = prev?.opts ?? PREP_DEFAULTS;

  const [who, setWho] = useState<PrepOtb | null>(() => prev?.otb ?? (prev?.locals?.length ? { name: prev.name } : start.name ? { name: start.name } : null));
  const [text, setText] = useState(who?.name ?? '');
  const [games, setGames] = useState<number | null>(null);
  const [lichess, setLichess] = useState(prev?.lichess ?? '');
  const [chesscom, setChesscom] = useState(prev?.chesscom ?? '');
  const [period, setPeriod] = useState(init.after ? 'after' : String(init.months));
  const [after, setAfter] = useState(init.after ?? '');
  const [max, setMax] = useState(init.max);
  const [color, setColor] = useState<PrepColor>(init.color);
  const [speeds, setSpeeds] = useState<PrepSpeed[]>(() => init.speeds.filter((s) => s !== 'daily'));
  const [rated, setRated] = useState(init.rated);
  const [busy, setBusy] = useState(false);
  const periodId = useId();
  const maxId = useId();

  const custom = period === 'after';
  const months = custom ? 0 : Number(period);
  const startDay = custom && !after ? 0 : periodStart({ months, after: custom ? after : undefined }).day;

  const online = Boolean(cleanSiteUser(lichess) || cleanSiteUser(chesscom));
  const badUser = [lichess, chesscom].some((v) => v.trim() && !cleanSiteUser(v));
  // μισογραμμένο όνομα δεν αγνοείται σιωπηλά
  const halfName = !who && text.trim().length > 0;
  const hasSource = online || (who !== null && games !== 0);
  const problem = !hasSource
    ? L('Συμπλήρωσε τουλάχιστον ένα πεδίο παίκτη.', 'Fill in at least one player field.')
    : halfName
      ? L('Διάλεξε παίκτη στο FIDE / OTB ή άδειασε το πεδίο.', 'Pick a player in FIDE / OTB or clear the field.')
      : badUser
        ? L('Διόρθωσε το username.', 'Fix the username.')
        : custom && !after
          ? L('Βάλε ημερομηνία στην περίοδο.', 'Set a date for the period.')
          : !speeds.length
            ? L('Διάλεξε τουλάχιστον έναν ρυθμό.', 'Pick at least one time control.')
            : '';

  const submit = async () => {
    setBusy(true);
    try {
      const opts: PrepOpts = { speeds, months, ...(custom ? { after } : {}), max, rated, color };
      const r = await api.post<{ prep: PrepInfo }>('/api/prep/start', {
        otb: who ?? undefined,
        lichess: lichess.trim() || undefined,
        chesscom: chesscom.trim() || undefined,
        opts,
        replace: prev?.id,
      });
      onStarted(r.prep);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const toggleSpeed = (s: PrepSpeed) => setSpeeds((x) => PREP_PICK_SPEEDS.filter((y) => (y === s ? !x.includes(y) : x.includes(y))));
  const noClassical = chesscom.trim() && speeds.length === 1 && speeds[0] === 'classical';

  return (
    <form
      className="kb-card prep-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem && !busy) void submit();
      }}
    >
      <div className="kb-card-head">
        <span className="kb-card-av" aria-hidden>
          <Target size={22} />
        </span>
        <div>
          <b>{prev ? L('Άλλαξε φίλτρα', 'Change filters') : L('Νέος αντίπαλος', 'New opponent')}</b>
          <span>{L('Αρκεί ένα πεδίο· τα φίλτρα ισχύουν για όποιο διαλέξεις', 'One field is enough; the filters apply to whichever you use')}</span>
        </div>
        <div className="prep-head-tools">
          {friends.length > 0 && (
            <select
              className="kb-input prep-friend"
              value=""
              aria-label={L('Από τους φίλους σου', 'From your friends')}
              onChange={(e) => {
                const f = friends.find((x) => x.id === e.target.value);
                if (!f) return;
                setWho(null);
                setText('');
                setLichess(f.acc?.lichess ?? '');
                setChesscom(f.acc?.chesscom ?? '');
              }}
            >
              <option value="">{L('Από φίλο…', 'From a friend…')}</option>
              {friends.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          {canClose && (
            <button type="button" className="kb-btn ghost icon" onClick={onClose} aria-label={L('Κλείσιμο', 'Close')}>
              <X aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="kb-card-body prep-body">
        <Section n={1} title={L('Παίκτης', 'Player profiles')}>
          <OtbField text={text} who={who} startDay={startDay} onText={setText} onWho={setWho} onGames={setGames} />
          <SiteField label="Lichess" value={lichess} onChange={setLichess} />
          <SiteField
            label="Chess.com"
            value={chesscom}
            onChange={setChesscom}
            warn={noClassical ? L('Το Chess.com δεν έχει κλασικό: άνοιξε και το Rapid.', 'Chess.com has no classical: turn on Rapid too.') : undefined}
          />
        </Section>

        <Section n={2} title={L('Τι να ψάξω', 'Preparation scope')}>
          <Row id={periodId} label={L('Περίοδος', 'Period')}>
            <div className="prep-period">
              <select id={periodId} className="kb-input" value={period} onChange={(e) => setPeriod(e.target.value)}>
                {[...new Set([...PERIODS, ...(custom ? [] : [months])])].map((m) => (
                  <option key={m} value={m}>
                    {m ? L(`Τελευταίοι ${m} μήνες`, `Last ${m} months`) : L('Όλες', 'All time')}
                  </option>
                ))}
                <option value="after">{L('Μετά από…', 'Custom date after…')}</option>
              </select>
              {custom && <input className="kb-input" type="date" value={after} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setAfter(e.target.value)} aria-label={L('Μετά από', 'After')} />}
            </div>
          </Row>
          <Row id={maxId} label={L('Παρτίδες', 'Games')} hint={L('συνολικά', 'in total')}>
            <select id={maxId} className="kb-input" value={max} onChange={(e) => setMax(Number(e.target.value))}>
              {[...new Set([...LIMITS, init.max])].map((n) => (
                <option key={n} value={n}>
                  {n ? L(`Οι ${fmtNum(n)} πιο πρόσφατες`, `The ${fmtNum(n)} most recent`) : L('Όλες όσες υπάρχουν', 'All available')}
                </option>
              ))}
            </select>
          </Row>
          <Row label={L('Ο αντίπαλος παίζει', 'Opponent plays')}>
            <div className="prep-seg" role="group" aria-label={L('Ο αντίπαλος παίζει', 'Opponent plays')}>
              {COLORS.map((c) => (
                <button key={c} type="button" aria-pressed={color === c} onClick={() => setColor(c)}>
                  {c !== 'both' && <span className={`side ${c === 'white' ? 'w' : 'b'}`} aria-hidden />}
                  {colorName(c)}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        <Section n={3} title={L('Ρυθμοί', 'Time controls')}>
          <div className="prep-speeds">
            {PREP_PICK_SPEEDS.map((s) => (
              <button key={s} type="button" className="kb-chip" aria-pressed={speeds.includes(s)} onClick={() => toggleSpeed(s)}>
                {speedName(s)}
              </button>
            ))}
            <label className="prep-check">
              <input type="checkbox" checked={rated} onChange={(e) => setRated(e.target.checked)} />
              {L('Μόνο rated παρτίδες', 'Rated games only')}
            </label>
          </div>
        </Section>
      </div>

      <div className="kb-card-foot prep-foot">
        <button type="submit" className="kb-btn primary lg" disabled={Boolean(problem) || busy}>
          <Download aria-hidden /> {L('Κατέβασε και φτιάξε ρεπερτόριο', 'Download & build repertoire')}
        </button>
        {problem && (text || lichess || chesscom) ? <p className="prep-note">{problem}</p> : null}
      </div>
    </form>
  );
}
