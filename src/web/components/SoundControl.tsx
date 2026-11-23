/**
 * Ήχος: το ηχείο της πάνω γραμμής (κλικ → μικρό παράθυρο με διακόπτη, ένταση, σετ ήχων και «Δοκιμή») και τα
 * ονόματα των σετ για τις Ρυθμίσεις. Οι αλλαγές από το ηχείο γράφονται αμέσως (`ui.sound`), σε όλα τα παράθυρα.
 */
import { useEffect, useRef, useState } from 'react';
import { Play, Volume1, Volume2, VolumeX } from 'lucide-react';
import { L } from '../i18n.ts';
import { useApp } from '../store.ts';
import { setUiLater } from '../tactics/store.ts';
import { SOUND_THEMES, playMoveSound, soundConfig, type SoundConfig, type SoundTheme } from '../sounds.ts';

export const soundThemeName = (t: SoundTheme): string =>
  ({ wood: L('Ξύλο', 'Wood'), piano: L('Πιάνο', 'Piano'), nes: L('Ρετρό', 'Retro') })[t];

export const soundThemeNote = (t: SoundTheme): string =>
  ({
    wood: L('Ξύλινα κομμάτια σε ξύλινη σκακιέρα, άλλος ήχος στην αιχμαλωσία', 'Wooden pieces on a wooden board, a different sound for captures'),
    piano: L('Απαλές νότες πιάνου', 'Soft piano notes'),
    nes: L('Ήχοι παλιού βιντεοπαιχνιδιού (8-bit)', 'Old video game sounds (8-bit)'),
  })[t];

/** Δείγμα: μια κίνηση και μια αιχμαλωσία, με τις ρυθμίσεις που δίνονται (και με κλειστό ήχο). */
export function previewSound(c: SoundConfig): void {
  playMoveSound('Nf3', { preview: c });
  setTimeout(() => playMoveSound('Bxf7', { preview: c }), 450);
}

export function SoundButton() {
  const ui = useApp((s) => s.settings?.ui) as Record<string, unknown> | undefined;
  const c = soundConfig(ui);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const save = (patch: Partial<SoundConfig>) => setUiLater({ sound: { ...c, ...patch } });
  const hear = (patch: Partial<SoundConfig> = {}) => previewSound({ ...c, ...patch, on: true });
  const Icon = !c.on || c.volume === 0 ? VolumeX : c.volume < 40 ? Volume1 : Volume2;
  return (
    <div className="sound-ctl" ref={box}>
      <button
        className="icon-btn"
        aria-expanded={open}
        title={c.on ? L(`Ήχος: ${soundThemeName(c.theme)}, ${c.volume}%`, `Sound: ${soundThemeName(c.theme)}, ${c.volume}%`) : L('Ήχος: κλειστός', 'Sound: off')}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={17} />
      </button>
      {open && (
        <div className="sound-pop" role="dialog" aria-label={L('Ήχος', 'Sound')}>
          <label className="check">
            <input type="checkbox" checked={c.on} onChange={(e) => save({ on: e.target.checked })} /> {L('Ήχοι στις κινήσεις', 'Move sounds')}
          </label>
          <label className="sound-row">
            <span>{L('Ένταση', 'Volume')}</span>
            <input type="range" min={0} max={100} step={5} value={c.volume} disabled={!c.on} onChange={(e) => save({ volume: Number(e.target.value) })} onPointerUp={(e) => hear({ volume: Number(e.currentTarget.value) })} onKeyUp={(e) => hear({ volume: Number(e.currentTarget.value) })} />
            <span className="tnum sound-pct">{c.volume}%</span>
          </label>
          <label className="sound-row">
            <span>{L('Σετ ήχων', 'Sound set')}</span>
            <select
              value={c.theme}
              disabled={!c.on}
              onChange={(e) => {
                const theme = e.target.value as SoundTheme;
                save({ theme });
                hear({ theme });
              }}
            >
              {SOUND_THEMES.map((t) => (
                <option key={t} value={t}>
                  {soundThemeName(t)}
                </option>
              ))}
            </select>
          </label>
          <button className="sound-test" onClick={() => hear()} disabled={!c.on}>
            <Play size={14} /> {L('Δοκιμή', 'Test')}
          </button>
        </div>
      )}
    </div>
  );
}
