/** Στοίβα διαλόγων και αναδυόμενων της Τακτικής: Esc κλείνει μόνο τον πάνω, η εστίαση μένει μέσα του (Tab). */
import { useEffect, useRef } from 'react';
import { DialogStack } from '../../dialogStack.ts';

/** Όλοι οι ανοιχτοί διάλογοι του παραθύρου· ένας listener για το Esc (μόνο ο πάνω-πάνω κλείνει). */
export const dialogs = new DialogStack();
let escBound = false;
function bindEscape(): void {
  if (escBound) return;
  escBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (dialogs.escape()) e.preventDefault();
  });
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab και Shift+Tab κυκλικά μέσα στο στοιχείο (παγίδα εστίασης των διαλόγων). */
export function trapTab(e: React.KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return;
  const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  if (!list.length) {
    e.preventDefault();
    return;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Καταχωρεί έναν διάλογο ή επικάλυμμα στη στοίβα του Esc. */
export function useDialogStack(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    bindEscape();
    const id = dialogs.push({
      close: () => closeRef.current(),
      visible: () => {
        const el = ref.current;
        return Boolean(el && el.isConnected && el.getClientRects().length > 0);
      },
    });
    return () => dialogs.remove(id);
  }, [ref]);
}
