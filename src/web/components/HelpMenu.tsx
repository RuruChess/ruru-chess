/**
 * Μενού «?» στην πάνω μπάρα: συντομεύσεις πληκτρολογίου & ποντικιού, επανεκκίνηση Οδηγού και
 * άνοιγμα Ρυθμίσεων / Σχετικά. Χωρίς επιπλέον μπάρα ή οπτικό θόρυβο.
 */
import { useState, type MouseEvent } from 'react';
import { CircleHelp } from 'lucide-react';
import { L } from '../i18n.ts';
import { ContextMenu, WinDialog, type MenuItem } from './ui.tsx';

interface HelpButtonProps {
  /** εμφάνιση της επιλογής «Δείξε ξανά τον Οδηγό» (μόνο στο κύριο παράθυρο) */
  canRestartGuide: boolean;
  onRestartGuide: () => void;
  onOpenReleaseNotes: () => void;
  onOpenSettings: () => void;
}

export function HelpButton({ canRestartGuide, onRestartGuide, onOpenReleaseNotes, onOpenSettings }: HelpButtonProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [shortcuts, setShortcuts] = useState(false);

  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: Math.max(8, r.right - 250), y: r.bottom + 4 });
  };

  const items: MenuItem[] = [
    { label: L('Τι νέο υπάρχει (Release Notes)', 'What’s new (Release Notes)'), onClick: onOpenReleaseNotes },
    { label: L('Συντομεύσεις πληκτρολογίου & ποντικιού', 'Keyboard & mouse shortcuts'), onClick: () => setShortcuts(true) },
    ...(canRestartGuide ? [{ label: L('Ξεκίνα ξανά τον Οδηγό', 'Restart the Guide'), onClick: onRestartGuide }] : []),
    { separator: true, label: '' },
    { label: L('Ρυθμίσεις, Σχετικά & επικοινωνία', 'Settings, About & contact'), onClick: onOpenSettings },
  ];

  const groups: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
      title: L('Σκακιέρα & πλοήγηση', 'Board & navigation'),
      rows: [
        ['← / →', L('Προηγούμενη / επόμενη κίνηση (σε διακλάδωση: επιλογή βαριάντας)', 'Previous / next move (at a branch: choose variation)')],
        ['↑ / ↓', L('Αρχή / τέλος παρτίδας', 'Start / end of game')],
        ['F', L('Γύρισμα σκακιέρας', 'Flip board')],
        ['Ctrl + Z / Y', L('Αναίρεση / επανάληψη', 'Undo / redo')],
      ],
    },
    {
      title: L('Σχεδίαση & σχολιασμός', 'Drawing & annotation'),
      rows: [
        [L('Δεξί κλικ + σύρσιμο', 'Right-click + drag'), L('Πράσινο βέλος ή τετράγωνο', 'Green arrow or square')],
        [L('Shift / Alt / Ctrl + δεξί', 'Shift / Alt / Ctrl + right'), L('Κόκκινο, κίτρινο ή μπλε χρώμα', 'Red, yellow or blue colour')],
        [L('Δεξί κλικ σε κίνηση', 'Right-click a move'), L('Σχόλιο, προαγωγή ή διαγραφή βαριάντας', 'Comment, promote or delete variation')],
      ],
    },
    {
      title: L('Αρχεία & παράθυρα', 'Files & windows'),
      rows: [
        ['Ctrl + N', L('Νέα παρτίδα', 'New game')],
        ['Ctrl + S', L('Αποθήκευση παρτίδας στη βάση', 'Save game to database')],
        ['Ctrl + V', L('Επικόλληση PGN ή FEN στη σκακιέρα', 'Paste PGN or FEN onto the board')],
        [L('Μεσαίο κλικ σε καρτέλα', 'Middle-click a tab'), L('Κλείσιμο καρτέλας', 'Close tab')],
      ],
    },
  ];

  return (
    <>
      <button className="icon-btn" title={L('Βοήθεια & συντομεύσεις', 'Help & shortcuts')} aria-label={L('Βοήθεια & συντομεύσεις', 'Help & shortcuts')} onClick={openMenu}>
        <CircleHelp size={17} />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      {shortcuts && (
        <WinDialog
          title={L('Συντομεύσεις πληκτρολογίου & ποντικιού', 'Keyboard & mouse shortcuts')}
          onClose={() => setShortcuts(false)}
          width={560}
          footer={
            <button className="win-btn default" onClick={() => setShortcuts(false)}>
              {L('Εντάξει', 'OK')}
            </button>
          }
        >
          <div className="help-grid">
            {groups.map((g) => (
              <section key={g.title} className="help-group">
                <h3>{g.title}</h3>
                <dl className="help-list">
                  {g.rows.map(([k, desc]) => (
                    <div key={k} className="help-row">
                      <dt>
                        <kbd>{k}</kbd>
                      </dt>
                      <dd>{desc}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </WinDialog>
      )}
    </>
  );
}
