/**
 * Γρήγορη αναζήτηση στη γραμμή εργαλείων των Βάσεων (δίπλα στη μικρή σκακιέρα): γράφεις παίκτη (με προτάσεις από
 * τη βάση) ή επικολλάς FEN, ή στήνεις θέση, και ανοίγει η βάση με τα αποτελέσματα. Η ίδια αναζήτηση υπήρχε μέσα σε
 * κάθε βάση («Αναζήτηση / φίλτρο», «Παίκτες»)· εδώ είναι ένα βήμα από την αρχική.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, LayoutGrid, SlidersHorizontal, Target, X } from 'lucide-react';
import { Position, START_FEN } from '../../core/chess.ts';
import { api, type SearchCriteria } from '../api.ts';
import { L, fmtNum } from '../i18n.ts';
import { useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';
import { SetupDialog } from './GameDialogs.tsx';
import { requestPrep } from '../prep/request.ts';

interface PlayerRow {
  id: number;
  name: string;
  games: number;
  maxElo: number;
  first: number;
  last: number;
}

/** Έγκυρο FEN (όχι απλώς λέξεις με «/»). */
function asFen(text: string): string | null {
  const t = text.trim();
  if (!/^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}(\s|$)/.test(t)) return null;
  // μόνο η τοποθέτηση: λευκά παίζουν, χωρίς ροκέ
  const full = t.split(/\s+/).length >= 2 ? t : `${t} w - - 0 1`;
  try {
    return Position.fromFen(full).fen();
  } catch {
    return null;
  }
}

export interface DbSearch {
  filter?: SearchCriteria;
  fen?: string | null;
  openSearch?: boolean;
}

/** Ανοίγει τη βάση με φίλτρο / θέση (και σε καρτέλα που είναι ήδη ανοιχτή, όταν οι βάσεις ανοίγουν σε καρτέλες). */
export function openDbWith(dbId: string, title: string, s: DbSearch): void {
  useApp.getState().openTab({ id: `db-${dbId}`, kind: 'db', dbId, title, ...(s.filter ? { filter: s.filter } : {}), ...(s.fen ? { fen: s.fen } : {}), ...(s.openSearch ? { openSearch: true } : {}) });
  const detail = { dbId, filter: s.filter ?? {}, fen: s.fen ?? null, openSearch: s.openSearch };
  setTimeout(() => window.dispatchEvent(new CustomEvent('knightbase:position-search', { detail })), 50);
}

export function QuickSearch() {
  const library = useApp((s) => s.library);
  const ui = (useApp((s) => s.settings?.ui) ?? {}) as Record<string, unknown>;
  const activate = useApp((s) => s.activate);

  // η βάση: όποια διάλεξε ο χρήστης τελευταία, αλλιώς η βάση αναφοράς, αλλιώς η μεγαλύτερη
  const dbs = useMemo(() => library.filter((d) => d.games > 0 && d.busy?.kind !== 'import').sort((a, b) => a.name.localeCompare(b.name)), [library]);
  const saved = ui.quickSearchDb as string | undefined;
  const ref = ui.referenceDb as string | undefined;
  const fallback = [...dbs].sort((a, b) => b.games - a.games)[0]?.id ?? '';
  const dbId = [saved, ref].find((id) => id && dbs.some((d) => d.id === id)) ?? fallback;
  const db = dbs.find((d) => d.id === dbId);
  // βάση που εισάγεται ακόμη (π.χ. η βάση αναφοράς μετά τη λήψη): δεν ψάχνεται μέχρι να τελειώσει
  const importing = library.find((d) => d.busy?.kind === 'import' && d.busy.status === 'running');
  const pct = importing?.busy?.progress.totalBytes ? Math.min(99, Math.floor((importing.busy.progress.bytes / importing.busy.progress.totalBytes) * 100)) : null;
  const importNote = importing
    ? L(
        `Η «${importing.name}» εισάγεται ακόμη${pct !== null ? ` (${pct}%)` : ''}· η αναζήτηση σε αυτήν θα δουλέψει μόλις τελειώσει.`,
        `“${importing.name}” is still importing${pct !== null ? ` (${pct}%)` : ''}; searching it will work once it finishes.`,
      )
    : '';

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [err, setErr] = useState('');
  const [hi, setHi] = useState(0);
  const [setup, setSetup] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const fen = asFen(q);
  const text = q.trim();

  // προτάσεις παικτών (από το επώνυμο, όπως στην καρτέλα «Παίκτες» της βάσης)
  useEffect(() => {
    if (!dbId || fen || text.length < 2) {
      setRows([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api
        .get<PlayerRow[]>(`/api/db/${dbId}/players?prefix=${encodeURIComponent(text)}&limit=8`)
        .then((r) => {
          if (!live) return;
          setRows(r);
          setErr('');
        })
        .catch((e) => {
          if (!live) return;
          setRows([]);
          setErr((e as Error).message || L('σφάλμα', 'error'));
        });
    }, 160);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [dbId, text, fen]);
  useEffect(() => setHi(0), [rows]);

  // κλείσιμο της λίστας με κλικ αλλού
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, [open]);

  const show = (s: DbSearch) => {
    if (!db) return;
    setOpen(false);
    openDbWith(db.id, db.name, s);
  };

  const run = () => {
    if (fen) return show({ fen });
    if (!text) return show({ openSearch: true });
    const r = rows[hi];
    show({ filter: { player: r && open ? r.name : text } });
  };

  const prepare = (name: string) => {
    setOpen(false);
    requestPrep({ name });
    activate('prep');
  };

  const years = (r: PlayerRow) => (r.first ? `${Math.floor(r.first / 10000)}–${Math.floor(r.last / 10000)}` : '');
  const showList = open && Boolean(text) && Boolean(db);

  // μαζεμένο σαν κουμπί· ανοίγει (και δείχνει τη βάση) όταν γράφεις ή κάνεις κλικ
  const wide = open || Boolean(q);
  return (
    <div className={`quick-search${wide ? ' on' : ''}`} ref={box} data-guide="quick-search">
      <div className="qs-field" title={wide ? undefined : db ? L(`Αναζήτηση παρτίδων (παίκτης ή FEN) στη «${db.name}»`, `Search games (player or FEN) in “${db.name}”`) : undefined}>
        <Search size={16} className="qs-ic" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              run();
            } else if (e.key === 'Escape') {
              if (open) setOpen(false);
              else setQ('');
            } else if (e.key === 'ArrowDown' && rows.length) {
              e.preventDefault();
              setOpen(true);
              setHi((h) => Math.min(rows.length - 1, h + 1));
            } else if (e.key === 'ArrowUp' && rows.length) {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            }
          }}
          placeholder={wide ? L('Παίκτης ή FEN…', 'Player or FEN…') : L('Αναζήτηση παρτίδων', 'Search games')}
          aria-label={L('Αναζήτηση παρτίδων (παίκτης ή θέση)', 'Search games (player or position)')}
          spellCheck={false}
        />
        {q && (
          <button className="qs-clear" onClick={() => setQ('')} title={L('Καθαρισμός', 'Clear')} aria-label={L('Καθαρισμός', 'Clear')}>
            <X size={14} />
          </button>
        )}
        {wide && dbs.length > 0 && (
        <select
          className="qs-db"
          value={dbId}
          onChange={(e) => setUiLater({ quickSearchDb: e.target.value })}
          title={L('Σε ποια βάση ψάχνεις', 'Database to search')}
          aria-label={L('Βάση', 'Database')}
        >
          {dbs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.id === ref ? L(' (αναφορά)', ' (reference)') : ''} · {fmtNum(d.games)}
            </option>
          ))}
        </select>
        )}
        <button className="qs-seg" disabled={!db} onClick={() => setSetup(true)} title={L('Αναζήτηση θέσης: στήσε τη θέση στη σκακιέρα', 'Position search: set up the position on a board')} aria-label={L('Αναζήτηση θέσης', 'Position search')}>
          <LayoutGrid size={15} />
        </button>
        <button className="qs-seg" disabled={!db} onClick={() => show({ openSearch: true })} title={L('Όλα τα κριτήρια: Elo, έτη, ECO, αποτέλεσμα, υλικό, ελιγμοί…', 'All criteria: Elo, years, ECO, result, material, maneuvers…')} aria-label={L('Περισσότερα κριτήρια', 'More criteria')}>
          <SlidersHorizontal size={15} />
        </button>
      </div>
      {open && !dbs.length && (
        <div className="qs-menu">
          <div className="qs-note">{importNote || L('Δεν υπάρχει ακόμη βάση με παρτίδες: άνοιξε ένα αρχείο PGN / ChessBase ή κατέβασε μια «Βάση αναφοράς».', 'No database with games yet: open a PGN / ChessBase file or download a “Reference database”.')}</div>
        </div>
      )}

      {showList && (
        <div className="qs-menu" role="listbox">
          {fen ? (
            <button className="qs-row" onClick={() => show({ fen })}>
              <LayoutGrid size={15} />
              <span className="qs-main">{L('Παρτίδες με αυτή τη θέση', 'Games with this position')}</span>
              <span className="qs-aux">{db?.name}</span>
            </button>
          ) : (
            <>
              {rows.map((r, i) => (
                <div key={r.id} className={`qs-row${i === hi ? ' hi' : ''}`} role="option" aria-selected={i === hi} onMouseEnter={() => setHi(i)} onClick={() => show({ filter: { player: r.name } })}>
                  <span className="qs-main">{r.name}</span>
                  <span className="qs-aux">
                    {fmtNum(r.games)} {L('παρτ.', 'g.')}
                    {r.maxElo ? ` · ${r.maxElo}` : ''}
                    {years(r) ? ` · ${years(r)}` : ''}
                  </span>
                  <span className="qs-acts">
                    <button className="qs-mini" title={L('Παρτίδες με τα λευκά', 'Games with White')} onClick={(e) => (e.stopPropagation(), show({ filter: { white: r.name } }))}>
                      {L('Λευκά', 'White')}
                    </button>
                    <button className="qs-mini" title={L('Παρτίδες με τα μαύρα', 'Games with Black')} onClick={(e) => (e.stopPropagation(), show({ filter: { black: r.name } }))}>
                      {L('Μαύρα', 'Black')}
                    </button>
                    <button className="qs-mini" title={L('Προετοιμασία για αυτόν τον αντίπαλο (ρεπερτόριο, αδύνατα σημεία, και παρτίδες από Lichess / Chess.com)', 'Prepare for this opponent (repertoire, weak spots, plus games from Lichess / Chess.com)')} onClick={(e) => (e.stopPropagation(), prepare(r.name))}>
                      <Target size={13} /> {L('Προετοιμασία', 'Prepare')}
                    </button>
                  </span>
                </div>
              ))}
              <button className="qs-row qs-all" onClick={() => show({ filter: { player: text } })}>
                <Search size={15} />
                <span className="qs-main">
                  {L('Όλες οι παρτίδες του', 'All games of')} «{text}»
                </span>
                <span className="qs-aux">{db?.name} · Enter</span>
              </button>
              {err && <div className="qs-note error-text">{L(`Η βάση δεν απάντησε: ${err}`, `The database did not answer: ${err}`)}</div>}
              {importNote && <div className="qs-note">{importNote}</div>}
              {!err && !rows.length && text.length >= 2 && <div className="qs-note">{L('Κανένας παίκτης με αυτό το επώνυμο στη βάση· δοκίμασε «Επώνυμο, Όνομα» ή άλλη βάση.', 'No player with this surname in the database; try “Surname, Name” or another database.')}</div>}
            </>
          )}
        </div>
      )}

      {setup && (
        <SetupDialog
          initialFen={fen ?? START_FEN}
          onClose={() => setSetup(false)}
          onDone={(x) => {
            setSetup(false);
            show({ fen: x });
          }}
        />
      )}
    </div>
  );
}
