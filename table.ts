import { cardToInt } from '../../shared/cards.js';
import type { ChatMessage, DecisionRecord, Reaction, SeatView, TableView } from '../../shared/protocol.js';
import { REACTIONS } from '../../shared/protocol.js';
import { BLIND_PAYTABLE, NO_BETS, TRIPS_PAYTABLE, requiredToStart, sideTotal, type Decision, type DecisionPhase, type InitialBets } from '../../shared/rules.js';
import { BAD_BEAT_VARIANTS, PAIRS_VARIANTS, previewPairs } from '../../shared/sidebets.js';
import { PROGRESSIVE, progressiveHand } from '../../shared/progressive.js';
import { pawnFor } from '../../shared/debt.js';
import type { WagerKey } from '../../shared/protocol.js';
import { advise } from '../../shared/strategy.js';
import { session } from '../api.js';
import { cardEl, setCard } from '../cardView.js';
import { append, h, initials, modal, money, svg, toast } from '../dom.js';
import { actionId, call, getSocket, onStatus, setCurrentTable } from '../net.js';
import { motionScale, prefs, setTableTheme } from '../settings.js';
import { sfx, unlockAudio } from '../sound.js';
import { openSettings, tableLook } from './settingsModal.js';
import { openReplay } from './replay.js';
import { fetchChips, fetchPawns, fetchRecap, openPastNights, openRecap, renderNight } from './night.js';
import { openHelp, openPayTables, readSideBetFields, sideBetFields } from './help.js';
import { outsEl, outsText } from './outs.js';
import { outsFor } from '../../shared/strategy.js';

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
  1: [[50, 85]],
  2: [[32, 84], [68, 84]],
  3: [[17, 72], [50, 88], [83, 72]],
  4: [[14, 63], [34, 87], [66, 87], [86, 63]],
  5: [[12, 58], [17, 79], [50, 92], [83, 79], [88, 58]],
  6: [[12, 57], [12, 77], [33, 92], [67, 92], [88, 77], [88, 57]],
};

const ALL_WAGERS: WagerKey[] = ['ante', 'blind', 'play', 'trips', 'pairs', 'badBeat', 'progressive'];
const BETTABLE: WagerKey[] = ['ante', 'trips', 'pairs', 'badBeat', 'progressive'];
const SIDE_KEYS = ['trips', 'pairs', 'badBeat', 'progressive'] as const;
const WAGER_NAME: Record<WagerKey, string> = { ante: 'Ante', blind: 'Blind', play: 'Play', trips: 'Trips+', pairs: 'Ultimate Pairs', badBeat: 'Bad Beat', progressive: '$5 Progressive' };

const narrowScreen = () => matchMedia('(max-width: 760px)').matches;
const DECISION_LABEL: Record<Decision, string> = { play4: 'Play 4×', play3: 'Play 3×', play2: 'Play 2×', play1: 'Play 1×', check: 'Check', fold: 'Fold' };
const MULT: Partial<Record<Decision, number>> = { play4: 4, play3: 3, play2: 2, play1: 1 };

interface SeatEls {
  root: HTMLElement; plate: HTMLElement; avatar: HTMLElement; name: HTMLElement; bal: HTMLElement; status: HTMLElement;
  cards: HTMLElement[]; spots: Record<WagerKey, HTMLElement>; handName: HTMLElement; float: HTMLElement; gem: HTMLElement;
}

export function mountTable(root: HTMLElement, code: string, onExit: (msg?: string) => void) {
  const me = session.me!;
  const sock = getSocket();
  let view: TableView | null = null;
  let prev: TableView | null = null;
  let clockOffset = 0;
  let chip = 2500;
  let draft: InitialBets = { ...NO_BETS };
  let draftDirty = false;
  let betTimer: number | null = null;
  let chat: ChatMessage[] = [];
  const muted = new Set<string>(JSON.parse(localStorage.getItem('uth.muted') ?? '[]'));
  const analysis = new Map<string, DecisionRecord[]>();
  const sessionStats = { hands: 0, net: 0, baseNet: 0, decisions: 0, correct: 0, evLostCents: 0, series: [] as number[],
    side: { trips: { bets: 0, wins: 0, net: 0 }, pairs: { bets: 0, wins: 0, net: 0 }, badBeat: { bets: 0, wins: 0, net: 0 }, progressive: { bets: 0, wins: 0, net: 0 } } };
  let panel: 'chat' | 'table' | 'night' = 'chat';
  let panelOpenMobile = false;
  let unread = 0;
  let disposed = false;

  // ---------------------------------------------------------------- skeleton
  const tableName = h('span', { class: 'tname' });
  const statusPill = h('span', { class: 'conn', hidden: true }, 'Reconnecting…');
  const jackpotAmt = h('b', { class: 'jp-amt' });
  const jackpotSign = h('button', { class: 'jackpot', title: 'Five Card Progressive — linked jackpot. Tap for the pay table.', hidden: true,
    onclick: () => view && openPayTables(view.config, view.jackpot?.amount) }, h('span', { class: 'jp-label' }, 'Progressive'), jackpotAmt);
  let shownJackpot = 0;
  const hostBtn = h('button', { class: 'ghost hide-m', onclick: () => openHostMenu(), hidden: true }, 'Host');
  // Phones: one tidy row — back, name, jackpot, chat, and a menu for everything else.
  const moreBtn = h('button', { class: 'ghost more-btn', 'aria-label': 'Table menu', title: 'Table menu', onclick: () => openMoreMenu() }, '☰');
  const chatBtn = h('button', { class: 'ghost panel-toggle', onclick: () => togglePanel('chat') }, 'Chat');
  const top = h('header', { class: 'tbar' },
    h('button', { class: 'ghost back-btn', 'aria-label': 'Back to the lobby', onclick: () => leave() }, '←', h('span', { class: 'hide-m' }, ' Lobby')),
    h('div', { class: 'tbar-title' }, tableName, h('button', { class: 'code', title: 'Copy invitation link', onclick: () => invite() }, code)),
    statusPill, jackpotSign,
    h('div', { class: 'tbar-actions' },
      h('button', { class: 'ghost hide-m', onclick: () => invite() }, 'Invite'),
      chatBtn,
      h('button', { class: 'ghost panel-toggle hide-m', onclick: () => togglePanel('night') }, 'Tonight'),
      h('button', { class: 'ghost panel-toggle hide-m', onclick: () => togglePanel('table') }, 'History'),
      hostBtn,
      h('button', { class: 'ghost hide-m', onclick: () => openHelp() }, 'Rules'),
      h('button', { class: 'ghost hide-m', 'aria-label': 'Settings', title: 'Settings', onclick: () => openSettings({ inTable: true, view: () => view }) }, 'Settings'),
      moreBtn));

  function openMoreMenu() {
    const item = (label: string, sub: string, fn: () => void) => h('button', { class: 'menu-item', onclick: () => { m.close(); fn(); } },
      h('b', {}, label), h('small', {}, sub));
    const body = h('div', { class: 'menu-list' },
      item('Invite friends', `Share the link · code ${code}`, () => invite()),
      item('Tonight', 'Leaderboard, biggest wins and losses, best hands', () => togglePanel('night')),
      item('Table & history', 'Players, recent hands, your session', () => togglePanel('table')),
      view?.you.isHost && !view.config.solo ? item('Host controls', 'Players, limits, felt and card colors', () => openHostMenu()) : null,
      (() => {
        const me = view && view.you.seat !== null ? view.seats[view.you.seat] : null;
        if (!me || view!.config.solo) return null;
        return me.sitOut ? item('Sit back in', 'Get dealt in from the next hand', () => setSitOut(false))
          : item('Sit out', 'Keep your seat and chips, skip hands', () => setSitOut(true));
      })(),
      item('Settings', 'Sound, animations, strategy trainer', () => openSettings({ inTable: true, view: () => view })),
      item('How to play', 'Rules and pay tables', () => openHelp()),
      item('Leave table', 'Back to the lobby', () => leave()));
    const m = modal(view?.config.name ?? 'Table', body);
  }

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
  const spotEls: Record<WagerKey, HTMLElement> = {
    ante: spot('Ante', 'ante'), blind: spot('Blind', 'blind'), play: spot('Play', 'play'),
    trips: spot('Trips+', 'trips', true), pairs: spot('Ultimate Pairs', 'pairs', true), badBeat: spot('Bad Beat', 'badBeat', true),
    progressive: spot('$5 Progressive', 'progressive', true),
  };
  spotEls.progressive.title = 'Fixed $5 bet. Tap to add or remove — the chip you have selected does not matter.';
  // Side bets sit in their own smaller row; on phones they fold into one expandable Bonus bets panel.
  const bonusToggle = h('button', { class: 'bonus-toggle', 'aria-expanded': 'false', onclick: () => {
    const open = !bonusPanel.classList.contains('open');
    bonusPanel.classList.toggle('open', open);
    bonusToggle.setAttribute('aria-expanded', String(open));
  } });
  const bonusPanel = h('div', { class: 'bonus-panel' },
    bonusToggle,
    h('div', { class: 'bonus-body' },
      h('div', { class: 'bonus-spots' }, spotEls.trips, spotEls.pairs, spotEls.badBeat, spotEls.progressive),
      h('button', { class: 'link paytable-link', onclick: () => view && openPayTables(view.config, view.jackpot?.amount) }, 'Pay tables')));
  const totals = h('div', { class: 'totals' });
  const autoRow = h('div', { class: 'auto-row', hidden: true });
  const bonusFlash = h('div', { class: 'bonus-flash', hidden: true, role: 'status' });
  const rack = h('div', { class: 'rack', role: 'radiogroup', 'aria-label': 'Chip value' },
    ...CHIPS.map((c) => h('button', { class: `chip ${CHIP_CLASS[c]}`, role: 'radio', 'aria-label': `$${CHIP_LABEL[c]} chip`, 'data-v': c, onclick: () => selectChip(c) }, h('span', {}, CHIP_LABEL[c]))));
  const controls = h('div', { class: 'controls' });
  const dockMsg = h('div', { class: 'dock-msg' });
  const result = h('div', { class: 'my-result', hidden: true });
  const dock = h('section', { class: 'dock', 'aria-label': 'Your seat' },
    h('div', { class: 'dock-hand' }, h('div', { class: 'cards-row' }, ...myCards), myHandName),
    h('div', { class: 'dock-mid' },
      timerBar, dockMsg,
      h('div', { class: 'bet-layout' },
        h('div', { class: 'spots' }, spotEls.ante, spotEls.blind, spotEls.play),
        bonusPanel),
      totals, autoRow, bonusFlash, hint, result),
    h('div', { class: 'dock-right' }, rack, controls));

  // Side panel
  const chatList = h('ol', { class: 'chat-list', 'aria-live': 'polite' });
  const chatInput = h('input', { maxlength: 240, placeholder: 'Message the table', 'aria-label': 'Chat message' }) as HTMLInputElement;
  const reactRow = h('div', { class: 'reacts' }, ...REACTIONS.map((r) => h('button', { class: 'react', onclick: () => react(r) }, r)));
  const chatPane = h('div', { class: 'pane pane-chat' }, chatList,
    reactRow,
    h('form', { class: 'chat-form', onsubmit: (e: Event) => { e.preventDefault(); sendChat(); } }, chatInput, h('button', { class: 'btn small' }, 'Send')));
  const historyPane = h('div', { class: 'pane pane-table', hidden: true });
  const nightPane = h('div', { class: 'pane pane-night', hidden: true });
  const tabNight = h('button', { class: 'tab', onclick: () => setPanel('night') }, 'Tonight');
  const tabChat = h('button', { class: 'tab on', onclick: () => setPanel('chat') }, 'Chat');
  const tabTable = h('button', { class: 'tab', onclick: () => setPanel('table') }, 'History');
  const side = h('aside', { class: 'side' },
    h('div', { class: 'tabs' }, tabChat, tabNight, tabTable, h('button', { class: 'icon-btn side-close', 'aria-label': 'Close panel', onclick: () => togglePanel() }, '✕')),
    chatPane, nightPane, historyPane);

  const screen = h('div', { class: 'table-screen' }, top, h('div', { class: 'stage' }, h('div', { class: 'table-area' }, tableEl), side), dock);
  root.replaceChildren(screen);
  selectChip(chip);

  // ---------------------------------------------------------------- builders
  function spot(label: string, key: WagerKey, bonus = false) {
    return h('button', { class: `spot spot-${key} ${bonus ? 'bonus' : ''}`, 'data-k': key, 'aria-label': label, onclick: () => onSpot(key) },
      h('span', { class: 'spot-label' }, label), h('span', { class: 'spot-amt' }));
  }

  function makeSeat(i: number): SeatEls {
    const cards = [cardEl(null, 'empty sm'), cardEl(null, 'empty sm')];
    const mk = (k: WagerKey, title: string) => h('div', { class: `mini-spot ms-${k}`, title });
    const spots: Record<WagerKey, HTMLElement> = {
      ante: mk('ante', 'Ante'), blind: mk('blind', 'Blind'), play: mk('play', 'Play'),
      trips: mk('trips', 'Trips+'), pairs: mk('pairs', 'Ultimate Pairs'), badBeat: mk('badBeat', 'Bad Beat'),
      progressive: mk('progressive', '$5 Progressive'),
    };
    const gem = h('div', { class: 'gem', hidden: true });
    const avatar = h('div', { class: 'avatar' });
    const name = h('div', { class: 'pname' });
    const bal = h('div', { class: 'pbal' });
    const status = h('div', { class: 'pstatus' });
    const handName = h('div', { class: 'hand-name' });
    const float = h('div', { class: 'float' });
    const plate = h('div', { class: 'plate' }, avatar, h('div', { class: 'pinfo' }, name, bal), status);
    const root = h('div', { class: 'seat empty-seat', 'data-seat': i },
      h('div', { class: 'cards-row' }, ...cards), handName,
      h('div', { class: 'mini-bonus' }, spots.trips, spots.pairs, spots.badBeat, spots.progressive),
      h('div', { class: 'mini-spots' }, spots.ante, spots.blind, spots.play),
      plate, float, gem);
    root.addEventListener('click', (e) => {
      if (!view) return;
      const seat = Number(root.dataset.realSeat);
      const sv = view.seats[seat];
      if (!sv && view.you.role === 'spectator') sit(seat);
      else if (sv && sv.playerId !== me.id && (e.target as HTMLElement).closest('.plate')) seatMenu(sv);
    });
    return { root, plate, avatar, name, bal, status, cards, spots, handName, float, gem };
  }

  // ---------------------------------------------------------------- socket wiring
  const handlers = {
    state: (v: TableView) => {
      clockOffset = v.serverNow - Date.now(); prev = view; view = v; render();
      // Keep the running tab current: refresh once per settled hand while it's on screen.
      if (v.phase === 'settled' && prev?.phase !== 'settled' && isPanelVisible('night')) setTimeout(refreshNight, 300);
    },
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
  const onJackpotHit = (p: { tableName: string; playerName: string; hand: string; amount: number; same: boolean }) => {
    // Linked jackpot: every table hears about it. Your own table already sees it in the hand result.
    if (p.same) return;
    toast(`${p.hand === 'Royal Flush' ? 'Jackpot! ' : ''}${p.playerName} hit a ${p.hand} on the progressive at ${p.tableName} — ${money(p.amount)}.`, 'info');
  };
  sock.on('jackpot:hit', onJackpotHit);
  sock.on('night:ended', onNightEnded);
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
    sock.off('jackpot:hit', onJackpotHit);
    sock.off('night:ended', onNightEnded);
    sock.off('chat:message', handlers.chat);
    sock.off('chat:history', handlers.history);
    sock.off('chat:reaction', handlers.reaction);
    sock.off('hand:analysis', handlers.analysis);
    sock.off('table:closed', handlers.closed);
    sock.off('kicked', handlers.kicked);
    offStatus();
    setCurrentTable(null);
    setTableTheme(null);
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
    setTableTheme({ felt: v.config.felt, cardBack: v.config.cardBack });
    renderJackpot(v);

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
    // Bonus bets lock at the deal, so the phone panel folds away to give the table room.
    if (v.phase !== 'betting' && bonusPanel.classList.contains('open')) { bonusPanel.classList.remove('open'); bonusToggle.setAttribute('aria-expanded', 'false'); }
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
      delete el.root.dataset.st;
      el.root.setAttribute('aria-label', `Seat ${realSeat + 1}, open`);
      return;
    }
    el.avatar.textContent = s.avatar || initials(s.name);
    el.avatar.title = s.name;
    el.name.textContent = s.name;
    el.bal.textContent = money(s.balance);
    el.bal.dataset.debt = s.debt ? `IOU ${money(s.debt)}` : '';
    el.bal.title = s.debt ? `${s.name} owes the house ${money(s.debt)} in markers — just for fun.` : '';
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
    el.root.dataset.st = !s.connected ? 'away' : s.leaving || s.standingUp ? 'leaving' : s.status;
    // Phones show short tags only when they tell you something: Ready, Checked, Played 3×, Folded, Away…
    const tag = el.status.textContent ?? '';
    el.root.dataset.tag = /^(In hand|Choosing bet|Betting|Next hand|Won |Lost |Push)/.test(tag) || !tag ? '' : '1';
    el.root.dataset.act = s.lastAction ?? '';
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
    el.handName.textContent = s.result ? `${s.result.handName}${s.result.outcome === 'fold' ? ' (folded)' : ''}` : (s.playerId === me.id ? '' : s.handName ?? '');

    // spots + chip animations on increases
    for (const k of ALL_WAGERS) {
      const amt = s.bet[k] ?? 0;
      const was = p && p.playerId === s.playerId ? (p.bet[k] ?? 0) : 0;
      el.spots[k].textContent = amt ? money(amt) : '';
      el.spots[k].classList.toggle('on', amt > 0);
      if (!first && amt > was && (k !== 'blind')) flyChip(el.plate, el.spots[k], amt);
    }
    // Bonus gem: visible to everyone only once the result is public; never reveals a folded hand's combination.
    const hits = s.result?.lines.filter((l) => (l.wager === 'pairs' || l.wager === 'badBeat' || l.wager === 'progressive') && l.result === 'win') ?? [];
    el.gem.hidden = !hits.length;
    el.gem.textContent = hits.map((l) => l.wager === 'progressive' ? `Progressive ${money(l.credit)}`
      : (l.wager === 'pairs' ? 'Pairs' : 'Bad Beat') + (l.multiplier ? ` ${l.multiplier.toLocaleString('en-US')}:1` : '')).join(' · ');
    if (!first && p && s.lastAction && s.lastAction !== p.lastAction && s.lastAction !== 'check' && s.lastAction !== 'fold') sfx.chip();
  }

  function statusText(s: SeatView) {
    if (s.leaving) return 'Leaving';
    if (s.standingUp) return 'To the rail';
    switch (s.status) {
      case 'betting': return s.bet.ante ? 'Betting' : 'Choosing bet';
      case 'ready': return 'Ready';
      case 'sitting-out': return s.awayByHost ? 'Away' : 'Sitting out';
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
    if (!r) return;
    const markMine = () => {
      const set = new Set(r.best5 ?? []);
      [...community, ...myCards].forEach((c) => { if (set.has(c.dataset.card ?? '')) c.classList.add('hl'); });
      seatEls.find((x) => x.root.dataset.realSeat === String(mine!.seat))?.cards.forEach((c) => { if (set.has(c.dataset.card ?? '')) c.classList.add('hl'); });
    };
    const markDealer = () => {
      const set = new Set(v.dealer.best5 ?? []);
      [...community, ...dealerCards].forEach((c) => { if (set.has(c.dataset.card ?? '') && !c.classList.contains('hl')) c.classList.add('hl-dealer'); });
    };
    // A Bad Beat highlights both the winning and the losing combination.
    // Other players' winning hands light up on their own seats (their best cards from their two hole cards).
    for (const sv of v.seats) {
      if (!sv?.result || sv.seat === mine?.seat || !(sv.result.net > 0)) continue;
      const set = new Set(sv.result.best5 ?? []);
      seatEls.find((x) => x.root.dataset.realSeat === String(sv.seat))?.cards.forEach((c) => { if (set.has(c.dataset.card ?? '')) c.classList.add('hl'); });
    }
    if (r.lines.some((l) => l.wager === 'badBeat' && l.result === 'win')) { markMine(); markDealer(); return; }
    if (r.outcome === 'win' || r.outcome === 'push') markMine();
    else if (r.outcome === 'lose') markDealer();
  }

  // ---------------------------------------------------------------- dock
  function myView() { return view && view.you.seat !== null ? view.seats[view.you.seat] : null; }

  function renderDock(v: TableView) {
    const s = myView();
    dock.classList.toggle('spectating', !s);
    const inHand = !!s && s.cards.length > 0;
    dock.classList.toggle('no-hand', !inHand);
    myCards.forEach((el, i) => { if (inHand) updateCard(el, s!.cards[i], false, 0); else clearCard(el); });
    myHandName.textContent = inHand ? (s!.result?.handName ?? s!.handName ?? '') : '';

    // Spots show either the live hand's bets or the draft during betting
    const betting = v.phase === 'betting' && !!s;
    const amounts: Record<WagerKey, number> = betting
      ? { ante: draft.ante, blind: draft.ante, play: 0, trips: draft.trips, pairs: draft.pairs, badBeat: draft.badBeat, progressive: draft.progressive }
      : s ? s.bet : { ante: 0, blind: 0, play: 0, trips: 0, pairs: 0, badBeat: 0, progressive: 0 };
    spotEls.progressive.hidden = !v.config.progressive && !amounts.progressive;
    const editable = (k: WagerKey) => betting && s!.status !== 'ready' && BETTABLE.includes(k);
    for (const k of ALL_WAGERS) {
      const el = spotEls[k];
      (el.querySelector('.spot-amt') as HTMLElement).textContent = amounts[k] ? money(amounts[k]) : '';
      el.classList.toggle('on', amounts[k] > 0);
      el.classList.toggle('clickable', editable(k));
      (el as HTMLButtonElement).disabled = !editable(k);
    }
    const sideSum = amounts.trips + amounts.pairs + amounts.badBeat + amounts.progressive;
    bonusToggle.replaceChildren(h('span', {}, narrowScreen() ? 'Bonus' : 'Bonus bets'), h('b', {}, sideSum ? money(sideSum) : narrowScreen() ? '+' : 'none'));
    rack.hidden = !betting;

    // Committed vs reserved: everything on the table, plus what must stay free for a 1× Play.
    if (s) {
      const committed = amounts.ante + amounts.blind + amounts.play + sideSum;
      const reserve = (betting || (inHand && !s.bet.play && s.status !== 'folded' && !s.result)) ? amounts.ante : 0;
      totals.hidden = !committed;
      totals.replaceChildren();
      append(totals, [
        h('span', {}, 'On the table ', h('b', {}, money(committed))),
        reserve ? h('span', {}, 'Reserved for 1× Play ', h('b', {}, money(reserve))) : null,
        h('span', {}, betting ? 'Free after bets ' : 'Stack ', h('b', {}, money(betting ? s.balance - committed - reserve : s.balance))),
        null]);
    } else totals.hidden = true;
    renderPairsFlash(v, s);
    renderAuto(v, s);

    // Message line
    let msg = '';
    if (!s) {
      const free = v.seats.some((x) => !x);
      msg = free ? 'You are watching. Tap an open seat to join the table.' : 'You are watching this table.';
    } else if (v.phase === 'betting') {
      const need = requiredToStart(Math.max(draft.ante, v.config.minAnte), sideTotal(draft));
      msg = s.status === 'sitting-out' ? (s.awayByHost ? 'The host set you away. Tap Sit back in to play the next hand.' : 'You’re sitting out. Your seat and chips are saved — tap Sit back in when you’re ready.') :
        s.status === 'ready' ? 'Ready — waiting for the others.' :
        s.balance < requiredToStart(v.config.minAnte) ? 'Your stack can’t cover a minimum hand.' :
        draft.ante ? 'Add bonus bets if you like, then deal in. Bonus bets lock when the cards come out.' :
        `Choose a chip, then tap Ante. Limits ${money(v.config.minAnte)}–${money(v.config.maxAnte)}. You need ${money(need)} free.`;
    } else if (s.standingUp) msg = 'The host is moving you to the spectators after this hand. Your chips stay with you.';
    else if (s.status === 'sitting-out') msg = 'You’re sitting out — you’ll be dealt in when you sit back in.';
    else if (s.sitOut && inHand && v.phase !== 'settled') msg = 'You’ll sit out after this hand.';
    else if (s.status === 'waiting-next') msg = 'You’re in from the next hand.';
    else if (v.phase === 'settled') msg = '';
    else if (s.needsToAct) msg = v.phase === 'river' ? 'Play 1× or fold.' : v.phase === 'flop' ? 'Play 2× or check.' : 'Play 4×, 3× or check.';
    else if (inHand) msg = s.bet.play ? `Your ${money(s.bet.play)} Play bet is in. Waiting for the others.` : s.status === 'folded' ? 'You folded.' : 'Waiting for the others.';
    dockMsg.textContent = msg;

    // Controls
    controls.replaceChildren();
    if (!s) {
      const free = v.seats.findIndex((x) => !x);
      if (free >= 0) controls.append(h('button', { class: 'btn gold', onclick: () => sit(free) }, 'Take a seat'));
    } else if (v.phase === 'betting' && s.status === 'sitting-out') {
      controls.append(h('button', { class: 'btn gold', onclick: async () => {
        const r = await call('player:prefs', { sitOut: false }); if (!r.ok) toast(r.error, 'error');
      } }, 'Sit back in'));
    } else if (v.phase === 'betting') {
      if (!v.config.solo && s.status !== 'ready') controls.append(h('button', { class: 'btn subtle', onclick: () => setSitOut(true) }, 'Sit out'));
      if (v.you.canReload) controls.append(h('button', { class: 'btn', onclick: reload }, `Reload ${money(v.config.startingBankroll)}`));
      if (v.you.lastBet && s.status !== 'ready') controls.append(h('button', { class: 'btn', onclick: rebet }, 'Rebet'));
      if (draft.ante || sideTotal(draft)) controls.append(h('button', { class: 'btn', disabled: s.status === 'ready', onclick: clearBets }, 'Clear'));
      if (s.status === 'ready') controls.append(h('button', { class: 'btn', onclick: () => setReady(false) }, 'Not ready'));
      else controls.append(h('button', { class: 'btn gold', disabled: !draft.ante, onclick: readyUp }, v.config.solo ? 'Deal' : 'Deal me in'));
    } else if (inHand && !v.config.solo && v.phase !== 'settled' && !s.needsToAct) {
      // Schedule (or cancel) sitting out after the current hand.
      controls.append(s.sitOut
        ? h('button', { class: 'btn subtle', onclick: () => setSitOut(false) }, 'Stay in next hand')
        : h('button', { class: 'btn subtle', onclick: () => setSitOut(true) }, 'Sit out next hand'));
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
    if (rec && !hint.hidden) {
      const o = outsFor(v.phase as DecisionPhase, (s!.cards as string[]).map(cardToInt), v.community.filter((c): c is string => !!c).map(cardToInt));
      hint.replaceChildren(h('b', {}, `Suggested: ${DECISION_LABEL[rec.action]}. `), rec.reason, o ? h('div', { class: 'outs' }, outsText(o)) : '');
    }
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
    seatEls.forEach((s) => {
      const acting = s.root.classList.contains('acting') && !!d;
      s.root.style.setProperty('--t', String(acting ? frac : 0));
      // Seconds left, shown on every deciding player's avatar (server clock).
      if (acting) s.avatar.dataset.secs = String(secs); else delete s.avatar.dataset.secs;
      s.root.classList.toggle('low', acting && secs <= 5);
    });
    const mine = myView();
    if (mine?.needsToAct && secs <= 5 && secs > 0 && secs !== lastTick) { lastTick = secs; sfx.tick(); }
  }
  let lastTick = -1;

  // ---------------------------------------------------------------- actions
  function selectChip(v: number) {
    chip = v;
    rack.querySelectorAll('.chip').forEach((c) => { const on = Number((c as HTMLElement).dataset.v) === v; c.classList.toggle('sel', on); c.setAttribute('aria-checked', String(on)); });
  }

  function onSpot(k: WagerKey) {
    if (!view || view.phase !== 'betting' || !BETTABLE.includes(k)) return;
    const s = myView();
    if (!s || s.status === 'ready' || s.status === 'sitting-out') return;
    const c = view.config;
    const key = k as keyof InitialBets;
    if (k === 'progressive' && !c.progressive) return toast('The progressive is not offered at this table.', 'error');
    if (k === 'progressive' && draft.progressive) {
      // Tapping a placed progressive takes it back, as a dealer would before the deal.
      draft = { ...draft, progressive: 0 }; draftDirty = true; sfx.chip(); renderDock(view); scheduleBetSync(); return;
    }
    const add = k === 'progressive' ? PROGRESSIVE.wager : chip;
    const next: InitialBets = { ...draft, [key]: draft[key] + add };
    const max: Record<keyof InitialBets, number> = { ante: c.maxAnte, trips: c.maxTrips, pairs: c.maxPairs, badBeat: c.maxBadBeat, progressive: PROGRESSIVE.wager };
    if (next[key] > max[key]) return toast(`The maximum ${WAGER_NAME[k]} bet here is ${money(max[key])}.`, 'error');
    if (k === 'badBeat' && !draft.trips && BAD_BEAT_VARIANTS[c.badBeatVariant].requires.includes('trips'))
      return toast('Bad Beat needs a Trips+ bet at this table. Place Trips+ first.', 'error');
    const need = requiredToStart(next.ante, sideTotal(next));
    if (need > s.balance) return toast(`That needs ${money(need)} free: Ante, Blind, bonus bets and a 1× Play reserve.`, 'error');
    draft = next;
    draftDirty = true;
    sfx.chip();
    flyChip(rack.querySelector('.chip.sel') as HTMLElement, spotEls[k], add);
    if (k === 'ante') setTimeout(() => flyChip(rack.querySelector('.chip.sel') as HTMLElement, spotEls.blind, chip), 70);
    renderDock(view);
    scheduleBetSync();
  }

  function scheduleBetSync() {
    if (betTimer) clearTimeout(betTimer);
    betTimer = window.setTimeout(syncBet, 250);
  }
  const same = (a: InitialBets, b: InitialBets) => a.ante === b.ante && a.trips === b.trips && a.pairs === b.pairs && a.badBeat === b.badBeat && a.progressive === b.progressive;
  async function syncBet(): Promise<boolean> {
    betTimer = null;
    if (!draftDirty) return true;
    if (draft.ante === 0 && sideTotal(draft) === 0) { draftDirty = false; return (await call('bet:clear', { actionId: actionId() })).ok; }
    if (draft.ante === 0) { toast('Place an Ante to play. Bonus bets ride alongside a hand.', 'info'); return false; }
    const sent = { ...draft };
    const r = await call('bet:place', { actionId: actionId(), ...sent });
    if (same(draft, sent)) draftDirty = false;
    if (!r.ok) { toast(r.error, 'error'); draft = { ...(view?.you.pending ?? NO_BETS) }; draftDirty = false; if (view) renderDock(view); }
    return r.ok;
  }
  async function clearBets() {
    draft = { ...NO_BETS }; draftDirty = false;
    if (betTimer) clearTimeout(betTimer);
    const r = await call('bet:clear', { actionId: actionId() });
    if (!r.ok) toast(r.error, 'error');
    if (view) renderDock(view);
  }
  async function setSitOut(on: boolean) {
    const r = await call('player:prefs', { sitOut: on });
    if (!r.ok) toast(r.error, 'error');
  }

  /** Short description of a bet: "$25 Ante · $5 Trips+ · $5 Progressive". */
  function betLabel(b: InitialBets) {
    return [`${money(b.ante)} Ante`, ...SIDE_KEYS.filter((k) => b[k]).map((k) => `${money(b[k])} ${WAGER_NAME[k]}`)].join(' · ');
  }
  function renderAuto(v: TableView, s: SeatView | null) {
    const auto = v.you.autoRebet;
    const showAuto = !!s && (!!auto || (v.phase === 'betting' && (!!draft.ante || !!v.you.lastBet)));
    // Markers owed, with Pay off between hands.
    const debt = s?.debt ? h('span', { class: 'debt-pill' }, 'IOU ', h('b', {}, money(s.debt)),
      !inHandNow(v) && s.balance > 0 ? h('button', { class: 'link', onclick: () => openPayoff() }, 'Pay off') : null) : null;
    autoRow.hidden = !showAuto && !debt;
    if (autoRow.hidden) return;
    autoRow.replaceChildren(!showAuto ? '' : auto
      ? h('span', { class: 'auto-on' }, h('b', {}, '↻ Same bet every hand'), h('small', {}, betLabel(auto)),
        h('button', { class: 'link', onclick: () => setAuto(false) }, 'Stop'))
      : h('button', { class: 'link auto-off', onclick: () => confirmAuto() }, '↻ Same bet every hand…'), debt ?? '');
  }
  async function confirmAuto() {
    if (!view) return;
    if (draftDirty && !(await syncBet())) return;
    const bet = draft.ante ? draft : view.you.lastBet;
    if (!bet?.ante) return toast('Place a bet first.', 'error');
    const body = h('div', { class: 'stack' },
      h('p', {}, 'Each new hand, this bet goes down and you’re dealt in automatically:'),
      h('p', { class: 'auto-confirm' }, betLabel(bet)),
      h('p', { class: 'muted tiny' }, 'It stops if you change your bet, tap Not ready, sit out, or can’t cover it. The server checks limits and your chips every hand.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn gold', onclick: async () => { m.close(); await setAuto(true); } }, 'Turn on'),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel')));
    const m = modal('Same bet every hand', body);
  }
  async function setAuto(on: boolean) {
    const r = await call('player:prefs', { autoRebet: on });
    if (!r.ok) toast(r.error, 'error'); else toast(on ? 'Same bet every hand is on.' : 'Same bet every hand is off.', 'info');
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
    if (!r.ok) return toast(r.error, 'error');
    const debt = (r as { debt?: number }).debt ?? 0;
    toast(debt ? `Marker signed. You owe the house ${money(debt)} — pawn ${pawnFor(debt).item} to cover it.` : 'Stack reloaded with virtual chips.', 'info');
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
  function isPanelVisible(p: 'chat' | 'table' | 'night') { return panel === p && (panelOpenMobile || matchMedia('(min-width: 1100px)').matches); }
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
  function setPanel(p: 'chat' | 'table' | 'night') {
    panel = p;
    tabChat.classList.toggle('on', p === 'chat'); tabTable.classList.toggle('on', p === 'table'); tabNight.classList.toggle('on', p === 'night');
    chatPane.hidden = p !== 'chat'; historyPane.hidden = p !== 'table'; nightPane.hidden = p !== 'night';
    if (p === 'night') refreshNight();
    if (p === 'chat') { unread = 0; chatBtn.textContent = 'Chat'; }
  }
  function togglePanel(p?: 'chat' | 'table' | 'night') {
    if (p && (!panelOpenMobile || panel !== p)) { setPanel(p); panelOpenMobile = true; }
    else panelOpenMobile = false;
    side.classList.toggle('open', panelOpenMobile);
  }

  function seatMenu(sv: SeatView) {
    const body = h('div', { class: 'stack' },
      h('p', {}, `${sv.name} · ${money(sv.balance)}`),
      h('button', { class: 'btn', onclick: () => { m.close(); mute(sv.playerId, sv.name); } }, 'Mute chat'),
      ...(view?.you.isHost ? hostSeatButtons(sv, () => m.close()) : []));
    const m = modal(sv.name, body);
  }
  /** Host seat controls: away/back, move to the spectators, remove. None of these touch cards or chips. */
  function hostSeatButtons(sv: SeatView, done: () => void) {
    const away = sv.status === 'sitting-out';
    const act = async (ev: string, payload: object) => { done(); const r = await call(ev as 'host:away', payload as never); if (!r.ok) toast(r.error, 'error'); };
    return [
      h('button', { class: 'btn small', onclick: () => act('host:away', { playerId: sv.playerId, away: !away }) }, away ? 'Bring back' : 'Set away'),
      sv.standingUp ? h('span', { class: 'muted tiny' }, 'Moving to spectators') :
        h('button', { class: 'btn small', onclick: () => act('host:standUp', { playerId: sv.playerId }) }, 'Move to spectators'),
      h('button', { class: 'btn small danger', onclick: () => { done(); kick(sv); } }, 'Remove'),
    ];
  }
  async function kick(sv: SeatView) {
    if (!confirm(`Remove ${sv.name} from the table? They won't be able to rejoin.`)) return;
    const r = await call('host:kick', { playerId: sv.playerId });
    if (!r.ok) toast(r.error, 'error');
  }

  // ---------------------------------------------------------------- tonight: running tab and recap
  let nightLoading = false, nightAgain = false;
  async function refreshNight() {
    if (nightLoading) { nightAgain = true; return; }
    nightLoading = true;
    try {
      const [r, chips, pawns] = await Promise.all([fetchRecap(code), view?.you.seat !== null ? fetchChips(code) : Promise.resolve(null), fetchPawns(code)]);
      nightPane.replaceChildren(renderNight(r, {
        meId: me.id, isHost: !!view?.you.isHost && !view.config.solo, live: !!r && r.endedAt === null, chips,
        onReplay: (id) => openReplay(id), onEnd: () => endNight(), onPast: () => openPastNights(code, me.id, openReplay),
        pawns, onPay: () => openPayoff(),
      }));
    } catch (e) {
      nightPane.replaceChildren(h('p', { class: 'muted' }, (e as Error).message));
    } finally {
      nightLoading = false;
      if (nightAgain) { nightAgain = false; refreshNight(); }
    }
  }
  const inHandNow = (v: TableView) => !!v.handId && v.phase !== 'settled' && v.phase !== 'betting' && (myView()?.cards.length ?? 0) > 0;
  /** Pay markers back from your stack: all of it, or just what's above a starting stack. */
  function openPayoff() {
    const s = myView();
    if (!view || !s?.debt) return;
    const all = Math.min(s.debt, s.balance);
    const winnings = Math.min(s.debt, Math.max(0, s.balance - view.config.startingBankroll));
    const pay = async (amount: number) => {
      m.close();
      const r = await call<{ balance: number; debt: number; paid: number }>('player:payDebt', { amount });
      if (!r.ok) return toast(r.error, 'error');
      sfx.chip();
      toast(r.debt ? `Paid ${money(r.paid)}. You still owe ${money(r.debt)}.` : `Debt free! Paid ${money(r.paid)}.`, 'success');
      if (isPanelVisible('night')) refreshNight();
    };
    const body = h('div', { class: 'stack' },
      h('p', {}, `You owe the house ${money(s.debt)} in markers. Pawned: ${pawnFor(s.debt).item}.`),
      winnings > 0 && winnings < all ? h('button', { class: 'btn', onclick: () => pay(winnings) }, `Pay ${money(winnings)} — your winnings above a starting stack`) : null,
      h('button', { class: 'btn gold', disabled: !all, onclick: () => pay(all) }, all >= s.debt ? `Pay it all off — ${money(all)}` : `Pay ${money(all)} — everything in front of you`),
      h('p', { class: 'muted tiny' }, 'Just for fun: paying off moves chips from your stack back to the house. Bets on the layout that no longer fit are taken back.'));
    const m = modal('Pay off markers', body);
  }
  async function endNight() {
    if (!confirm('End the night for everyone? Everyone gets the recap, and the next hand starts a new night.')) return;
    const r = await call('host:endNight');
    if (!r.ok) toast(r.error, 'error');
  }
  async function onNightEnded(p: { nightId: string }) {
    try {
      const r = await fetchRecap(code, p.nightId);
      if (r) openRecap(r, me.id, openReplay);
    } catch { /* recap is still in Past nights */ }
    if (isPanelVisible('night')) refreshNight();
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
          h('dt', {}, 'Main game'), h('dd', { class: sessionStats.baseNet < 0 ? 'neg' : 'pos' }, money(sessionStats.baseNet, true)),
          h('dt', {}, 'Strategy'), h('dd', {}, acc === null ? '—' : `${acc}% of ${sessionStats.decisions} decisions`),
          h('dt', {}, 'EV given up'), h('dd', {}, sessionStats.evLostCents ? money(-sessionStats.evLostCents) : '—')),
        spark),
      h('section', {},
        h('h3', {}, 'Bonus bets this session'),
        h('table', { class: 'mini-table' },
          h('tr', {}, h('th', {}), h('th', {}, 'Bets'), h('th', {}, 'Hits'), h('th', {}, 'Net')),
          ...SIDE_KEYS.map((k) => {
            const x = sessionStats.side[k];
            return h('tr', {}, h('td', {}, WAGER_NAME[k]), h('td', { class: 'num' }, String(x.bets)), h('td', { class: 'num' }, String(x.wins)),
              h('td', { class: `num ${x.net < 0 ? 'neg' : x.net > 0 ? 'pos' : ''}` }, money(x.net, true)));
          })),
        h('p', { class: 'muted' }, `Pay tables: ${PAIRS_VARIANTS[v.config.pairsVariant].name}, ${BAD_BEAT_VARIANTS[v.config.badBeatVariant].name}. `,
          h('button', { class: 'link', onclick: () => openPayTables(v.config) }, 'View'))),
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
          h('div', { class: 'rp' }, ...r.players.map((p) => h('span', { class: p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : '' }, `${p.name} ${p.outcome === 'fold' ? `folded ${p.handName}` : p.handName} ${money(p.net, true)}${p.sideHits?.length ? ` · ${p.sideHits.join(', ')}` : ''}`))))))
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
      // Each wager pays or is collected on its own spot, side bets included.
      sv.result.lines.forEach((l, i) => {
        const spotEl = el.spots[l.wager];
        if (l.result === 'win') setTimeout(() => { flyChip(tray, spotEl, l.net, true); setTimeout(() => flyChip(spotEl, el.plate, l.credit, true), 380); }, 500 + i * 110);
        else if (l.result === 'lose') setTimeout(() => flyChip(spotEl, tray, l.stake), 500 + i * 110);
      });
    });
    if (s?.result) {
      const r = s.result;
      const rare = r.lines.some((l) => (l.wager === 'badBeat' && (l.multiplier ?? 0) >= 500) || (l.wager === 'pairs' && (l.multiplier ?? 0) >= 100) || (l.wager === 'progressive' && l.credit >= 15_000));
      setTimeout(() => { rare || r.net >= s.bet.ante * 8 ? sfx.bigWin() : r.net > 0 ? sfx.win() : r.net < 0 ? sfx.lose() : sfx.push(); if (r.net) sfx.payout(); }, 450);
      sessionStats.hands++;
      sessionStats.net += r.net;
      sessionStats.baseNet += r.baseNet;
      for (const k of SIDE_KEYS) {
        const l = r.lines.find((x) => x.wager === k);
        if (!l) continue;
        sessionStats.side[k].bets++;
        if (l.result === 'win') sessionStats.side[k].wins++;
        sessionStats.side[k].net += l.net;
      }
      sessionStats.series.push(s.balance);
      if (sessionStats.series.length === 1) sessionStats.series.unshift(s.balance - r.net);
      renderResult(v, s);
    }
  }

  function renderJackpot(v: TableView) {
    jackpotSign.hidden = !v.config.progressive || !v.jackpot;
    if (!v.jackpot) return;
    const target = v.jackpot.amount;
    if (target === shownJackpot) return;
    const from = shownJackpot || target;
    shownJackpot = target;
    // The meter counts up like the sign over a progressive bank. Display only.
    if (!motionScale() || from >= target) { jackpotAmt.textContent = money(target); return; }
    const t0 = performance.now(), dur = 900 * motionScale();
    const step = (t: number) => {
      if (shownJackpot !== target) return;
      const k = Math.min(1, (t - t0) / dur);
      jackpotAmt.textContent = money(Math.round(from + (target - from) * k));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** In-hand Ultimate Pairs indicator and the showdown side-bet banner. Purely visual. */
  function renderPairsFlash(v: TableView, s: SeatView | null) {
    let text = '', rare = false, kind = '';
    const prog = s?.result?.lines.find((l) => l.wager === 'progressive' && l.result === 'win');
    if (s && v.phase === 'settled' && prog) {
      text = `Progressive — ${prog.note ?? prog.combo} — ${money(prog.credit)}`;
      rare = prog.credit >= 15_000; kind = 'progressive';
    } else if (s && s.bet.progressive > 0 && v.community[2] && s.cards[0] && ['flop', 'river', 'showdown'].includes(v.phase)) {
      // The progressive is decided on the flop; show it the moment it's known. The settlement is the server's.
      const hand = progressiveHand((s.cards as string[]).map(cardToInt), (v.community.slice(0, 3) as string[]).map(cardToInt));
      const row = PROGRESSIVE.rows.find((r) => r.hand === hand);
      if (row) {
        text = `Progressive — ${hand} — ${row.kind === 'meter' ? `${row.pct}% of the jackpot` : money(row.amount!)} (paid at the end of the hand)`;
        rare = row.kind === 'meter' || row.amount! >= 15_000; kind = 'progressive';
      }
    }
    if (text) { /* progressive banner takes priority */ }
    else if (s && v.phase === 'settled' && s.result) {
      const bb = s.result.lines.find((l) => l.wager === 'badBeat' && l.result === 'win');
      const up = s.result.lines.find((l) => l.wager === 'pairs' && l.result === 'win');
      if (bb) {
        const who = bb.combo?.startsWith('Dealer') ? 'Dealer’s' : 'Your';
        text = `Bad Beat! ${who} ${bb.combo?.replace(/^(Dealer|Player) /, '')} beaten — ${bb.multiplier!.toLocaleString('en-US')} to 1`;
        rare = (bb.multiplier ?? 0) >= 500; kind = 'badbeat';
      } else if (up) {
        text = `Ultimate Pairs — ${up.combo} — ${up.multiplier!.toLocaleString('en-US')} to 1`;
        rare = (up.multiplier ?? 0) >= 100; kind = 'pairs';
      }
    } else if (s && s.bet.pairs > 0 && s.cards[0] && ['preflop', 'flop', 'river'].includes(v.phase)) {
      const pv = previewPairs(PAIRS_VARIANTS[v.config.pairsVariant], (s.cards as string[]).map(cardToInt));
      if (pv.won) {
        text = `Ultimate Pairs — ${pv.label} — ${pv.payout.toLocaleString('en-US')} to 1`;
        if (pv.pendingUpgrade) text += ` (${pv.pendingUpgrade.payout.toLocaleString('en-US')} to 1 if the dealer also holds aces — shown at showdown)`;
        rare = pv.payout >= 100; kind = 'pairs';
      }
    }
    const changed = bonusFlash.textContent !== text;
    bonusFlash.hidden = !text;
    bonusFlash.textContent = text;
    bonusFlash.className = `bonus-flash ${kind} ${rare ? 'rare' : ''}`;
    if (changed && text && motionScale()) bonusFlash.animate([{ transform: 'scale(.92)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: (rare ? 700 : 350) * motionScale(), easing: 'cubic-bezier(.2,.7,.25,1)' });
  }

  function renderResult(v: TableView, s: SeatView) {
    const r = s.result!;
    const title = r.outcome === 'fold' ? (r.net > 0 ? `Folded — bonus bets pay ${money(r.net)}` : 'Folded') : r.net > 0 ? `You win ${money(r.net)}` : r.net < 0 ? `You lose ${money(-r.net)}` : 'Push';
    const decisions = analysis.get(v.handId!) ?? [];
    const showGrades = prefs.get().trainer !== 'casino';
    const shown = decisions.filter((d) => showGrades || !d.correct);
    const hasSide = r.lines.some((l) => (SIDE_KEYS as readonly string[]).includes(l.wager));
    // Compact: one chip per wager with its net; details for winning bonus bets go on one short line below.
    const lineText = (l: (typeof r.lines)[0]) => l.result === 'push' ? 'Push' : money(l.net, true);
    const details = r.lines.filter((l) => l.result === 'win' && (SIDE_KEYS as readonly string[]).includes(l.wager)).map((l) =>
      l.wager === 'progressive' ? `Progressive: ${l.note ?? l.combo ?? ''} pays ${money(l.credit)} (the $5 is kept)`
        : `${WAGER_NAME[l.wager]}: ${l.combo ?? ''}${l.multiplier ? ` ${l.multiplier.toLocaleString('en-US')}:1` : ''}, ${money(l.stake)} stake back`);
    result.hidden = false;
    const fresh = result.dataset.hand !== v.handId;
    result.dataset.hand = v.handId ?? '';
    result.className = `my-result ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''} ${fresh && motionScale() ? 'staged' : ''}`;
    // First the cards: winning five light up and the title shows. Then the breakdown fades in.
    if (fresh && motionScale()) setTimeout(() => result.classList.remove('staged'), 1400 * motionScale());
    result.replaceChildren();
    append(result, [
      h('div', { class: 'res-title' }, title, h('small', {}, ` ${r.handName} vs dealer ${v.dealer.handName ?? ''}`)),
      h('ul', { class: 'lines' }, ...r.lines.map((l) => h('li', { class: (SIDE_KEYS as readonly string[]).includes(l.wager) ? 'sideline' : '' },
        h('span', { title: l.note ?? '' }, WAGER_NAME[l.wager]),
        h('span', { class: l.net > 0 ? 'pos' : l.net < 0 ? 'neg' : '', title: l.note ?? '' }, lineText(l))))),
      details.length ? h('p', { class: 'res-details' }, details.join(' · ')) : null,
      hasSide ? h('p', { class: 'subtotals' }, `Main game ${money(r.baseNet, true)} · Bonus bets ${money(r.sideNet, true)}`) : null,
      shown.length ? h('ul', { class: 'grades' }, ...shown.map((d) => h('li', { class: d.correct ? 'ok' : 'bad' },
        `${d.correct ? '✓' : '✗'} ${cap(d.phase)}: ${DECISION_LABEL[d.action]}${d.timedOut ? ' (timed out)' : ''}`,
        d.correct ? '' : ` — best was ${DECISION_LABEL[d.recommended]}${d.evCost !== undefined ? `, costing ${d.evCost.toFixed(2)} antes${d.evExact ? '' : ' (est.)'} (${money(d.evCostCents ?? 0)})` : ''}`,
        d.correct ? null : h('div', { class: 'why' }, d.reason),
        d.correct ? null : outsEl(d.outs)))) : null,
      showGrades && decisions.length && r.baseNet > 0 && decisions.some((d) => !d.correct) ? h('p', { class: 'muted' }, 'You won this hand, but the mistake still cost expected value — results and decisions are graded separately.') : null]);
  }
  const cap = (s: string) => ({ preflop: 'Pre-flop', flop: 'Flop', river: 'River' } as Record<string, string>)[s] ?? s;

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
      ...sideBetFields(c),
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
        name: String(fd.get('name')), minAnte: dollars('minAnte'), maxAnte: dollars('maxAnte'), maxTrips: dollars('maxTrips'), ...readSideBetFields(fd),
        startingBankroll: dollars('startingBankroll'), decisionSeconds: Number(fd.get('decisionSeconds')), bettingSeconds: Number(fd.get('bettingSeconds')),
        maxSeats: Number(fd.get('maxSeats')), isPublic: fd.get('isPublic') === 'on', allowSpectators: fd.get('allowSpectators') === 'on',
      });
      if (r.ok) { toast('Settings saved.', 'success'); m.close(); } else toast(r.error, 'error');
    });
    const others = view.seats.filter((s): s is SeatView => !!s && s.playerId !== me.id);
    const body = h('div', { class: 'stack' },
      form,
      h('h3', {}, 'Players'),
      others.length ? h('ul', { class: 'plist host-plist' }, ...others.map((s) => h('li', {},
        h('span', {}, h('b', {}, s.name), h('small', { class: 'muted' }, ` ${!s.connected ? 'Disconnected' : statusText(s)} · ${money(s.balance)}`)),
        h('span', { class: 'host-btns' }, ...hostSeatButtons(s, () => m.close()))))) : h('p', { class: 'muted' }, 'Nobody else is seated.'),
      h('p', { class: 'muted tiny' }, 'Set away: they keep their seat but sit out until they tap Sit back in. Move to spectators: they stand up (after the current hand) and keep their chips if they sit again.'),
      tableLook(view),
      h('h3', {}, 'Tonight'),
      h('p', { class: 'muted tiny' }, 'Ending the night shows everyone the recap (leaderboard, biggest win and loss, best hands). The next hand starts a new night. A night also ends on its own after 4 hours without a hand.'),
      h('button', { class: 'btn', disabled: inHand, onclick: () => { m.close(); endNight(); } }, inHand ? 'End the night (after this hand)' : 'End the night'),
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
