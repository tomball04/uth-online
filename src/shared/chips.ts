// §28 Chip denominations and collectible chip designs. Values are numbers (cents); designs are purely visual.
// Every chip is drawn by one procedural SVG template from (denomination, collection). A design never changes a
// chip's value, and the value label is always drawn large on a high-contrast inlay.

/** The nine denominations, in cents. */
export const DENOMS = [100, 500, 2_500, 10_000, 50_000, 100_000, 500_000, 2_500_000, 10_000_000] as const;
export type Denom = (typeof DENOMS)[number];
export const DENOM_LABEL: Record<Denom, string> = { 100: '1', 500: '5', 2_500: '25', 10_000: '100', 50_000: '500', 100_000: '1K', 500_000: '5K', 2_500_000: '25K', 10_000_000: '100K' };
export const DENOM_NAME: Record<Denom, string> = { 100: '$1', 500: '$5', 2_500: '$25', 10_000: '$100', 50_000: '$500', 100_000: '$1,000', 500_000: '$5,000', 2_500_000: '$25,000', 10_000_000: '$100,000' };
/** Equip slot for a single-denomination override (e.g. 'c25'). */
export const denomSlot = (d: Denom) => `c${d / 100}` as const;
export const DENOM_SLOTS = DENOMS.map(denomSlot);

/** Default colour category per denomination (§28.1). [body, accent, label]. */
const BASE: Record<Denom, [string, string, string]> = {
  100: ['#ece8df', '#2b5aa6', '#1b1b1f'],      // white
  500: ['#b3262b', '#f4f1ea', '#ffffff'],      // red
  2_500: ['#1f7a45', '#f4f1ea', '#ffffff'],    // green
  10_000: ['#26252a', '#f4f1ea', '#ffffff'],   // black
  50_000: ['#5b2a86', '#f3d77a', '#ffffff'],   // purple
  100_000: ['#e0b13a', '#1b1b1f', '#1b1b1f'],  // yellow / gold
  500_000: ['#b8641f', '#3b2010', '#ffffff'],  // orange / brown
  2_500_000: ['#c7ccd3', '#4a5260', '#1b1b1f'], // platinum
  10_000_000: ['#141418', '#d4af37', '#f3d77a'], // high-roller plaque
};

export const CHIP_COLLECTIONS = [
  { id: 'classic', name: 'Classic Vegas', setId: 'chips-classic', blurb: 'The standard rack: edge spots and a clean inlay.' },
  { id: 'emerald', name: 'Emerald Elite', setId: 'chips-emerald', blurb: 'Emerald rims and gold spots.' },
  { id: 'midnight', name: 'Midnight Royale', setId: 'chips-midnight', blurb: 'Midnight blue with silver crowns.' },
  { id: 'crimson', name: 'Crimson Club', setId: 'chips-crimson', blurb: 'Crimson rings and white diamond inserts.' },
  { id: 'vintage', name: 'Vintage Casino', setId: 'chips-ivory', blurb: 'Aged clay with ivory faces.' },
  { id: 'deco', name: 'Art Deco Gold', setId: 'chips-deco', blurb: 'Black lacquer and gold sunbursts.' },
  { id: 'desert', name: 'Desert High Roller', setId: 'chips-desert', blurb: 'Sandstone and terracotta stripes.' },
  { id: 'saloon', name: 'Old West Saloon', setId: 'chips-saloon', blurb: 'Hand-stamped stars on weathered wood tones.' },
  { id: 'royal', name: 'Royal Flush', setId: 'chips-royal', blurb: 'All four suits around the rim.' },
  { id: 'platinum', name: 'Platinum Prestige', setId: 'chips-highroller', blurb: 'Brushed platinum with engraved rings.' },
  { id: 'neon', name: 'Neon Nights', setId: 'chips-neon', blurb: 'A glowing neon ring on black.' },
  { id: 'marble', name: 'Black Marble', setId: 'chips-blackgold', blurb: 'Veined black marble with gold numerals.' },
  { id: 'carbon', name: 'Carbon Fiber', setId: 'chips-carbon', blurb: 'Woven carbon with a racing stripe.' },
  { id: 'cosmic', name: 'Cosmic Casino', setId: 'chips-cosmic', blurb: 'Deep space, stars and a planetary ring.' },
  { id: 'diamond', name: 'Diamond Reserve', setId: 'chips-diamond', blurb: 'Faceted ice-white with a diamond edge.' },
] as const;
export type ChipCollectionId = (typeof CHIP_COLLECTIONS)[number]['id'];
export const CHIP_COLLECTION = new Map(CHIP_COLLECTIONS.map((c) => [c.id, c]));
export const COLLECTION_BY_SET = new Map(CHIP_COLLECTIONS.map((c) => [c.setId as string, c.id as ChipCollectionId]));
export const chipItemId = (col: ChipCollectionId, d: Denom) => `chip-${col}-${d / 100}`;
/** Parses 'chip-neon-25' → { col: 'neon', d: 2500 }. */
export function parseChipItem(id: string): { col: ChipCollectionId; d: Denom } | null {
  const m = /^chip-([a-z]+)-(\d+)$/.exec(id);
  if (!m || !CHIP_COLLECTION.has(m[1] as ChipCollectionId)) return null;
  const d = Number(m[2]) * 100;
  return (DENOMS as readonly number[]).includes(d) ? { col: m[1] as ChipCollectionId, d: d as Denom } : null;
}

// ------------------------------------------------------------------ rendering
const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const mix = (a: string, b: string, t: number) => {
  const [r1, g1, b1] = hex(a), [r2, g2, b2] = hex(b);
  const f = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${((1 << 24) | (f(r1, r2) << 16) | (f(g1, g2) << 8) | f(b1, b2)).toString(16).slice(1)}`;
};
const ring = (n: number, r: number, f: (x: number, y: number, deg: number, i: number) => string) =>
  Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return f(50 + r * Math.cos(t), 50 + r * Math.sin(t), (t * 180) / Math.PI + 90, i); }).join('');
const f2 = (n: number) => n.toFixed(2);
let uid = 0;

interface Style { body: string; rim: string; spots: string; inlay: string; ink: string; extra: (gid: string) => string; defs?: (gid: string) => string; font?: string }

function style(col: ChipCollectionId, d: Denom): Style {
  const [base, accent, label] = BASE[d];
  switch (col) {
    case 'emerald': return { body: base, rim: '#0f5a3e', spots: '#d4af37', inlay: '#f6efdc', ink: '#0f3d2b',
      extra: () => `<circle cx="50" cy="50" r="31" fill="none" stroke="#d4af37" stroke-width="1.6"/>` };
    case 'midnight': return { body: '#141c33', rim: mix(base, '#141c33', 0.35), spots: '#c0c6cc', inlay: mix(base, '#ffffff', 0.15), ink: label,
      extra: () => ring(8, 37, (x, y, deg) => `<path d="M${f2(x - 3)} ${f2(y + 1.5)} L${f2(x - 3)} ${f2(y - 1.5)} L${f2(x - 1.5)} ${f2(y)} L${f2(x)} ${f2(y - 2.2)} L${f2(x + 1.5)} ${f2(y)} L${f2(x + 3)} ${f2(y - 1.5)} L${f2(x + 3)} ${f2(y + 1.5)} Z" fill="#c0c6cc" transform="rotate(${f2(deg)} ${f2(x)} ${f2(y)})"/>`) };
    case 'crimson': return { body: base, rim: '#8b1420', spots: '#ffffff', inlay: '#fbf7ee', ink: '#5a0d16',
      extra: () => ring(6, 41, (x, y, deg) => `<path d="M${f2(x)} ${f2(y - 4)} L${f2(x + 3)} ${f2(y)} L${f2(x)} ${f2(y + 4)} L${f2(x - 3)} ${f2(y)} Z" fill="#fff" transform="rotate(${f2(deg)} ${f2(x)} ${f2(y)})"/>`) };
    case 'vintage': return { body: mix(base, '#c8b48a', 0.45), rim: mix(base, '#6a4a2a', 0.35), spots: '#efe3c4', inlay: '#efe3c4', ink: '#3b2a18', font: 'Georgia,serif',
      extra: () => `<circle cx="50" cy="50" r="33" fill="none" stroke="#6a4a2a" stroke-width=".8" stroke-dasharray="1 1.6"/>` + ring(24, 45.5, (x, y) => `<circle cx="${f2(x)}" cy="${f2(y)}" r=".9" fill="#3b2a18" opacity=".35"/>`) };
    case 'deco': return { body: '#141418', rim: '#141418', spots: '#c9a45c', inlay: base, ink: label, font: 'Georgia,serif',
      extra: () => ring(24, 38, (x, y, deg) => `<rect x="${f2(x - .8)}" y="${f2(y - 6)}" width="1.6" height="12" fill="#c9a45c" transform="rotate(${f2(deg)} ${f2(x)} ${f2(y)})"/>`) + `<circle cx="50" cy="50" r="30" fill="none" stroke="#c9a45c" stroke-width="2"/>` };
    case 'desert': return { body: '#d9b27a', rim: '#a65a2e', spots: base, inlay: '#f7ead0', ink: '#5a2e14',
      extra: () => ring(12, 40, (x, y, deg) => `<rect x="${f2(x - 1.6)}" y="${f2(y - 5)}" width="3.2" height="10" fill="#a65a2e" transform="rotate(${f2(deg)} ${f2(x)} ${f2(y)})"/>`) + `<circle cx="50" cy="50" r="31" fill="none" stroke="${base}" stroke-width="3"/>` };
    case 'saloon': return { body: mix(base, '#6a4026', 0.55), rim: '#3b2417', spots: '#e3c48e', inlay: '#f2e2bd', ink: '#3b2417', font: 'Georgia,serif',
      extra: () => ring(5, 39, (x, y) => star(x, y, 3.4, '#e3c48e')) };
    case 'royal': return { body: base, rim: mix(base, '#000000', 0.25), spots: 'none', inlay: '#fbf7ee', ink: '#141418',
      extra: () => ring(8, 40.5, (x, y, deg, i) => `<text x="${f2(x)}" y="${f2(y + 2.6)}" font-size="8" text-anchor="middle" fill="${i % 2 ? '#c0392b' : '#141418'}" stroke="#fff" stroke-width=".5" paint-order="stroke" transform="rotate(${f2(deg)} ${f2(x)} ${f2(y)})">${['♠', '♥', '♣', '♦'][i % 4]}</text>`) };
    case 'platinum': return { body: '#d5d9df', rim: '#9aa2ad', spots: base, inlay: '#f4f6f8', ink: '#2b313a',
      defs: (g) => `<linearGradient id="${g}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".5" stop-color="#b8bec7"/><stop offset="1" stop-color="#eef0f3"/></linearGradient>`,
      extra: () => `<circle cx="50" cy="50" r="37" fill="none" stroke="#7d8591" stroke-width=".5"/><circle cx="50" cy="50" r="34" fill="none" stroke="#7d8591" stroke-width=".5"/><circle cx="50" cy="50" r="31.5" fill="none" stroke="${base}" stroke-width="2"/>` };
    case 'neon': return { body: '#0d0d12', rim: '#0d0d12', spots: '#ff3ea5', inlay: '#0d0d12', ink: mix(base, '#ffffff', 0.3),
      defs: (g) => `<filter id="${g}g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter>`,
      extra: (g) => `<circle cx="50" cy="50" r="38" fill="none" stroke="${mix(base, '#ffffff', 0.25)}" stroke-width="3" filter="url(#${g}g)"/><circle cx="50" cy="50" r="38" fill="none" stroke="${mix(base, '#ffffff', 0.55)}" stroke-width="1.2"/>` };
    case 'marble': return { body: '#17161a', rim: '#0c0c0e', spots: '#d4af37', inlay: base, ink: label,
      extra: () => `<path d="M8 40 Q30 30 44 46 T92 52" fill="none" stroke="#5c5a62" stroke-width=".9" opacity=".8"/><path d="M14 66 Q36 58 52 70 T88 30" fill="none" stroke="#8a8790" stroke-width=".5" opacity=".7"/><path d="M30 12 Q42 30 36 46" fill="none" stroke="#6d6a73" stroke-width=".6" opacity=".7"/>` };
    case 'carbon': return { body: '#2a2b2e', rim: '#18191b', spots: base, inlay: '#1c1d20', ink: mix(base, '#ffffff', 0.35),
      defs: (g) => `<pattern id="${g}p" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#26272a"/><rect width="2" height="2" fill="#323336"/><rect x="2" y="2" width="2" height="2" fill="#323336"/></pattern>`,
      extra: () => `<rect x="44" y="4" width="12" height="92" fill="${base}" opacity=".85"/>` };
    case 'cosmic': return { body: '#1b1035', rim: '#0d0820', spots: 'none', inlay: '#140b29', ink: mix(base, '#ffffff', 0.4),
      extra: () => ring(14, 40, (x, y, _d, i) => `<circle cx="${f2(x + (i % 3) - 1)}" cy="${f2(y + ((i * 7) % 5) - 2)}" r="${i % 3 ? .6 : 1.1}" fill="#fff" opacity=".9"/>`) + `<ellipse cx="50" cy="50" rx="36" ry="10" fill="none" stroke="${base}" stroke-width="2" transform="rotate(-24 50 50)" opacity=".85"/>` };
    case 'diamond': return { body: '#eef6fb', rim: base, spots: '#9fd0f0', inlay: '#ffffff', ink: '#1d3c56',
      extra: () => ring(12, 38, (x, y, deg) => `<path d="M${f2(x)} ${f2(y - 5)} L${f2(x + 3.2)} ${f2(y)} L${f2(x)} ${f2(y + 5)} L${f2(x - 3.2)} ${f2(y)} Z" fill="#cfe9f8" stroke="#9fd0f0" stroke-width=".4" transform="rotate(${f2(deg)} ${f2(x)} ${f2(y)})"/>`) };
    default: return { body: base, rim: mix(base, '#000000', 0.18), spots: accent, inlay: '#fbf7ee', ink: base === '#ece8df' ? '#1b1b1f' : mix(base, '#000000', 0.25),
      extra: () => `<circle cx="50" cy="50" r="31" fill="none" stroke="${accent}" stroke-width="1" stroke-dasharray="3 2"/>` };
  }
}
const star = (x: number, y: number, r: number, c: string) => {
  const pts = Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; return `${f2(x + rr * Math.cos(a))},${f2(y + rr * Math.sin(a))}`; });
  return `<polygon points="${pts.join(' ')}" fill="${c}"/>`;
};

/** One chip face (or a $100K plaque) as an SVG string. The value is always legible. */
export function renderChip(d: Denom, col: ChipCollectionId = 'classic', opts: { cls?: string } = {}): string {
  const s = style(col, d);
  const g = `ch${(++uid).toString(36)}`;
  const font = s.font ?? 'Barlow Condensed, Arial Narrow, sans-serif';
  const text = DENOM_LABEL[d];
  const fs = text.length >= 4 ? 17 : text.length === 3 ? 21 : 25;
  const defs = s.defs?.(g) ?? '';
  const fill = col === 'platinum' ? `url(#${g}m)` : col === 'carbon' ? `url(#${g}p)` : s.body;
  if (d === 10_000_000) {
    // High-roller plaque: rectangular, engraved border, same value rules.
    return `<svg viewBox="0 0 100 64" class="chip-svg plaque ${opts.cls ?? ''}" data-col="${col}" role="img" aria-label="${DENOM_NAME[d]} plaque"><defs>${defs}</defs>`
      + `<rect x="2" y="2" width="96" height="60" rx="7" fill="${fill}" stroke="${s.rim}" stroke-width="3"/>`
      + `<rect x="8" y="8" width="84" height="48" rx="4" fill="none" stroke="${s.spots === 'none' ? s.ink : s.spots}" stroke-width="1.2"/>`
      + `<rect x="20" y="17" width="60" height="30" rx="4" fill="${s.inlay}" opacity=".95"/>`
      + `<text x="50" y="40" font-size="20" font-weight="800" text-anchor="middle" fill="${s.ink}" font-family="${font}">${text}</text></svg>`;
  }
  const spots = s.spots === 'none' ? '' : ring(6, 43, (x, y, deg) => `<rect x="${f2(x - 4)}" y="${f2(y - 3.2)}" width="8" height="6.4" rx="1" fill="${s.spots}" transform="rotate(${f2(deg)} ${f2(x)} ${f2(y)})"/>`);
  return `<svg viewBox="0 0 100 100" class="chip-svg ${opts.cls ?? ''}" data-col="${col}" role="img" aria-label="${DENOM_NAME[d]} chip"><defs>${defs}</defs>`
    + `<circle cx="50" cy="50" r="48" fill="${fill}" stroke="${s.rim}" stroke-width="3"/>${spots}${s.extra(g)}`
    + `<circle cx="50" cy="50" r="24" fill="${s.inlay}" stroke="${s.rim}" stroke-width="1.2"/>`
    + `<text x="50" y="${50 + fs * 0.36}" font-size="${fs}" font-weight="800" text-anchor="middle" fill="${s.ink}" font-family="${font}">${text}</text></svg>`;
}

/** The chips used to show an amount, largest first, capped so huge bets become a few big chips/plaques. */
export function chipBreakdown(amount: number, max = 5): Denom[] {
  const out: Denom[] = [];
  let left = amount;
  for (const d of [...DENOMS].reverse()) while (left >= d && out.length < max) { out.push(d); left -= d; }
  return out;
}

/** Which collection draws a denomination for a player: per-denomination override, else the tray set, else classic. */
export function chipCollectionFor(equipped: Record<string, string | undefined> | undefined, d: Denom): ChipCollectionId {
  const o = equipped?.[denomSlot(d)];
  const p = o ? parseChipItem(o) : null;
  if (p) return p.col;
  return COLLECTION_BY_SET.get(equipped?.chips ?? '') ?? 'classic';
}
