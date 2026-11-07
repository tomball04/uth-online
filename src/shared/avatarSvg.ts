// Layered 2D avatar renderer (§24.2). Output is an SVG string built only from enumerated appearance values and
// the bundled catalog's fixed colors: no user text, markup or URLs ever reach the SVG.
// Everything except the frame is clipped to the portrait circle, so hats and hair can never spill onto cards
// or neighboring seats.

import { DEFAULT_APPEARANCE, EYE_COLOR, HAIR_COLOR, ITEM, SKIN, parseAppearance, cleanEquipped, type Appearance, type Equipped, type Item } from './cosmetics.js';

export type Pose = 'front' | 'left' | 'right';
export type Crop = 'face' | 'chest' | 'wrist';
export interface RenderOpts { pose?: Pose; frame?: boolean; background?: boolean; id?: string; crop?: Crop }
const CROP: Record<Crop, string> = { face: '20 8 60 60', chest: '22 52 56 48', wrist: '48 66 34 34' };

let uid = 0;
const shade = (hex: string, amt: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};
const safeColor = (c: string | undefined, d: string) => (c && /^#[0-9a-fA-F]{3,6}$/.test(c) ? c : d);

function item(eq: Equipped, slot: keyof Equipped): Item | undefined {
  const id = eq[slot];
  const it = id ? ITEM.get(id) : undefined;
  return it && it.slot === slot ? it : undefined;
}

// ------------------------------------------------------------------ parts
function faceShape(face: Appearance['face'], skin: string) {
  const st = `fill="${skin}" stroke="${shade(skin, -0.25)}" stroke-width="0.8"`;
  switch (face) {
    case 'round': return `<ellipse cx="50" cy="44" rx="18.5" ry="19.5" ${st}/>`;
    case 'long': return `<ellipse cx="50" cy="44" rx="15.5" ry="22" ${st}/>`;
    case 'square': return `<path d="M33 34 Q33 23 50 23 Q67 23 67 34 L67 50 Q67 64 50 65 Q33 64 33 50 Z" ${st}/>`;
    case 'heart': return `<path d="M32.5 38 Q32 23 50 23 Q68 23 67.5 38 Q67 52 58 60 Q53 65 50 65 Q47 65 42 60 Q33 52 32.5 38 Z" ${st}/>`;
    default: return `<ellipse cx="50" cy="44" rx="17" ry="21" ${st}/>`;
  }
}

function eyes(a: Appearance, dx: number) {
  const iris = EYE_COLOR[a.eyeColor] ?? EYE_COLOR[0];
  const out: string[] = [];
  for (const x of [43 + dx, 57 + dx]) {
    if (a.eyes === 'smiling') { out.push(`<path d="M${x - 2.8} 43 Q${x} 40.4 ${x + 2.8} 43" fill="none" stroke="#2a1d14" stroke-width="1.1" stroke-linecap="round"/>`); continue; }
    const [rx, ry] = a.eyes === 'round' ? [2.4, 2.2] : a.eyes === 'wide' ? [3, 1.9] : [2.7, 1.6];
    out.push(`<ellipse cx="${x}" cy="42.5" rx="${rx}" ry="${ry}" fill="#fbfaf7"/>`);
    out.push(`<circle cx="${x + dx * 0.15}" cy="42.6" r="1.35" fill="${iris}"/><circle cx="${x + dx * 0.15}" cy="42.6" r="0.6" fill="#120c08"/>`);
    out.push(`<circle cx="${x + 0.5}" cy="42" r="0.35" fill="#fff"/>`);
    if (a.eyes === 'hooded') out.push(`<path d="M${x - 3} 41.6 Q${x} 40 ${x + 3} 41.6" fill="none" stroke="#3a2a1e" stroke-width="0.9"/>`);
  }
  return out.join('');
}

function brows(a: Appearance, dx: number, hair: string) {
  const c = a.hair === 'bald' || a.hair === 'buzz' ? shade(hair, 0.1) : hair;
  const w = a.brows === 'bold' ? 1.8 : a.brows === 'thin' ? 0.7 : 1.15;
  return [43 + dx, 57 + dx].map((x, i) => {
    const s = i === 0 ? -1 : 1;
    const outer = x + 3.2 * s, inner = x - 2.6 * s;
    const d = a.brows === 'straight' ? `M${inner} 38.4 L${outer} 38.2`
      : a.brows === 'arched' ? `M${inner} 38.8 Q${x + 0.8 * s} 35.6 ${outer} 38.6`
      : `M${inner} 38.6 Q${x} 37 ${outer} 38.4`;
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  }).join('');
}

function nose(a: Appearance, dx: number, skin: string) {
  const c = shade(skin, -0.3), x = 50 + dx * 1.3;
  switch (a.nose) {
    case 'button': return `<path d="M${x - 1.6} 49 Q${x} 50.4 ${x + 1.6} 49" fill="none" stroke="${c}" stroke-width="0.9" stroke-linecap="round"/>`;
    case 'broad': return `<path d="M${x - 0.6} 43 L${x - 1} 47 M${x - 3} 49 Q${x - 2.6} 50.8 ${x} 50.4 Q${x + 2.6} 50.8 ${x + 3} 49" fill="none" stroke="${c}" stroke-width="0.9" stroke-linecap="round"/>`;
    case 'narrow': return `<path d="M${x} 43 L${x + 0.6} 48.6 Q${x} 49.6 ${x - 1} 49.2" fill="none" stroke="${c}" stroke-width="0.8" stroke-linecap="round"/>`;
    case 'aquiline': return `<path d="M${x - 0.3} 42.5 Q${x + 2.2} 46 ${x + 1.2} 49.2 Q${x} 50 ${x - 1.4} 49.4" fill="none" stroke="${c}" stroke-width="0.9" stroke-linecap="round"/>`;
    default: return `<path d="M${x} 43.5 L${x + 0.8} 48.4 Q${x} 49.8 ${x - 1.6} 49.2" fill="none" stroke="${c}" stroke-width="0.9" stroke-linecap="round"/>`;
  }
}

function mouth(a: Appearance, dx: number) {
  const x = 50 + dx, lip = '#9b4a43';
  switch (a.mouth) {
    case 'grin': return `<path d="M${x - 5} 54.4 Q${x} 59.4 ${x + 5} 54.4 Z" fill="#5a1f1b"/><path d="M${x - 4.4} 54.8 L${x + 4.4} 54.8 L${x + 3.6} 56 L${x - 3.6} 56 Z" fill="#fbfaf7"/>`;
    case 'neutral': return `<path d="M${x - 3.6} 55.2 L${x + 3.6} 55.2" stroke="${lip}" stroke-width="1.1" stroke-linecap="round"/>`;
    case 'smirk': return `<path d="M${x - 3.8} 55.4 Q${x + 0.5} 56.2 ${x + 4} 53.8" fill="none" stroke="${lip}" stroke-width="1.1" stroke-linecap="round"/>`;
    case 'laugh': return `<path d="M${x - 5} 53.8 Q${x} 61.5 ${x + 5} 53.8 Z" fill="#5a1f1b"/><path d="M${x - 3} 58 Q${x} 59.6 ${x + 3} 58 Q${x} 56.8 ${x - 3} 58" fill="#d36b6b"/>`;
    default: return `<path d="M${x - 4.2} 54.4 Q${x} 57.8 ${x + 4.2} 54.4" fill="none" stroke="${lip}" stroke-width="1.15" stroke-linecap="round"/>`;
  }
}

function facialHair(a: Appearance, dx: number, hair: string) {
  const x = 50 + dx;
  switch (a.facialHair) {
    case 'stubble': return `<path d="M35 50 Q37 64 50 65.5 Q63 64 65 50 Q60 58 50 58.5 Q40 58 35 50 Z" fill="${hair}" opacity="0.22"/>`;
    case 'mustache': return `<path d="M${x - 5.5} 53.2 Q${x - 2.5} 50.6 ${x} 52 Q${x + 2.5} 50.6 ${x + 5.5} 53.2 Q${x} 53.6 ${x - 5.5} 53.2 Z" fill="${hair}"/>`;
    case 'handlebar': return `<path d="M${x - 8} 51.2 Q${x - 7} 54.2 ${x - 4} 53.2 Q${x - 2} 50.8 ${x} 52 Q${x + 2} 50.8 ${x + 4} 53.2 Q${x + 7} 54.2 ${x + 8} 51.2 Q${x + 6.5} 53 ${x + 4} 51.6 Q${x} 50 ${x - 4} 51.6 Q${x - 6.5} 53 ${x - 8} 51.2 Z" fill="${hair}"/>`;
    case 'goatee': return `<path d="M${x - 5} 53.2 Q${x} 51 ${x + 5} 53.2 Q${x} 53.8 ${x - 5} 53.2 Z M${x - 3.2} 58 Q${x} 57 ${x + 3.2} 58 L${x + 2.4} 63.6 Q${x} 65 ${x - 2.4} 63.6 Z" fill="${hair}"/>`;
    case 'full': return `<path d="M33.5 44 Q33 62 50 66.5 Q67 62 66.5 44 L64 46 Q63 52 57 53 Q50 51 43 53 Q37 52 36 46 Z" fill="${hair}"/><path d="M${x - 4} 56 Q${x} 58.4 ${x + 4} 56" fill="none" stroke="#9b4a43" stroke-width="1"/>`;
    case 'chin-strap': return `<path d="M33.6 44 Q34 62 50 66 Q66 62 66.4 44 L65 44 Q64 60 50 63.6 Q36 60 35 44 Z" fill="${hair}"/>`;
    default: return '';
  }
}

/** Hair drawn behind the head (long styles). */
function hairBack(a: Appearance, c: string) {
  switch (a.hair) {
    case 'long': return `<path d="M30 40 Q29 20 50 19 Q71 20 70 40 L72 76 Q60 80 50 79 Q40 80 28 76 Z" fill="${c}"/>`;
    case 'bob': return `<path d="M30.5 42 Q29 20 50 19.5 Q71 20 69.5 42 L70 60 Q60 63 50 62 Q40 63 30 60 Z" fill="${c}"/>`;
    case 'braids': return `<g fill="${c}"><path d="M31 40 Q30 21 50 20 Q70 21 69 40 L66 46 L34 46 Z"/>${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="31.5" cy="${50 + i * 5.2}" rx="3" ry="3.2"/><ellipse cx="68.5" cy="${50 + i * 5.2}" rx="3" ry="3.2"/>`).join('')}</g>`;
    case 'ponytail': return `<path d="M64 30 Q78 34 74 56 Q72 66 66 70 Q70 54 63 40 Z" fill="${c}"/>`;
    case 'afro': return `<circle cx="50" cy="34" r="25" fill="${c}"/>`;
    case 'bun': return `<circle cx="50" cy="17.5" r="7" fill="${c}"/>`;
    default: return '';
  }
}

/** Hair drawn over the forehead. */
function hairFront(a: Appearance, c: string, dx: number) {
  const hi = shade(c, 0.18);
  switch (a.hair) {
    case 'bald': return `<ellipse cx="${45 + dx}" cy="28" rx="5" ry="2.2" fill="#fff" opacity="0.14"/>`;
    case 'buzz': return `<path d="M33 38 Q32 22 50 22 Q68 22 67 38 Q64 28 50 27.5 Q36 28 33 38 Z" fill="${c}" opacity="0.55"/>`;
    case 'short': return `<path d="M32.4 40 Q30 19 50 19.5 Q70 19 67.6 40 Q66 30 60 28 Q50 31 42 28.5 Q35 30 32.4 40 Z" fill="${c}"/>`;
    case 'side-part': return `<path d="M32.4 41 Q30 19 50 19 Q70 19 67.6 41 Q66 31 62 28 Q48 33 38 30 Q34 34 32.4 41 Z" fill="${c}"/><path d="M41 21.5 Q40 26 38.6 30" stroke="${hi}" stroke-width="0.8" fill="none"/>`;
    case 'slick': return `<path d="M32.6 38 Q31 20 50 20 Q69 20 67.4 38 Q65 27 50 26 Q35 27 32.6 38 Z" fill="${c}"/><path d="M38 23.5 Q50 21 62 23.5" stroke="${hi}" stroke-width="0.9" fill="none"/>`;
    case 'curly': return `<g fill="${c}">${[[34, 34], [36, 27], [42, 22.5], [50, 21], [58, 22.5], [64, 27], [66, 34], [46, 26], [54, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5"/>`).join('')}</g>`;
    case 'afro': return `<path d="M30 40 Q28 24 50 23 Q72 24 70 40 Q66 30 50 30 Q34 30 30 40 Z" fill="${c}"/>`;
    case 'bob': return `<path d="M32 42 Q30 19.5 50 19.5 Q70 19.5 68 42 Q66 32 64 31 Q52 34 40 31 Q35 32 32 42 Z" fill="${c}"/>`;
    case 'long': case 'ponytail': case 'bun': case 'braids':
      return `<path d="M32.4 41 Q30 19 50 19.5 Q70 19 67.6 41 Q65 30 57 28 Q50 30 43 28 Q35 30 32.4 41 Z" fill="${c}"/>`;
    case 'waves': return `<path d="M32.4 40 Q30 19 50 19.5 Q70 19 67.6 40 Q66 33 63 31 Q60 28 57 31 Q53 27 49 30.5 Q45 27 41 30.5 Q37 28 35 32 Q33 35 32.4 40 Z" fill="${c}"/>`;
    case 'mohawk': return `<path d="M45 32 Q44 16 50 11 Q56 16 55 32 Q50 30 45 32 Z" fill="${c}"/><path d="M33 38 Q32 26 45 24 L45 30 Q37 31 33 38 Z M67 38 Q68 26 55 24 L55 30 Q63 31 67 38 Z" fill="${c}" opacity="0.4"/>`;
    default: return '';
  }
}

function ears(skin: string, it: Item | undefined) {
  const e = `<ellipse cx="32.4" cy="45" rx="2.6" ry="4" fill="${skin}" stroke="${shade(skin, -0.25)}" stroke-width="0.6"/><ellipse cx="67.6" cy="45" rx="2.6" ry="4" fill="${skin}" stroke="${shade(skin, -0.25)}" stroke-width="0.6"/>`;
  if (!it) return e;
  const c = safeColor(it.look.a, '#d4af37');
  const j = it.look.kind === 'hoops'
    ? `<circle cx="32.2" cy="51" r="2.4" fill="none" stroke="${c}" stroke-width="0.9"/><circle cx="67.8" cy="51" r="2.4" fill="none" stroke="${c}" stroke-width="0.9"/>`
    : `<circle cx="32.2" cy="48.6" r="0.95" fill="${c}"/><circle cx="67.8" cy="48.6" r="0.95" fill="${c}"/>`;
  return e + j;
}

function eyewear(it: Item | undefined, dx: number) {
  if (!it) return '';
  const a = safeColor(it.look.a, '#222'), b = safeColor(it.look.b, '#2b2b2b');
  const L = 43 + dx, R = 57 + dx;
  switch (it.look.kind) {
    case 'round': return `<g fill="none" stroke="${a}" stroke-width="0.9"><circle cx="${L}" cy="42.6" r="4"/><circle cx="${R}" cy="42.6" r="4"/><path d="M${L + 4} 42 Q50 40.6 ${R - 4} 42 M${L - 4} 42 L33 41 M${R + 4} 42 L67 41"/></g>`;
    case 'half': return `<g fill="none" stroke="${a}" stroke-width="1"><path d="M${L - 4} 43.4 Q${L} 47.6 ${L + 4} 43.4 Z M${R - 4} 43.4 Q${R} 47.6 ${R + 4} 43.4 Z M${L + 4} 43.4 L${R - 4} 43.4"/></g>`;
    case 'aviator': return `<g><path d="M${L - 4.6} 40.4 L${L + 4.4} 40.4 Q${L + 4.4} 47.4 ${L} 47 Q${L - 4.6} 46.6 ${L - 4.6} 40.4 Z M${R - 4.4} 40.4 L${R + 4.6} 40.4 Q${R + 4.6} 46.6 ${R} 47 Q${R - 4.4} 47.4 ${R - 4.4} 40.4 Z" fill="${b}" opacity="0.88" stroke="${a}" stroke-width="0.9"/><path d="M${L + 4.4} 40.8 L${R - 4.4} 40.8 M${L - 4.6} 40.6 L33 40 M${R + 4.6} 40.6 L67 40" stroke="${a}" stroke-width="0.9"/><path d="M${L - 2.6} 41.6 L${L - 0.6} 41.6" stroke="#fff" opacity="0.5" stroke-width="0.7"/></g>`;
    case 'wayfarer': return `<g><path d="M${L - 5} 39.6 L${L + 4.6} 39.6 L${L + 3.8} 45.8 Q${L} 46.8 ${L - 4.2} 45.8 Z M${R - 4.6} 39.6 L${R + 5} 39.6 L${R + 4.2} 45.8 Q${R} 46.8 ${R - 3.8} 45.8 Z" fill="${a}" stroke="${b}" stroke-width="0.8"/><path d="M${L + 4.6} 40.6 L${R - 4.6} 40.6 M${L - 5} 40 L33 39.6 M${R + 5} 40 L67 39.6" stroke="${b}" stroke-width="1"/></g>`;
    default: return '';
  }
}

function hat(it: Item | undefined, dx: number) {
  if (!it) return '';
  const a = safeColor(it.look.a, '#1b1b1f'), b = safeColor(it.look.b, shade(a, -0.35));
  const x = 50 + dx * 0.6;
  switch (it.look.kind) {
    case 'fedora': return `<g><ellipse cx="${x}" cy="27.5" rx="27" ry="5" fill="${shade(a, -0.15)}"/><path d="M${x - 15} 27 Q${x - 16} 12 ${x - 6} 9.5 Q${x} 13 ${x + 6} 9.5 Q${x + 16} 12 ${x + 15} 27 Z" fill="${a}"/><path d="M${x - 15} 23.5 L${x + 15} 23.5 L${x + 15} 27 L${x - 15} 27 Z" fill="${b}"/></g>`;
    case 'cowboy': return `<g><path d="M${x - 31} 24 Q${x - 26} 32 ${x} 30.5 Q${x + 26} 32 ${x + 31} 24 Q${x + 22} 28 ${x} 27 Q${x - 22} 28 ${x - 31} 24 Z" fill="${shade(a, -0.12)}"/><path d="M${x - 14} 28 Q${x - 16} 10 ${x - 7} 9 Q${x} 13 ${x + 7} 9 Q${x + 16} 10 ${x + 14} 28 Z" fill="${a}"/><path d="M${x - 14.6} 24.6 L${x + 14.6} 24.6 L${x + 14.2} 27.6 L${x - 14.2} 27.6 Z" fill="${shade(a, -0.4)}"/></g>`;
    case 'cap': return `<g><path d="M${x - 17.5} 30 Q${x - 18} 14 ${x} 13.5 Q${x + 18} 14 ${x + 17.5} 30 Z" fill="${a}"/><path d="M${x - 17.5} 30 Q${x - 26} 30 ${x - 30} 33 Q${x - 20} 34.5 ${x - 12} 31 Z" fill="${shade(a, -0.25)}"/>${it.look.b ? `<path d="M${x} 18 L${x + 3} 22 L${x} 26 L${x - 3} 22 Z" fill="${b}"/>` : ''}<circle cx="${x}" cy="14" r="1.2" fill="${shade(a, -0.3)}"/></g>`;
    case 'visor': return `<g><path d="M${x - 18} 29 Q${x} 24 ${x + 18} 29 L${x + 18} 31.5 Q${x} 27 ${x - 18} 31.5 Z" fill="${shade(a, -0.3)}"/><path d="M${x - 20} 31 Q${x} 25 ${x + 20} 31 Q${x + 10} 38 ${x} 37.6 Q${x - 10} 38 ${x - 20} 31 Z" fill="${a}" opacity="0.78"/></g>`;
    default: return '';
  }
}

// ------------------------------------------------------------------ torso
function torso(a: Appearance, eq: Equipped, skin: string) {
  const broad = a.body === 'broad';
  const sw = broad ? 34 : 28;              // half shoulder width
  const outfit = item(eq, 'outfit');
  const kind = outfit?.look.kind ?? 'tee';
  const c = safeColor(outfit?.look.a, '#3a3d42'), c2 = safeColor(outfit?.look.b, '#f4f1ea'), c3 = safeColor(outfit?.look.c, shade(c, 0.1));
  const shoulders = (fill: string) => `<path d="M${50 - sw} 101 L${50 - sw} 84 Q${50 - sw} 72 ${50 - sw + 12} 70 L${50 + sw - 12} 70 Q${50 + sw} 72 ${50 + sw} 84 L${50 + sw} 101 Z" fill="${fill}"/>`;
  const neck = `<path d="M44 58 L44 71 Q50 75 56 71 L56 58 Z" fill="${shade(skin, -0.1)}"/>`;
  const parts: string[] = [neck];
  const collar = (col: string) => `<path d="M43 69 L50 77 L44.5 80 L40.5 71 Z M57 69 L50 77 L55.5 80 L59.5 71 Z" fill="${col}" stroke="${shade(col, -0.2)}" stroke-width="0.4"/>`;
  const lapels = (jacket: string, shirt: string, satin?: string) =>
    `${shoulders(jacket)}<path d="M43 69.5 L50 79 L57 69.5 L57 101 L43 101 Z" fill="${shirt}"/>`
    + `<path d="M42.6 69.5 L50 88 L44 101 L36 101 L38 84 L40.5 78 L38 74.5 Z M57.4 69.5 L50 88 L56 101 L64 101 L62 84 L59.5 78 L62 74.5 Z" fill="${satin ?? shade(jacket, -0.12)}"/>`;
  switch (kind) {
    case 'polo': parts.push(shoulders(c), `<path d="M47.5 72 L52.5 72 L52 84 L48 84 Z" fill="${shade(c, -0.12)}"/><circle cx="50" cy="76" r="0.6" fill="#fff"/><circle cx="50" cy="80" r="0.6" fill="#fff"/>`, collar(shade(c, 0.05))); break;
    case 'shirt': parts.push(shoulders(c), `<path d="M50 77 L50 101" stroke="${shade(c, -0.15)}" stroke-width="0.6"/>${[83, 89, 95].map((y) => `<circle cx="50" cy="${y}" r="0.6" fill="${shade(c, -0.3)}"/>`).join('')}`, collar(c)); break;
    case 'dress': case 'gown': {
      parts.push(`<path d="M${50 - sw} 101 L${50 - sw} 84 Q${50 - sw} 72 ${50 - sw + 12} 70 L${50 + sw - 12} 70 Q${50 + sw} 72 ${50 + sw} 84 L${50 + sw} 101 Z" fill="${shade(skin, -0.05)}"/>`);
      parts.push(kind === 'gown'
        ? `<path d="M${50 - sw + 4} 101 L${50 - sw + 6} 82 Q50 90 ${50 + sw - 6} 82 L${50 + sw - 4} 101 Z" fill="${c}"/><path d="M${50 - sw + 6} 82 L${50 - sw + 9} 70 L${50 - sw + 11} 70 L${50 - sw + 9.4} 83 Z M${50 + sw - 6} 82 L${50 + sw - 9} 70 L${50 + sw - 11} 70 L${50 + sw - 9.4} 83 Z" fill="${c}"/>`
        : `<path d="M${50 - sw + 3} 101 L${50 - sw + 4} 80 Q50 86 ${50 + sw - 4} 80 L${50 + sw - 3} 101 Z" fill="${c}"/><path d="M${50 - sw + 5} 81 L${50 - sw + 10} 70.4 M${50 + sw - 5} 81 L${50 + sw - 10} 70.4" stroke="${c}" stroke-width="1.6"/>`);
      break;
    }
    case 'blazer': case 'suit': parts.push(lapels(c, c2), collar(c2), `<circle cx="47" cy="94" r="0.9" fill="${shade(c, -0.4)}"/>`); break;
    case 'suit3': parts.push(lapels(c, c2), `<path d="M44.5 80 L50 86 L55.5 80 L56.5 101 L43.5 101 Z" fill="${c3}"/>${[88, 93, 98].map((y) => `<circle cx="50" cy="${y}" r="0.7" fill="${shade(c3, -0.45)}"/>`).join('')}`, collar(c2),
      `<path d="M${50 - sw + 3} 88 L${50 - sw + 3} 101 M${50 - sw + 7} 76 L${50 - sw + 7} 101 M${50 + sw - 3} 88 L${50 + sw - 3} 101 M${50 + sw - 7} 76 L${50 + sw - 7} 101" stroke="${shade(c, 0.2)}" stroke-width="0.3"/>`); break;
    case 'tux': parts.push(lapels(c, c2, c === '#141418' ? '#2a2a32' : shade(c, -0.06)), collar(c2), `${[86, 91, 96].map((y) => `<circle cx="50" cy="${y}" r="0.6" fill="#1b1b1f"/>`).join('')}`); break;
    case 'smoking': parts.push(lapels(c, c2, c2), collar('#f4f1ea'), `<path d="M${50 - sw + 4} 99 L${50 - sw + 12} 99" stroke="${c2}" stroke-width="1"/><path d="M${50 + sw - 12} 99 L${50 + sw - 4} 99" stroke="${c2}" stroke-width="1"/>`); break;
    case 'vest': parts.push(shoulders(c2), collar(c2), `<path d="M${50 - sw + 8} 101 L${50 - sw + 9} 76 L44 72 L50 84 L56 72 L${50 + sw - 9} 76 L${50 + sw - 8} 101 Z" fill="${c}"/>${[89, 94, 99].map((y) => `<circle cx="50" cy="${y}" r="0.7" fill="${shade(c, -0.45)}"/>`).join('')}`); break;
    default: parts.push(shoulders(c), `<path d="M44 70 Q50 77 56 70" fill="none" stroke="${shade(c, -0.25)}" stroke-width="1.2"/>`);
  }
  return parts.join('');
}

function necklace(it: Item | undefined) {
  if (!it) return '';
  const c = safeColor(it.look.a, '#d4af37');
  if (it.look.kind === 'pearls') return `<g fill="${c}" stroke="${shade(c, -0.2)}" stroke-width="0.25">${Array.from({ length: 11 }, (_, i) => { const t = (i / 10) * Math.PI; return `<circle cx="${(50 - 9 * Math.cos(t)).toFixed(2)}" cy="${(70 + 6 * Math.sin(t)).toFixed(2)}" r="1.1"/>`; }).join('')}</g>`;
  return `<path d="M41.5 70 Q50 79 58.5 70" fill="none" stroke="${c}" stroke-width="1.1" stroke-dasharray="1 0.4"/>`;
}

function neckwear(it: Item | undefined) {
  if (!it) return '';
  const a = safeColor(it.look.a, '#141418'), b = safeColor(it.look.b, '#c9a45c');
  switch (it.look.kind) {
    case 'tie': return `<path d="M48.4 76.5 L51.6 76.5 L52.4 79 L50 80 L47.6 79 Z" fill="${shade(a, -0.15)}"/><path d="M48.2 79.4 L51.8 79.4 L53.6 97 L50 101 L46.4 97 Z" fill="${a}"/>`;
    case 'bow': return `<path d="M50 76.6 L43.4 73.4 L43.4 80.4 Z M50 76.6 L56.6 73.4 L56.6 80.4 Z" fill="${a}"/><rect x="48.6" y="75.2" width="2.8" height="2.8" rx="0.6" fill="${shade(a, -0.25)}"/>`;
    case 'scarf': return `<path d="M42 70 Q50 78 58 70 L59 73 Q50 82 41 73 Z" fill="${a}"/><path d="M52 76 L56 92 L52 93 L50 78 Z" fill="${b}"/>`;
    case 'bolo': return `<path d="M47 75 L48 99 M53 75 L52 99" stroke="#3b2417" stroke-width="0.7"/><ellipse cx="50" cy="80" rx="2.2" ry="2.8" fill="${a}" stroke="#c0c6cc" stroke-width="0.8"/>`;
    default: return '';
  }
}

function lapel(it: Item | undefined, broad: boolean) {
  if (!it) return '';
  const x = broad ? 61 : 58.5, a = safeColor(it.look.a, '#f4f1ea');
  switch (it.look.kind) {
    case 'square': return `<path d="M${x - 2.6} 87 L${x + 3} 87 L${x + 3} 89 L${x - 2.6} 89 Z" fill="${shade(a, -0.1)}"/><path d="M${x - 2} 87 L${x - 0.6} 84.4 L${x + 0.6} 86.2 L${x + 1.8} 84.2 L${x + 2.6} 87 Z" fill="${a}"/>`;
    case 'pin': return `<path d="M${x - 4} 80.6 Q${x - 4} 78.4 ${x - 2.4} 78 Q${x - 1} 79 ${x - 1} 80.6 L${x - 2.5} 83 Z" fill="${a}" transform="rotate(-8 ${x - 2.5} 80)"/>`;
    case 'chippin': return `<circle cx="${x - 2}" cy="81" r="2.6" fill="${a}" stroke="#fff" stroke-width="0.9" stroke-dasharray="1.2 1"/><circle cx="${x - 2}" cy="81" r="1.2" fill="#fff" opacity="0.8"/>`;
    default: return '';
  }
}

function watch(it: Item | undefined, outfitColor: string, skin: string) {
  if (!it) return '';
  const a = safeColor(it.look.a, '#c0c6cc');
  if (it.look.kind === 'pocketwatch') return `<path d="M40 92 Q46 97 54 93" fill="none" stroke="${a}" stroke-width="0.8"/><circle cx="54.6" cy="93" r="1.8" fill="${a}" stroke="${shade(a, -0.3)}" stroke-width="0.4"/>`;
  // A forearm resting across the lower edge, watch on the wrist.
  return `<g><path d="M52 101 Q55 90 65 85.6 L68 91 Q60 94 59 101 Z" fill="${shade(outfitColor, -0.18)}" stroke="${shade(outfitColor, -0.4)}" stroke-width="0.4"/><path d="M65.6 85.4 Q70 81.6 74.6 82.4 Q76.6 84.6 74 87.6 Q71 90 68 90.6 Z" fill="${skin}" stroke="${shade(skin, -0.25)}" stroke-width="0.5"/>`
    + `<rect x="64.6" y="85" width="3.4" height="6.4" rx="0.8" fill="${shade(a, -0.2)}" transform="rotate(-35 66.3 88.2)"/><circle cx="66.3" cy="88.2" r="2.1" fill="${a}" stroke="${shade(a, -0.35)}" stroke-width="0.4"/><circle cx="66.3" cy="88.2" r="1.2" fill="#fbfaf7" opacity="0.8"/>`
    + (it.look.b ? `<circle cx="66.3" cy="88.2" r="2.6" fill="none" stroke="${safeColor(it.look.b, '#bfe3ff')}" stroke-width="0.7" stroke-dasharray="0.5 0.5"/>` : '') + `</g>`;
}

function background(it: Item | undefined, gid: string) {
  const a = safeColor(it?.look.a, '#145a3e'), b = safeColor(it?.look.b, '#0b3b28');
  const grad = `<defs><radialGradient id="${gid}bg" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs><rect width="100" height="100" fill="url(#${gid}bg)"/>`;
  switch (it?.look.kind) {
    case 'strip': return grad + `<g opacity="0.55">${[[12, 70, 8], [24, 58, 6], [80, 64, 7], [90, 52, 5]].map(([x, h, w]) => `<rect x="${x}" y="${100 - h}" width="${w}" height="${h}" fill="#140a24"/><rect x="${x + 1}" y="${100 - h + 3}" width="${w - 2}" height="1.4" fill="${b}"/>`).join('')}</g>`;
    case 'marquee': return grad + `<g fill="${b}">${Array.from({ length: 12 }, (_, i) => `<circle cx="${6 + i * 8}" cy="8" r="1.6"/><circle cx="${6 + i * 8}" cy="92" r="1.6" opacity="0.7"/>`).join('')}</g>`;
    case 'desert': return `<defs><linearGradient id="${gid}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b}"/><stop offset="0.65" stop-color="${a}"/><stop offset="1" stop-color="#f2c27a"/></linearGradient></defs><rect width="100" height="100" fill="url(#${gid}bg)"/><circle cx="70" cy="62" r="12" fill="#ffd27a" opacity="0.7"/><path d="M0 78 L20 70 L34 76 L58 66 L80 74 L100 68 L100 100 L0 100 Z" fill="#5a2a2a" opacity="0.6"/>`;
    default: return grad;
  }
}

function frame(it: Item | undefined, gid: string) {
  if (!it) return '';
  const a = safeColor(it.look.a, '#c9a45c'), b = safeColor(it.look.b, '#fff2c4');
  const ring = (w: number, c: string, extra = '') => `<circle cx="50" cy="50" r="${48.5 - w / 2}" fill="none" stroke="${c}" stroke-width="${w}" ${extra}/>`;
  const around = (n: number, f: (x: number, y: number, deg: number, i: number) => string, r = 46.5) =>
    Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2 - Math.PI / 2; return f(50 + r * Math.cos(t), 50 + r * Math.sin(t), (t * 180) / Math.PI + 90, i); }).join('');
  switch (it.look.kind) {
    case 'ring': return ring(3.2, a) + ring(0.6, shade(a, 0.4));
    case 'ring2': return ring(3.6, a) + `<circle cx="50" cy="50" r="44.6" fill="none" stroke="${b}" stroke-width="1"/>`;
    case 'deco': return ring(3, a) + around(24, (x, y, d) => `<rect x="${(x - 0.7).toFixed(2)}" y="${(y - 2.4).toFixed(2)}" width="1.4" height="4.8" fill="${a}" transform="rotate(${d.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})"/>`, 45);
    case 'diamond': return ring(2.4, '#c0c6cc') + around(20, (x, y) => `<path d="M${x.toFixed(2)} ${(y - 1.9).toFixed(2)} l1.5 1.9 l-1.5 1.9 l-1.5 -1.9 Z" fill="${a}" stroke="#9fd0f0" stroke-width="0.3"/>`, 47.2);
    case 'animated': return `<defs><linearGradient id="${gid}fr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.5" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>`
      + ring(3.6, `url(#${gid}fr)`) + `<circle class="fx-spin" cx="50" cy="50" r="46.7" fill="none" stroke="${b}" stroke-width="1.6" stroke-dasharray="10 136" stroke-linecap="round"/>`;
    case 'royal': return ring(3, a) + `<g class="fx-spin">${around(5, (x, y, d, i) => `<g transform="rotate(${d.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})"><rect x="${(x - 3).toFixed(2)}" y="${(y - 4).toFixed(2)}" width="6" height="8" rx="0.8" fill="#fbfaf7" stroke="${a}" stroke-width="0.5"/><text x="${x.toFixed(2)}" y="${(y + 1.3).toFixed(2)}" font-size="3.6" text-anchor="middle" font-family="Georgia,serif" font-weight="700" fill="#141418">${['10', 'J', 'Q', 'K', 'A'][i]}</text></g>`, 46.2)}</g>`;
    case 'marquee': return ring(3.6, '#5a3520') + `<g class="fx-blink">${around(22, (x, y) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.15" fill="${a}"/>`, 46.7)}</g>`;
    case 'wanted': return `<path d="M2 2 H98 V98 H2 Z M7 7 V93 H93 V7 Z" fill="${a}" fill-rule="evenodd"/><path d="M2 2 H98 V98 H2 Z" fill="none" stroke="#6a4026" stroke-width="1"/>`;
    case 'rope': return ring(3.6, a) + ring(3.6, b, 'stroke-dasharray="2.4 2.4"');
    default: return '';
  }
}

// ------------------------------------------------------------------ public API
/** Render an avatar portrait as an SVG string. Unknown or invalid input falls back to defaults. */
export function renderAvatar(look: { appearance?: unknown; equipped?: unknown } | null | undefined, opts: RenderOpts = {}): string {
  const a = parseAppearance(look?.appearance) ?? DEFAULT_APPEARANCE;
  const eq = cleanEquipped(look?.equipped);
  const gid = `av${opts.id ?? (++uid).toString(36)}`;
  const pose = opts.pose ?? 'front';
  const dx = pose === 'left' ? -2.2 : pose === 'right' ? 2.2 : 0;
  const tilt = pose === 'left' ? -4 : pose === 'right' ? 4 : 0;
  const skin = SKIN[a.skin] ?? SKIN[2];
  const hairC = HAIR_COLOR[a.hairColor] ?? HAIR_COLOR[1];
  const outfit = item(eq, 'outfit');
  const hatIt = item(eq, 'hat');
  const body = [
    opts.background === false ? '' : background(item(eq, 'background'), gid),
    hairBack(a, hairC),
    torso(a, eq, skin),
    necklace(item(eq, 'necklace')),
    neckwear(item(eq, 'neckwear')),
    lapel(item(eq, 'lapel'), a.body === 'broad'),
    `<g transform="rotate(${tilt} 50 60)">`,
    ears(skin, item(eq, 'earrings')),
    faceShape(a.face, skin),
    `<ellipse cx="${41 + dx}" cy="50" rx="3" ry="1.8" fill="#e88" opacity="0.16"/><ellipse cx="${59 + dx}" cy="50" rx="3" ry="1.8" fill="#e88" opacity="0.16"/>`,
    eyes(a, dx), brows(a, dx, hairC), nose(a, dx, skin), facialHair(a, dx, hairC), mouth(a, dx),
    eyewear(item(eq, 'eyewear'), dx),
    hatIt && (a.hair === 'afro' || a.hair === 'mohawk') ? '' : hairFront(a, hairC, dx),
    hat(hatIt, dx),
    `</g>`,
    watch(item(eq, 'watch'), safeColor(outfit?.look.a, '#3a3d42'), skin),
  ].join('');
  const fr = opts.frame === false ? '' : frame(item(eq, 'frame'), gid);
  const square = item(eq, 'frame')?.look.kind === 'wanted';
  const clip = square ? `<rect x="5" y="5" width="90" height="90"/>` : `<circle cx="50" cy="50" r="${fr ? 45.5 : 50}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${opts.crop ? CROP[opts.crop] : '0 0 100 100'}" class="av-svg" aria-hidden="true"><defs><clipPath id="${gid}c">${clip}</clipPath></defs><g clip-path="url(#${gid}c)">${body}</g>${fr}</svg>`;
}

/** Small item preview used by the Boutique: the item worn by a neutral mannequin, or a swatch for non-wearables. */
export function renderItemPreview(itemId: string, base?: { appearance?: unknown; equipped?: unknown }): string {
  const it = ITEM.get(itemId);
  if (!it) return '';
  const gid = `ip${(++uid).toString(36)}`;
  if (it.slot === 'chips') {
    const c = CHIP_SKINS[it.look.kind] ?? CHIP_SKINS.classic;
    return `<svg viewBox="0 0 100 100" class="av-svg" aria-hidden="true">${[[30, 60, 0], [50, 40, 1], [70, 60, 2]].map(([x, y, i]) => chipSvg(x, y, c[i])).join('')}</svg>`;
  }
  if (it.slot === 'cardBack') {
    const a = safeColor(it.look.a, '#1d3c7a'), b = safeColor(it.look.b, '#0f2350');
    return `<svg viewBox="0 0 100 100" class="av-svg" aria-hidden="true"><defs><pattern id="${gid}p" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${b}"/><rect width="4" height="8" fill="${a}"/></pattern></defs>`
      + `<rect x="24" y="14" width="40" height="60" rx="4" fill="url(#${gid}p)" stroke="#fbfaf7" stroke-width="2.4" transform="rotate(-8 44 44)"/><rect x="38" y="24" width="40" height="60" rx="4" fill="url(#${gid}p)" stroke="#fbfaf7" stroke-width="2.4" transform="rotate(6 58 54)"/></svg>`;
  }
  if (it.slot === 'emotes' || it.slot === 'victory') {
    return `<svg viewBox="0 0 100 100" class="av-svg" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="#13442f"/><text x="50" y="60" font-size="28" text-anchor="middle" fill="#e6c77a" font-family="Georgia,serif">${it.slot === 'emotes' ? '“!”' : '★'}</text></svg>`;
  }
  const look = { appearance: base?.appearance, equipped: { ...cleanEquipped(base?.equipped), [it.slot]: it.id } };
  if ((it.needsCollar || it.needsJacket) && !ITEM.get(look.equipped.outfit ?? '')?.jacket) look.equipped.outfit = 'blazer-grey';
  return renderAvatar(look, { frame: it.slot === 'frame' });
}

/** Chip colors per skin: [ $5-ish, $25-ish, $100-ish ] main + edge. Values never change. */
export const CHIP_SKINS: Record<string, [string, string][]> = {
  classic: [['#c0392b', '#fff'], ['#1e8449', '#fff'], ['#1b1b1f', '#fff']],
  ivory: [['#e8dcc2', '#8b2534'], ['#e8dcc2', '#1f6b4a'], ['#e8dcc2', '#1b1b1f']],
  blackgold: [['#1b1b1f', '#d4af37'], ['#2a2a30', '#d4af37'], ['#111', '#f3d77a']],
  highroller: [['#f3eee4', '#c9a45c'], ['#6a3f99', '#f3eee4'], ['#141418', '#c9a45c']],
  midnight: [['#1b2a4a', '#c0c6cc'], ['#22355e', '#e8e8f0'], ['#0d1426', '#c0c6cc']],
  emerald: [['#13664a', '#d4af37'], ['#1f7b58', '#f3d77a'], ['#0b3b28', '#d4af37']],
  saloon: [['#8a5236', '#e8d6a8'], ['#5a3520', '#e3c48e'], ['#3b2417', '#d9b26d']],
};
const chipSvg = (x: number, y: number, [m, e]: [string, string]) =>
  `<g><circle cx="${x}" cy="${y}" r="17" fill="${m}" stroke="${shade(m, -0.35)}" stroke-width="1"/><circle cx="${x}" cy="${y}" r="13.5" fill="none" stroke="${e}" stroke-width="4" stroke-dasharray="4.2 2.9"/><circle cx="${x}" cy="${y}" r="8" fill="${shade(m, 0.1)}" stroke="${e}" stroke-width="0.8"/></g>`;
