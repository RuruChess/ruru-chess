/**
 * Τα πρόσωπα των αντιπάλων: ζωγραφιστά πορτρέτα σε SVG (δικά μας, χωρίς εικόνες απ’ έξω), ένα ανά bot.
 * Οι μηχανές (πλήρης μηχανή, Leela, Maia, δικές σου ρυθμίσεις) είναι ρομπότ στο ίδιο στυλ.
 */
import type { BotSpec } from './bots.ts';

type Hair = 'messy' | 'side' | 'buzz' | 'bald' | 'curly' | 'long' | 'bob' | 'bun' | 'pigtails' | 'quiff';
type Clothes = 'tee' | 'hoodie' | 'shirt' | 'blazer' | 'cardigan' | 'sweater';

interface Person {
  kind: 'person';
  bg: string;
  skin: string;
  hair: string;
  style: Hair;
  clothes: Clothes;
  shirt: string;
  /** γένια: γεμάτα, μουστάκι, αξύριστος */
  beard?: 'full' | 'mustache' | 'stubble';
  glasses?: 'round' | 'square';
  earrings?: boolean;
  cap?: string;
  /** παιδί (στρογγυλό πρόσωπο, μάγουλα) ή μεγάλος (ρυτίδες) */
  age?: 'kid' | 'older';
  /** χαμόγελο με δόντια */
  grin?: boolean;
  /** φρύδια ψηλά (αβέβαιος) ή χαμηλά (συγκεντρωμένος) */
  brows?: 'up' | 'down';
  freckles?: boolean;
}

interface Robot {
  kind: 'robot';
  bg: string;
  metal: string;
  glow: string;
  /** στρογγυλό κεφάλι και χαμόγελο (η Maia, που παίζει σαν άνθρωπος) */
  soft?: boolean;
}

type Face = Person | Robot;

const FACES: Record<string, Face> = {
  beginner: { kind: 'person', bg: '#cfe8d5', skin: '#f2c9a5', hair: '#7a4a24', style: 'messy', clothes: 'tee', shirt: '#4f9d69', brows: 'up', freckles: true },
  kid: { kind: 'person', bg: '#fde2cf', skin: '#e8b48c', hair: '#2b1d16', style: 'pigtails', clothes: 'hoodie', shirt: '#e2697a', age: 'kid', grin: true },
  cafe: { kind: 'person', bg: '#efe0c5', skin: '#e9b98f', hair: '#b9b4ad', style: 'bald', clothes: 'cardigan', shirt: '#8a6a4a', beard: 'mustache', cap: '#5a5048', age: 'older', grin: true },
  student: { kind: 'person', bg: '#d6e4f5', skin: '#a8714b', hair: '#1f1712', style: 'curly', clothes: 'hoodie', shirt: '#3d6fb4', glasses: 'round' },
  club: { kind: 'person', bg: '#f3dcd2', skin: '#f4cdb0', hair: '#9b4a25', style: 'bob', clothes: 'sweater', shirt: '#6f7fbf', earrings: true },
  attacker: { kind: 'person', bg: '#f6d3cf', skin: '#d39a6e', hair: '#151112', style: 'quiff', clothes: 'tee', shirt: '#2d2b33', beard: 'stubble', brows: 'down' },
  solid: { kind: 'person', bg: '#d9e6e3', skin: '#f3d0b4', hair: '#d9b25f', style: 'long', clothes: 'blazer', shirt: '#36566b', glasses: 'square' },
  expert: { kind: 'person', bg: '#dcd8f0', skin: '#7b4c32', hair: '#16100d', style: 'side', clothes: 'shirt', shirt: '#5a6b7d', beard: 'full', brows: 'down' },
  master: { kind: 'person', bg: '#ead7ef', skin: '#d9a67d', hair: '#2a1a14', style: 'bun', clothes: 'blazer', shirt: '#7a2f4f', earrings: true, grin: true },
  full: { kind: 'robot', bg: '#d5e3ee', metal: '#9aa8b6', glow: '#22b8f0' },
  leela: { kind: 'robot', bg: '#e3dcf6', metal: '#a593d8', glow: '#f25fd0' },
  maia: { kind: 'robot', bg: '#d6efe8', metal: '#7cc4b2', glow: '#ffb627', soft: true },
  custom: { kind: 'robot', bg: '#e4e6e9', metal: '#a3a9b1', glow: '#7ccf3a' },
};

/** Χρώμα πιο σκούρο (amt < 0) ή πιο ανοιχτό (amt > 0). */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch(n >> 16);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const faceOf = (bot: BotSpec): Face => FACES[bot.kind === 'maia' ? 'maia' : bot.id] ?? FACES.custom;

/** Το πρόσωπο του αντιπάλου (γεμίζει το κουτί του). */
export function BotFace({ bot }: { bot: BotSpec }) {
  const f = faceOf(bot);
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="50" fill={f.bg} />
      {f.kind === 'robot' ? <RobotFace f={f} /> : <PersonFace f={f} />}
    </svg>
  );
}

function PersonFace({ f }: { f: Person }) {
  const skinDark = shade(f.skin, -0.16);
  const hairDark = shade(f.hair, -0.25);
  const shirtDark = shade(f.shirt, -0.28);
  const kid = f.age === 'kid';
  const head = kid
    ? 'M30 45 C30 28 39 22 50 22 C61 22 70 28 70 45 C70 58 62 67 50 67 C38 67 30 58 30 45 Z'
    : 'M31 42 C31 26 40 21 50 21 C60 21 69 26 69 42 C69 56 61 67 50 67 C39 67 31 56 31 42 Z';
  const browY = f.brows === 'up' ? -1.6 : f.brows === 'down' ? 0.9 : 0;
  return (
    <g>
      {/* μαλλιά πίσω από το κεφάλι */}
      {f.style === 'long' && <path d="M27 46 C25 23 37 14 50 14 C63 14 75 23 73 46 L76 80 Q63 87 50 84 Q37 87 24 80 Z" fill={hairDark} />}
      {f.style === 'bob' && <path d="M28 44 C27 24 38 16 50 16 C62 16 73 24 72 44 L73 63 Q66 67 60 63 L40 63 Q34 67 27 63 Z" fill={hairDark} />}
      {f.style === 'pigtails' && (
        <g fill={f.hair}>
          <ellipse cx="25" cy="52" rx="6.5" ry="11" transform="rotate(14 25 52)" />
          <ellipse cx="75" cy="52" rx="6.5" ry="11" transform="rotate(-14 75 52)" />
          <circle cx="28.5" cy="41" r="2.6" fill="#f2c94c" />
          <circle cx="71.5" cy="41" r="2.6" fill="#f2c94c" />
        </g>
      )}
      {f.style === 'bun' && <circle cx="50" cy="15" r="9" fill={f.hair} />}
      {/* σώμα και λαιμός */}
      <path d="M13 100 C13 80 29 72 50 72 C71 72 87 80 87 100 Z" fill={f.shirt} />
      <path d="M42 58 L58 58 L58 75 Q50 80 42 75 Z" fill={skinDark} />
      <Clothing c={f.clothes} shirt={f.shirt} dark={shirtDark} />
      {/* αυτιά και κεφάλι */}
      <ellipse cx={kid ? 30 : 31} cy="46" rx="3.6" ry="5.6" fill={skinDark} />
      <ellipse cx={kid ? 70 : 69} cy="46" rx="3.6" ry="5.6" fill={skinDark} />
      <path d={head} fill={f.skin} />
      {f.earrings && (
        <g fill="#e8b73a">
          <circle cx="31" cy="52.5" r="1.8" />
          <circle cx="69" cy="52.5" r="1.8" />
        </g>
      )}
      {/* γένια κάτω από το στόμα */}
      {f.beard === 'full' && <path d="M31 45 C32 62 40 70.5 50 70.5 C60 70.5 68 62 69 45 C67 53 63 57.5 58 58.5 C55 55.5 45 55.5 42 58.5 C37 57.5 33 53 31 45 Z" fill={f.hair} />}
      {f.beard === 'stubble' && <path d="M32 47 C33 61 41 67 50 67 C59 67 67 61 68 47 C65 55 59 59 50 59 C41 59 35 55 32 47 Z" fill={f.hair} opacity="0.22" />}
      {/* μάτια, φρύδια, μύτη */}
      <g fill="#2a2522">
        <ellipse cx="42.5" cy="45" rx="2.2" ry="2.7" />
        <ellipse cx="57.5" cy="45" rx="2.2" ry="2.7" />
      </g>
      <g fill="#fff">
        <circle cx="43.3" cy="44.1" r="0.75" />
        <circle cx="58.3" cy="44.1" r="0.75" />
      </g>
      <g stroke={f.style === 'bald' ? shade(f.hair, -0.35) : hairDark} strokeWidth="2" strokeLinecap="round" fill="none" transform={`translate(0 ${browY})`}>
        <path d={f.brows === 'down' ? 'M38.2 39.6 Q42.6 38.4 46.6 40' : 'M38.4 39.8 Q42.6 37.4 46.6 39.4'} />
        <path d={f.brows === 'down' ? 'M53.4 40 Q57.4 38.4 61.8 39.6' : 'M53.4 39.4 Q57.4 37.4 61.6 39.8'} />
      </g>
      <path d="M50.2 46.5 Q48 52 50.8 53.4" stroke={skinDark} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      {f.freckles && (
        <g fill={skinDark} opacity="0.6">
          <circle cx="39" cy="51" r="0.7" />
          <circle cx="41.5" cy="52.3" r="0.7" />
          <circle cx="37.6" cy="53" r="0.6" />
          <circle cx="61" cy="51" r="0.7" />
          <circle cx="58.5" cy="52.3" r="0.7" />
          <circle cx="62.4" cy="53" r="0.6" />
        </g>
      )}
      {(kid || f.grin) && (
        <g fill="#ff6f6f" opacity={kid ? 0.25 : 0.14}>
          <circle cx="37.5" cy="53.5" r="3.4" />
          <circle cx="62.5" cy="53.5" r="3.4" />
        </g>
      )}
      {f.age === 'older' && (
        <g stroke={skinDark} strokeWidth="0.9" strokeLinecap="round" fill="none">
          <path d="M36.5 46.5 L34.5 47.4" />
          <path d="M63.5 46.5 L65.5 47.4" />
          <path d="M43 33.2 Q50 31.8 57 33.2" />
          <path d="M44.5 35.6 Q50 34.6 55.5 35.6" />
        </g>
      )}
      {/* στόμα */}
      {f.grin ? (
        <g>
          <path d="M44 57.2 Q50 64.6 56 57.2 Z" fill="#7b2d2d" />
          <path d="M45.2 57.8 Q50 59.8 54.8 57.8 L54.4 58.8 Q50 60.6 45.6 58.8 Z" fill="#fff" />
        </g>
      ) : (
        <path d={f.brows === 'up' ? 'M45 58.6 Q50 61.2 55 58' : 'M44.6 58 Q50 62 55.4 58'} stroke="#8a3b3b" strokeWidth="1.9" strokeLinecap="round" fill="none" />
      )}
      {f.beard === 'mustache' && <path d="M42.8 55.6 Q50 51.8 57.2 55.6 Q53.4 57.4 50 56 Q46.6 57.4 42.8 55.6 Z" fill={f.hair} />}
      <HairFront f={f} dark={hairDark} />
      {f.glasses === 'round' && (
        <g stroke="#2f2a2a" strokeWidth="1.6" fill="#ffffff" fillOpacity="0.12">
          <circle cx="42.5" cy="45" r="5.4" />
          <circle cx="57.5" cy="45" r="5.4" />
          <path d="M47.9 44.6 Q50 43.2 52.1 44.6 M37.1 44.2 L31.8 42.8 M62.9 44.2 L68.2 42.8" fill="none" />
        </g>
      )}
      {f.glasses === 'square' && (
        <g stroke="#3a2f35" strokeWidth="1.6" fill="#ffffff" fillOpacity="0.12">
          <rect x="36.4" y="40.6" width="12.2" height="8.6" rx="2.2" />
          <rect x="51.4" y="40.6" width="12.2" height="8.6" rx="2.2" />
          <path d="M48.6 44 Q50 43 51.4 44 M36.4 43.6 L31.8 42.6 M63.6 43.6 L68.2 42.6" fill="none" />
        </g>
      )}
      {f.cap && (
        <g>
          <path d="M29.5 34 C30 21 40 15.5 51 15.5 C63 15.5 71 21.5 71.5 31.5 C63 27.5 40 28 29.5 34 Z" fill={f.cap} />
          <path d="M27 34.4 C40 28 62 27 75 31.6 C71 35 61 34 50.5 34 C40.5 34 32 36.2 27 34.4 Z" fill={shade(f.cap, -0.3)} />
        </g>
      )}
    </g>
  );
}

function HairFront({ f, dark }: { f: Person; dark: string }) {
  const h = f.hair;
  switch (f.style) {
    case 'messy':
      return (
        <path
          d="M30.5 45 C27.5 27 37 17 50.5 17 C63 17 72.5 26 69.5 45 C68 37 66 32 62 29.5 C58.5 33.5 51 33.5 45.5 30 C41.5 33.5 35 36.5 30.5 45 Z M38 21 L41 14.5 L44.5 19.5 L48 12.5 L51.5 18.5 L56 13.5 L58 19.5 L63 16.5 L62 22 Z"
          fill={h}
        />
      );
    case 'side':
      return <path d="M30.5 42 C29 25 39 18 51 18 C63 18 71.5 25 69.5 42 C68.5 34 65 29.5 58 27.5 C50 31 40.5 31.5 33.5 33.5 C31.5 36 30.8 39 30.5 42 Z" fill={h} />;
    case 'buzz':
      return <path d="M31 39 C32 26 40 19.5 50 19.5 C60 19.5 68 26 69 39 C64 31.5 58 28.5 50 28.5 C42 28.5 36 31.5 31 39 Z" fill={h} opacity="0.92" />;
    case 'bald':
      return (
        <g fill={h}>
          <path d="M30.6 49 C29.8 42 30.8 37.5 33.6 35 C34 39.5 34.6 44 35.4 49 Z" />
          <path d="M69.4 49 C70.2 42 69.2 37.5 66.4 35 C66 39.5 65.4 44 64.6 49 Z" />
        </g>
      );
    case 'curly': {
      const pts: Array<[number, number, number]> = [
        [31, 40, 5.6], [32.5, 32, 6], [37, 25.5, 6.2], [43.5, 21, 6.4], [50.5, 19.5, 6.6], [57.5, 21, 6.4], [63.5, 25.5, 6.2], [67.5, 32, 6], [69, 40, 5.6],
        [40, 29.5, 5.4], [47, 27.5, 5.4], [54, 27.5, 5.4], [60.5, 29.5, 5.4],
      ];
      return (
        <g fill={h}>
          {pts.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} />
          ))}
          <g fill={dark} opacity="0.55">
            {pts.slice(0, 9).map(([x, y], i) => (
              <circle key={i} cx={x + 1.4} cy={y + 1.6} r="1.6" />
            ))}
          </g>
        </g>
      );
    }
    case 'long':
      return <path d="M30 46 C28.5 25 38.5 16.5 50 16.5 C61.5 16.5 71.5 25 70 46 C67.5 35 62.5 28.5 54.5 26.5 C49 30.5 41 33.5 33.5 35.5 C31.5 38.5 30.5 42 30 46 Z" fill={h} />;
    case 'bob':
      return <path d="M30 41 C30 25 39 18 50 18 C61 18 70 25 70 41 C66 36.5 60 34.5 50 34.5 C40 34.5 34 36.5 30 41 Z" fill={h} />;
    case 'bun':
      return <path d="M30.5 43 C29.5 26.5 39 19.5 50 19.5 C61 19.5 70.5 26.5 69.5 43 C66 33.5 59 28.5 50 28.5 C41 28.5 34 33.5 30.5 43 Z" fill={h} />;
    case 'pigtails':
      return (
        <g fill={h}>
          <path d="M31 43 C30 27 39 20 50 20 C61 20 70 27 69 43 C67 33.5 60 28 50 27.5 C40 28 33 33.5 31 43 Z" />
          <path d="M50 20.5 L50 28" stroke={dark} strokeWidth="1.2" />
        </g>
      );
    case 'quiff':
      return <path d="M30.5 43 C29 28 36.5 19.5 48.5 18.5 C54 11 66.5 12 70.5 21 C72.5 28 71.5 35.5 69.5 43 C66.5 33.5 61 29.5 52 28.5 C43 28.5 35.5 33.5 30.5 43 Z" fill={h} />;
  }
}

function Clothing({ c, shirt, dark }: { c: Clothes; shirt: string; dark: string }) {
  switch (c) {
    case 'tee':
      return <path d="M41 73.5 Q50 82 59 73.5" stroke={dark} strokeWidth="2.4" fill="none" strokeLinecap="round" />;
    case 'hoodie':
      return (
        <g>
          <path d="M34 76 Q50 64 66 76 Q59 85 50 85 Q41 85 34 76 Z" fill={dark} />
          <path d="M46 83 L45 94 M54 83 L55 94" stroke="#f4f4f4" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      );
    case 'shirt':
      return (
        <g>
          <path d="M42 72 L50 80 L44.5 85 Z M58 72 L50 80 L55.5 85 Z" fill="#f1f1f1" />
          <path d="M50 80 L50 100" stroke={dark} strokeWidth="1.2" />
          <circle cx="50" cy="88" r="0.9" fill={dark} />
          <circle cx="50" cy="95" r="0.9" fill={dark} />
        </g>
      );
    case 'blazer':
      return (
        <g>
          <path d="M42 73 L50 93 L58 73 Z" fill="#f3f1ee" />
          <path d="M42 73 L50 93 L37.5 85 L40 76 Z M58 73 L50 93 L62.5 85 L60 76 Z" fill={dark} />
          <circle cx="50" cy="96" r="1.1" fill={shade(shirt, -0.45)} />
        </g>
      );
    case 'cardigan':
      return (
        <g>
          <path d="M42.5 73 L50 88 L57.5 73 Z" fill="#e8e1d6" />
          <path d="M42.5 73 L50 88 L50 100 L44 100 L39 80 Z M57.5 73 L50 88 L50 100 L56 100 L61 80 Z" fill={dark} opacity="0.55" />
          <circle cx="51.6" cy="92" r="1" fill="#3a2f26" />
          <circle cx="51.6" cy="97" r="1" fill="#3a2f26" />
        </g>
      );
    case 'sweater':
      return <path d="M41 73.2 Q50 79.5 59 73.2" stroke={dark} strokeWidth="3.4" fill="none" strokeLinecap="round" />;
  }
}

function RobotFace({ f }: { f: Robot }) {
  const dark = shade(f.metal, -0.35);
  const light = shade(f.metal, 0.35);
  return (
    <g>
      <path d="M14 100 C14 82 30 75 50 75 C70 75 86 82 86 100 Z" fill={dark} />
      <circle cx="50" cy="89" r="3.6" fill={f.glow} />
      <rect x="44" y="64" width="12" height="12" rx="2" fill={shade(f.metal, -0.2)} />
      <path d="M50 22 L50 13" stroke={dark} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="50" cy="11" r="3.6" fill={f.glow} />
      <rect x="17" y="37" width="7" height="16" rx="3.5" fill={dark} />
      <rect x="76" y="37" width="7" height="16" rx="3.5" fill={dark} />
      <rect x="23" y="21" width="54" height="46" rx={f.soft ? 22 : 12} fill={f.metal} />
      <rect x="27" y="24" width="46" height="8" rx="4" fill={light} opacity="0.5" />
      <rect x="30.5" y="33" width="39" height="21" rx="10.5" fill="#1d2430" />
      <g fill={f.glow}>
        <circle cx="41.5" cy="43.5" r="4.6" />
        <circle cx="58.5" cy="43.5" r="4.6" />
      </g>
      <g fill="#fff" opacity="0.8">
        <circle cx="43" cy="42" r="1.4" />
        <circle cx="60" cy="42" r="1.4" />
      </g>
      {f.soft ? (
        <path d="M42.5 58.6 Q50 64 57.5 58.6" stroke="#1d2430" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      ) : (
        <g>
          <rect x="39" y="57.5" width="22" height="5" rx="2.5" fill="#1d2430" />
          <path d="M44.5 57.5 V62.5 M50 57.5 V62.5 M55.5 57.5 V62.5" stroke={f.metal} strokeWidth="1.2" />
        </g>
      )}
    </g>
  );
}
