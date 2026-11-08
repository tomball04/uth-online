import { ATTITUDES, ATTITUDE_LABEL, ATTITUDE_LABEL_CLEAN, ATTITUDE_NOTE } from '../../shared/roast/meta.js';
import { prefs } from '../settings.js';
// §25 dealer presentation: one portrait per dealer, rendered from that dealer's single appearance definition
// (§26). States change only expression, pose and a CSS motion — never the face, hair or outfit.
import { renderAvatar, type Expression, type Pose } from '../../shared/avatarSvg.js';
import { DEALER, type Dealer } from '../../shared/dealers.js';
import type { TableView } from '../../shared/protocol.js';
import { h } from '../dom.js';
import { sfx } from '../sound.js';

export type DealerMood = 'greet' | 'wait' | 'deal' | 'reveal' | 'win' | 'loss' | 'bigwin' | 'farewell';
const MOOD: Record<DealerMood, { ex: Expression; pose: Pose }> = {
  greet: { ex: 'grin', pose: 'front' }, wait: { ex: 'smile', pose: 'front' }, deal: { ex: 'focused', pose: 'left' },
  reveal: { ex: 'neutral', pose: 'right' }, win: { ex: 'smile', pose: 'front' }, loss: { ex: 'neutral', pose: 'front' },
  bigwin: { ex: 'surprised', pose: 'front' }, farewell: { ex: 'wink', pose: 'front' },
};

export function dealerPortrait(d: Dealer, mood: DealerMood, cls = '') {
  const el = h('div', { class: `dealer-av mood-${mood} ${cls}`, role: 'img', 'aria-label': `${d.name}, ${d.title}` });
  el.innerHTML = renderAvatar(d, { expression: MOOD[mood].ex, pose: MOOD[mood].pose });
  return el;
}

/** The dealer badge in the dealer zone, with hand-over transitions and the introduction card. */
export function makeDealerBadge(feltHost: HTMLElement) {
  let host = feltHost;
  const stage = h('div', { class: 'dealer-stage' });
  const name = h('div', { class: 'dealer-tag' });
  const root = h('div', { class: 'dealer-badge' }, stage, name);
  let key = '', lastEvent = 0, shown: string | null = null, busy = 0;

  function moodFor(v: TableView): DealerMood {
    const ev = v.house.event;
    if (ev && v.serverNow - ev.at < 4000) return 'greet';
    switch (v.phase) {
      case 'preflop': case 'flop': case 'river': case 'decide': return 'deal';
      case 'showdown': return 'reveal';
      case 'settled': {
        if (v.house.bigWin) return 'bigwin';
        if (v.house.rotating) return 'farewell';
        const net = v.seats.reduce((t, s) => t + (s?.result?.net ?? 0), 0);
        return net > 0 ? 'win' : net < 0 ? 'loss' : 'wait';
      }
      default: return 'wait';
    }
  }

  function introCard(d: Dealer, v: TableView, reason: string) {
    if (v.config.dealer.intro === 'off') return;
    const card = h('div', { class: 'dealer-intro', role: 'status' },
      dealerPortrait(d, 'greet', 'big'),
      h('div', {},
        h('div', { class: 'di-kicker' }, reason === 'open' ? 'Your dealer tonight' : 'Now dealing'),
        h('div', { class: 'di-name' }, d.name), h('div', { class: 'di-title' }, d.title),
        v.config.dealer.intro === 'full' ? h('p', { class: 'di-line' }, `“${d.intro}”`) : h('p', { class: 'di-line' }, `“${d.introShort}”`)));
    host.append(card);
    setTimeout(() => card.classList.add('out'), 4200);
    setTimeout(() => card.remove(), 4800);
  }

  function render(v: TableView) {
    const d = DEALER.get(v.house.dealerId);
    if (!d) return;
    const ev = v.house.event;
    if (ev && ev.at !== lastEvent) {
      const fresh = v.serverNow - ev.at < 5000;
      lastEvent = ev.at;
      if (fresh && ev.kind === 'rotate' && ev.from && DEALER.get(ev.from) && shown && shown !== d.id) {
        // Hand-over: the outgoing dealer waves goodbye and slides out; the new dealer slides in.
        const out = dealerPortrait(DEALER.get(ev.from)!, 'farewell', 'leaving');
        stage.append(out);
        busy = Date.now() + 900;
        setTimeout(() => out.remove(), 900);
        sfx.shift(v.config.dealer.volume);
        introCard(d, v, ev.reason);
      } else if (fresh && (ev.kind === 'intro' || ev.kind === 'rotate')) {
        introCard(d, v, ev.reason);
      }
    }
    const mood = moodFor(v);
    const k = `${d.id}|${mood}`;
    if (k !== key) {
      key = k;
      const next = dealerPortrait(d, mood, shown && shown !== d.id ? 'arriving' : '');
      const old = stage.querySelector('.dealer-av:not(.leaving)');
      const swap = () => { old?.remove(); stage.append(next); };
      if (busy > Date.now()) setTimeout(swap, busy - Date.now()); else swap();
      shown = d.id;
    }
    name.textContent = d.name;
    root.title = `${d.name} — ${d.title}. ${d.personality} Dealers are presentation only: every dealer deals the same game with the same odds.`;
    root.dataset.rounds = String(v.house.rounds);
  }
  /** Called for each dealer chat line, for the voice cue. */
  function spoke(v: TableView | null) {
    const d = v && DEALER.get(v.house.dealerId);
    if (d && v) sfx.voice(d.voice, v.config.dealer.volume);
  }
  return { root, render, spoke, setHost(el: HTMLElement) { host = el; } };
}

/** Host controls for the dealer (presentation only). */
export function dealerSection(v: TableView, call: (ev: 'host:dealer', p: object) => Promise<{ ok: boolean; error?: string; queued?: boolean }>, toast: (m: string, k?: 'error' | 'success' | 'info') => void) {
  const d = v.config.dealer;
  const inHand = !!v.handId && v.phase !== 'settled';
  const cur = DEALER.get(v.house.dealerId)!;
  const sel = (name: string, label: string, opts: [string, string][], value: string) =>
    h('label', {}, label, h('select', { name }, ...opts.map(([val, text]) => h('option', { value: val, selected: val === value }, text))));
  const clean = !prefs.get().roast.profanity;
  const form = h('form', { class: 'form-grid dealer-form' },
    h('label', { class: 'span2' }, 'Dealer attitude (the table’s maximum)',
      h('select', { name: 'attitude', 'data-testid': 'attitude' }, ...ATTITUDES.map((a) => h('option', { value: a, selected: a === (d.attitude ?? 'smartass') }, `${(clean ? ATTITUDE_LABEL_CLEAN : ATTITUDE_LABEL)[a]} — ${ATTITUDE_NOTE[a]}`))),
      h('small', { class: 'muted' }, 'Players can always turn it down, filter profanity or mute the dealer for themselves. Personal roasts only target players who opted in — including at No Mercy.')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'rotate', checked: d.rotate }), 'Automatic rotation'),
    sel('every', 'Rotate every', [['10', '10 rounds'], ['25', '25 rounds'], ['50', '50 rounds'], ['100', '100 rounds']], String(d.every)),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'majorWins', checked: d.majorWins }), 'Rotate after major wins'),
    h('label', {}, 'Major win: net profit of at least ($)', h('input', { name: 'majorMin', type: 'number', min: 100, step: 1, value: d.majorMin / 100 })),
    h('label', {}, '…or this many × the opening wager, if higher', h('input', { name: 'majorMultiple', type: 'number', min: 5, max: 10000, value: d.majorMultiple })),
    h('label', {}, 'Progressive payout that counts as major ($)', h('input', { name: 'progressiveMin', type: 'number', min: 100, step: 1, value: d.progressiveMin / 100 })),
    sel('intro', 'Dealer introductions', [['full', 'Full'], ['short', 'Short'], ['off', 'Disabled']], d.intro),
    sel('chatter', 'Dealer table talk', [['often', 'Often'], ['normal', 'Normal'], ['rare', 'Rare'], ['off', 'Off']], d.chatter),
    h('label', { class: 'span2' }, `Dealer voice volume`, h('input', { name: 'volume', type: 'range', min: 0, max: 100, value: d.volume })),
    h('button', { class: 'btn gold span2' }, 'Save dealer settings'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const r = await call('host:dealer', { settings: {
      rotate: fd.get('rotate') === 'on', every: Number(fd.get('every')), majorWins: fd.get('majorWins') === 'on',
      majorMin: Math.round(Number(fd.get('majorMin')) * 100), majorMultiple: Number(fd.get('majorMultiple')),
      progressiveMin: Math.round(Number(fd.get('progressiveMin')) * 100),
      intro: fd.get('intro'), chatter: fd.get('chatter'), volume: Number(fd.get('volume')), attitude: fd.get('attitude'),
    } });
    if (r.ok) toast('Dealer settings saved.', 'success'); else toast(r.error ?? 'Failed', 'error');
  });
  const roster = h('div', { class: 'dealer-roster' }, ...[...DEALER.values()].map((x) => {
    const b = h('button', { class: `dealer-pick ${x.id === cur.id ? 'on' : ''}`, disabled: x.id === cur.id || inHand, title: `${x.name} — ${x.title}. ${x.personality}`,
      onclick: async () => {
        const r = await call('host:dealer', { dealerId: x.id });
        if (!r.ok) return toast(r.error ?? 'Failed', 'error');
        toast(r.queued ? `${x.name} takes over after these results.` : `${x.name} is now dealing.`, 'success');
        roster.querySelectorAll('.dealer-pick').forEach((el) => el.classList.toggle('on', el === b));
      } }, dealerPortrait(x, 'wait'), h('span', {}, x.name));
    return b;
  }));
  return h('section', { class: 'dealer-section' },
    h('h3', {}, 'Dealer'),
    h('p', {}, `Now dealing: `, h('b', {}, cur.name), ` — ${v.house.rounds} of ${d.every} rounds into the shift${d.rotate ? '' : ' (rotation off)'}.`),
    h('p', { class: 'muted tiny' }, 'Dealers are presentation only. Every dealer deals the same shuffled shoe with the same rules and payouts; changing dealers never changes the cards or the odds.'),
    roster,
    h('p', { class: 'muted tiny' }, inHand ? 'You can choose a dealer between hands.' : 'Tap a dealer to bring them in now (or right after the results are shown).'),
    form);
}
