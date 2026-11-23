/** Κοινά κομμάτια του εκπαιδευτή τακτικής: ρυθμίσεις σκακιέρας, πλήκτρα της οθόνης, σήματα θεμάτων και αποτελέσματος. */
import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX } from 'lucide-react';
import { L, fmtNum, language } from '../i18n.ts';
import { useApp } from '../store.ts';
import { soundConfig } from '../sounds.ts';
import { dialogs } from '../components/ui/Dialog.tsx';
import type { Command } from '../commands.ts';
import type { ThemeName } from './api.ts';
import { parseTypedMove } from './logic.ts';

/** Οι ρυθμίσεις της σκακιέρας για τα puzzles (θέμα, κομμάτια, κίνηση, ήχοι). */
export function useBoardSettings() {
  const settings = useApp((s) => s.settings);
  const ui = (settings?.ui ?? {}) as Record<string, unknown>;
  const reduced = ui.reducedMotion === true || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  return {
    theme: settings?.boardTheme,
    pieceSet: settings?.pieceSet,
    coordinates: settings?.showCoordinates ?? true,
    animationMs: reduced ? 0 : Math.min(settings?.animationMs ?? 200, 260),
    oneClick: ui.oneClick !== false,
    sounds: soundConfig(ui).on,
    // → σε διακλάδωση: λίστα με τις υποψήφιες κινήσεις (Ρυθμίσεις, όπως στο παράθυρο της παρτίδας)
    variationDialog: ui.variationDialog !== false,
  };
}

/** Στοιχείο όπου η πληκτρολόγηση είναι κείμενο ή που έχει δικά του πλήκτρα. */
export function ownsKey(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  // κουμπιά και σύνδεσμοι: Enter / Space ανήκουν σε αυτά
  if ((e.key === 'Enter' || e.key === ' ') && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.getAttribute('role') === 'checkbox' || t.getAttribute('role') === 'switch')) return true;
  return false;
}

/**
 * Πλήκτρα μιας οθόνης της τακτικής όσο είναι ενεργή: όχι όταν είναι ανοιχτός διάλογος, παλέτα,
 * μενού ή ξενάγηση, ούτε μέσα σε πεδία κειμένου.
 */
export function useScreenKeys(active: boolean, handler: (e: KeyboardEvent) => boolean | void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const fn = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (dialogs.topId() !== null || document.querySelector('.modal-backdrop, .context-menu')) return;
      if (ownsKey(e)) return;
      if (ref.current(e) === true) e.preventDefault();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [active]);
}

/** Οι εντολές μιας υπο-οθόνης (μπαίνουν στην παλέτα μαζί με αυτές της καρτέλας). */
export type CommandsRef = { current: () => Command[] };

/** Όνομα θέματος στη γλώσσα του χρήστη. */
export const themeLabel = (t: ThemeName): string => (language() === 'el' ? t.el : t.en);

export function ThemeChips({ themes, max = 8 }: { themes: ThemeName[]; max?: number }) {
  if (!themes.length) return null;
  return (
    <div className="tx-chips" aria-label={L('Θέματα', 'Themes')}>
      {themes.slice(0, max).map((t) => (
        <span key={t.key} className="tag">
          {themeLabel(t)}
        </span>
      ))}
    </div>
  );
}

/** Σωστό / λάθος: πάντα με σύμβολο και λέξη, όχι μόνο με χρώμα. */
export function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <div className={`tx-verdict ${ok ? 'is-ok' : 'is-bad'}`} role="status">
      <Icon className="ic" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/**
 * Κίνηση με το πληκτρολόγιο (SAN, UCI, ελληνικά γράμματα κομματιών) και Enter. Μια κίνηση που
 * γράφτηκε όσο απαντούσε ο αντίπαλος παίζεται μόλις έρθει η σειρά του χρήστη.
 */
export const MoveInput = forwardRef<HTMLInputElement, { fen: string; ready: boolean; disabled?: boolean; onMove: (uci: string) => void; resetKey: string }>(function MoveInput({ fen, ready, disabled, onMove, resetKey }, ref) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const pending = useRef<string | null>(null);
  const id = useId();
  useEffect(() => {
    setText('');
    setBad(false);
    pending.current = null;
  }, [resetKey]);
  const play = (t: string) => {
    const uci = parseTypedMove(fen, t);
    if (!uci) {
      setText(t);
      setBad(true);
      return;
    }
    setBad(false);
    onMove(uci);
  };
  useEffect(() => {
    const t = pending.current;
    if (!t || !ready) return;
    pending.current = null;
    play(t);
  }, [ready, fen]);
  return (
    <form
      className="tx-type"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        setText('');
        if (!ready) pending.current = t;
        else play(t);
      }}
    >
      <label className="sr-only" htmlFor={id}>
        {L('Πληκτρολόγηση κίνησης', 'Type a move')}
      </label>
      <input
        id={id}
        ref={ref}
        className="input input-sm"
        value={text}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        placeholder={L('Γράψε κίνηση (π.χ. Bxh7+ ή e2e4) και Enter', 'Type a move (e.g. Bxh7+ or e2e4) and Enter')}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${id}-err` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setText('');
            setBad(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {bad && (
        <span id={`${id}-err`} className="tx-type-err" role="alert">
          {L('Δεν είναι νόμιμη κίνηση εδώ', 'Not a legal move here')}
        </span>
      )}
    </form>
  );
});

/** «1.784» (με διαχωριστικό χιλιάδων της γλώσσας). */
export const fmtRating = (r: number): string => fmtNum(Math.round(r));

/** «+12» / «−8» με σωστό σύμβολο μείον. */
export const signed = (n: number): string => (n > 0 ? `+${fmtNum(n)}` : n < 0 ? `−${fmtNum(-n)}` : '±0');

/** Αξιολόγηση της μηχανής από τη σκοπιά του λύτη: «+3,4» / «ματ σε 2». */
export function evalText(cp: number | null | undefined, mate: number | null | undefined): string {
  if (mate !== null && mate !== undefined) return mate > 0 ? L(`ματ σε ${mate} για σένα`, `mate in ${mate} for you`) : L(`ματ σε ${-mate} για τον αντίπαλο`, `mate in ${-mate} for the opponent`);
  if (cp === null || cp === undefined) return '';
  const v = (cp / 100).toLocaleString(language() === 'el' ? 'el-GR' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return cp > 0 ? `+${v}` : cp < 0 ? `−${v.replace('-', '')}` : '0,0';
}
