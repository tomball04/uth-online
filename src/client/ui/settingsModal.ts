import type { TableView } from '../../shared/protocol.js';
import { h, modal, toast } from '../dom.js';
import { call } from '../net.js';
import { BACKS, FELTS, prefs, type CardBack, type FeltColor, type Prefs } from '../settings.js';
import { cardEl } from '../cardView.js';
import { session } from '../api.js';
import { unlockAudio } from '../sound.js';
import { styleEvent } from '../cosmetics.js';
import { EFFECTS } from '../../shared/themes.js';

export function openSettings(opts: { inTable?: boolean; view?: () => TableView | null } = {}) {
  const p = prefs.get();
  const range = (key: 'fxVolume' | 'ambientVolume', label: string) => h('label', {}, label,
    h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: p[key], oninput: (e: Event) => { unlockAudio(); prefs.set({ [key]: Number((e.target as HTMLInputElement).value) } as Partial<Prefs>); } }));
  const radio = <K extends 'motion' | 'trainer'>(key: K, label: string, options: [Prefs[K], string, string][]) =>
    h('fieldset', {}, h('legend', {}, label), ...options.map(([v, l, d]) =>
      h('label', { class: 'radio' }, h('input', { type: 'radio', name: key, value: v, checked: p[key] === v, onchange: () => { prefs.set({ [key]: v } as Partial<Prefs>); if (key === 'trainer' && v !== 'casino') styleEvent('trainer'); } }),
        h('span', {}, h('b', {}, l), h('small', {}, d)))));

  const v = opts.view?.();
  const seated = !!v && v.you.seat !== null;
  const tablePrefs = seated ? h('fieldset', {}, h('legend', {}, 'At this table'),
    h('label', { class: 'radio' }, h('input', { type: 'checkbox', checked: v!.you.timeoutPolicy === 'strategy', onchange: async (e: Event) => {
      const r = await call('player:prefs', { timeoutPolicy: (e.target as HTMLInputElement).checked ? 'strategy' : 'default' });
      if (!r.ok) toast(r.error, 'error');
    } }), h('span', {}, h('b', {}, 'If my timer runs out, play basic strategy'), h('small', {}, 'Otherwise the table checks for you, then folds on the river.'))),
    h('label', { class: 'radio' }, h('input', { type: 'checkbox', checked: !!v!.seats[v!.you.seat!]?.sitOut, onchange: async (e: Event) => {
      const r = await call('player:prefs', { sitOut: (e.target as HTMLInputElement).checked });
      if (!r.ok) toast(r.error, 'error');
    } }), h('span', {}, h('b', {}, 'Sit out'), h('small', {}, 'Keep your seat but skip hands until you uncheck this.')))) : null;

  const body = h('div', { class: 'stack settings' },
    radio('trainer', 'Strategy trainer', [
      ['casino', 'Casino', 'No hints during the hand. Mistakes and their outs are still shown afterwards.'],
      ['training', 'Training', 'See the recommended play and why, before you act.'],
      ['challenge', 'Challenge', 'No hints during the hand; every decision is graded afterwards.'],
    ]),
    h('fieldset', {}, h('legend', {}, 'Sound'), range('fxVolume', 'Effects'), range('ambientVolume', 'Casino ambience')),
    radio('motion', 'Animation', [
      ['full', 'Full', 'Dealt cards, chip movement and reveals.'],
      ['fast', 'Fast play', 'The same animations at about twice the speed.'],
      ['off', 'Reduced motion', 'Cards and chips appear without movement.'],
    ]),
    h('fieldset', {}, h('legend', {}, 'Avatars'),
      h('label', { class: 'radio' }, h('input', { type: 'checkbox', checked: p.cosmeticFx, onchange: (e: Event) => prefs.set({ cosmeticFx: (e.target as HTMLInputElement).checked }) }),
        h('span', {}, h('b', {}, 'Cosmetic animations'), h('small', {}, 'Animated frames and victory effects from other players. Off keeps everything still on this device.')))),
    h('fieldset', {}, h('legend', {}, 'Cards'),
      h('label', { class: 'radio' }, h('input', { type: 'checkbox', checked: p.fourColorDeck, onchange: (e: Event) => prefs.set({ fourColorDeck: (e.target as HTMLInputElement).checked }) }),
        h('span', {}, h('b', {}, 'Four-colour deck'), h('small', {}, 'Blue diamonds and green clubs, easier to tell apart on small screens. Just for you.')))),
    v ? tableLook(v) : null,
    tablePrefs,
    restoreSection());
  modal('Settings', body);
}

/** Guest identity on another device: the restore code is this device's private sign-in key. */
function restoreSection() {
  const code = session.token;
  if (!code) return null;
  const out = h('input', { readonly: true, value: '••••••••••••', 'aria-label': 'Restore code', class: 'restore-code' }) as HTMLInputElement;
  return h('fieldset', {}, h('legend', {}, 'Use another device'),
    h('p', { class: 'muted tiny' }, 'Your name, chips and statistics live on the server under a private restore code. To play as you on another phone or computer, copy it there under “Have a restore code?” on the home screen. Keep it to yourself — anyone with it can play as you.'),
    h('div', { class: 'row' }, out,
      h('button', { class: 'btn small', type: 'button', onclick: () => { out.value = code; out.select(); } }, 'Show'),
      h('button', { class: 'btn small', type: 'button', onclick: async () => {
        try { await navigator.clipboard.writeText(code); toast('Restore code copied.', 'success'); } catch { out.value = code; out.select(); toast('Select and copy the code.', 'info'); }
      } }, 'Copy')));
}

/** Felt and card backs are the host's choice and everyone at the table sees them. Others see what's in use. */
export function tableLook(v: TableView) {
  const host = v.you.isHost;
  return h('fieldset', {}, h('legend', {}, 'Table look'),
    host ? null : h('p', { class: 'muted tiny' }, 'The host chooses the felt and card backs for everyone at this table.'),
    swatches('felt', 'Felt', FELTS, v.config.felt, !host),
    swatches('cardBack', 'Card backs', BACKS, v.config.cardBack, !host),
    h('div', { class: 'swatch-group' }, h('span', { class: 'swatch-label' }, 'Player cosmetics'),
      h('div', { class: 'seg' }, ...EFFECTS.map((e) => h('button', { class: `seg-btn ${v.config.effects === e.id ? 'on' : ''}`, title: e.note, disabled: !host,
        onclick: async (ev: MouseEvent) => {
          const r = await call('host:theme', { effects: e.id });
          if (!r.ok) return toast(r.error, 'error');
          (ev.currentTarget as HTMLElement).parentElement!.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b === ev.currentTarget));
        } }, e.name))),
      h('small', { class: 'muted tiny' }, EFFECTS.find((e) => e.id === v.config.effects)?.note ?? '')),
    h('div', { class: 'theme-preview', 'aria-hidden': 'true' }, h('div', { class: 'cards-row' }, cardEl('Ah'), cardEl('Kd'), cardEl('Qc'), cardEl(null))));
}

function swatches<K extends 'felt' | 'cardBack'>(key: K, label: string, opts: { id: string; name: string; swatch: string }[], value: string, readOnly: boolean) {
  return h('div', { class: `swatch-group ${readOnly ? 'readonly' : ''}`, role: 'radiogroup', 'aria-label': label },
    h('span', { class: 'swatch-label' }, label),
    h('div', { class: 'swatches' }, ...opts.map((o) => h('label', { class: 'swatch', title: o.name },
      h('input', { type: 'radio', name: key, value: o.id, checked: o.id === value, disabled: readOnly, 'aria-label': o.name,
        onchange: async () => {
          const r = await call('host:theme', { [key]: o.id } as { felt?: FeltColor; cardBack?: CardBack });
          if (!r.ok) toast(r.error, 'error');
        } }),
      h('span', { class: 'swatch-dot', style: `--sw: ${o.swatch}` }),
      h('span', { class: 'swatch-name' }, o.name)))));
}
