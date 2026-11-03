import { cardToInt } from '../../shared/cards.js';
import type { ChatMessage, DecisionRecord, Reaction, SeatView, TableView } from '../../shared/protocol.js';
import { REACTIONS } from '../../shared/protocol.js';
import { BLIND_PAYTABLE, TRIPS_PAYTABLE, requiredToStart, type Decision, type DecisionPhase } from '../../shared/rules.js';
import { advise } from '../../shared/strategy.js';
import { session } from '../api.js';
import { cardEl, setCard } from '../cardView.js';
import { append, h, initials, modal, money, svg, toast } from '../dom.js';
import { actionId, call, getSocket, onStatus, setCurrentTable } from '../net.js';
import { motionScale, prefs } from '../settings.js';
import { sfx, unlockAudio } from '../sound.js';
import { openSettings } from './settingsModal.js';
import { openReplay } from './replay.js';
import { openHelp } from './help.js';

const CHIPS = [100, 500, 2500, 10000, 50000];
const CHIP_CLASS: Record<number, string> = { 100: 'c1', 500: 'c5', 2500: 'c25', 10000: 'c100', 50000: 'c500' };
const CHIP_LABEL: Record<number, string> = { 100: '1', 500: '5', 2500: '25', 10000: '100', 50000: '500' };

const LAYOUTS: Record<number, [number, number][]> = {
  1: [[50, 84]],
  2: [[35, 84], [65, 84]],
  3: [[19, 68], [50, 87], [81, 68]],
  4: [[11, 46], [33, 83], [67, 83], [89, 46]],
  5: [[9, 38], [24, 73], [50, 88], [76, 73], [91, 38]],
  6: [[8, 36], [21, 69], [39, 87], [61, 87], [79, 69], [92, 36]],
};

// Tall (phone) table: seats wrap around the lower curve, clear of the board.
const LAYOUTS_TALL: Record<number, [number, number][]> = {
  1: [[50, 86]],
  2: [[33, 86], [67, 86]],
  3: [[18, 74], [50, 89], [82, 74]],
  4: [[13, 64], [35, 88], [65, 88], [87, 64]],
  5: [[12, 62], [24, 81], [50, 91], [76, 81], [88, 62]],
  6: [[11, 58], [15, 77], [36, 92], [64, 92], [85, 77], [89, 58]],
};

const DECISION_LABEL: Record<Decision, string> = { play4: 'Play 4×', play3: 'Play 3×', play2: 'Play 2×', play1: 'Play 1×', check: 'Check', fold: 'Fold' };
const MULT: Partial<Record<Decision, number>> = { play4: 4, play3: 3, play2: 2, play1: 1 };

interface SeatEls {
  root: HTMLElement; plate: HTMLElement; avatar: HTMLElement; name: HTMLElement; bal: HTMLElement; status: HTMLElement;
  cards: HTMLElement[]; spots: Record<'trips' | 'ante' | 'blind' | 'play', HTMLElement>; handName: HTMLElement; float: HTMLElement;
}

export function mountTable(root: HTMLElement, code: string, onExit: (msg?: string) => void) {
  const me = session.me!;
  const sock = getSocket();
  let view: TableView | null = null;
  let prev: TableView | null = null;
  let clockOffset = 0;
  let chip = 2500;
  let draft = { ante: 0, trips: 0 };
  let draftDirty = false;
  let betTimer: number | null = null;
  let chat: ChatMessage[] = [];
  const muted = new Set<string>(JSON.parse(localStorage.getItem('uth.muted') ?? '[]'));
  const analysis = new Map<string, DecisionRecord[]>();
  const sessionStats = { hands: 0, net: 0, decisions: 0, correct: 0, evLostCents: 0, series: [] as number[] };
  let panel: 'chat' | 'table' = 'chat';
  let panelOpenMobile = false;
  let unread = 0;
  let disposed = false;

  // ---------------------------------------------------------------- skeleton
  const tableName = h('span', { class: 'tname' });
  const statusPill = h('span', { class: 'conn', hidden: true }, 'Reconnecting…');
  const hostBtn = h('button', { class: 'ghost', onclick: () => openHostMenu(), hidden: true }, 'Host');
  const chatBtn = h('button', { class: 'ghost panel-toggle', onclick: () => togglePanel('chat') }, 'Chat');
  const top = h('header', { class: 'tbar' },
    h('button', { class: 'ghost', onclick: () => leave() }, '← Lobby'),
    h('div', { class: 'tbar-title' }, tableName, h('button', { class: 'code', title: 'Copy invitation link', onclick: () => invite() }, code)),
    statusPill,
    h('div', { class: 'tbar-actions' },
      h('button', { class: 'ghost', onclick: () => invite() }, 'Invite'),
      chatBtn,
      h('button', { class: 'ghost panel-toggle', onclick: () => togglePanel('table') }, 'History'),
      hostBtn,
      h('button', { class: 'ghost hide-m', onclick: () => openHelp() }, 'Rules'),
      h('button', { class: 'ghost', 'aria-label': 'Settings', title: 'Settings', onclick: () => openSettings({ inTable: true, view: () => view }) }, h('span', { class: 'hide-m' }, 'Settings'), h('span', { class: 'show-m' }, '⚙'))));

  // Gold lettering printed on the felt, as on a real layout. Separate artwork for the wide and tall tables.
  const feltPrint = svg(`<svg class="felt-print fp-wide" viewBox="0 0 1000 562" aria-hidden="true">
    <defs><path id="arcW" d="M 190 328 Q 500 458 810 328" /></defs>
    <text class="fp-big"><textPath href="#arcW" startOffset="50%" text-anchor="middle">ULTIMATE TEXAS HOLD'EM</textPath></text>
    <text class="fp-small" x="500" y="166" text-anchor="middle">DEALER QUALIFIES WITH A PAIR OR BETTER</text>
  </svg>`);
  const feltPrintTall = svg(`<svg class="felt-print fp-tall" viewBox="0 0 1000 980" aria-hidden="true">
    <defs><path id="arcT" d="M 70 585 Q 500 770 930 585" /></defs>
    <text class="fp-big"><textPath href="#arcT" startOffset="50%" text-anchor="middle">ULTIMATE TEXAS HOLD'EM</textPath></text>
  </svg>`);

  const dealerCards = [cardEl(null, 'empty'), cardEl(null, 'empty')];
  const dealerName = h('div', { class: 'hand-name dealer-hn' });
  const dealerBubble = h('div', { class: 'bubble' });
  const community = Array.from({ length: 5 }, () => cardEl(null, 'empty'));
  const shoe = h('div', { class: 'shoe', 'aria-hidden': 'true' }, h('div', { class: 'shoe-card' }));
  const tray = h('div', { class: 'tray', 'aria-hidden': 'true' }, ...[CHIPS[4], CHIPS[3], CHIPS[2], CHIPS[1], CHIPS[0]].map((c) => h('span', { class: `tray-col ${CHIP_CLASS[c]}` })));
  const phaseLine = h('div', { class: 'phase-line' });

  const felt = h('div', { class: 'felt' },
    feltPrint, feltPrintTall, tray, shoe,
    h('div', { class: 'dealer-zone' }, dealerBubble, h('div', { class: 'cards-row' }, ...dealerCards), dealerName),
    h('div', { class: 'community' }, h('div', { class: 'cards-row' }, ...community), phaseLine));
  const seatEls: SeatEls[] = Array.from({ length: 6 }, (_, i) => makeSeat(i));
  seatEls.forEach((s) => felt.append(s.root));
  const tableEl = h('div', { class: 'rail' }, felt);

  // Dock: my hand + controls
  const myCards = [cardEl(null, 'empty big'), cardEl(null, 'empty big')];
  const myHandName = h('div', { class: 'my-hn' });
  const hint = h('div', { class: 'hint', hidden: true });
  const timerBar = h('div', { class: 'timer' }, h('i'));
  const spotEls = {
    trips: spot('Trips+', 'trips'), ante: spot('Ante', 'ante'), blind: spot('Blind', 'blind'), play: spot('Play', 'play'),
  };
  const rack = h('div', { class: 'rack', role: 'radiogroup', 'aria-label': 'Chip value' },
    ...CHIPS.map((c) => h('button', { class: `chip ${CHIP_CLASS[c]}`, role: 'radio', 'aria-label': `$${CHIP_LABEL[c]} chip`, 'data-v': c, onclick: () => selectChip(c) }, h('span', {}, CHIP_LABEL[c]))));
  const controls = h('div', { class: 'controls' });
  const dockMsg = h('div', { class: 'dock-msg' });
  const result = h('div', { class: 'my-result', hidden: true });
  const dock = h('section', { class: 'dock', 'aria-label': 'Your seat' },
    h('div', { class: 'dock-hand' }, h('div', { class: 'cards-row' }, ...myCards), myHandName),
    h('div', { class: 'dock-mid' },
      timerBar, dockMsg,
      h('div', { class: 'spots' }, spotEls.trips, spotEls.ante, spotEls.blind, spotEls.play),
      hint, result),
    h('div', { class: 'dock-right' }, rack, controls));

  // Side panel
  const chatList = h('ol', { class: 'chat-list', 'aria-live': 'polite' });
  const chatInput = h('input', { maxlength: 240, placeholder: 'Message the table', 'aria-label': 'Chat message' }) as HTMLInputElement;
  const reactRow = h('div', { class: 'reacts' }, ...REACTIONS.map((r) => h('button', { class: 'react', onclick: () => react(r) }, r)));
  const chatPane = h('div', { class: 'pane pane-chat' }, chatList,
    reactRow,
    h('form', { class: 'chat-form', onsubmit: (e: Event) => { e.preventDefault(); sendChat(); } }, chatInput, h('button', { class: 'btn small' }, 'Send')));
  const historyPane = h('div', { class: 'pane pane-table', hidden: true });
  const tabChat = h('button', { class: 'tab on', onclick: () => setPanel('chat') }, 'Chat');
  const tabTable = h('button', { class: 'tab', onclick: () => setPanel('table') }, 'Table & history');
  const side = h('aside', { class: 'side' },
    h('div', { class: 'tabs' }, tabChat, tabTable, h('button', { class: 'icon-btn side-close', 'aria-label': 'Close panel', onclick: () => togglePanel() }, '✕')),
    chatPane, historyPane);

  const screen = h('div', { class: 'table-screen' }, top, h('div', { class: 'stage' }, h('div', { class: 'table-area' }, tableEl), side), dock);
  root.replaceChildren(screen);
  selectChip(chip);

  // ---------------------------------------------------------------- builders
  function spot(label: string, key: string) {
    return h('button', { class: `spot spot-${key}`, 'data-k': key, onclick: () => onSpot(key as 'ante' | 'trips') },
      h('span', { class: 'spot-label' }, label), h('span', { class: 'spot-amt' }));
  }

  function makeSeat(i: number): SeatEls {
    const cards = [cardEl(null, 'empty sm'), cardEl(null, 'empty sm')];
    const mk = (k: string) => h('div', { class: `mini-spot ms-${k}`, title: k[0].toUpperCase() + k.slice(1) });
    const spots = { trips: mk('trips'), ante: mk('ante'), blind: mk('blind'), play: mk('play') };
    const avatar = h('div', { class: 'avatar' });
    const name = h('div', { class: 'pname' });
    const bal = h('div', { class: 'pbal' });
    const status = h('div', { class: 'pstatus' });
    const handName = h('div', { class: 'hand-name' });
    const float = h('div', { class: 'float' });
    const plate = h('div', { class: 'plate' }, avatar, h('div', { class: 'pinfo' }, name, bal), status);
    const root = h('div', { class: 'seat empty-seat', 'data-seat': i },
      h('div', { class: 'cards-row' }, ...cards), handName,
      h('div', { class: 'mini-spots' }, spots.trips, spots.ante, spots.blind, spots.play),
      plate, float);
    root.addEventListener('click', (e) => {
      if (!view) return;
      const seat = Number(root.dataset.realSeat);
      const sv = view.seats[seat];
      if (!sv && view.you.role === 'spectator') sit(seat);
      else if (sv && sv.playerId !== me.id && (e.target as HTMLElement).closest('.plate')) seatMenu(sv);
    });
    return { root, plate, avatar, name, bal, status, cards, spots, handName, float };
  }

  // ---------------------------------------------------------------- socket wiring
  const handlers = {
    state: (v: TableView) => { clockOffset = v.serverNow - Date.now(); prev = view; view = v; render(); },
    chat: (m: ChatMessage) => addChat(m),
    history: (ms: ChatMessage[]) => { chat = []; chatList.replaceChildren(); ms.forEach((m) => addChat(m, true)); },
    reaction: (p: { playerId: string; seat: number | null; reaction: Reaction }) => showReaction(p),
    analysis: (p: { handId: string; decisions: DecisionRecord[] }) => onAnalysis(p),
    closed: (p: { reason: string }) => exit(p.reason),
    kicked: (p: { reason: string }) => exit(p.reason),
  };
  sock.on('table:state', handlers.state);
  sock.on('chat:message', handlers.chat);
  sock.on('chat:history', handlers.history);
  sock.on('chat:reaction', handlers.reaction);
  sock.on('hand:analysis', handlers.analysis);
  sock.on('table:closed', handlers.closed);
  sock.on('kicked', handlers.kicked);
  const offStatus = onStatus((s) => { statusPill.hidden = s === 'connected'; statusPill.textContent = s === 'offline' ? 'Offline — refresh to retry' : 'Reconnecting…'; });
  setCurrentTable(code);

  (async () => {
    const r = await call<{ seat: number | null }>('table:join', { code, asSpectator: new URLSearchParams(location.search).has('watch') });
    if (!r.ok) return exit(r.error);
  })();

  const tick = window.setInterval(() => renderClock(), 200);
  const mq = matchMedia('(max-width: 760px)');
  const onMq = () => { if (view) { prev = view; render(); } };
  mq.addEventListener('change', onMq);
  const keyHandler = (e: KeyboardEvent) => {
    if (!view || (e.target as HTMLElement).closest('input,textarea,select')) return;
    const legal = view.you.legal;
    const map: Record<string, Decision[]> = { c: ['check'], f: ['fold'], '4': ['play4'], '3': ['play3'], '2': ['play2'], '1': ['play1'] };
    const d = map[e.key.toLowerCase()]?.find((x) => legal.includes(x));
    if (d) decide(d);
    if (e.key === 'Enter' && view.phase === 'betting') readyUp();
  };
  document.addEventListener('keydown', keyHandler);
  root.addEventListener('pointerdown', unlockAudio, { once: true });

  function exit(msg?: string) {
    if (disposed) return;
    dispose();
    onExit(msg);
  }
  function dispose() {
    disposed = true;
    clearInterval(tick);
    document.removeEventListener('keydown', keyHandler);
    mq.removeEventListener('change', onMq);
    sock.off('table:state', handlers.state);
    sock.off('chat:message', handlers.chat);
    sock.off('chat:history', handlers.history);
    sock.off('chat:reaction', handlers.reaction);
    sock.off('hand:analysis', handlers.analysis);
    sock.off('table:closed', handlers.closed);
    sock.off('kicked', handlers.kicked);
    offStatus();
    setCurrentTable(null);
  }

  // ---------------------------------------------------------------- render
  function visualIndex(seat: number, n: number): number {
    if (!view || view.you.seat === null) return seat;
    const home = n % 2 ? Math.floor(n / 2) : n / 2 - 1;
    return (seat - view.you.seat + home + n) % n;
  }

  function render() {
    const v = view!;
    const first = !prev;
    const newHand = !!v.handId && prev?.handId !== v.handId;
    tableName.textContent = v.config.name;
    hostBtn.hidden = !v.you.isHost || v.config.solo;
    screen.classList.toggle('solo', v.config.solo);
    screen.dataset.phase = v.phase;

    // --- seats
    const n = v.config.maxSeats;
    const narrow = matchMedia('(max-width: 760px)').matches;
    const layout = (narrow ? LAYOUTS_TALL[n] : LAYOUTS[n]) ?? LAYOUTS[6];
    seatEls.forEach((el, i) => { el.root.hidden = i >= n; });
    for (let seat = 0; seat < n; seat++) {
      const vi = visualIndex(seat, n);
      const el = seatEls[vi];
      const [x, y] = layout[vi];
      el.root.style.setProperty('--x', `${x}%`);
      el.root.style.setProperty('--y', `${y}%`);
      el.root.dataset.realSeat = String(seat);
      el.root.classList.toggle('side-left', x < 30);
      el.root.classList.toggle('side-right', x > 70);
      renderSeat(el, v.seats[seat], prev?.seats[seat] ?? null, seat, first);
    }

    // --- dealer & community
    const dealerPrev = prev?.dealer.cards ?? [];
    v.dealer.cards.forEach((c, i) => updateCard(dealerCards[i], c, !first && dealerPrev[i] === null && c !== null, i * 160));
    if (!v.dealer.cards.length) dealerCards.forEach((c) => clearCard(c));
    dealerName.textContent = v.dealer.handName ? `${v.dealer.handName}${v.dealer.qualifies === false ? ' — does not qualify' : ''}` : '';
    const commPrev = prev?.community ?? [];
    let flipIdx = 0;
    community.forEach((el, i) => {
      const c = v.community[i];
      if (c === undefined) { clearCard(el); return; }
      const flipping = !first && !newHand && (commPrev[i] ?? null) === null && c !== null;
      updateCard(el, c, flipping, flipping ? flipIdx++ * 140 : 0);
    });
    phaseLine.textContent = phaseText(v);
    highlight(v);

    if (newHand && !first) animateDeal(v);
    if (v.phase === 'settled' && prev?.phase !== 'settled' && !first) onSettled(v);
    if (v.phase === 'betting' && prev && prev.phase !== 'betting') { draft = { ...v.you.pending }; draftDirty = false; result.hidden = true; }
    if (first || (!draftDirty && v.phase === 'betting')) draft = { ...v.you.pending };

    renderDock(v);
    renderHistory();
    renderClock();
  }

  function phaseText(v: TableView) {
    switch (v.phase) {
      case 'waiting': return 'Waiting for players';
      case 'betting': {
        const ready = v.seats.filter((s) => s?.status === 'ready').length;
        const seated = v.seats.filter((s) => s && s.status !== 'sitting-out').length;
        return `Place your bets · ${ready} of ${seated} ready`;
      }
      case 'preflop': return 'Pre-flop · check or play 3× / 4×';
      case 'flop': return 'Flop · check or play 2×';
      case 'river': return 'River · play 1× or fold';
      case 'showdown': case 'settled': return v.dealer.handName ? `Dealer: ${v.dealer.handName}` : 'Showdown';
    }
  }

  function renderSeat(el: SeatEls, s: SeatView | null, p: SeatView | null, realSeat: number, first: boolean) {
    el.root.classList.toggle('empty-seat', !s);
    el.root.classList.toggle('mine', !!s && s.playerId === me.id);
    if (!s) {
      el.name.textContent = view!.you.role === 'spectator' ? 'Sit here' : 'Open seat';
      el.bal.textContent = '';
      el.avatar.textContent = '';
      el.status.textContent = '';
      el.cards.forEach((c) => clearCard(c));
      Object.values(el.spots).forEach((x) => { x.textContent = ''; x.classList.remove('on'); });
      el.handName.textContent = '';
      el.root.classList.remove('acting', 'won', 'lost', 'pushed', 'folded', 'away', 'host', 'ready');
      el.root.setAttribute('aria-label', `Seat ${realSeat + 1}, open`);
      return;
    }
    el.avatar.textContent = s.avatar || initials(s.name);
    el.avatar.title = s.name;
    el.name.textContent = s.name;
    el.bal.textContent = money(s.balance);
    el.root.classList.toggle('host', s.isHost);
    el.root.classList.toggle('away', !s.connected);
    el.root.classList.toggle('acting', s.needsToAct);
    el.root.classList.toggle('ready', s.status === 'ready');
    el.root.classList.toggle('folded', s.status === 'folded');
    const r = s.result;
    el.root.classList.toggle('won', !!r && r.net > 0);
    el.root.classList.toggle('lost', !!r && r.net < 0);
    el.root.classList.toggle('pushed', !!r && r.net === 0);
    el.status.textContent = !s.connected ? 'Away' : statusText(s);
    el.root.setAttribute('aria-label', `Seat ${realSeat + 1}, ${s.name}, ${money(s.balance)}, ${el.status.textContent}`);

    // cards
    const flips: number[] = [];
    s.cards.forEach((c, i) => {
      const was = p?.cards?.[i];
      const flip = !first && was === null && c !== null;
      if (flip) flips.push(i);
      updateCard(el.cards[i], c, flip, i * 120);
    });
    if (!s.cards.length) el.cards.forEach((c) => clearCard(c));
    el.handName.textContent = s.result ? (s.result.handName === 'Folded' ? '' : s.result.handName) : (s.playerId === me.id ? '' : s.handName ?? '');

    // spots + chip animations on increases
    for (const k of ['trips', 'ante', 'blind', 'play'] as const) {
      const amt = s.bet[k];
      const was = p && p.playerId === s.playerId ? p.bet[k] : 0;
      el.spots[k].textContent = amt ? money(amt) : '';
      el.spots[k].classList.toggle('on', amt > 0);
      if (!first && amt > was && (k !== 'blind')) flyChip(el.plate, el.spots[k], amt);
    }
    if (!first && p && s.lastAction && s.lastAction !== p.lastAction && s.lastAction !== 'check' && s.lastAction !== 'fold') sfx.chip();
  }

  function statusText(s: SeatView) {
    if (s.leaving) return 'Leaving';
    switch (s.status) {
      case 'betting': return s.bet.ante ? 'Betting' : 'Choosing bet';
      case 'ready': return 'Ready';
      case 'sitting-out': return 'Sitting out';
      case 'waiting-next': return 'Next hand';
      case 'folded': return 'Folded';
      case 'in-hand':
        if (s.result) return s.result.net > 0 ? `Won ${money(s.result.net)}` : s.result.net < 0 ? `Lost ${money(-s.result.net)}` : 'Push';
        if (s.needsToAct) return 'Deciding…';
        if (s.bet.play) return `Played ${s.bet.play / s.bet.ante}×`;
        return s.lastAction === 'check' ? 'Checked' : 'In hand';
    }
  }

  function updateCard(el: HTMLElement, c: string | null, flip: boolean, delay: number) {
    el.classList.remove('empty');
    const cur = el.dataset.card || null;
    const isBack = el.classList.contains('back');
    if (c === cur && (c !== null || isBack)) return;
    const ms = motionScale();
    if (flip && ms > 0) {
      const d = 160 * ms;
      setTimeout(() => {
        sfx.flip();
        el.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)' }], { duration: d, easing: 'ease-in' }).onfinish = () => {
          setCard(el, c);
          el.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0deg)' }], { duration: d, easing: 'ease-out' });
        };
      }, delay * ms);
    } else setCard(el, c);
  }
  function clearCard(el: HTMLElement) {
    el.replaceChildren();
    el.className = el.className.replace(/\b(back|hl|hl-dealer)\b/g, '').trim() + ' empty';
    el.dataset.card = '';
  }

  function highlight(v: TableView) {
    const all = [...dealerCards, ...community, ...myCards, ...seatEls.flatMap((s) => s.cards)];
    all.forEach((c) => c.classList.remove('hl', 'hl-dealer'));
    if (v.phase !== 'settled') return;
    const mine = v.you.seat !== null ? v.seats[v.you.seat] : null;
    const r = mine?.result;
    if (r?.best5 && r.net >= 0 && r.outcome !== 'fold') {
      const set = new Set(r.best5);
      [...community, ...myCards].forEach((c) => { if (set.has(c.dataset.card ?? '')) c.classList.add('hl'); });
      if (mine) seatEls.find((s) => s.root.dataset.realSeat === String(mine.seat))?.cards.forEach((c) => c.classList.add('hl'));
    } else if (v.dealer.best5 && r && r.net < 0 && r.outcome !== 'fold') {
      const set = new Set(v.dealer.best5);
      [...community, ...dealerCards].forEach((c) => { if (set.has(c.dataset.card ?? '')) c.classList.add('hl-dealer'); });
    }
  }

  // ---------------------------------------------------------------- dock
  function myView() { return view && view.you.seat !== null ? view.seats[view.you.seat] : null; }

  function renderDock(v: TableView) {
    const s = myView();
    dock.classList.toggle('spectating', !s);
    const inHand = !!s && s.cards.length > 0;
    myCards.forEach((el, i) => { if (inHand) updateCard(el, s!.cards[i], false, 0); else clearCard(el); });
    myHandName.textContent = inHand ? (s!.result?.handName ?? s!.handName ?? '') : '';

    // Spots show either the live hand's bets or the draft during betting
    const betting = v.phase === 'betting' && !!s;
    const amounts = betting ? { trips: draft.trips, ante: draft.ante, blind: draft.ante, play: 0 } : s ? s.bet : { trips: 0, ante: 0, blind: 0, play: 0 };
    for (const k of ['trips', 'ante', 'blind', 'play'] as const) {
      const el = spotEls[k];
      (el.querySelector('.spot-amt') as HTMLElement).textContent = amounts[k] ? money(amounts[k]) : '';
      el.classList.toggle('on', amounts[k] > 0);
      el.classList.toggle('clickable', betting && (k === 'ante' || k === 'trips'));
      (el as HTMLButtonElement).disabled = !(betting && (k === 'ante' || k === 'trips'));
    }
    rack.hidden = !betting;

    // Message line
    let msg = '';
    if (!s) {
      const free = v.seats.some((x) => !x);
      msg = free ? 'You are watching. Tap an open seat to join the table.' : 'You are watching this table.';
    } else if (v.phase === 'betting') {
      const need = requiredToStart(Math.max(draft.ante, v.config.minAnte), draft.trips);
      msg = s.status === 'ready' ? 'Ready — waiting for the others.' :
        s.balance < requiredToStart(v.config.minAnte, 0) ? 'Your stack can’t cover a minimum hand.' :
        draft.ante ? `Ante ${money(draft.ante)} + Blind ${money(draft.ante)}${draft.trips ? ` + Trips ${money(draft.trips)}` : ''}. Keep ${money(draft.ante)} for the Play bet.` :
        `Choose a chip, then tap Ante. Limits ${money(v.config.minAnte)}–${money(v.config.maxAnte)}. You need ${money(need)} free.`;
    } else if (s.status === 'waiting-next') msg = 'You’re in from the next hand.';
    else if (v.phase === 'settled') msg = '';
    else if (s.needsToAct) msg = v.phase === 'river' ? 'Play 1× or fold.' : v.phase === 'flop' ? 'Play 2× or check.' : 'Play 4×, 3× or check.';
    else if (inHand) msg = s.bet.play ? `Your ${money(s.bet.play)} Play bet is in. Waiting for the others.` : s.status === 'folded' ? 'You folded.' : 'Waiting for the others.';
    dockMsg.textContent = msg;

    // Controls
    controls.replaceChildren();
    if (!s) {
      const free = v.seats.findIndex((x) => !x);
      if (free >= 0) controls.append(h('button', { class: 'btn gold', onclick: () => sit(free) }, 'Take a seat'));
    } else if (v.phase === 'betting') {
      if (v.you.canReload) controls.append(h('button', { class: 'btn', onclick: reload }, `Reload ${money(v.config.startingBankroll)}`));
      if (v.you.lastBet && s.status !== 'ready') controls.append(h('button', { class: 'btn', onclick: rebet }, 'Rebet'));
      if (draft.ante || draft.trips) controls.append(h('button', { class: 'btn', disabled: s.status === 'ready', onclick: clearBets }, 'Clear'));
      if (s.status === 'ready') controls.append(h('button', { class: 'btn', onclick: () => setReady(false) }, 'Not ready'));
      else controls.append(h('button', { class: 'btn gold', disabled: !draft.ante, onclick: readyUp }, v.config.solo ? 'Deal' : 'Deal me in'));
    } else if (s.needsToAct) {
      const rec = trainerAdvice(v, s);
      for (const d of v.you.legal) {
        const amt = MULT[d] ? money((MULT[d]!) * s.bet.ante) : '';
        controls.append(h('button', {
          class: `btn act ${MULT[d] ? 'gold' : d === 'fold' ? 'danger' : ''} ${rec && prefs.get().trainer === 'training' && rec.action === d ? 'recommended' : ''}`,
          onclick: () => decide(d),
        }, DECISION_LABEL[d], amt ? h('small', {}, amt) : null));
      }
    }

    // Trainer hint
    const rec = s && s.needsToAct ? trainerAdvice(v, s) : null;
    hint.hidden = !(rec && prefs.get().trainer === 'training');
    if (rec && !hint.hidden) hint.replaceChildren(h('b', {}, `Suggested: ${DECISION_LABEL[rec.action]}. `), rec.reason);
  }

  let adviceCache: { key: string; a: ReturnType<typeof advise> } | null = null;
  function trainerAdvice(v: TableView, s: SeatView) {
    if (prefs.get().trainer === 'casino' || !s.cards[0] || !['preflop', 'flop', 'river'].includes(v.phase)) return null;
    const key = `${v.handId}|${v.phase}`;
    if (adviceCache?.key === key) return adviceCache.a;
    const hole = (s.cards as string[]).map(cardToInt);
    const comm = v.community.filter((c): c is string => !!c).map(cardToInt);
    const a = advise(v.phase as DecisionPhase, hole, comm);
    adviceCache = { key, a };
    return a;
  }

  function renderClock() {
    if (!view) return;
    const d = view.deadline;
    const now = Date.now() + clockOffset;
    let frac = 0, secs = 0;
    if (d) {
      const total = (view.phase === 'betting' ? view.config.bettingSeconds : view.config.decisionSeconds) * 1000;
      const left = Math.max(0, d - now);
      frac = Math.min(1, left / total);
      secs = Math.ceil(left / 1000);
    }
    timerBar.hidden = !d;
    (timerBar.firstChild as HTMLElement).style.transform = `scaleX(${frac})`;
    timerBar.dataset.secs = d ? `${secs}s` : '';
    timerBar.classList.toggle('low', !!d && secs <= 5);
    seatEls.forEach((s) => s.root.style.setProperty('--t', String(s.root.classList.contains('acting') ? frac : 0)));
    const mine = myView();
    if (mine?.needsToAct && secs <= 5 && secs > 0 && secs !== lastTick) { lastTick = secs; sfx.tick(); }
  }
  let lastTick = -1;

  // ---------------------------------------------------------------- actions
  function selectChip(v: number) {
    chip = v;
    rack.querySelectorAll('.chip').forEach((c) => { const on = Number((c as HTMLElement).dataset.v) === v; c.classList.toggle('sel', on); c.setAttribute('aria-checked', String(on)); });
  }

  function onSpot(k: 'ante' | 'trips') {
    if (!view || view.phase !== 'betting') return;
    const s = myView();
    if (!s || s.status === 'ready') return;
    const next = { ...draft, [k]: draft[k] + chip };
    if (k === 'ante' && next.ante > view.config.maxAnte) return toast(`The maximum Ante here is ${money(view.config.maxAnte)}.`, 'error');
    if (k === 'trips' && next.trips > view.config.maxTrips) return toast(`The maximum Trips+ bet here is ${money(view.config.maxTrips)}.`, 'error');
    if (requiredToStart(next.ante, next.trips) > s.balance)
      return toast(`That needs ${money(requiredToStart(next.ante, next.trips))} free: Ante, Blind${next.trips ? ', Trips+' : ''} and a 1× Play reserve.`, 'error');
    draft = next;
    draftDirty = true;
    sfx.chip();
    flyChip(rack.querySelector('.chip.sel') as HTMLElement, spotEls[k], chip);
    if (k === 'ante') setTimeout(() => flyChip(rack.querySelector('.chip.sel') as HTMLElement, spotEls.blind, chip), 70);
    renderDock(view);
    scheduleBetSync();
  }

  function scheduleBetSync() {
    if (betTimer) clearTimeout(betTimer);
    betTimer = window.setTimeout(syncBet, 250);
  }
  async function syncBet(): Promise<boolean> {
    betTimer = null;
    if (!draftDirty) return true;
    if (draft.ante === 0 && draft.trips === 0) { draftDirty = false; return (await call('bet:clear', { actionId: actionId() })).ok; }
    if (draft.ante === 0) { toast('Place an Ante to play. Trips+ is an optional side bet.', 'info'); return false; }
    const sent = { ...draft };
    const r = await call('bet:place', { actionId: actionId(), ante: sent.ante, trips: sent.trips });
    if (draft.ante === sent.ante && draft.trips === sent.trips) draftDirty = false;
    if (!r.ok) { toast(r.error, 'error'); draft = { ...(view?.you.pending ?? { ante: 0, trips: 0 }) }; draftDirty = false; if (view) renderDock(view); }
    return r.ok;
  }
  async function clearBets() {
    draft = { ante: 0, trips: 0 }; draftDirty = false;
    if (betTimer) clearTimeout(betTimer);
    const r = await call('bet:clear', { actionId: actionId() });
    if (!r.ok) toast(r.error, 'error');
    if (view) renderDock(view);
  }
  async function rebet() {
    const lb = view?.you.lastBet;
    if (!lb) return;
    draft = { ...lb }; draftDirty = true;
    if (await syncBet()) await setReady(true);
  }
  async function readyUp() {
    unlockAudio();
    if (betTimer) { clearTimeout(betTimer); }
    if (!(await syncBet())) return;
    await setReady(true);
  }
  async function setReady(ready: boolean) {
    const r = await call('player:ready', { actionId: actionId(), ready });
    if (!r.ok) toast(r.error, 'error');
  }
  let deciding = false;
  async function decide(d: Decision) {
    if (!view || deciding || !view.handId) return;
    deciding = true;
    unlockAudio();
    controls.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
    const r = await call('player:decide', { actionId: actionId(), handId: view.handId, phase: view.phase, decision: d });
    deciding = false;
    if (!r.ok) { toast(r.error, 'error'); if (view) renderDock(view); }
    else if (d === 'fold') sfx.lose();
  }
  async function sit(seat: number) {
    unlockAudio();
    const r = await call<{ seat: number }>('table:sit', { seat });
    if (!r.ok) toast(r.error, 'error');
  }
  async function reload() {
    const r = await call('player:reload');
    if (!r.ok) toast(r.error, 'error'); else toast('Stack reloaded with virtual chips.', 'success');
  }
  async function leave() {
    if (view && myView()?.cards.length && view.phase !== 'settled' && view.phase !== 'betting') {
      if (!confirm('Leave mid-hand? Any decisions still due will be made for you: check, then fold on the river.')) return;
    }
    await call('table:leave');
    exit();
  }
  function invite() {
    const url = `${location.origin}/table/${code}`;
    const body = h('div', { class: 'invite' },
      h('p', {}, 'Send this link to friends. They pick a name and land in an open seat.'),
      h('div', { class: 'copy-row' }, h('input', { value: url, readonly: true, 'aria-label': 'Invitation link', onfocus: (e: FocusEvent) => (e.target as HTMLInputElement).select() }),
        h('button', { class: 'btn gold', onclick: async () => { await navigator.clipboard?.writeText(url).catch(() => {}); toast('Link copied.', 'success'); } }, 'Copy link')),
      h('p', { class: 'muted' }, 'Or share the table code: ', h('b', { class: 'code-big' }, code)));
    modal('Invite friends', body);
  }

  // ---------------------------------------------------------------- chat & reactions
  function addChat(m: ChatMessage, silent = false) {
    if (m.playerId && muted.has(m.playerId)) return;
    chat.push(m);
    if (chat.length > 120) { chat.shift(); chatList.firstChild?.remove(); }
    const li = h('li', { class: `msg msg-${m.kind}` },
      m.kind === 'player' ? h('button', { class: 'who', title: 'Mute this player', onclick: () => mute(m.playerId!, m.name!) }, m.name ?? '') : null,
      h('span', {}, m.text));
    chatList.append(li);
    chatList.scrollTop = chatList.scrollHeight;
    if (m.kind === 'dealer') { dealerBubble.textContent = m.text; dealerBubble.classList.add('show'); clearTimeout((dealerBubble as any)._t); (dealerBubble as any)._t = setTimeout(() => dealerBubble.classList.remove('show'), 3200); }
    if (!silent && m.kind === 'player' && m.playerId !== me.id) {
      if (!isPanelVisible('chat')) { unread++; chatBtn.textContent = `Chat (${unread})`; }
      sfx.notify();
    }
  }
  function isPanelVisible(p: 'chat' | 'table') { return panel === p && (panelOpenMobile || matchMedia('(min-width: 1100px)').matches); }
  function mute(pid: string, name: string) {
    if (pid === me.id) return;
    if (!confirm(`Mute ${name}? Their messages will be hidden on this device.`)) return;
    muted.add(pid);
    localStorage.setItem('uth.muted', JSON.stringify([...muted]));
    toast(`${name} is muted.`);
  }
  async function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    const r = await call('chat:send', { text });
    if (r.ok) chatInput.value = ''; else toast(r.error, 'error');
  }
  async function react(r: Reaction) {
    const x = await call('chat:react', { reaction: r });
    if (!x.ok) toast(x.error, 'error');
  }
  function showReaction(p: { playerId: string; seat: number | null; reaction: Reaction }) {
    if (muted.has(p.playerId) || p.seat === null || !view) return;
    const el = seatEls.find((s) => s.root.dataset.realSeat === String(p.seat));
    if (!el) return;
    const b = h('div', { class: 'reaction' }, p.reaction);
    el.root.append(b);
    setTimeout(() => b.remove(), 2600);
  }
  function setPanel(p: 'chat' | 'table') {
    panel = p;
    tabChat.classList.toggle('on', p === 'chat'); tabTable.classList.toggle('on', p === 'table');
    chatPane.hidden = p !== 'chat'; historyPane.hidden = p !== 'table';
    if (p === 'chat') { unread = 0; chatBtn.textContent = 'Chat'; }
  }
  function togglePanel(p?: 'chat' | 'table') {
    if (p && (!panelOpenMobile || panel !== p)) { setPanel(p); panelOpenMobile = true; }
    else panelOpenMobile = false;
    side.classList.toggle('open', panelOpenMobile);
  }

  function seatMenu(sv: SeatView) {
    const body = h('div', { class: 'stack' },
      h('p', {}, `${sv.name} · ${money(sv.balance)}`),
      h('button', { class: 'btn', onclick: () => { m.close(); mute(sv.playerId, sv.name); } }, 'Mute chat'),
      view?.you.isHost ? h('button', { class: 'btn danger', onclick: () => { m.close(); kick(sv); } }, 'Remove from table') : null);
    const m = modal(sv.name, body);
  }
  async function kick(sv: SeatView) {
    if (!confirm(`Remove ${sv.name} from the table? They won't be able to rejoin.`)) return;
    const r = await call('host:kick', { playerId: sv.playerId });
    if (!r.ok) toast(r.error, 'error');
  }

  // ---------------------------------------------------------------- history / session panel
  function renderHistory() {
    if (!view) return;
    const v = view;
    const acc = sessionStats.decisions ? Math.round((sessionStats.correct / sessionStats.decisions) * 100) : null;
    const spark = sparkline(sessionStats.series);
    historyPane.replaceChildren(
      h('section', {},
        h('h3', {}, 'Your session'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Hands'), h('dd', {}, String(sessionStats.hands)),
          h('dt', {}, 'Result'), h('dd', { class: sessionStats.net < 0 ? 'neg' : 'pos' }, money(sessionStats.net, true)),
          h('dt', {}, 'Strategy'), h('dd', {}, acc === null ? '—' : `${acc}% of ${sessionStats.decisions} decisions`),
          h('dt', {}, 'EV given up'), h('dd', {}, sessionStats.evLostCents ? money(-sessionStats.evLostCents) : '—')),
        spark),
      h('section', {},
        h('h3', {}, 'Players'),
        h('ul', { class: 'plist' }, ...v.seats.filter(Boolean).map((s) => h('li', {},
          h('span', {}, `${s!.name}${s!.isHost ? ' (host)' : ''}${!s!.connected ? ' — away' : ''}`), h('span', { class: 'num' }, money(s!.balance))))),
        v.spectators ? h('p', { class: 'muted' }, `${v.spectators} watching`) : null),
      h('section', {},
        h('h3', {}, 'Recent hands'),
        v.recent.length ? h('ol', { class: 'recent' }, ...v.recent.map((r) => h('li', {},
          h('div', { class: 'rh' }, h('b', {}, `#${r.handNumber}`), ` Dealer ${r.dealerHand}${r.dealerQualifies ? '' : ' (no qualify)'}`,
            r.players.some((p) => p.name === me.name) ? h('button', { class: 'link', onclick: () => openReplay(r.handId) }, 'Replay') : null),
          h('div', { class: 'rp' }, ...r.players.map((p) => h('span', { class: p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : '' }, `${p.name} ${p.outcome === 'fold' ? 'folded' : p.handName} ${money(p.net, true)}`))))))
          : h('p', { class: 'muted' }, 'No hands played yet.')));
  }

  function sparkline(series: number[]) {
    if (series.length < 2) return h('p', { class: 'muted' }, 'Your stack graph appears after two hands.');
    const w = 260, ht = 54, min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
    const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${ht - 4 - ((v - min) / span) * (ht - 8)}`).join(' ');
    const el = svg(`<svg class="spark" viewBox="0 0 ${w} ${ht}" role="img" aria-label="Stack over this session"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`);
    return el;
  }

  // ---------------------------------------------------------------- settlement, analysis, animations
  function onSettled(v: TableView) {
    const s = myView();
    v.seats.forEach((sv) => {
      if (!sv?.result) return;
      const el = seatEls.find((x) => x.root.dataset.realSeat === String(sv.seat))!;
      const net = sv.result.net;
      el.float.textContent = money(net, true);
      el.float.className = `float show ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''} ${net >= sv.bet.ante * 8 && net > 0 ? 'big' : ''}`;
      setTimeout(() => el.float.classList.remove('show'), 3800 * Math.max(motionScale(), 0.5));
      const spotsWithStake = (['trips', 'ante', 'blind', 'play'] as const).filter((k) => sv.bet[k] > 0);
      if (net > 0) spotsWithStake.forEach((k, i) => setTimeout(() => flyChip(tray, el.plate, sv.bet[k], true), 500 + i * 90));
      else if (net < 0) spotsWithStake.forEach((k, i) => setTimeout(() => flyChip(el.spots[k], tray, sv.bet[k], true), 500 + i * 90));
    });
    if (s?.result) {
      const r = s.result;
      setTimeout(() => { r.net >= s.bet.ante * 8 ? sfx.bigWin() : r.net > 0 ? sfx.win() : r.net < 0 ? sfx.lose() : sfx.push(); if (r.net) sfx.payout(); }, 450);
      sessionStats.hands++;
      sessionStats.net += r.net;
      sessionStats.series.push(s.balance);
      if (sessionStats.series.length === 1) sessionStats.series.unshift(s.balance - r.net);
      renderResult(v, s);
    }
  }

  function renderResult(v: TableView, s: SeatView) {
    const r = s.result!;
    const title = r.outcome === 'fold' ? 'Folded' : r.net > 0 ? `You win ${money(r.net)}` : r.net < 0 ? `You lose ${money(-r.net)}` : 'Push';
    const decisions = analysis.get(v.handId!) ?? [];
    const showGrades = prefs.get().trainer !== 'casino';
    result.hidden = false;
    result.className = `my-result ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}`;
    result.replaceChildren();
    append(result, [
      h('div', { class: 'res-title' }, title, h('small', {}, ` ${r.handName} vs dealer ${v.dealer.handName ?? ''}`)),
      h('ul', { class: 'lines' }, ...r.lines.map((l) => h('li', {},
        h('span', { title: l.note ?? '' }, `${l.wager === 'trips' ? 'Trips+' : l.wager[0].toUpperCase() + l.wager.slice(1)}`),
        h('span', { class: l.net > 0 ? 'pos' : l.net < 0 ? 'neg' : '' }, l.result === 'push' ? 'Push' : money(l.net, true))))),
      showGrades && decisions.length ? h('ul', { class: 'grades' }, ...decisions.map((d) => h('li', { class: d.correct ? 'ok' : 'bad' },
        `${d.correct ? '✓' : '✗'} ${cap(d.phase)}: ${DECISION_LABEL[d.action]}${d.timedOut ? ' (timed out)' : ''}`,
        d.correct ? '' : ` — best was ${DECISION_LABEL[d.recommended]}${d.evCost !== undefined ? `, costing ${d.evCost.toFixed(2)} antes${d.evExact ? '' : ' (est.)'} (${money(d.evCostCents ?? 0)})` : ''}`,
        d.correct ? null : h('div', { class: 'why' }, d.reason)))) : null,
      showGrades && decisions.length && r.net > 0 && decisions.some((d) => !d.correct) ? h('p', { class: 'muted' }, 'You won this hand, but the mistake still cost expected value — results and decisions are graded separately.') : null]);
  }
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1).replace('preflop', 'Pre-flop');

  function onAnalysis(p: { handId: string; decisions: DecisionRecord[] }) {
    analysis.set(p.handId, p.decisions);
    sessionStats.decisions += p.decisions.length;
    sessionStats.correct += p.decisions.filter((d) => d.correct).length;
    sessionStats.evLostCents += p.decisions.reduce((s, d) => s + (d.evCostCents ?? 0), 0);
    const s = myView();
    if (view?.handId === p.handId && view.phase === 'settled' && s?.result) renderResult(view, s);
    renderHistory();
  }

  function animateDeal(v: TableView) {
    const ms = motionScale();
    if (!ms) return;
    const order: HTMLElement[] = [];
    const seatsInHand = v.seats.filter((s) => s && s.cards.length).map((s) => seatEls.find((e) => e.root.dataset.realSeat === String(s!.seat))!);
    for (const round of [0, 1]) {
      seatsInHand.forEach((e) => order.push(e.cards[round]));
      order.push(dealerCards[round]);
    }
    const from = shoe.getBoundingClientRect();
    order.forEach((el, i) => {
      const to = el.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
      el.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(-35deg) scale(.55)`, opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 },
      ], { duration: 420 * ms, delay: i * 120 * ms, easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'backwards' });
      setTimeout(() => sfx.deal(), i * 120 * ms);
    });
    myCards.forEach((el, i) => el.animate([{ transform: 'translateY(-40px) rotate(-8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 380 * ms, delay: (order.length * 0.5 + i * 2) * 120 * ms, easing: 'cubic-bezier(.2,.7,.25,1)', fill: 'backwards' }));
  }

  function flyChip(fromEl: HTMLElement | null, toEl: HTMLElement | null, amount: number, stack = false) {
    const ms = motionScale();
    if (!ms || !fromEl || !toEl || !fromEl.isConnected || !toEl.isConnected) return;
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    if (!a.width || !b.width) return;
    const denom = [...CHIPS].reverse().find((c) => c <= amount) ?? 100;
    const count = stack ? 3 : 1;
    for (let k = 0; k < count; k++) {
      const c = h('div', { class: `chip flying ${CHIP_CLASS[denom]}` }, h('span', {}, CHIP_LABEL[denom]));
      document.body.append(c);
      const x0 = a.left + a.width / 2 - 14, y0 = a.top + a.height / 2 - 14;
      const x1 = b.left + b.width / 2 - 14, y1 = b.top + b.height / 2 - 14 - k * 3;
      c.style.left = `${x0}px`; c.style.top = `${y0}px`;
      c.animate([
        { transform: 'translate(0,0) scale(.9)', opacity: 0.2 },
        { transform: `translate(${(x1 - x0) / 2}px, ${(y1 - y0) / 2 - 30}px) scale(1.05)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${x1 - x0}px, ${y1 - y0}px) scale(.85)`, opacity: 1 },
      ], { duration: 460 * ms, delay: k * 70 * ms, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'both' }).onfinish = () => c.remove();
    }
  }

  // ---------------------------------------------------------------- host menu
  function openHostMenu() {
    if (!view) return;
    const c = view.config;
    const inHand = !!view.handId && view.phase !== 'settled';
    const num = (name: string, label: string, value: number, attrs: Record<string, number> = {}) =>
      h('label', {}, label, h('input', { name, type: 'number', value, ...attrs }));
    const form = h('form', { class: 'form-grid' },
      h('label', { class: 'span2' }, 'Table name', h('input', { name: 'name', value: c.name, maxlength: 40 })),
      num('minAnte', 'Minimum Ante ($)', c.minAnte / 100, { min: 1, step: 1 }),
      num('maxAnte', 'Maximum Ante ($)', c.maxAnte / 100, { min: 1, step: 1 }),
      num('maxTrips', 'Maximum Trips+ ($)', c.maxTrips / 100, { min: 0, step: 1 }),
      num('startingBankroll', 'Starting stack for new players ($)', c.startingBankroll / 100, { min: 10, step: 1 }),
      num('decisionSeconds', 'Decision timer (s)', c.decisionSeconds, { min: 5, max: 120 }),
      num('bettingSeconds', 'Betting timer (s)', c.bettingSeconds, { min: 5, max: 120 }),
      num('maxSeats', 'Seats', c.maxSeats, { min: 2, max: 6 }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'isPublic', checked: c.isPublic }), 'List in public tables'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'allowSpectators', checked: c.allowSpectators }), 'Allow spectators'),
      h('button', { class: 'btn gold span2', disabled: inHand }, inHand ? 'Settings can be changed between hands' : 'Save settings'),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const dollars = (k: string) => Math.round(Number(fd.get(k)) * 100);
      const r = await call('host:settings', {
        name: String(fd.get('name')), minAnte: dollars('minAnte'), maxAnte: dollars('maxAnte'), maxTrips: dollars('maxTrips'),
        startingBankroll: dollars('startingBankroll'), decisionSeconds: Number(fd.get('decisionSeconds')), bettingSeconds: Number(fd.get('bettingSeconds')),
        maxSeats: Number(fd.get('maxSeats')), isPublic: fd.get('isPublic') === 'on', allowSpectators: fd.get('allowSpectators') === 'on',
      });
      if (r.ok) { toast('Settings saved.', 'success'); m.close(); } else toast(r.error, 'error');
    });
    const others = view.seats.filter((s): s is SeatView => !!s && s.playerId !== me.id);
    const body = h('div', { class: 'stack' },
      form,
      h('h3', {}, 'Players'),
      others.length ? h('ul', { class: 'plist' }, ...others.map((s) => h('li', {}, h('span', {}, s.name),
        h('button', { class: 'btn small danger', onclick: () => { m.close(); kick(s); } }, 'Remove')))) : h('p', { class: 'muted' }, 'Nobody else is seated.'),
      h('p', { class: 'muted' }, 'Hosts manage the room only. Cards, shuffling, payouts and other players’ chips are controlled by the server.'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (!confirm('Close this table for everyone? A hand in progress finishes first.')) return;
        const r = await call('host:close'); if (!r.ok) toast(r.error, 'error'); else m.close();
      } }, 'Close table'));
    const m = modal('Host controls', body, { wide: true });
  }

  void BLIND_PAYTABLE; void TRIPS_PAYTABLE;
  return { dispose };
}
