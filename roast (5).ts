// §32 Dealer banter in the browser. The server picks a line; this file shows it within THIS viewer's limits:
// mute, maximum intensity, profanity filter, subtitles and optional speech. Nothing here is sent anywhere except
// the player's own consent (personal targeting + max intensity), which the server needs to decide who it may roast.
import type { ChatMessage } from '../shared/protocol.js';
import { viewRoast, type Shown } from '../shared/roast/view.js';
import { prefs, type RoastPrefs } from './settings.js';

type Lib = typeof import('../shared/roast/library.js');
let lib: Lib | null = null;
let loading: Promise<Lib> | null = null;
/** The dialogue library is a separate chunk, loaded when a table opens. */
export function loadRoastLibrary(): Promise<Lib> {
  return lib ? Promise.resolve(lib) : (loading ??= import('../shared/roast/library.js').then((m) => (lib = m)));
}

export type { Shown } from '../shared/roast/view.js';

/** What this viewer sees for a dealer message (null = hidden because they muted the dealer). */
export function showRoast(m: ChatMessage, p: RoastPrefs = prefs.get().roast): Shown | null {
  if (!m.roast) return null;
  if (!lib) return p.mute ? null : { text: m.text, major: false, meltdown: false, style: 'normal', dealer: m.roast.dealer, lineId: null };
  return viewRoast(m.roast, m.text, p, lib);
}

/** Optional spoken dialogue through the browser's own speech synthesis. Silently does nothing when unavailable. */
export function speak(s: Shown, p: RoastPrefs = prefs.get().roast) {
  try {
    if (!p.speech || !lib || typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return false;
    const u = new SpeechSynthesisUtterance(s.text);
    const v = lib.VOICE[s.dealer as keyof typeof lib.VOICE] ?? { rate: 1, pitch: 1 };
    u.rate = v.rate * (s.style === 'rant' ? 1.12 : s.style === 'shout' ? 1.06 : 1);
    u.pitch = v.pitch;
    u.volume = Math.max(0, Math.min(1, p.volume / 100));
    if (s.style !== 'rant') speechSynthesis.cancel();      // short lines replace each other; a meltdown plays out
    speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}
