import { lazyPortrait } from '../cosmetics.js';
// "Tonight": the running tab for the current table night, the end-of-night recap, a shareable recap
// image, and a chips check straight from the ledger. All numbers come from the server.

import type { NightRecap, RecapMoment } from '../../shared/recap.js';
import { RANK_LABEL, SUIT_SYMBOL } from '../../shared/cards.js';
import { api } from '../api.js';
import { cardEl } from '../cardView.js';
import { h, modal, money, toast } from '../dom.js';

export interface Chips { start: number; reloads: number; wagered: number; paid: number; refunded: number; ledgerTotal: number; balance: number; debt: number; balanced: boolean }

export async function fetchRecap(code: string, nightId?: string): Promise<NightRecap | null> {
  return (await api<{ recap: NightRecap | null }>(`/api/tables/${code}/night${nightId ? `?id=${encodeURIComponent(nightId)}` : ''}`)).recap;
}
export interface PawnEvent { id: number; playerId: string; name: string; kind: 'marker' | 'payoff'; amount: number; debtAfter: number; item: string; at: number }
export async function fetchPawns(code: string): Promise<PawnEvent[]> {
  try { return (await api<{ events: PawnEvent[] }>(`/api/tables/${code}/pawns`)).events; } catch { return []; }
}
const theirs = (item: string) => item.replace(/^your /, 'their ');

/** The pawn shop: every marker taken and paid back at this table, newest first. Just for fun. */
export function renderPawnShop(events: PawnEvent[], meId: string, onPay?: () => void) {
  if (!events.length) return null;
  return h('section', { class: 'pawn-shop' }, h('h4', {}, 'Pawn shop'),
    h('ul', {}, ...events.map((e) => h('li', { class: e.kind },
      h('span', { class: 'pawn-time' }, timeOf(e.at)),
      h('span', {}, e.kind === 'marker'
        ? [h('b', {}, e.name), ` pawned ${theirs(e.item)} for a `, h('span', { class: 'neg' }, money(e.amount)), ' marker']
        : [h('b', {}, e.name), ' paid ', h('span', { class: 'pos' }, money(e.amount)), e.debtAfter ? ' back' : ` and got ${theirs(e.item)} back`]),
      h('span', { class: 'pawn-owes muted' }, e.debtAfter ? `owes ${money(e.debtAfter)}` : 'debt free')))),
    onPay ? h('button', { class: 'btn small', onclick: onPay }, 'Pay off my markers') : null);
}

export async function fetchChips(code: string): Promise<Chips | null> {
  try { return (await api<{ chips: Chips }>(`/api/tables/${code}/chips`)).chips; } catch { return null; }
}

const cards = (cs: string[]) => h('span', { class: 'mini-cards' }, ...cs.map((c) => cardEl(c)));
const duration = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function moment(label: string, m: RecapMoment | null, onReplay: (id: string) => void) {
  if (!m) return null;
  return h('div', { class: `moment ${m.amount < 0 ? 'neg' : 'pos'}` },
    h('small', {}, label),
    h('div', { class: 'moment-row' },
      h('div', {}, h('b', {}, m.name), ' ', h('span', { class: m.amount < 0 ? 'neg' : 'pos' }, money(m.amount, true)),
        h('div', { class: 'muted tiny' }, `${m.handName} · hand #${m.handNumber}`)),
      cards(m.hole)),
    h('button', { class: 'link tiny', onclick: () => onReplay(m.handId) }, 'Replay'));
}

export function renderNight(r: NightRecap | null, o: {
  meId: string; isHost: boolean; live: boolean; chips: Chips | null;
  onReplay: (id: string) => void; onEnd?: () => void; onPast?: () => void;
  pawns?: PawnEvent[]; onPay?: () => void;
}) {
  const shop = o.pawns ? renderPawnShop(o.pawns, o.meId, o.chips?.debt ? o.onPay : undefined) : null;
  if (!r || !r.hands) {
    return h('div', { class: 'night' },
      h('p', { class: 'muted' }, 'No hands yet tonight. The running tab starts with the first deal.'),
      shop,
      o.chips ? chipsCheck(o.chips) : null,
      o.onPast ? h('button', { class: 'link', onclick: o.onPast }, 'Past nights') : null);
  }
  const end = r.endedAt ?? r.lastHandAt ?? Date.now();
  return h('div', { class: 'night' },
    h('p', { class: 'night-sub' }, `${r.hands} hand${r.hands === 1 ? '' : 's'} · since ${timeOf(r.startedAt)} · ${duration(end - r.startedAt)}${r.endedAt ? ' · ended' : ''}`),
    h('table', { class: 'board' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Player'), h('th', { class: 'num' }, 'Net'), h('th', { class: 'num' }, 'W-L-P'), h('th', {}, 'Best'))),
      h('tbody', {}, ...r.players.map((p, i) => h('tr', { class: p.playerId === o.meId ? 'me' : '' },
        h('td', {}, i === 0 && p.net > 0 ? '👑' : String(i + 1)),
        h('td', { class: 'lb-name' }, lazyPortrait(p.playerId, p.name, 'lb-av'), p.name, p.debt ? h('span', { class: 'iou', title: 'Markers taken at this table' }, ` IOU ${money(p.debt)}`) : null),
        h('td', { class: `num ${p.net < 0 ? 'neg' : p.net > 0 ? 'pos' : ''}` }, money(p.net, true)),
        h('td', { class: 'num' }, `${p.wins}-${p.losses}-${p.pushes}`),
        h('td', { class: 'tiny' }, p.bestHand ?? '—'))))),
    h('div', { class: 'moments' }, moment('Biggest win', r.biggestWin, o.onReplay), moment('Biggest loss', r.biggestLoss, o.onReplay)),
    r.bestHands.length ? h('section', {}, h('h4', {}, 'Best hands'),
      h('ul', { class: 'best-list' }, ...r.bestHands.map((b) => h('li', {},
        h('span', {}, h('b', {}, b.handName), ` — ${b.name}`), cards(b.hole),
        h('button', { class: 'link tiny', onclick: () => o.onReplay(b.handId) }, `#${b.handNumber}`))))) : null,
    r.bonusHits.length ? h('section', {}, h('h4', {}, 'Bonus hits'),
      h('ul', { class: 'bonus-list' }, ...r.bonusHits.map((b) => h('li', {},
        h('span', {}, h('b', {}, b.name), ` · ${b.bet}${b.detail ? ` — ${b.detail}` : ''}`), h('span', { class: 'pos num' }, money(b.amount, true)))))) : null,
    r.fun.length ? h('section', {}, h('h4', {}, 'Tonight’s awards'),
      h('ul', { class: 'fun-list' }, ...r.fun.map((f) => h('li', {}, h('b', {}, f.label), h('span', {}, f.text))))) : null,
    shop,
    o.chips ? chipsCheck(o.chips) : null,
    h('div', { class: 'night-actions' },
      h('button', { class: 'btn small', onclick: () => shareRecap(r) }, 'Share recap'),
      o.live && o.isHost && o.onEnd ? h('button', { class: 'btn small', onclick: o.onEnd }, 'End the night') : null,
      o.onPast ? h('button', { class: 'link', onclick: o.onPast }, 'Past nights') : null));
}

/** Your stack, reconciled against the ledger. */
function chipsCheck(c: Chips) {
  const row = (k: string, v: number, sign = true) => [h('dt', {}, k), h('dd', { class: 'num' }, money(v, sign))];
  return h('section', { class: 'chips-check' },
    h('h4', {}, 'Your chips at this table'),
    h('dl', { class: 'kv' },
      ...row('Starting chips', c.start, false), ...row('Markers (minus payoffs)', c.reloads), ...row('Wagered', -c.wagered),
      ...row('Paid back to you', c.paid), ...(c.refunded ? row('Refunded', c.refunded) : []),
      ...(c.debt ? [h('dt', {}, 'Still owed to the house'), h('dd', { class: 'num neg' }, money(c.debt))] : []),
      h('dt', { class: 'total' }, 'Equals'), h('dd', { class: 'num total' }, money(c.ledgerTotal))),
    h('p', { class: c.balanced ? 'pos tiny' : 'neg tiny' }, c.balanced
      ? `✓ Matches your stack of ${money(c.balance)} exactly.`
      : `Your stack shows ${money(c.balance)} — that doesn’t match. Please report this.`));
}

export function openRecap(r: NightRecap, meId: string, onReplay: (id: string) => void) {
  const m = modal(`${r.tableName} — the night`, renderNight(r, { meId, isHost: false, live: false, chips: null, onReplay: (id) => { m.close(); onReplay(id); } }), { wide: true });
  m.panel.classList.add('recap-modal');
  const top = r.players[0];
  if (top && top.net > 0) m.panel.querySelector('.modal-body')!.prepend(h('p', { class: 'recap-head' }, `${top.name} wins the night, ${money(top.net, true)}.`));
}

export async function openPastNights(code: string, meId: string, onReplay: (id: string) => void) {
  const nights = (await api<{ nights: { id: string; startedAt: number; endedAt: number | null; hands: number }[] }>(`/api/tables/${code}/nights`)).nights;
  const list = h('ul', { class: 'past-nights' }, ...nights.filter((n) => n.hands).map((n) => h('li', {},
    h('button', { class: 'link', onclick: async () => { m.close(); const r = await fetchRecap(code, n.id); if (r) openRecap(r, meId, onReplay); } },
      new Date(n.startedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })),
    h('span', { class: 'muted' }, ` ${n.hands} hands${n.endedAt ? '' : ' · tonight'}`))));
  const m = modal('Past nights', nights.some((n) => n.hands) ? list : h('p', { class: 'muted' }, 'No nights yet.'));
}

// ---------------------------------------------------------------- share image
const cardText = (c: string) => `${RANK_LABEL[c[0]]}${SUIT_SYMBOL[c[1]]}`;

export function drawRecap(r: NightRecap): HTMLCanvasElement {
  const W = 1080, H = 1350, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  // Felt and rail
  const bg = g.createRadialGradient(W / 2, H * 0.4, 80, W / 2, H / 2, H * 0.8);
  bg.addColorStop(0, '#1f7a52'); bg.addColorStop(1, '#063a26');
  g.fillStyle = '#2a170c'; g.fillRect(0, 0, W, H);
  g.fillStyle = bg; roundRect(g, 36, 36, W - 72, H - 72, 48); g.fill();
  g.strokeStyle = '#c9a45c'; g.lineWidth = 6; roundRect(g, 54, 54, W - 108, H - 108, 40); g.stroke();
  const gold = '#e9cf8f', cream = '#f5ecd8', pos = '#8fe0a8', neg = '#ff9a8a';
  const text = (s: string, x: number, y: number, size: number, color = cream, align: CanvasTextAlign = 'left', weight = 500, font = 'Barlow Semi Condensed, Arial Narrow, sans-serif') => {
    g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y);
  };
  text('ULTIMATE TEXAS HOLD’EM', W / 2, 140, 34, gold, 'center', 600, 'Marcellus, Georgia, serif');
  text(r.tableName, W / 2, 205, 58, cream, 'center', 600, 'Marcellus, Georgia, serif');
  const date = new Date(r.startedAt).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  text(`${date} · ${r.hands} hands`, W / 2, 255, 30, '#cfe6d8', 'center');
  let y = 330;
  const top = r.players[0];
  if (top && top.net > 0) { text(`🏆 ${top.name} wins the night  ${money(top.net, true)}`, W / 2, y, 40, gold, 'center', 700); y += 70; }
  for (const [i, p] of r.players.slice(0, 6).entries()) {
    text(`${i + 1}. ${p.name}`, 150, y, 38, cream, 'left', 600);
    text(money(p.net, true), W - 150, y, 38, p.net < 0 ? neg : p.net > 0 ? pos : cream, 'right', 700);
    y += 54;
  }
  y += 24;
  g.strokeStyle = 'rgba(201,164,92,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(150, y); g.lineTo(W - 150, y); g.stroke();
  y += 60;
  const line = (label: string, value: string, color = cream) => {
    text(label, 150, y, 28, gold, 'left', 600); text(value, 150, y + 40, 34, color, 'left', 500); y += 96;
  };
  if (r.biggestWin) line('BIGGEST WIN', `${r.biggestWin.name} ${money(r.biggestWin.amount, true)} — ${r.biggestWin.handName} (${r.biggestWin.hole.map(cardText).join(' ')})`, pos);
  if (r.biggestLoss) line('BIGGEST LOSS', `${r.biggestLoss.name} ${money(r.biggestLoss.amount, true)} — ${r.biggestLoss.handName}`, neg);
  if (r.bestHands[0]) line('HAND OF THE NIGHT', `${r.bestHands[0].name}: ${r.bestHands[0].handName} (${r.bestHands[0].hole.map(cardText).join(' ')})`);
  const jackpot = r.bonusHits.find((b) => b.bet === 'Progressive');
  if (jackpot && y < H - 200) line('PROGRESSIVE', `${jackpot.name} — ${jackpot.detail} ${money(jackpot.amount, true)}`, gold);
  for (const f of r.fun.slice(0, 2)) if (y < H - 200) line(f.label.toUpperCase(), f.text);
  text('Virtual chips only · just for fun', W / 2, H - 90, 24, 'rgba(245,236,216,.6)', 'center');
  return cv;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h2: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r);
  g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export async function shareRecap(r: NightRecap) {
  const cv = drawRecap(r);
  const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
  if (!blob) return toast('Could not make the image.', 'error');
  const file = new File([blob], `uth-night-${new Date(r.startedAt).toISOString().slice(0, 10)}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: object) => boolean };
  try {
    if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title: `${r.tableName} — the night` }); return; }
  } catch (e) { if ((e as Error).name === 'AbortError') return; }
  const a = h('a', { href: URL.createObjectURL(blob), download: file.name });
  document.body.append(a); a.click(); a.remove();
  toast('Recap image downloaded.', 'success');
}
