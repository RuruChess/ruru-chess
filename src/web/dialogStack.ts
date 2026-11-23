/** Στοίβα ανοιχτών διαλόγων: το Esc κλείνει μόνο τον πάνω-πάνω ορατό διάλογο. */

// Π.χ. η «Θέση» μέσα στην «Αναζήτηση» κλείνει μόνη της. Διάλογοι σε κρυφές καρτέλες παρακάμπτονται.

export interface DialogEntry {
  /** κλείσιμο (το τρέχον onClose του διαλόγου) */
  close: () => void;
  /** ο διάλογος φαίνεται (όχι σε κρυφή καρτέλα) */
  visible: () => boolean;
}

export class DialogStack {
  private entries: Array<{ id: number; entry: DialogEntry }> = [];
  private seq = 0;

  /** Νέος διάλογος στην κορυφή· επιστρέφει το κλειδί του. */
  push(entry: DialogEntry): number {
    const id = ++this.seq;
    this.entries.push({ id, entry });
    return id;
  }

  remove(id: number): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  get size(): number {
    return this.entries.length;
  }

  /** Ο πάνω-πάνω ορατός διάλογος. */
  topId(): number | null {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].entry.visible()) return this.entries[i].id;
    return null;
  }

  /** Esc: κλείνει τον πάνω-πάνω ορατό διάλογο· `false` αν δεν υπάρχει κανένας. */
  escape(): boolean {
    const id = this.topId();
    if (id === null) return false;
    this.entries.find((e) => e.id === id)?.entry.close();
    return true;
  }
}
