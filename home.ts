import type { PublicTableListing } from '../../shared/protocol.js';
import { api, restoreWithCode, session, signIn } from '../api.js';
import { cardEl } from '../cardView.js';
import { h, modal, money, toast } from '../dom.js';
import { resetSocket } from '../net.js';
import { openHelp, readSideBetFields, sideBetFields } from './help.js';
import { openSettings } from './settingsModal.js';

export function mountHome(root: HTMLElement, nav: (path: string) => void, opts: { joinCode?: string; message?: string } = {}) {
  const me = session.me;
  if (opts.message) toast(opts.message, 'info', 5000);

  const fan = h('div', { class: 'hero-fan', 'aria-hidden': 'true' },
    ...['As', 'Ks', 'Qs', 'Js', 'Ts'].map((c, i) => { const el = cardEl(c, 'fan'); el.style.setProperty('--i', String(i)); return el; }));

  if (!me) {
    const input = h('input', { id: 'name', maxlength: 20, autocomplete: 'nickname', placeholder: 'Your name at the table', required: true }) as HTMLInputElement;
    const form = h('form', { class: 'name-form' },
      h('label', { for: 'name' }, opts.joinCode ? 'You’ve been invited to a table. What should everyone call you?' : 'Pick a display name to get started. No account needed.'),
      h('div', { class: 'row' }, input, h('button', { class: 'btn gold' }, opts.joinCode ? 'Join the table' : 'Continue')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await signIn(input.value);
        resetSocket();
        if (opts.joinCode) nav(`/table/${opts.joinCode}`); else mountHome(root, nav);
      } catch (err: any) { toast(err.message, 'error'); }
    });
    root.replaceChildren(h('main', { class: 'home' }, h('section', { class: 'hero' }, fan, h('h1', {}, 'Ultimate Texas Hold’em'),
      h('p', { class: 'lede' }, 'Pull up a chair with up to five friends. Everyone plays their own hand against one dealer.'), form,
      h('button', { class: 'link restore-link', onclick: () => restoreFromCode(() => { resetSocket(); if (opts.joinCode) nav(`/table/${opts.joinCode}`); else mountHome(root, nav); }) }, 'Have a restore code?'),
      h('p', { class: 'fine' }, 'Virtual chips only. Nothing here can be bought, won or cashed out.'))));
    setTimeout(() => input.focus(), 50);
    return;
  }

  const codeInput = h('input', { maxlength: 8, placeholder: 'Table code', 'aria-label': 'Table code', autocapitalize: 'characters', class: 'code-input' }) as HTMLInputElement;
  const publicList = h('div', { class: 'public-list' }, h('p', { class: 'muted' }, 'Looking for open tables…'));

  const join = (e: Event) => {
    e.preventDefault();
    const c = codeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 6) return toast('Table codes are 6 or 8 characters.', 'error');
    nav(`/table/${c}`);
  };

  root.replaceChildren(h('main', { class: 'home' },
    h('section', { class: 'hero' }, fan,
      h('h1', {}, 'Ultimate Texas Hold’em'),
      h('p', { class: 'lede' }, `Welcome back, ${me.name}.`),
      h('div', { class: 'cta-row' },
        h('button', { class: 'btn gold big', onclick: () => openCreate(nav) }, 'Create a private table'),
        h('form', { class: 'join-form', onsubmit: join }, codeInput, h('button', { class: 'btn big' }, 'Join'))),
      h('div', { class: 'cta-row secondary' },
        h('button', { class: 'btn', onclick: () => solo(nav) }, 'Practice solo'),
        h('button', { class: 'ghost', onclick: () => nav('/stats') }, 'Your statistics'),
        h('button', { class: 'ghost', onclick: () => openHelp() }, 'How to play'),
        h('button', { class: 'ghost', onclick: () => openSettings() }, 'Settings'),
        h('button', { class: 'ghost', onclick: () => rename(root, nav) }, 'Change name'))),
    h('section', { class: 'lobby' }, h('h2', {}, 'Public tables'), publicList),
    h('p', { class: 'fine' }, 'Virtual chips only. Nothing here can be bought, won or cashed out.')));

  const load = async () => {
    try {
      const { tables } = await api<{ tables: PublicTableListing[] }>('/api/tables');
      publicList.replaceChildren(tables.length ? h('table', { class: 'tables' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Table'), h('th', {}, 'Seats'), h('th', {}, 'Ante'), h('th', {}, 'Status'), h('th', {}))),
        h('tbody', {}, ...tables.map((t) => h('tr', {},
          h('td', {}, t.name), h('td', { class: 'num' }, `${t.seated} / ${t.maxSeats}`),
          h('td', { class: 'num' }, `${money(t.minAnte)}–${money(t.maxAnte)}`),
          h('td', {}, t.inHand ? 'Hand in progress' : 'Between hands'),
          h('td', {}, t.seated < t.maxSeats ? h('button', { class: 'btn small gold', onclick: () => nav(`/table/${t.code}`) }, 'Sit down')
            : t.allowSpectators ? h('button', { class: 'btn small', onclick: () => nav(`/table/${t.code}?watch=1`) }, 'Watch') : 'Full')))))
        : h('p', { class: 'muted' }, 'No public tables right now. Create one and tick “List in public tables”, or invite friends privately.'));
    } catch { publicList.replaceChildren(h('p', { class: 'muted' }, 'Couldn’t load public tables.')); }
  };
  load();
  const t = setInterval(() => { if (!publicList.isConnected) clearInterval(t); else load(); }, 8000);
}

async function solo(nav: (p: string) => void) {
  try {
    const { code } = await api<{ code: string }>('/api/tables', { method: 'POST', body: JSON.stringify({ solo: true }) });
    nav(`/table/${code}`);
  } catch (e: any) { toast(e.message, 'error'); }
}

function rename(root: HTMLElement, nav: (p: string) => void) {
  const input = h('input', { value: session.me?.name ?? '', maxlength: 20 }) as HTMLInputElement;
  const form = h('form', { class: 'stack' }, h('label', {}, 'Display name', input), h('button', { class: 'btn gold' }, 'Save name'));
  const m = modal('Change name', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/me', { method: 'PATCH', body: JSON.stringify({ name: input.value }) });
      session.setMe({ ...session.me!, name: input.value.trim() });
      resetSocket();
      m.close(); mountHome(root, nav);
      toast('Name updated. Tables you rejoin will show the new name.', 'success');
    } catch (err: any) { toast(err.message, 'error'); }
  });
}

function openCreate(nav: (p: string) => void) {
  const num = (name: string, label: string, value: number, attrs: Record<string, number> = {}) =>
    h('label', {}, label, h('input', { name, type: 'number', value, required: true, ...attrs }));
  const form = h('form', { class: 'form-grid' },
    h('label', { class: 'span2' }, 'Table name', h('input', { name: 'name', maxlength: 40, placeholder: `${session.me?.name}'s Table` })),
    num('maxSeats', 'Seats', 6, { min: 2, max: 6 }),
    num('startingBankroll', 'Starting stack ($)', 1000, { min: 10, step: 1 }),
    num('minAnte', 'Minimum Ante ($)', 5, { min: 1, step: 1 }),
    num('maxAnte', 'Maximum Ante ($)', 100, { min: 1, step: 1 }),
    num('maxTrips', 'Maximum Trips+ ($)', 25, { min: 0, step: 1 }),
    ...sideBetFields(),
    num('decisionSeconds', 'Decision timer (seconds)', 25, { min: 5, max: 120 }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'isPublic' }), 'List in public tables'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'allowSpectators', checked: true }), 'Allow spectators'),
    h('button', { class: 'btn gold span2' }, 'Create table'));
  const m = modal('New table', form, { wide: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const d = (k: string) => Math.round(Number(fd.get(k)) * 100);
    try {
      const { code } = await api<{ code: string }>('/api/tables', { method: 'POST', body: JSON.stringify({
        name: String(fd.get('name') ?? ''), maxSeats: Number(fd.get('maxSeats')), startingBankroll: d('startingBankroll'),
        minAnte: d('minAnte'), maxAnte: d('maxAnte'), maxTrips: d('maxTrips'), decisionSeconds: Number(fd.get('decisionSeconds')), ...readSideBetFields(fd),
        isPublic: fd.get('isPublic') === 'on', allowSpectators: fd.get('allowSpectators') === 'on',
      }) });
      m.close();
      nav(`/table/${code}`);
    } catch (err: any) { toast(err.message, 'error'); }
  });
}

/** Sign in on this device with the restore code copied from another one. */
function restoreFromCode(done: () => void) {
  const input = h('input', { placeholder: 'Paste your restore code', 'aria-label': 'Restore code', autocomplete: 'off' }) as HTMLInputElement;
  const form = h('form', { class: 'stack' },
    h('p', { class: 'muted' }, 'Find it on your other device under Settings → Use another device.'),
    input, h('button', { class: 'btn gold' }, 'Restore'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await restoreWithCode(input.value); m.close(); toast('Welcome back.', 'success'); done(); }
    catch (err) { toast((err as Error).message, 'error'); }
  });
  const m = modal('Restore your player', form);
}
