/**
 * Ήχοι της σκακιέρας: πραγματικές ηχογραφήσεις (βλ. `public/sounds/README.md`). Ξύλο (προεπιλογή): ξύλινο κομμάτι
 * σε ξύλινη σκακιέρα, του el_boss (CC0)· Πιάνο και Ρετρό του Enigmahack (AGPL-3.0-or-later). Κίνηση, αιχμαλωσία
 * (άλλος ήχος), σαχ (όπου το σετ έχει) και ειδοποίηση· διακόπτης, σετ και ένταση στις Ρυθμίσεις και στο ηχείο της
 * πάνω γραμμής (`ui.sound`). Τα αρχεία φορτώνονται με την πρώτη ενέργεια του χρήστη, ώστε ο πρώτος ήχος να παίζει
 * χωρίς καθυστέρηση.
 */

export type SoundTheme = 'wood' | 'piano' | 'nes';
export type MoveSound = 'move' | 'capture' | 'castle' | 'promote' | 'check' | 'notify' | 'success' | 'error';

export interface SoundConfig {
  on: boolean;
  theme: SoundTheme;
  /** 0–100 */
  volume: number;
}

export const SOUND_THEMES: SoundTheme[] = ['wood', 'piano', 'nes'];
export const DEFAULT_SOUND: SoundConfig = { on: true, theme: 'wood', volume: 70 };

/** Οι ρυθμίσεις ήχου από το `ui` των ρυθμίσεων (και το παλιό `ui.sounds`). */
export function soundConfig(ui: Record<string, unknown> | undefined): SoundConfig {
  const s = (ui?.sound ?? {}) as Partial<SoundConfig>;
  return {
    on: typeof s.on === 'boolean' ? s.on : ui?.sounds !== false,
    theme: SOUND_THEMES.includes(s.theme as SoundTheme) ? (s.theme as SoundTheme) : DEFAULT_SOUND.theme,
    volume: typeof s.volume === 'number' && Number.isFinite(s.volume) ? Math.max(0, Math.min(100, Math.round(s.volume))) : DEFAULT_SOUND.volume,
  };
}

/** Τα αρχεία κάθε σετ· ό,τι λείπει (ροκέ, προαγωγή, σαχ στο Ξύλο) παίζει τον ήχο κίνησης, το «λάθος» σιωπή. */
const MUSIC: Partial<Record<MoveSound, string>> = { move: 'Move', capture: 'Capture', check: 'Check', notify: 'GenericNotify', success: 'GenericNotify' };
const SETS: Record<SoundTheme, Partial<Record<MoveSound, string>>> = {
  wood: { move: 'Move', capture: 'Capture', notify: 'GenericNotify', success: 'GenericNotify' },
  piano: MUSIC,
  nes: MUSIC,
};

function fileFor(theme: SoundTheme, kind: MoveSound): string | null {
  if (kind === 'error') return null;
  return SETS[theme][kind] ?? SETS[theme].move ?? null;
}

let cfg: SoundConfig = DEFAULT_SOUND;
let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
  }
  // ο browser ξεκινά τον ήχο μόνο μετά από ενέργεια του χρήστη (κλικ, πλήκτρο): εδώ είμαστε μέσα σε μία
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

const urlOf = (theme: SoundTheme, file: string) => `/sounds/${theme}/${file}.mp3`;

function load(a: AudioContext, url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => a.decodeAudioData(b))
      .catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

function preload(theme: SoundTheme): void {
  const a = audio();
  if (a) for (const f of new Set(Object.values(SETS[theme]))) if (f) void load(a, urlOf(theme, f));
}

// φόρτωση με την πρώτη ενέργεια του χρήστη (πριν από την πρώτη κίνηση)
if (typeof window !== 'undefined') {
  const first = () => {
    window.removeEventListener('pointerdown', first, true);
    window.removeEventListener('keydown', first, true);
    if (cfg.on) preload(cfg.theme);
  };
  window.addEventListener('pointerdown', first, true);
  window.addEventListener('keydown', first, true);
}

/** Οι τρέχουσες ρυθμίσεις (τις δίνει το App από τις ρυθμίσεις του server). */
export function setSoundConfig(c: SoundConfig): void {
  const changed = c.theme !== cfg.theme;
  cfg = c;
  if (changed && ctx && c.on) preload(c.theme);
}

export interface SoundOptions {
  /** δοκιμή με άλλες ρυθμίσεις (π.χ. στις Ρυθμίσεις, πριν από την αποθήκευση): παίζει και με κλειστό ήχο */
  preview?: SoundConfig;
}

/** Παίζει έναν ήχο (σιωπηλά αν ο ήχος είναι κλειστός ή αν ο browser δεν επιτρέπει ακόμη ήχο). */
export function playSound(kind: MoveSound, opts: SoundOptions = {}): void {
  const c = opts.preview ?? cfg;
  const file = fileFor(c.theme, kind);
  if ((!c.on && !opts.preview) || !file || c.volume <= 0) return;
  const a = audio();
  if (!a) return;
  void load(a, urlOf(c.theme, file)).then((buf) => {
    if (!buf) return;
    const src = a.createBufferSource();
    src.buffer = buf;
    const g = a.createGain();
    g.gain.value = (c.volume / 100) ** 1.5;
    src.connect(g).connect(a.destination);
    src.start();
  });
}

/**
 * Ήπια ειδοποίηση (πρόσκληση, αίτημα φιλίας, βάση από φίλο): δύο απαλοί τόνοι (ημιτονοειδείς, μαλακή άνοδος/πτώση),
 * πολύ πιο σιγανοί από τους ήχους των κινήσεων· σιωπή αν ο ήχος είναι κλειστός.
 */
export function playChime(): void {
  if (!cfg.on || cfg.volume <= 0) return;
  const a = audio();
  if (!a) return;
  const peak = 0.09 * (cfg.volume / 100) ** 1.5;
  const t0 = a.currentTime + 0.01;
  // Μι5 → Λα5, το δεύτερο λίγο πιο σιγανό
  ([[659.25, 0, 1], [880, 0.13, 0.8]] as const).forEach(([hz, at, k]) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.value = hz;
    const s = t0 + at;
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(peak * k, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.45);
    o.connect(g).connect(a.destination);
    o.start(s);
    o.stop(s + 0.5);
  });
}

/** Τι ήχο θέλει μια κίνηση (από το SAN): σαχ, αιχμαλωσία, ροκέ, προαγωγή ή απλή κίνηση. */
export function moveSoundOf(san: string): MoveSound {
  if (/[+#]/.test(san)) return 'check';
  if (san.includes('x')) return 'capture';
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('=')) return 'promote';
  return 'move';
}

/** Ο ήχος μιας κίνησης (σαχ σε σετ χωρίς ήχο σαχ: αιχμαλωσία ή κίνηση). */
export function playMoveSound(san: string, opts: SoundOptions = {}): void {
  const kind = moveSoundOf(san);
  const theme = (opts.preview ?? cfg).theme;
  playSound(kind === 'check' && !SETS[theme].check && san.includes('x') ? 'capture' : kind, opts);
}
