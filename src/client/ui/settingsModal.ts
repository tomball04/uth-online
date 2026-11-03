import type { TableView } from '../../shared/protocol.js';
import { h, modal, toast } from '../dom.js';
import { call } from '../net.js';
import { prefs, type Prefs } from '../settings.js';
import { unlockAudio } from '../sound.js';

export function openSettings(opts: { inTable?: boolean; view?: () => TableView | null } = {}) {
  const p = prefs.get();
  const range = (key: 'fxVolume' | 'ambientVolume', label: string) => h('label', {}, label,
    h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: p[key], oninput: (e: Event) => { unlockAudio(); prefs.set({ [key]: Number((e.target as HTMLInputElement).value) } as Partial<Prefs>); } }));
  const radio = <K extends 'motion' | 'trainer'>(key: K, label: string, options: [Prefs[K], string, string][]) =>
    h('fieldset', {}, h('legend', {}, label), ...options.map(([v, l, d]) =>
      h('label', { class: 'radio' }, h('input', { type: 'radio', name: key, value: v, checked: p[key] === v, onchange: () => prefs.set({ [key]: v } as Partial<Prefs>) }),
        h('span', {}, h('b', {}, l), h('small', {}, d)))));

  const v = opts.view?.();
  const seated = !!v && v.you.seat !== null;
  const tablePrefs = seated ? h('fieldset', {}, h('legend', {}, 'At this table'),
    h('label', { class: 'radio' }, h('input', { type: 'checkbox', checked: v!.you.timeoutPolicy === 'strategy', onchange: async (e: Event) => {
      const r = await call('player:prefs', { timeoutPolicy: (e.target as HTMLInputElement).checked ? 'strategy' : 'default' });
      if (!r.ok) toast(r.error, 'error');
    } }), h('span', {}, h('b', {}, 'If my timer runs out, play basic strategy'), h('small', {}, 'Otherwise the table checks for you, then folds on the river.'))),
    h('label', { class: 'radio' }, h('input', { type: 'checkbox', checked: v!.seats[v!.you.seat!]?.status === 'sitting-out', onchange: async (e: Event) => {
      const r = await call('player:prefs', { sitOut: (e.target as HTMLInputElement).checked });
      if (!r.ok) toast(r.error, 'error');
    } }), h('span', {}, h('b', {}, 'Sit out'), h('small', {}, 'Keep your seat but skip hands until you uncheck this.')))) : null;

  const body = h('div', { class: 'stack settings' },
    radio('trainer', 'Strategy trainer', [
      ['casino', 'Casino', 'No hints. Your decisions are still recorded in your statistics.'],
      ['training', 'Training', 'See the recommended play and why, before you act.'],
      ['challenge', 'Challenge', 'No hints during the hand; every decision is graded afterwards.'],
    ]),
    h('fieldset', {}, h('legend', {}, 'Sound'), range('fxVolume', 'Effects'), range('ambientVolume', 'Casino ambience')),
    radio('motion', 'Animation', [
      ['full', 'Full', 'Dealt cards, chip movement and reveals.'],
      ['fast', 'Fast play', 'The same animations at about twice the speed.'],
      ['off', 'Reduced motion', 'Cards and chips appear without movement.'],
    ]),
    h('label', { class: 'radio' }, h('input', { type: 'checkbox', checked: p.fourColorDeck, onchange: (e: Event) => prefs.set({ fourColorDeck: (e.target as HTMLInputElement).checked }) }),
      h('span', {}, h('b', {}, 'Four-colour deck'), h('small', {}, 'Blue diamonds and green clubs, easier to read on small screens.'))),
    tablePrefs);
  modal('Settings', body);
}
