// Multiplayer integration tests on PostgreSQL over real sockets, one section per area (sequential; each section starts its own server).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $, FAST, TC, aid, rigDeck, rigShoe, rigTcp, startServer } from './harness';
import { type TableView } from '../../src/shared/protocol';
import { DEFAULT_APPEARANCE } from '../../src/shared/cosmetics';
import { DEALER, DEALERS } from '../../src/shared/dealers';
import { chipItemId } from '../../src/shared/chips';
import { PAWN_TIERS } from '../../src/shared/debt';
import { io as ioc } from 'socket.io-client';
import { intToCard } from '../../src/shared/cards';
import { type NightRecap } from '../../src/shared/recap';
import { PROGRESSIVE, progSetup, resolveMeter } from '../../src/shared/progressive';
import { type PlayerSettlementRow } from '../../src/server/store';
import { DEFAULT_BJ_RULES, bjEvCost, newHand } from '../../src/shared/blackjack';
import { LINE } from '../../src/shared/roast/library';
import { fill } from '../../src/shared/roast/render';

// ==================================================================== blackjack.test.ts
describe('blackjack', () => {
  type S = Awaited<ReturnType<typeof startServer>>;

  describe('§27 Blackjack (PostgreSQL)', () => {
    let s: S; let a: TC; let b: TC; let code: string;
    const eng = () => s.server.manager.tables.get(code)!;
    const recon = async (...ps: TC[]) => { for (const p of ps) expect(await s.store.ledgerSum(p.id, code), p.name).toBe(p.state.seats.find((x) => x?.playerId === p.id)!.balance); };
    async function round(shoe: number[], bets: [TC, number][]) {
      await bets[0][0].waitState((v) => v.phase === 'betting' && v.config.game === 'bj', 8000, 'bj betting');
      s.rigShoe(code, shoe);
      for (const [p, amt] of bets) expect((await p.bet(amt)).ok, p.name).toBe(true);
      await Promise.all(bets.map(([p]) => p.ready()));
      return bets[0][0].waitState((v) => !!v.handId && v.phase !== 'betting', 8000, 'dealt');
    }
    const settled = (p: TC) => p.waitState((v) => v.phase === 'settled', 8000, 'settled');
    const seat = (v: TableView, p: TC) => v.seats.find((x) => x?.playerId === p.id)!;

    beforeAll(async () => {
      s = await startServer();
      a = await s.player('Ann'); b = await s.player('Bo');
      code = await s.createTable(a.token, { game: 'bj', minAnte: 100, maxAnte: 1_000_000, startingBankroll: 100_000 });
      await a.join(code); await b.join(code);
      await a.waitState((v) => !!v.seats[1]);
    });
    afterAll(() => s.stop());

    it('shows the rules before betting and refuses side bets, half dollars and unaffordable bets', async () => {
      const v = await a.waitState((x) => x.phase === 'betting');
      expect(v.config.game).toBe('bj');
      expect(v.bj!.rulesText.join(' ')).toMatch(/6 decks.*Blackjack pays 3:2.*stands on all 17s/);
      expect(v.bj!.rules).toMatchObject({ decks: 6, h17: false, maxHands: 4, resplitAces: false, lateSurrender: false, insurance: true, peek: true });
      expect((await a.bet($(5), $(5))).error).toMatch(/poker bets/);
      expect((await a.bet(550)).error).toMatch(/whole dollars/);
      expect((await a.bet($(50_000))).error).toMatch(/Maximum|Not enough/);
      expect((await a.bet($(2000))).error).toMatch(/Not enough chips/);
    });

    it('natural blackjack pays 3:2 exactly (even on $1); dealer stands on soft 17; bust loses', async () => {
      // Ann A-K (blackjack), Bo 10-6 hits a 9 (bust). Dealer 6-A = soft 17: stands.
      await round(rigShoe(['As Kd', 'Ts 6d'], '6c Ah', '9h'), [[a, $(1)], [b, $(10)]]);
      const t = await b.waitState((v) => v.bj?.turn?.playerId === b.id);
      expect(t.bj!.dealerTotal).toBe('6');
      expect(t.dealer.cards).toEqual(['6c', null]);                       // hole card hidden from everyone
      expect(seat(t, a).bj!.hands[0].done).toBe(true);                    // a natural doesn't act
      expect((await a.emit('bj:act', { actionId: aid(), handId: t.handId, action: 'hit' })).error).toMatch(/your turn/);
      await b.bj('hit');
      const v = await settled(a);
      expect(v.dealer.cards).toEqual(['6c', 'Ah']);
      expect(v.bj!.dealerTotal).toBe('Soft 17');
      expect(seat(v, a).result).toMatchObject({ net: 150 });              // $1 × 3:2 = $1.50, not rounded
      expect(seat(v, b).bj!.hands[0]).toMatchObject({ outcome: 'bust', net: -$(10) });
      await recon(a, b);
    });

    it('dealer blackjack: both naturals push, others lose; insurance pays 2:1; timeouts decline insurance', async () => {
      await round(rigShoe(['Ad Kh', '9s 9d'], 'Ac Ks'), [[a, $(10)], [b, $(10)]]);
      const v0 = await a.waitState((v) => v.phase === 'insurance');
      expect(v0.bj!.actions).toEqual(['insure', 'no-insurance']);
      expect(v0.bj!.insuranceMax).toBe($(5));
      expect((await b.emit('bj:act', { actionId: aid(), handId: v0.handId, action: 'insure', amount: $(6) })).error).toMatch(/half your bet/);
      await b.bj('insure');
      await a.bj('no-insurance');
      const v = await settled(a);
      expect(v.bj!.dealerTotal).toBe('Blackjack');
      expect(seat(v, a).result!.net).toBe(0);                               // blackjack vs blackjack: push
      expect(seat(v, b).bj!.hands[0]).toMatchObject({ outcome: 'lose', net: -$(10) });
      expect(seat(v, b).bj!.insuranceNet).toBe($(10));                      // $5 insurance pays $10
      expect(seat(v, b).result!.net).toBe(0);
      await recon(a, b);
    });

    it('splits pairs, doubles after splitting, and caps at four hands', async () => {
      // Bo: 8-8 vs dealer 6. Split → 8+3 (double → +9 = 20), 8+8 (split again) → 8+8 (split again → 4 hands) …
      await round(rigShoe(['Ts 7d', '8s 8d'], '6c Tc', '3h 9h 8c 8h Kd 2c Ks 7c'), [[a, $(10)], [b, $(10)]]);
      await a.bj('stand');
      let v = await b.waitState((x) => x.bj?.turn?.playerId === b.id);
      expect(v.bj!.actions).toEqual(expect.arrayContaining(['split', 'double']));
      await b.bj('split');                                                   // hand 1: 8 + 3
      v = await b.waitState((x) => seat(x, b).bj!.hands.length === 2 && x.bj!.actions.includes('double'));
      expect(seat(v, b).bj!.hands[0].cards).toEqual(['8s', '3h']);
      await b.bj('double');                                                  // 8 3 9 = 20, double after split
      v = await b.waitState((x) => seat(x, b).bj!.active === 1);
      expect(seat(v, b).bj!.hands[1].cards).toEqual(['8d', '8c']);
      await b.bj('split');                                                   // 3 hands
      await b.bj('split', { hand: 1 });                                      // hand 2 was 8 + 8 again → 4 hands
      v = await b.waitState((x) => seat(x, b).bj!.hands.length === 4);
      expect(v.bj!.actions).not.toContain('split');                          // four-hand maximum
      expect(seat(v, b).bj!.hands.map((h) => h.cards[0])).toEqual(['8s', '8d', '8h', '8c']);
      for (let i = 0; i < 3; i++) await b.bj('stand');
      v = await settled(a);
      // dealer 6 + 10 = 16, draws the next card
      const hands = seat(v, b).bj!.hands;
      expect(hands[0]).toMatchObject({ doubled: true, bet: $(20), total: '20' });
      const staked = hands.reduce((t, h) => t + h.bet, 0);
      expect(staked).toBe($(50));
      expect(seat(v, b).result!.net).toBe(hands.reduce((t, h) => t + h.net!, 0));
      await recon(a, b);
    });

    it('split aces get one card each and a 21 there is not a blackjack', async () => {
      await round(rigShoe(['As Ad', '5s 5d'], '9c 7d', 'Kh 2c Th'), [[a, $(10)], [b, $(10)]]);
      await a.bj('split');
      const v1 = await a.waitState((x) => seat(x, a).bj!.hands.length === 2 && seat(x, a).bj!.hands.every((h) => h.done));
      expect(seat(v1, a).bj!.hands.map((h) => h.total)).toEqual(['21', 'Soft 13']);
      await b.bj('double');
      const v = await settled(a);
      expect(seat(v, a).bj!.hands[0]).toMatchObject({ outcome: 'win', net: $(10) });   // 1:1, not 3:2
      expect(seat(v, b).bj!.hands[0]).toMatchObject({ doubled: true, total: '20', outcome: 'win', net: $(20) });
      await recon(a, b);
    });

    it('cannot double or split without the chips, and refuses moves out of turn', async () => {
      // Bo bets nearly everything: no money left to double or split.
      const st = (await b.waitState((x) => x.phase === 'betting'));
      const bal = seat(st, b).balance;
      await round(rigShoe(['Ts 7d', '6s 6d'], '5c Tc', 'Kh'), [[a, $(10)], [b, bal - $(1)]]);   // dealer busts, so Bo can keep playing
      await a.bj('stand');
      const v = await b.waitState((x) => x.bj?.turn?.playerId === b.id);
      expect(v.bj!.actions).toEqual(['hit', 'stand']);
      expect((await b.emit('bj:act', { actionId: aid(), handId: v.handId, action: 'split' })).error).toMatch(/Not available/);
      expect((await b.emit('bj:act', { actionId: aid(), handId: 'nope', action: 'hit' })).error).toMatch(/round is over/);
      // The trainer marks the would-be split as constrained (ungraded), not wrong.
      expect(v.bj!.advice).toMatchObject({ best: 'stand', constrained: true });   // 6-6 vs 5: split if you could; otherwise 12 vs 5 stands
      await b.bj('stand');
      await settled(a);
      const d = b.analysis.at(-1)!.decisions.find((x) => (x.phase as string).startsWith('bj-'))!;
      expect(d).toMatchObject({ action: 'stand', graded: false });
      await recon(a, b);
    });

    it('late surrender when the host enables it', async () => {
      await a.waitState((x) => x.phase === 'betting');
      expect((await a.emit('host:settings', { bjSurrender: true })).ok).toBe(true);
      await round(rigShoe(['Ts 6d', 'Ts 9d'], '9c Tc'), [[a, $(10)], [b, $(10)]]);
      await a.bj('surrender');
      await b.bj('stand');
      const v = await settled(a);
      expect(seat(v, a).bj!.hands[0]).toMatchObject({ outcome: 'surrender', net: -$(5) });
      expect((await a.emit('host:settings', { bjSurrender: false })).ok).toBe(true);
      await recon(a, b);
    });

    it('a disconnected player is stood automatically when the server timer runs out', async () => {
      await a.waitState((x) => x.phase === 'betting');
      expect((await a.emit('host:settings', { decisionSeconds: 5 })).ok).toBe(true);
      await round(rigShoe(['Ts 6d', 'Ts 2d'], '9c 8c'), [[a, $(10)], [b, $(10)]]);
      await a.waitState((x) => x.bj?.turn?.playerId === a.id);
      a.socket.disconnect();
      const v = await b.waitState((x) => x.bj?.turn?.playerId === b.id, 9000, 'Bo after timeout');
      expect(seat(v, a).bj!.hands[0]).toMatchObject({ done: true, cards: ['Ts', '6d'] });
      expect(b.chat.some((m) => /Ann stands on 16 \(auto\)/.test(m.text))).toBe(true);
      await b.bj('stand');
      await settled(b);
      a.socket.connect(); await a.connected(); await a.join(code);
      await a.waitState((x) => x.phase === 'settled' || x.phase === 'betting');
      expect((await a.emit('host:settings', { decisionSeconds: 25 })).ok).toBe(true);
    });

    it('switches games only between rounds and keeps everything', async () => {
      await round(rigShoe(['Ts 7d', 'Ts 8d'], '9c 8c'), [[a, $(10)], [b, $(10)]]);
      expect((await a.emit('host:game', { game: 'tcp' }))).toMatchObject({ ok: true, queued: true });
      await a.bj('stand'); await b.bj('stand');
      const v = await a.waitState((x) => x.config.game === 'tcp' && x.phase === 'betting', 9000, 'tcp');
      expect(v.bj).toBeNull();
      expect(seat(v, a)).toBeTruthy();
      await recon(a, b);
      expect((await a.emit('host:game', { game: 'bj' })).ok).toBe(true);
      await a.waitState((x) => x.config.game === 'bj');
    });
  });

  describe('§27 six players, seat order', () => {
    it('takes turns in seat order and settles each independently', async () => {
      const s = await startServer({ memory: true });
      try {
        const ps = await Promise.all(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((n) => s.player(n)));
        const code = await s.createTable(ps[0].token, { game: 'bj', minAnte: 100 });
        for (const p of ps) await p.join(code);
        await ps[0].waitState((v) => v.seats.filter(Boolean).length === 6);
        s.rigShoe(code, rigShoe(['Ts 2d', 'Ts 3d', 'Ts 4d', 'Ts 5d', 'Ts 6d', '5s 6c'], '7c Tc', '9h 9c 8h 7h 2h Kd'));
        for (const p of ps) await p.bet($(5));
        await Promise.all(ps.map((p) => p.ready()));
        const order: string[] = [];
        const moves: [number, string][] = [[0, 'hit'], [1, 'hit'], [2, 'hit'], [3, 'hit'], [4, 'stand'], [5, 'double']];
        for (const [i, act] of moves) {
          const v = await ps[i].waitState((x) => x.bj?.turn?.playerId === ps[i].id, 8000, `turn ${i}`);
          order.push(v.seats[v.bj!.turn!.seat]!.name);
          for (const other of ps) if (other !== ps[i]) expect(other.state.bj!.actions).toEqual([]);
          await ps[i].bj(act);
          if (act === 'hit') { const w = await ps[i].waitState((x) => x.bj?.turn?.playerId !== ps[i].id || x.bj!.actions.length > 0); if (w.bj?.turn?.playerId === ps[i].id) await ps[i].bj('stand'); }
        }
        expect(order).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
        const v = await ps[0].waitState((x) => x.phase === 'settled');
        for (const p of ps) {
          const st = await ps[0].waitState((x) => x.phase === 'settled');
          const me = st.seats.find((x) => x?.playerId === p.id)!;
          expect(me.result).toBeTruthy();
          expect(await s.store.ledgerSum(p.id, code)).toBe(me.balance);
        }
        expect(v.seats[5]!.bj!.hands[0]).toMatchObject({ doubled: true });
      } finally { await s.stop(); }
    });
  });
});

// ==================================================================== chips.test.ts
describe('chips', () => {
  type S = Awaited<ReturnType<typeof startServer>>;
  const key = () => `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`;

  describe('§28 collectible chips and large balances (PostgreSQL)', () => {
    let s: S; let a: TC; let code: string;
    beforeAll(async () => {
      s = await startServer();
      a = await s.player('Whale');
      code = await s.createTable(a.token, { startingBankroll: 1_000_000_000, minAnte: 100_000, maxAnte: 100_000_000, maxTrips: 1_000_000 });
      await a.join(code);
    });
    afterAll(() => s.stop());
    const buy = (itemId: string, k = key()) => s.api('/api/me/purchase', a.token, { method: 'POST', body: JSON.stringify({ itemId, key: k }) });
    const mine = async () => (await s.api('/api/me/cosmetics', a.token)).body;

    it('buys a set (which unlocks every denomination) and single chips; equips per denomination; never touches chips', async () => {
      await s.store.grant(a.id, { key: key(), rewardId: null, amount: 2000, items: [], method: 'reward', note: 'test' });
      const before = (await a.waitState((v) => !!v.seats[0])).seats[0]!.balance;
      expect((await buy('chips-neon')).body.status).toBe('ok');
      const b1 = (await mine()).balance;
      expect((await buy('chip-neon-500')).body).toMatchObject({ status: 'owned', balance: b1 });          // the set already covers it
      expect((await buy('chip-diamond-500')).body.status).toBe('ok');
      expect((await mine()).balance).toBe(b1 - 140);
      const base = (await mine()).avatar;
      const save = (equipped: object) => s.api('/api/me/avatar', a.token, { method: 'PUT', body: JSON.stringify({ ...base, equipped: { ...base.equipped, ...equipped } }) });
      expect((await save({ chips: 'chips-neon', c500: 'chip-diamond-500' })).status).toBe(200);
      expect((await save({ c25: 'chip-diamond-25' })).status).toBe(400);                                  // not owned
      expect((await save({ c25: 'chip-neon-500' })).status).toBe(400);                                    // wrong value
      const v = await a.waitState((x) => x.seats[0]?.look?.equipped.c500 === 'chip-diamond-500');
      expect(v.seats[0]!.look!.equipped.chips).toBe('chips-neon');
      expect(v.seats[0]!.balance).toBe(before);
    });

    it('settles very large wagers exactly: a $1,000,000 Ante on a $10,000,000 stack', async () => {
      s.decks.push(rigDeck(['As Ad'], '7c 2d', 'Ah Kd Qs 4c 9h'));
      await a.waitState((v) => v.phase === 'betting');
      expect((await a.bet($(1_000_000), $(10_000))).ok).toBe(true);
      await a.ready();
      await a.decide('preflop', 'play4');
      const v = await a.waitState((x) => x.phase === 'settled');
      const r = v.seats[0]!.result!;
      // Trips (three aces) pays 3:1 on $10,000; Ante (dealer doesn't qualify) pushes; Play 4× wins; Blind on trips pushes.
      expect(r.lines.find((l) => l.wager === 'play')!.net).toBe($(4_000_000));
      expect(r.lines.find((l) => l.wager === 'trips')!.net).toBe($(30_000));
      expect(v.seats[0]!.balance).toBe($(10_000_000) + r.net);
      expect(await s.store.ledgerSum(a.id, code)).toBe(v.seats[0]!.balance);
      expect(Number.isSafeInteger(v.seats[0]!.balance)).toBe(true);
    });
  });
});

// ==================================================================== cosmetics.test.ts
describe('cosmetics', () => {
  type S = Awaited<ReturnType<typeof startServer>>;
  const key = () => `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`;

  describe('§24 avatars, Style Credits and the Boutique (PostgreSQL)', () => {
    let s: S; let ann: TC; let bo: TC; let code: string;
    beforeAll(async () => {
      s = await startServer();
      ann = await s.player('Ann'); bo = await s.player('Bo');
      code = await s.createTable(ann.token, { allowSpectators: true });
      await ann.join(code); await bo.join(code);
      await ann.waitState((v) => v.phase === 'betting' && !!v.seats[1]);
    });
    afterAll(() => s.stop());
    const mine = async (t: TC) => (await s.api('/api/me/cosmetics', t.token)).body;
    const buy = (t: TC, itemId: string, k = key()) => s.api('/api/me/purchase', t.token, { method: 'POST', body: JSON.stringify({ itemId, key: k }) });
    const save = (t: TC, body: object) => s.api('/api/me/avatar', t.token, { method: 'PUT', body: JSON.stringify(body) });

    it('every new guest gets a distinct saved look and the welcome allowance, once', async () => {
      const a = await mine(ann), b = await mine(bo);
      expect(a.balance).toBe(300);
      expect(await mine(ann)).toMatchObject({ balance: 300 });           // welcome is idempotent
      expect(a.avatar.appearance).toBeTruthy();
      expect(JSON.stringify(a.avatar)).not.toEqual(JSON.stringify(b.avatar));
      expect(a.history.map((t: any) => t.rewardId)).toEqual(['welcome']);
    });

    it('shows portraits at the table and pushes a new look to everyone', async () => {
      const v = await bo.waitState((x) => !!x.seats[0]?.look && !!x.seats[1]?.look);
      expect(v.seats[0]!.look!.appearance).toBeTruthy();
      const r = await save(ann, { appearance: { ...DEFAULT_APPEARANCE, hair: 'afro' }, equipped: { outfit: 'shirt-white', neckwear: 'tie-black' }, preset: 'custom', outfits: {} });
      expect(r.status).toBe(200);
      await bo.waitState((x) => x.seats[0]?.look?.appearance.hair === 'afro', 4000, 'new look');
      expect((await mine(ann)).balance).toBe(350);                       // first save: +50 once
      await save(ann, { appearance: DEFAULT_APPEARANCE, equipped: {}, preset: 'custom', outfits: {} });
      expect((await mine(ann)).balance).toBe(350);
    });

    it('rejects markup, unknown values, unowned and incompatible items — the server decides ownership', async () => {
      const bad = [
        { appearance: { ...DEFAULT_APPEARANCE, hair: '<script>alert(1)</script>' }, equipped: {} },
        { appearance: '<svg onload=alert(1)>', equipped: {} },
        { appearance: DEFAULT_APPEARANCE, equipped: { hat: 'fedora-black' } },                 // not owned
        { appearance: DEFAULT_APPEARANCE, equipped: { outfit: 'tee-cream', neckwear: 'bow-red' } },
        { appearance: DEFAULT_APPEARANCE, equipped: { hat: 'fedora-black' }, owned: ['fedora-black'] }, // client claims ownership
      ];
      for (const b of bad) expect((await save(bo, b)).status, JSON.stringify(b)).toBe(400);
      expect((await s.api('/api/me/purchase', bo.token, { method: 'POST', body: JSON.stringify({ itemId: 'cap-green', key: key() }) })).body.error).toMatch(/free/);
      expect((await buy(bo, 'glasses-reading')).body.error).toMatch(/earned/);
      expect((await buy(bo, 'frame-vegas-bonus')).body.error).toMatch(/earned/);
      expect((await buy(bo, 'nope')).status).toBe(400);
      expect((await s.api('/api/me/purchase', bo.token, { method: 'POST', body: JSON.stringify({ itemId: 'fedora-black' }) })).body.error).toMatch(/key/);
    });

    it('purchases are atomic and idempotent: a retried key never charges twice; no negative balances', async () => {
      const k = key();
      const [r1, r2] = await Promise.all([buy(bo, 'fedora-black', k), buy(bo, 'fedora-black', k)]);
      expect([r1.body.status, r2.body.status].sort()).toEqual(['duplicate', 'ok']);
      expect((await mine(bo)).balance).toBe(150);
      expect((await buy(bo, 'fedora-black')).body.status).toBe('owned');  // new key, already owned: no charge
      expect((await mine(bo)).balance).toBe(150);
      // Two different 100+ items at once with 150 credits: exactly one goes through.
      const both = await Promise.all([buy(bo, 'bow-red'), buy(bo, 'cap-casino')]);
      expect(both.filter((r) => r.body.status === 'ok').length).toBe(1);
      expect(both.filter((r) => r.status === 400 && /Not enough/.test(r.body.error)).length).toBe(1);
      const m = await mine(bo);
      expect(m.balance).toBe(50);
      expect(m.history.filter((t: any) => t.kind === 'purchase').map((t: any) => t.amount).sort((a: number, b: number) => a - b)).toEqual([-150, -100]);
      for (const t of m.history) expect(t.balanceAfter).toBeGreaterThanOrEqual(0);
      // Ann can't wear Bo's fedora, even with the same display name.
      expect((await save(ann, { appearance: DEFAULT_APPEARANCE, equipped: { hat: 'fedora-black' } })).status).toBe(400);
      const ok = await save(bo, { appearance: DEFAULT_APPEARANCE, equipped: { hat: 'fedora-black' } });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      await ann.waitState((x) => x.seats[1]?.look?.equipped.hat === 'fedora-black', 4000, 'bo fedora');
    });

    it('Style Credits never touch chips', async () => {
      const before = (await ann.waitState((v) => v.phase === 'betting')).seats[0]!.balance;
      await s.store.grant(ann.id, { key: key(), rewardId: null, amount: 5000, items: [], method: 'reward', note: 'test' });
      expect((await buy(ann, 'tux-black')).body.status).toBe('ok');
      const v = await ann.waitState((x) => x.phase === 'betting');
      expect(v.seats[0]!.balance).toBe(before);
      expect(await s.store.ledgerSum(ann.id, code)).toBe(before);
      // and buying the rest of Classic Vegas unlocks its frame
      for (const id of ['bow-red', 'fedora-black', 'watch-gold', 'bg-marquee', 'win-vegas']) expect((await buy(ann, id)).body.status).toBe('ok');
      const m = await mine(ann);
      expect(m.owned.map((o: any) => o.itemId)).toContain('frame-vegas-bonus');
      expect((await save(ann, { appearance: DEFAULT_APPEARANCE, equipped: { outfit: 'tux-black', neckwear: 'bow-red', hat: 'fedora-black', frame: 'frame-vegas-bonus', victory: 'win-vegas' } })).status).toBe(200);
    });

    it('earns for playing — the same amount whatever the bet — and announces it', async () => {
      const annBefore = (await mine(ann)).balance, boBefore = (await mine(bo)).balance;
      s.decks.push(rigDeck(['As Ad', '2c 7d'], 'Kh Qd', 'Ac 9s 5h 3d Jc'));
      await ann.bet($(100)); await bo.bet($(5));                        // very different bets
      await Promise.all([ann.ready(), bo.ready()]);
      await ann.decide('preflop', 'play4'); await bo.decide('preflop', 'check'); await bo.decide('flop', 'check'); await bo.decide('river', 'fold');
      await ann.waitState((v) => v.phase === 'settled');
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline && !bo.events.some((e) => e.ev === 'style:earned')) await new Promise((r) => setTimeout(r, 20));
      const annGain = (await mine(ann)).balance - annBefore, boGain = (await mine(bo)).balance - boBefore;
      expect(annGain).toBe(200);           // first hand + game night
      expect(boGain).toBe(annGain);        // $100 winner and $5 folder earn the same
      expect(bo.events.find((e) => e.ev === 'style:earned')!.args[0]).toMatchObject({ rewards: expect.arrayContaining(['first-hand', 'game-night']) });
    });

    it('looks stay on the seats in Three Card Poker too, and the host can limit effects', async () => {
      expect((await bo.emit('host:theme', { effects: 'off' })).ok).toBe(false);
      expect((await ann.emit('host:theme', { effects: 'subtle' })).ok).toBe(true);
      await ann.waitState((v) => v.phase === 'betting');
      expect((await ann.emit('host:game', { game: 'tcp' })).ok).toBe(true);
      const v = await bo.waitState((x) => x.config.game === 'tcp' && x.config.effects === 'subtle');
      expect(v.seats[0]!.look!.equipped.hat).toBe('fedora-black');
      expect(v.seats[1]!.look!.equipped.hat).toBe('fedora-black');
      s.decks.push(rigTcp(['Ah Kh Qh', '2c 7d 9s'], 'Js 8d 4c'));
      await ann.emit('bet:place', { actionId: key(), ante: $(10) }); await bo.emit('bet:place', { actionId: key(), ante: $(10) });
      await Promise.all([ann.ready(), bo.ready()]);
      await ann.decide('decide', 'play1'); await bo.decide('decide', 'fold');
      const done = await ann.waitState((x) => x.phase === 'settled');
      expect(done.seats[0]!.look).toBeTruthy();
      expect(await s.store.ledgerSum(ann.id, code)).toBe(done.seats[0]!.balance);
    });

    it('reaction sets: only lines from a set you have equipped', async () => {
      expect((await bo.emit('chat:react', { reaction: 'Yeehaw!' })).ok).toBe(false);
      expect((await bo.emit('chat:react', { reaction: 'Nice hand!' })).ok).toBe(true);
    });

    it('public profile and looks show cosmetics only — no chips, balances or hands', async () => {
      const p = (await s.api(`/api/players/${ann.id}/profile`, bo.token)).body.profile;
      expect(p.collections).toContain('classic-vegas');
      expect(p.achievements).toEqual(expect.arrayContaining(['welcome', 'first-hand']));
      expect(JSON.stringify(p)).not.toMatch(/balance|stack|ledger|net|token/i);
      const l = (await s.api(`/api/looks?ids=${ann.id},${bo.id}`, bo.token)).body.looks;
      expect(Object.keys(l).sort()).toEqual([ann.id, bo.id].sort());
      expect(Object.keys(l[ann.id]).sort()).toEqual(['appearance', 'equipped']);
    });

    it('recovers after a server interruption: owned items, balance and look persist; a retried purchase is not charged again', async () => {
      const k = key();
      await s.store.grant(bo.id, { key: key(), rewardId: null, amount: 500, items: [], method: 'reward', note: 'test' });
      const first = await buy(bo, 'frame-silver', k);
      expect(first.body.status).toBe('ok');
      const before = await mine(bo);
      // Restart: brand-new server process on the same database.
      for (const c of s.clients) c.socket.disconnect();
      await s.server.close(); await s.store.close();
      const s2 = await startServer({ reset: false });
      try {
        const again = await s2.api('/api/me/purchase', bo.token, { method: 'POST', body: JSON.stringify({ itemId: 'frame-silver', key: k }) });
        expect(again.body.status).toBe('duplicate');
        const after = (await s2.api('/api/me/cosmetics', bo.token)).body;
        expect(after.balance).toBe(before.balance);
        expect(after.owned.map((o: any) => o.itemId).sort()).toEqual(before.owned.map((o: any) => o.itemId).sort());
        expect(after.avatar).toEqual(before.avatar);
      } finally { await s2.stop(); }
      s = { ...s, stop: async () => {} } as S;
    });
  });

  describe('§24 on the memory store', () => {
    it('same rules: welcome once, idempotent purchase, no negatives', async () => {
      const s = await startServer({ memory: true });
      try {
        const g = await s.guest('Mo');
        const api = (p: string, init?: RequestInit) => s.api(p, g.token, init);
        expect((await api('/api/me/cosmetics')).body.balance).toBe(300);
        const k = key();
        expect((await api('/api/me/purchase', { method: 'POST', body: JSON.stringify({ itemId: 'tux-black', key: k }) })).body.error).toMatch(/Not enough/);
        expect((await api('/api/me/purchase', { method: 'POST', body: JSON.stringify({ itemId: 'fedora-black', key: k }) })).body.status).toBe('ok');
        expect((await api('/api/me/purchase', { method: 'POST', body: JSON.stringify({ itemId: 'fedora-black', key: k }) })).body.status).toBe('duplicate');
        expect((await api('/api/me/cosmetics')).body.balance).toBe(150);
      } finally { await s.stop(); }
    });
  });
});

// ==================================================================== dealers.test.ts
describe('dealers', () => {
  type S = Awaited<ReturnType<typeof startServer>>;

  describe('§25 rotating dealers', () => {
    let s: S; let ann: TC; let bo: TC; let code: string;
    const engine = () => s.server.manager.tables.get(code)!;
    /** One quick hand: both play 4x preflop, which ends the decisions. */
    async function hand(deck?: number[], ante = $(5)) {
      if (deck) s.decks.push(deck);
      await ann.waitState((v) => v.phase === 'betting', 8000, 'betting');
      await ann.bet(ante); await bo.bet($(5));
      await Promise.all([ann.ready(), bo.ready()]);
      await ann.decide('preflop', 'play4'); await bo.decide('preflop', 'play4');
      return ann.waitState((v) => v.phase === 'settled', 8000, 'settled');
    }
    beforeAll(async () => {
      s = await startServer();
      ann = await s.player('Ann'); bo = await s.player('Bo');
      code = await s.createTable(ann.token, {});
      await ann.join(code); await bo.join(code);
    });
    afterAll(() => s.stop());

    it('a new table opens with a dealer from the roster, who speaks under their own name', async () => {
      const v = await ann.waitState((x) => x.phase === 'betting' && !!x.seats[1]);
      expect(DEALER.has(v.house.dealerId)).toBe(true);
      expect(v.house.rounds).toBe(0);
      expect(v.config.dealer).toMatchObject({ rotate: true, every: 25, majorWins: true, majorMin: 250_000, majorMultiple: 100, progressiveMin: 1_000_000 });
      await hand();
      const name = DEALER.get(v.house.dealerId)!.name;
      expect(ann.chat.filter((m) => m.kind === 'dealer').every((m) => m.name === name)).toBe(true);
      expect((await ann.waitState((x) => x.phase === 'settled')).house.rounds).toBe(1);
    });

    it('host settings are validated and host-only; dealer choice only between hands', async () => {
      expect((await bo.emit('host:dealer', { settings: { every: 10 } })).ok).toBe(false);
      expect((await ann.emit('host:dealer', { settings: { every: 7 } })).error).toMatch(/10, 25, 50 or 100/);
      expect((await ann.emit('host:dealer', { settings: { majorMin: 12_345 } })).ok).toBe(false);
      expect((await ann.emit('host:dealer', { dealerId: 'nobody' })).error).toMatch(/Unknown dealer/);
      expect((await ann.emit('host:dealer', { settings: { every: 10, intro: 'short', chatter: 'off', volume: 40 } })).ok).toBe(true);
      await ann.waitState((v) => v.phase === 'betting');
      s.decks.push(rigDeck(['Kc Kd', '2c 7d'], '2s 3h', 'Ks 9h 9d 4c Jh'));
      await ann.bet($(5)); await bo.bet($(5)); await Promise.all([ann.ready(), bo.ready()]);
      await ann.waitState((v) => v.phase === 'preflop');
      expect((await ann.emit('host:dealer', { dealerId: DEALERS.find((d) => d.id !== engine().house.dealerId)!.id })).error).toMatch(/between hands/);
      await ann.decide('preflop', 'play4'); await bo.decide('preflop', 'play4');
      await ann.waitState((v) => v.phase === 'settled');
    });

    it('rotates after the set number of completed rounds — after results, never mid-hand — and never to the same dealer', async () => {
      const start = engine().house.dealerId;
      let v!: TableView;
      while ((v = ann.state).house.rounds < 9) await hand();
      expect(v.house.dealerId).toBe(start);
      v = await hand();                                                      // the 10th completed round
      expect(v.house).toMatchObject({ dealerId: start, rounds: 10, rotating: { reason: 'shift' } });   // results still with the old dealer
      const next = await ann.waitState((x) => x.phase === 'betting', 8000, 'next betting');
      expect(next.house.dealerId).not.toBe(start);
      expect(next.house).toMatchObject({ rounds: 0, rotating: null, event: { kind: 'rotate', from: start, to: next.house.dealerId, reason: 'shift' } });
      const newName = DEALER.get(next.house.dealerId)!.name;
      // intro: the short intro, or (§32, at a roasting table) the new dealer's own roast introduction
      expect(ann.chat.some((m) => m.name === newName && (m.text === DEALER.get(next.house.dealerId)!.introShort || (m.roast?.cat === 'intro' && m.roast.dealer === next.house.dealerId)))).toBe(true);
    });

    it('a major win rotates early (once, even when it lands on the shift limit), using settled results only', async () => {
      expect((await ann.emit('host:dealer', { settings: { majorMin: 10_000, majorMultiple: 5 } })).ok).toBe(true);
      await ann.waitState((v) => v.phase === 'betting');
      engine().house.rounds = 9;                                              // the big win is also the 10th round
      const before = engine().house.dealerId;
      const farewells = () => ann.chat.filter((m) => DEALER.get(before)!.lines.farewell.includes(m.text) || (m.roast?.cat === 'farewell' && m.roast.dealer === before)).length;
      const f0 = farewells();
      // Ann: straight (A-K-Q-J-T) vs dealer pair; ante $25, play $100 → +$150 ≥ max($100, 5×$25).
      const v = await hand(rigDeck(['Ah Kd', '2c 7d'], '9s 9h', 'Qc Jh Ts 4d 3c'), $(25));
      expect(v.seats[0]!.result!.net).toBeGreaterThanOrEqual($(125));
      expect(v.house).toMatchObject({ rotating: { reason: 'bigwin' }, bigWin: { name: 'Ann' } });
      expect(ann.chat.some((m) => /Congratulations, Ann/.test(m.text))).toBe(true);
      expect(ann.chat.some((m) => m.text === 'That was quite a hand. Looks like my shift ends on a high note.' || m.roast?.cat === 'bigWinOut')).toBe(true);
      const n = await ann.waitState((x) => x.phase === 'betting');
      expect(n.house).toMatchObject({ rounds: 0, event: { reason: 'bigwin', from: before } });
      expect(farewells() - f0).toBe(1);                                       // exactly one hand-over
    });

    it('the shift count belongs to the table and carries across a game switch; dealer changes never touch the deck', async () => {
      await ann.waitState((v) => v.phase === 'betting');
      engine().house.rounds = 3;
      expect((await ann.emit('host:game', { game: 'tcp' })).ok).toBe(true);
      const dealer = engine().house.dealerId;
      s.decks.push(rigTcp(['Ah Kh Qh', '2c 7d 9s'], 'Js 8d 4c'));
      await ann.waitState((v) => v.config.game === 'tcp' && v.phase === 'betting');
      await ann.emit('bet:place', { actionId: aid(), ante: $(10) }); await bo.emit('bet:place', { actionId: aid(), ante: $(10) });
      await Promise.all([ann.ready(), bo.ready()]);
      const dealt = await ann.waitState((v) => v.phase === 'decide');
      expect(dealt.seats[0]!.cards).toEqual(['Ah', 'Kh', 'Qh']);              // the rigged deck, card for card
      await ann.decide('decide', 'play1'); await bo.decide('decide', 'fold');
      const v = await ann.waitState((x) => x.phase === 'settled');
      expect(v.house).toMatchObject({ dealerId: dealer, rounds: 4 });
      expect(await s.store.ledgerSum(ann.id, code)).toBe(v.seats[0]!.balance);
    });

    it('the host can pick a dealer between hands', async () => {
      const v = await ann.waitState((x) => x.phase === 'betting');
      const pick = DEALERS.find((d) => d.id !== v.house.dealerId)!.id;
      expect((await ann.emit('host:dealer', { dealerId: pick })).ok).toBe(true);
      const n = await bo.waitState((x) => x.house.dealerId === pick);
      expect(n.house.event).toMatchObject({ reason: 'host', to: pick });
    });

    it('survives a restart: same dealer, same shift count; an interrupted (voided) hand does not count', async () => {
      const { dealerId, rounds } = engine().house;
      s.decks.push(rigTcp(['Ah Kh Qh', '2c 7d 9s'], 'Js 8d 4c'));
      await ann.emit('bet:place', { actionId: aid(), ante: $(10) }); await bo.emit('bet:place', { actionId: aid(), ante: $(10) });
      await Promise.all([ann.ready(), bo.ready()]);
      await ann.waitState((v) => v.phase === 'decide');
      for (const c of s.clients) c.socket.disconnect();
      await s.server.close(); await s.store.close();
      const s2 = await startServer({ reset: false });
      try {
        const a2 = await s2.player('Ann2');
        await a2.join(code).catch(() => {});
        const v = await a2.waitState(() => true);
        expect(v.house).toMatchObject({ dealerId, rounds });
      } finally { await s2.stop(); }
      s = { ...s, stop: async () => {} } as S;
    });
  });
});

// ==================================================================== flow30.test.ts
// §30 integration flow at socket level (fast timers): lobby identity → avatar → border → chips → six-player Hold'em
// → default dealer change after 25 rounds → Three Card Poker → Blackjack. Same identity and exact balances throughout.
describe('flow30', () => {
  type S = Awaited<ReturnType<typeof startServer>>;
  const key = () => `k${Date.now()}${Math.random().toString(36).slice(2, 10)}`;

  describe('§30 full flow (PostgreSQL)', () => {
    let s: S; let ps: TC[]; let code: string;
    const ann = () => ps[0];
    const recon = async () => { for (const p of ps) expect(await s.store.ledgerSum(p.id, code), p.name).toBe(p.state.seats.find((x) => x?.playerId === p.id)!.balance); };
    beforeAll(async () => { s = await startServer(); ps = []; for (const n of ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo']) ps.push(await s.player(n)); });
    afterAll(() => s.stop());

    it('avatar, animated border and a custom chip are bought with Style Credits only', async () => {
      const a = ann();
      const api = (p: string, init?: RequestInit) => s.api(p, a.token, init);
      expect((await api('/api/me/avatar', { method: 'PUT', body: JSON.stringify({ appearance: { ...DEFAULT_APPEARANCE, hair: 'slick' }, equipped: {}, preset: 'custom', outfits: {} }) })).status).toBe(200);
      expect((await api('/api/me/purchase', { method: 'POST', body: JSON.stringify({ itemId: 'border-emerald-pulse', key: key() }) })).status).toBe(200);
      const chip = chipItemId('emerald', 2_500);
      expect((await api('/api/me/purchase', { method: 'POST', body: JSON.stringify({ itemId: chip, key: key() }) })).status).toBe(200);
      const r = await api('/api/me/avatar', { method: 'PUT', body: JSON.stringify({ appearance: { ...DEFAULT_APPEARANCE, hair: 'slick' }, equipped: { frame: 'border-emerald-pulse', c25: chip }, preset: 'custom', outfits: {} }) });
      expect(r.status).toBe(200);
      const me = (await api('/api/me/cosmetics')).body;
      expect(me.balance).toBe(300 + 50 - 250 - 70);
    });

    it('six players sit; the dealer hands over after the 25th completed round (default shift)', async () => {
      code = await s.createTable(ann().token, { startingBankroll: $(1000) });
      for (const p of ps) await p.join(code);
      const v0 = await ann().waitState((v) => v.phase === 'betting' && v.seats.filter(Boolean).length === 6);
      expect(v0.config.dealer.every).toBe(25);
      const annSeat = v0.seats.find((x) => x?.playerId === ann().id)!;
      expect(annSeat.look!.equipped).toMatchObject({ frame: 'border-emerald-pulse', c25: chipItemId('emerald', 2_500) });
      const first = v0.house.dealerId;
      for (let n = 1; n <= 25; n++) {
        await ann().waitState((v) => v.phase === 'betting', 8000, `betting ${n}`);
        expect(ann().state.house.dealerId).toBe(first);
        s.decks.push(rigDeck(['2c 3d', '4h 5s', '6c 7d', '8h 9s', 'Tc Jd', 'Qh Ks'], '2h 7s', 'Ac 9c 5d 3h 8d'));
        for (const p of ps) expect((await p.bet($(5))).ok).toBe(true);
        await Promise.all(ps.map((p) => p.ready()));
        await ann().waitState((v) => v.phase === 'preflop', 8000);
        await Promise.all(ps.map((p) => p.decide('preflop', 'play4')));
        await ann().waitState((v) => v.phase === 'settled', 8000);
      }
      const next = await ann().waitState((v) => v.phase === 'betting' && v.house.dealerId !== first, 8000, 'new dealer');
      expect(next.house).toMatchObject({ rounds: 0, event: { kind: 'rotate', from: first, reason: 'shift' } });
      await recon();
    });

    it('host switches to Three Card Poker and then Blackjack: same seats, identities, looks and exact balances', async () => {
      const seatsOf = (v = ann().state) => v.seats.filter(Boolean).map((x) => `${x!.playerId}@${x!.seat}`);
      const before = seatsOf();
      expect((await ann().emit('host:game', { game: 'tcp' })).ok).toBe(true);
      await ann().waitState((v) => v.config.game === 'tcp' && v.phase === 'betting');
      s.decks.push(rigTcp(['2c 5d 9h', '3c 6d Th', '4c 7d Jh', '2s 8d Qh', '3s 9d Kh', '4s Td Ah'], 'Qc 6h 4h'));
      for (const p of ps) expect((await p.emit('bet:place', { actionId: aid(), ante: $(5), trips: 0, pairPlus: 0, sixCard: 0 })).ok).toBe(true);
      await Promise.all(ps.map((p) => p.ready()));
      await ann().waitState((v) => v.phase === 'decide');
      await Promise.all(ps.map((p) => p.decide('decide', 'fold')));
      await ann().waitState((v) => v.phase === 'settled');
      await recon();
      await ann().waitState((v) => v.phase === 'betting');
      expect((await ann().emit('host:game', { game: 'bj' })).ok).toBe(true);
      await ann().waitState((v) => v.config.game === 'bj' && v.phase === 'betting');
      expect(seatsOf()).toEqual(before);
      s.rigShoe(code, rigShoe(['Ts 7d', 'Th 8d', 'Tc 9d', 'Td 7h', 'Ks 8h', 'Kh 9h'], '9c 8c'));
      for (const p of ps) expect((await p.bet($(5))).ok).toBe(true);
      await Promise.all(ps.map((p) => p.ready()));
      for (const p of ps) await p.bj('stand');
      const done = await ann().waitState((v) => v.phase === 'settled', 10_000);
      expect(seatsOf(done)).toEqual(before);
      expect(done.seats.find((x) => x?.playerId === ann().id)!.look!.equipped.frame).toBe('border-emerald-pulse');
      await recon();
      // The same identity owns the history in all three games.
      const q = (await s.api('/api/stats/quality', ann().token)).body.lifetime;
      expect(q.byGame).toMatchObject({ uth: { hands: 25 }, tcp: { hands: 1 }, bj: { hands: 1 } });
    });
  });
});

// ==================================================================== host.test.ts
describe('host', () => {
  type S = Awaited<ReturnType<typeof startServer>>;

  describe('host controls: table look, away, move to spectators', () => {
    let s: S; let code: string; let kim: TC; let lou: TC;
    beforeAll(async () => {
      s = await startServer({ memory: true });
      kim = await s.player('Kim'); lou = await s.player('Lou');
      code = await s.createTable(kim.token);
      await kim.join(code); await lou.join(code);
      await kim.waitState((v) => v.phase === 'betting' && !!v.seats[1]);
    });
    afterAll(() => s.stop());

    it('felt and card backs are the host’s choice and everyone sees them', async () => {
      expect(kim.state.config.felt).toBe('emerald');
      expect((await lou.emit('host:theme', { felt: 'sapphire' })).ok).toBe(false);          // not the host
      expect((await kim.emit('host:theme', { felt: 'plaid' })).ok).toBe(false);             // unknown
      expect((await kim.emit('host:theme', { felt: 'sapphire', cardBack: 'navy' })).ok).toBe(true);
      const v = await lou.waitState((x) => x.config.felt === 'sapphire');
      expect(v.config.cardBack).toBe('navy');
      await lou.waitState(() => lou.chat.some((m) => /changed the felt to Sapphire/.test(m.text)), 2000);
    });

    it('host can set a player away and bring them back; the player can come back themselves', async () => {
      expect((await lou.emit('host:away', { playerId: kim.id, away: true })).ok).toBe(false);
      expect((await kim.emit('host:away', { playerId: lou.id, away: true })).ok).toBe(true);
      let v = await lou.waitState((x) => x.seats[1]!.status === 'sitting-out');
      expect(v.seats[1]!.awayByHost).toBe(true);
      expect((await kim.emit('host:away', { playerId: lou.id, away: false })).ok).toBe(true);
      await lou.waitState((x) => x.seats[1]!.status !== 'sitting-out');
      await kim.emit('host:away', { playerId: lou.id, away: true });
      await lou.waitState((x) => x.seats[1]!.status === 'sitting-out');
      expect((await lou.bet($(10))).ok).toBe(true);
      expect((await lou.ready()).ok).toBe(true);                                             // readying = I'm back
      v = await lou.waitState((x) => x.seats[1]!.status === 'ready' || x.phase !== 'betting');
      expect(v.seats[1]!.awayByHost).toBeFalsy();
    });

    it('moving a player to the spectators mid-hand waits for the hand to finish and keeps their chips', async () => {
      await kim.bet($(10)); await kim.ready();
      await kim.waitState((v) => v.phase === 'preflop');
      expect((await kim.emit('host:standUp', { playerId: kim.id })).ok).toBe(false);         // can't stand yourself up
      expect((await kim.emit('host:standUp', { playerId: lou.id })).ok).toBe(true);
      let v = await lou.waitState((x) => !!x.seats[1]?.standingUp);
      expect(v.seats[1]!.cards).toHaveLength(2);                                            // still in this hand
      await kim.decide('preflop', 'check'); await lou.decide('preflop', 'check');
      await kim.decide('flop', 'check'); await lou.decide('flop', 'check');
      await kim.decide('river', 'fold'); await lou.decide('river', 'fold');
      v = await lou.waitState((x) => x.phase === 'betting' && !x.seats[1], 8000, 'stood up');
      expect(v.you.role).toBe('spectator');
      const bal = (await s.store.getStack(lou.id, code))!.balance;
      expect((await lou.emit('table:sit', {})).ok).toBe(true);
      v = await lou.waitState((x) => x.you.role === 'player');
      expect(v.seats[v.you.seat!]!.balance).toBe(bal);
    });
  });

  describe('debt counter (just for fun)', () => {
    let s: S; let code: string; let ed: TC;
    beforeAll(async () => {
      s = await startServer();
      ed = await s.player('Ed');
      code = await s.createTable(ed.token, { minAnte: 500, startingBankroll: 1500 });
      await ed.join(code);
    });
    afterAll(() => s.stop());

    async function loseEverything() {
      s.decks.push(rigDeck(['2c 3d'], 'As Ad', 'Kh Qs 8c 7d 4h'));
      await ed.waitState((v) => v.phase === 'betting');
      expect((await ed.bet($(5))).ok).toBe(true);
      await ed.ready();
      await ed.decide('preflop', 'check'); await ed.decide('flop', 'check'); await ed.decide('river', 'play1');
      await ed.waitState((v) => v.phase === 'settled' || (v.phase === 'betting' && v.seats[0]!.balance === 0));
    }

    let firstPawn = '', secondPawn = '';
    it('each reload adds a marker; the dealer jokes and suggests something to pawn', async () => {
      await loseEverything();
      await ed.waitState((v) => v.phase === 'betting' && v.you.canReload, 8000, 'broke');
      const r1 = await ed.emit('player:reload');
      expect(r1).toMatchObject({ ok: true, balance: $(15), debt: $(15) });
      let v = await ed.waitState((x) => x.seats[0]!.debt === $(15));
      expect(v.seats[0]!.balance).toBe($(15));
      expect(PAWN_TIERS[0].items).toContain(r1.pawned);                                        // a random item from the $1,000 tier
      expect(v.seats[0]!.pawned).toBe(r1.pawned);
      await ed.waitState(() => ed.chat.some((m) => m.text.startsWith('Ed takes a $15 marker. Total debt: $15.') && m.text.includes(`pawn ${r1.pawned} (about $1,000)`)), 2000);
      firstPawn = r1.pawned;

      await loseEverything();
      await ed.waitState((x) => x.phase === 'betting' && x.you.canReload, 8000, 'broke again');
      const r2 = await ed.emit('player:reload');
      expect(r2).toMatchObject({ ok: true, debt: $(30) });
      secondPawn = r2.pawned;
      v = await ed.waitState((x) => x.seats[0]!.debt === $(30) && x.seats[0]!.pawned === secondPawn);
      const lines = ed.chat.filter((m) => /marker/.test(m.text)).map((m) => m.text);
      expect(lines).toHaveLength(2);
      expect(lines[0]).not.toEqual(lines[1].replace('$30', '$15'));                         // a different joke each time
      // Debt survives in the database and is in the stats; it never touches the ledger reconciliation.
      expect((await s.store.getStack(ed.id, code))!.debt).toBe($(30));
      expect(await s.store.ledgerSum(ed.id, code)).toBe(v.seats[0]!.balance);
      const st = (await s.api('/api/stats/me', ed.token)).body.stats;
      expect(st.debt).toBe($(30));
    });

    it('pays markers back from the stack; the pawn shop keeps a running list', async () => {
      await ed.waitState((v) => v.phase === 'betting');
      expect((await ed.emit('player:payDebt', { amount: 0 })).ok).toBe(false);
      let r = await ed.emit('player:payDebt', { amount: $(10) });
      expect(r).toMatchObject({ ok: true, paid: $(10), debt: $(20), balance: $(5) });
      await ed.waitState(() => ed.chat.some((m) => m.text === `Ed pays $10 on their markers. Still owes $20 — ${secondPawn.replace(/^your /, 'their ')} stays at the pawn shop.`), 2000);
      // Asking for more than you have pays what you have, never more than you owe.
      r = await ed.emit('player:payDebt', { amount: $(500) });
      expect(r).toMatchObject({ ok: true, paid: $(5), debt: $(15), balance: 0 });
      expect((await ed.emit('player:payDebt', { amount: $(1) })).ok).toBe(false);          // no chips left
      expect(await s.store.ledgerSum(ed.id, code)).toBe(0);
      expect((await s.store.getStack(ed.id, code))!.debt).toBe($(15));
      const chips = (await s.api(`/api/tables/${code}/chips`, ed.token)).body.chips;
      expect(chips).toMatchObject({ balanced: true, balance: 0, debt: $(15), reloads: $(30) - $(15) });
      const events = (await s.api(`/api/tables/${code}/pawns`, ed.token)).body.events;
      expect(events.map((e: any) => [e.kind, e.amount, e.debtAfter])).toEqual([
        ['payoff', $(5), $(15)], ['payoff', $(10), $(20)], ['marker', $(15), $(30)], ['marker', $(15), $(15)]]);
      expect(events.map((e: any) => e.item)).toEqual([secondPawn, secondPawn, secondPawn, firstPawn]);   // the shop remembers what was pawned
      // Reloading again adds a new marker on top.
      expect(await ed.emit('player:reload')).toMatchObject({ ok: true, debt: $(30) });
    });

    it('cannot pay off mid-hand', async () => {
      s.decks.push(rigDeck(['Kc Kd'], '2s 3h', 'Ks 9h 9d 4c Jh'));
      await ed.bet($(5)); await ed.ready();
      await ed.waitState((v) => v.phase === 'preflop');
      expect((await ed.emit('player:payDebt', { amount: $(5) })).error).toMatch(/between hands/);
    });
  });
});

// ==================================================================== multiplayer.test.ts
describe('multiplayer', () => {
  type S = Awaited<ReturnType<typeof startServer>>;
  const BOARD = 'Kh 7s 2d 9c 4h';

  describe('six-player table on PostgreSQL', () => {
    let s: S; let code: string; let p: TC[];
    const holes = ['As Kd', 'Jc Jh', '7c 6c', '9d 8d', '3s 5d', 'Th Ts'];

    beforeAll(async () => {
      s = await startServer();
      p = [];
      for (const n of ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']) p.push(await s.player(n));
      code = await s.createTable(p[0].token, { name: 'Friday Night', isPublic: true });
      s.server.manager.tables.get(code)!.config.decisionSeconds = 2; // shorten the clock for the timeout seat
    });
    afterAll(() => s.stop());

    it('seats all six players at the same table and rejects a seventh', async () => {
      for (let i = 0; i < 6; i++) expect((await p[i].join(code)).seat).toBe(i);
      const seventh = await s.player('Gus');
      const r = await seventh.join(code);
      expect(r.ok).toBe(true);          // admitted as a spectator
      expect(r.seat).toBeNull();
      const v = await p[0].waitState((x) => x.seats.filter(Boolean).length === 6);
      expect(v.seats.map((x) => x!.name)).toEqual(['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']);
      expect((await s.api('/api/tables', p[0].token)).body.tables[0]).toMatchObject({ code, seated: 6, maxSeats: 6 });
    });

    it('plays a full hand with independent decisions and correct independent settlement', async () => {
      s.decks.push(rigDeck(holes, 'Qc Qd', BOARD));
      // Bets: everyone $10 ante; Ben and Eli add $5 Trips+
      for (let i = 0; i < 6; i++) expect((await p[i].bet($(10), i === 1 || i === 4 ? $(5) : 0)).ok).toBe(true);
      await Promise.all(p.map((c) => c.ready()));
      await p[0].waitState((v) => v.phase === 'preflop');

      // Every player sees only their own hole cards; same hidden board
      for (let i = 0; i < 6; i++) {
        const v = await p[i].waitState((x) => x.phase === 'preflop');
        expect(v.seats[i]!.cards).toEqual(holes[i].split(' '));
        for (let j = 0; j < 6; j++) if (j !== i) expect(v.seats[j]!.cards).toEqual([null, null]);
        expect(v.dealer.cards).toEqual([null, null]);
        expect(v.community).toEqual([null, null, null, null, null]);
      }

      // Pre-flop: Ava 4x, Ben 3x, the rest check; Fay never acts (timeout)
      expect((await p[0].decide('preflop', 'play4')).ok).toBe(true);
      expect((await p[1].decide('preflop', 'play3')).ok).toBe(true);
      for (const i of [2, 3, 4]) expect((await p[i].decide('preflop', 'check')).ok).toBe(true);

      // Others see Ava's visible Play wager, but not her cards
      const mid = await p[3].waitState((v) => v.seats[0]!.bet.play === $(40));
      expect(mid.seats[0]!.cards).toEqual([null, null]);
      expect(mid.seats[0]!.acted).toBe(true);

      // Flop (after Fay's timeout): everyone sees the same three cards
      const flops = await Promise.all(p.map((c) => c.waitState((v) => v.phase === 'flop', 6000)));
      for (const f of flops) expect(f.community).toEqual(['Kh', '7s', '2d', null, null]);
      expect(flops[0].you.legal).toEqual([]);            // already raised: no decision
      expect(flops[2].you.legal).toEqual(['play2', 'check']);
      expect((await p[2].decide('flop', 'play2')).ok).toBe(true);
      for (const i of [3, 4]) expect((await p[i].decide('flop', 'check')).ok).toBe(true);

      const rivers = await Promise.all(p.map((c) => c.waitState((v) => v.phase === 'river', 6000)));
      for (const r of rivers) expect(r.community).toEqual(BOARD.split(' '));
      expect((await p[3].decide('river', 'play1')).ok).toBe(true);
      expect((await p[4].decide('river', 'fold')).ok).toBe(true);

      const done = await p[0].waitState((v) => v.phase === 'settled', 8000);
      expect(done.dealer.cards).toEqual(['Qc', 'Qd']);
      expect(done.dealer.qualifies).toBe(true);
      const nets = done.seats.map((x) => x!.result!.net);
      //          Ava  Ben   Cal   Dee   Eli   Fay
      expect(nets).toEqual([$(50), -$(55), -$(40), -$(30), -$(25), -$(20)]);
      expect(done.seats.map((x) => x!.bet.play)).toEqual([$(40), $(30), $(20), $(10), 0, 0]);
      expect(done.seats[5]!.status).toBe('folded');      // river timeout -> fold

      // Showdown policy: after settlement every hand is face up, folded ones included
      expect(done.seats[0]!.cards).toEqual(['As', 'Kd']);
      expect(done.seats[4]!.cards).toEqual(['3s', '5d']);
      expect(done.seats[4]!.result!.handName).toBe('High Card');
      expect(done.seats[4]!.result!.outcome).toBe('fold');
      const eliOwn = p[4].state.seats[4]!;
      expect(eliOwn.cards).toEqual(['3s', '5d']);

      // Balances persisted and reconcile with the ledger
      for (let i = 0; i < 6; i++) {
        expect(done.seats[i]!.balance).toBe($(1000) + nets[i]);
        expect(await s.store.ledgerSum(p[i].id, code)).toBe(done.seats[i]!.balance);
      }
    });

    it('never sent hidden cards to anyone before showdown', () => {
      const dealerSecrets = ['"Qc"', '"Qd"'];
      for (let i = 0; i < 6; i++) {
        const before = p[i].raw.slice(0, p[i].raw.findIndex((r) => r.includes('"phase":"settled"')));
        const text = before.join('\n');
        for (const sec of dealerSecrets) expect(text.includes(sec)).toBe(false);
        for (let j = 0; j < 6; j++) if (j !== i) for (const c of holes[j].split(' ')) expect(text.includes(`"${c}"`)).toBe(false);
        // River cards never appear before the river
        const preRiver = p[i].raw.slice(0, p[i].raw.findIndex((r) => r.includes('"phase":"river"'))).join('\n');
        expect(preRiver.includes('"9c"')).toBe(false);
      }
    });

    it('records strategy decisions, timeouts and post-hand analysis', async () => {
      await p[1].waitState(() => p[1].analysis.length > 0, 8000, 'analysis');
      const ben = p[1].analysis[0].decisions;
      expect(ben[0]).toMatchObject({ phase: 'preflop', action: 'play3', recommended: 'play4', correct: false });
      expect(ben[0].evCost).toBeGreaterThan(0);
      await p[5].waitState(() => p[5].analysis.length > 0, 8000, 'analysis');
      expect(p[5].analysis[0].decisions.every((d) => d.timedOut)).toBe(true);
      // Fay's timed-out river fold with pocket tens was a mistake: the record carries the dealer's outs.
      const fayRiver = p[5].analysis[0].decisions.find((d) => d.phase === 'river')!;
      expect(fayRiver).toMatchObject({ action: 'fold', recommended: 'play1', correct: false });
      expect(fayRiver.outs).toMatchObject({ kind: 'dealer', combos: 990 });
      expect(fayRiver.outs!.count).toBeGreaterThan(0);
      const fayFlop = p[5].analysis[0].decisions.find((d) => d.phase === 'flop')!;
      expect(fayFlop.outs?.kind).toBe('improve');
      const stats = (await s.api('/api/stats/me', p[1].token)).body.stats;
      expect(stats.hands).toBe(1);
      expect(stats.trips.bets).toBe(1);
      expect(stats.handsWithFriends).toBe(1);
    });

    it('serves a replay that matches the saved hand, folded hands included', async () => {
      const handId = p[0].state.handId ?? p[0].states.findLast((v) => v.handId)!.handId!;
      const r = await s.api(`/api/hands/${handId}`, p[0].token);
      expect(r.status).toBe(200);
      expect(r.body.hand.community).toEqual(BOARD.split(' '));
      expect(r.body.hand.dealer).toEqual(['Qc', 'Qd']);
      const eli = r.body.hand.players.find((x: any) => x.name === 'Eli');
      expect(eli.hole).toEqual(['3s', '5d']);
      const outsider = await s.player('Outsider');
      expect((await s.api(`/api/hands/${handId}`, outsider.token)).status).toBe(404);
    });
  });

  describe('rules at the table', () => {
    let s: S;
    beforeAll(async () => { s = await startServer(); });
    afterAll(() => s.stop());

    it('dealer non-qualification only pushes the Ante; Trips+ still pays on a fold', async () => {
      const [a, b, c] = [await s.player('Al'), await s.player('Bo'), await s.player('Cy')];
      const code = await s.createTable(a.token);
      for (const x of [a, b, c]) await x.join(code);
      s.decks.push(rigDeck(['Ac Qd', 'Td 3s', '9h 9s'], 'Jc 5c', BOARD));
      await a.bet($(10)); await b.bet($(10)); await c.bet($(10), $(5));
      await Promise.all([a.ready(), b.ready(), c.ready()]);
      await a.decide('preflop', 'play4');
      await b.decide('preflop', 'check'); await c.decide('preflop', 'check');
      await b.decide('flop', 'check'); await c.decide('flop', 'check');
      await b.decide('river', 'play1'); await c.decide('river', 'fold');
      const v = await a.waitState((x) => x.phase === 'settled');
      expect(v.dealer.qualifies).toBe(false);
      const [ra, rb, rc] = v.seats.slice(0, 3).map((x) => x!.result!);
      expect(ra.net).toBe($(40));                                   // ante push, play +40, blind push
      expect(rb.net).toBe(-$(20));                                  // dealer's unqualified hand still beats B: play & blind lose
      expect(rb.lines.find((l) => l.wager === 'ante')!.result).toBe('push');
      expect(c.state.seats[2]!.result!.lines.find((l) => l.wager === 'trips')!.net).toBe($(15));
      expect(rc.net).toBe(-$(5));                                   // −10 ante −10 blind +15 trips
      expect(v.seats[2]!.balance).toBe($(995));
    });

    it('enforces affordability including the reserved 1x Play', async () => {
      const x = await s.player('Shorty');
      const code = await s.createTable(x.token, { startingBankroll: $(60), minAnte: $(5) });
      await x.join(code);
      expect((await x.bet($(20))).ok).toBe(true);                    // needs 60
      const r = await x.bet($(20), $(5));                           // needs 65
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/need \$65/);
      await x.bet($(20)); await x.ready();                           // $40 debited, $20 left = the 1x reserve
      const v = await x.waitState((s) => s.phase === 'preflop');
      expect(v.you.legal).toEqual(['check']);                        // cannot afford 3x/4x
      await x.decide('preflop', 'check');
      const f = await x.waitState((s) => s.phase === 'flop');
      expect(f.you.legal).toEqual(['check']);
      await x.decide('flop', 'check');
      const rv = await x.waitState((s) => s.phase === 'river');
      expect(rv.you.legal).toEqual(['play1', 'fold']);
    });
  });

  describe('abuse, duplicates and stale messages', () => {
    let s: S; let a: TC; let b: TC; let code: string;
    beforeAll(async () => {
      s = await startServer();
      a = await s.player('Alice'); b = await s.player('Bob');
      code = await s.createTable(a.token);
      await a.join(code); await b.join(code);
    });
    afterAll(() => s.stop());

    it('rejects malformed and impossible bets', async () => {
      for (const ante of [-500, 0, 150, 1e12, NaN, '500' as any, null as any, 99]) expect((await a.bet(ante)).ok).toBe(false);
      expect((await a.emit('bet:place', { actionId: 'short', ante: $(5), trips: 0 })).ok).toBe(false);
      expect((await a.emit('player:decide', { actionId: aid(), handId: 'x', phase: 'preflop', decision: 'play4' })).ok).toBe(false);
      expect((await a.ready()).ok).toBe(false);                   // no ante placed
    });

    it('applies a duplicated Play message once and rejects stale phase / wrong hand', async () => {
      await a.bet($(10)); await b.bet($(10));
      await Promise.all([a.ready(), b.ready()]);
      const v = await a.waitState((x) => x.phase === 'preflop');
      const id = aid();
      const msg = { actionId: id, handId: v.handId, phase: 'preflop', decision: 'play4' };
      const [r1, r2, r3] = await Promise.all([a.emit('player:decide', msg), a.emit('player:decide', msg), a.emit('player:decide', msg)]);
      expect([r1, r2, r3].every((r) => r.ok)).toBe(true);           // idempotent ack
      expect((await a.emit('player:decide', { ...msg, actionId: aid() })).ok).toBe(false); // already acted
      const ledger = (s.store as any).pool.query(`SELECT COUNT(*)::int n FROM ledger WHERE player_id=$1 AND kind='wager'`, [a.id]);
      expect((await ledger).rows[0].n).toBe(2);                     // initial + one play
      expect((await b.emit('player:decide', { actionId: aid(), handId: v.handId, phase: 'flop', decision: 'play2' })).error).toMatch(/Stale/);
      expect((await b.emit('player:decide', { actionId: aid(), handId: 'not-the-hand', phase: 'preflop', decision: 'check' })).ok).toBe(false);
      expect((await b.emit('player:decide', { actionId: aid(), handId: v.handId, phase: 'preflop', decision: 'play1' })).ok).toBe(false); // illegal in phase
      expect((await b.bet($(20))).ok).toBe(false);                    // betting locked mid-hand
      await b.decide('preflop', 'check'); await b.decide('flop', 'check'); await b.decide('river', 'fold');
      await a.waitState((x) => x.phase === 'settled');
      expect(await s.store.ledgerSum(a.id, code)).toBe(a.state.seats[0]!.balance);
    });

    it('prevents double settlement at the store level', async () => {
      const handId = a.state.handId!;
      const before = await s.store.ledgerSum(a.id, code);
      const r = await s.store.settleHand(handId, code, { hand: 'x', qualifies: true },
        (jp) => ({ meters: new Map([['five-card-5', jp.get('five-card-5')! + $(999)]]), hits: [], rows: [{ playerId: a.id, credit: $(999), net: 0, outcome: 'win', handName: 'x', handRank: 0, tripsNet: 0, play: 0, folded: false, settlement: {},
          pairsNet: 0, badBeatNet: 0, pairsCombo: null, badBeatCombo: null, pairsMultiplier: null, badBeatMultiplier: null, pairsVariant: null, badBeatVariant: null, baseNet: 0,
          progressiveNet: 0, progressiveHand: null }] }));
      expect(r.applied).toBe(false);
      expect(await s.store.ledgerSum(a.id, code)).toBe(before);
      expect(r.jackpot).toBe(await s.store.getJackpot());   // the meter is untouched by a rejected settlement
    });

    it('rejects unauthenticated sockets, non-host moderation and spoofed seats', async () => {
      const anon = ioc(s.url, { auth: { token: 'x'.repeat(43) }, transports: ['websocket'], forceNew: true, reconnection: false });
      const err = await new Promise<string>((r) => anon.on('connect_error', (e) => r(e.message)));
      expect(err).toBe('unauthorized');
      expect((await b.emit('host:kick', { playerId: a.id })).ok).toBe(false);
      expect((await b.emit('host:settings', { minAnte: $(1) })).ok).toBe(false);
      const spec = await s.player('Watcher');
      await spec.join(code, true);
      expect((await spec.emit('table:sit', { seat: 0 })).ok).toBe(false);   // occupied seat
      expect((await spec.emit('table:sit', { seat: 9 })).ok).toBe(false);   // nonexistent seat
      expect((await spec.bet($(10))).ok).toBe(false);                      // spectators cannot wager
    });

    it('sanitises and rate-limits chat; reactions are a fixed set', async () => {
      expect((await a.emit('chat:send', { text: '<script>alert(1)</script>hi\u0000' })).ok).toBe(true);
      const m = await a.waitState(() => a.chat.some((c) => c.kind === 'player'), 2000).then(() => a.chat.find((c) => c.kind === 'player')!);
      expect(m.text).toBe('scriptalert(1)/scripthi');
      const results = [];
      for (let i = 0; i < 8; i++) results.push((await a.emit('chat:send', { text: 'spam ' + i })).ok);
      expect(results.filter((x) => !x).length).toBeGreaterThan(0);
      expect((await a.emit('chat:react', { reaction: 'You suck' })).ok).toBe(false);
      expect((await b.emit('chat:react', { reaction: 'Nice hand!' })).ok).toBe(true);
    });

    it('host can change settings between hands and remove a player', async () => {
      await a.waitState((x) => x.phase === 'betting', 5000);
      expect((await a.emit('host:settings', { minAnte: $(10), maxAnte: $(50), decisionSeconds: 15 })).ok).toBe(true);
      expect(a.state.config.minAnte).toBe($(10));
      expect((await a.emit('host:settings', { minAnte: $(100), maxAnte: $(50) })).ok).toBe(false);
      const kicked = new Promise((r) => b.socket.once('kicked', r));
      expect((await a.emit('host:kick', { playerId: b.id })).ok).toBe(true);
      await kicked;
      const v = await a.waitState((x) => !x.seats[1]);
      expect(v.seats[1]).toBeNull();
      expect((await b.join(code)).ok).toBe(false);
    });
  });

  describe('connections, mid-hand joins and multiple tables', () => {
    let s: S;
    beforeAll(async () => { s = await startServer(); });
    afterAll(() => s.stop());

    it('a disconnected player keeps their seat; the table continues on the timer; reconnect restores everything', async () => {
      const a = await s.player('Host'); const b = await s.player('Flaky');
      const code = await s.createTable(a.token);
      s.server.manager.tables.get(code)!.config.decisionSeconds = 2;
      await a.join(code); await b.join(code);
      await a.bet($(10)); await b.bet($(10), $(5));
      await Promise.all([a.ready(), b.ready()]);
      const v0 = await b.waitState((x) => x.phase === 'preflop');
      const myCards = v0.seats[1]!.cards;
      await b.decide('preflop', 'play4');
      b.socket.disconnect();
      const seen = await a.waitState((x) => x.seats[1]!.connected === false);
      expect(seen.seats[1]!.status).toBe('in-hand');

      // Reconnect mid-hand with the same token (e.g. page refresh)
      const b2 = new (b.constructor as any)(s.url, b.token, b.id, 'Flaky2') as TC;
      s.clients.push(b2);
      await b2.connected();
      expect((await b2.join(code)).seat).toBe(1);
      const r = await b2.waitState((x) => !!x.handId);
      expect(r.seats[1]!.cards).toEqual(myCards);
      expect(r.seats[1]!.bet).toEqual({ ante: $(10), blind: $(10), trips: $(5), play: $(40), pairs: 0, badBeat: 0, progressive: 0, pairPlus: 0, sixCard: 0 });
      expect(r.seats[1]!.connected).toBe(true);
      expect(r.seats[1]!.balance).toBe($(1000) - $(65));

      // Host never acts — the server clock (not a browser) advances the table
      await a.waitState((x) => x.phase === 'settled', 12000);
      expect(await s.store.ledgerSum(b.id, code)).toBe(a.state.seats[1]!.balance);
    });

    it('players who join mid-hand wait for the next round', async () => {
      const a = await s.player('P1'); const late = await s.player('Late');
      const code = await s.createTable(a.token);
      await a.join(code);
      await a.bet($(5)); await a.ready();
      await a.waitState((x) => x.phase === 'preflop');
      expect((await late.join(code)).seat).toBe(1);
      const lv = await late.waitState((x) => x.phase === 'preflop' && !!x.seats[1]);
      expect(lv.seats[1]!.status).toBe('waiting-next');
      expect(lv.seats[1]!.cards).toEqual([]);
      expect(lv.you.legal).toEqual([]);
      expect((await late.bet($(5))).ok).toBe(false);
      await a.decide('preflop', 'check'); await a.decide('flop', 'check'); await a.decide('river', 'fold');
      await late.waitState((x) => x.phase === 'betting', 5000);
      expect((await late.bet($(5))).ok).toBe(true);
    });

    it('runs two tables concurrently with no shared cards or data', async () => {
      const [a1, a2, b1, b2] = [await s.player('A1'), await s.player('A2'), await s.player('B1'), await s.player('B2')];
      const t1 = await s.createTable(a1.token); const t2 = await s.createTable(b1.token);
      for (const [c, t] of [[a1, t1], [a2, t1], [b1, t2], [b2, t2]] as const) await c.join(t);
      for (const c of [a1, a2, b1, b2]) await c.bet($(5));
      await Promise.all([a1, a2, b1, b2].map((c) => c.ready()));
      await Promise.all([a1, a2, b1, b2].map((c) => c.waitState((x) => x.phase === 'preflop')));
      expect(a1.state.code).toBe(t1); expect(b1.state.code).toBe(t2);
      for (const ph of ['preflop', 'flop', 'river'])
        await Promise.all([a1, a2, b1, b2].map((c) => c.decide(ph, ph === 'river' ? 'play1' : 'check')));
      const [va, vb] = await Promise.all([a1.waitState((x) => x.phase === 'settled'), b1.waitState((x) => x.phase === 'settled')]);
      expect(va.handId).not.toBe(vb.handId);
      expect(a1.raw.some((r) => r.includes(t2))).toBe(false);
      expect(b2.raw.some((r) => r.includes(t1))).toBe(false);
      for (const v of [va, vb]) {
        const cards = [...v.community, ...v.dealer.cards, ...v.seats.flatMap((x) => x?.cards ?? [])].filter(Boolean);
        expect(new Set(cards).size).toBe(cards.length);
      }
    });

    it('spectators never receive hole cards before showdown', async () => {
      const a = await s.player('Seated'); const w = await s.player('Spectator');
      const code = await s.createTable(a.token);
      await a.join(code); await w.join(code, true);
      await a.bet($(5)); await a.ready();
      const v = await w.waitState((x) => x.phase === 'preflop');
      expect(v.you.role).toBe('spectator');
      expect(v.seats[0]!.cards).toEqual([null, null]);
      await a.decide('preflop', 'play4');
      await w.waitState((x) => x.phase === 'settled');
      const pre = w.raw.slice(0, w.raw.findIndex((r) => r.includes('"phase":"settled"'))).join('');
      const mine = a.states.find((x) => x.phase === 'preflop')!.seats[0]!.cards as string[];
      for (const c of mine) expect(pre.includes(`"${c}"`)).toBe(false);
    });
  });

  describe('persistence and crash recovery', () => {
    it('survives a server restart: balances persist and an interrupted hand is refunded exactly once', async () => {
      // Long reveal pause so the hand is genuinely mid-flight when the server "crashes".
      let s = await startServer({ timing: { ...FAST, revealMs: 60_000 } });
      const a = await s.player('Persist');
      const code = await s.createTable(a.token);
      await a.join(code);
      const meter0 = await s.store.getJackpot();
      await a.bet($(10), $(5), 0, 0, $(5)); await a.ready();
      await a.decide('preflop', 'play4');                               // $70 committed (incl. $5 progressive), hand in progress
      await a.waitState((x) => x.phase === 'flop');
      const token = a.token;
      // "Crash": tear the server down mid-hand without settling. Kill engine timers first.
      for (const t of s.server.manager.tables.values()) t.dispose();
      const midBalance = (await s.store.getStack(a.id, code))!.balance;
      const handId = a.state.handId!;
      const hand = await (s.store as any).pool.query('SELECT status FROM hands WHERE id=$1', [handId]);
      expect(hand.rows[0].status).toBe('active');
      expect(midBalance).toBe($(1000) - $(70));
      expect(await s.store.getJackpot()).toBe(meter0 + 350);            // contribution added at the deal
      await s.stop();

      s = await startServer({ reset: false });
      const status = (await (s.store as any).pool.query('SELECT status FROM hands WHERE id=$1', [handId])).rows[0].status;
      expect(status).toBe('voided');
      expect(await s.store.getJackpot()).toBe(meter0);                  // voided hand's contribution reversed
      const stack = (await s.store.getStack(a.id, code))!;
      expect(stack.balance).toBe($(1000));
      expect(await s.store.ledgerSum(a.id, code)).toBe(stack.balance);
      // Second recovery pass is a no-op
      expect((await s.store.voidActiveHands()).refunds).toBe(0);

      // Same identity + table code works after the restart
      const { TC } = await import('./harness');
      const back = new TC(s.url, token, a.id, 'Persist');
      s.clients.push(back);
      await back.connected();
      expect((await back.join(code)).seat).toBe(0);
      expect(back.state.seats[0]!.balance).toBe(stack.balance);
      await s.stop();
    });
  });

  describe('solo mode uses the same engine', () => {
    it('plays a practice hand without a clock on the in-memory store', async () => {
      const s = await startServer({ memory: true });
      const me = await s.player('Solo');
      const code = await s.createTable(me.token, { solo: true });
      await me.join(code);
      const v0 = await me.waitState((x) => x.config.solo);
      expect(v0.config.maxSeats).toBe(1);
      expect(v0.seats.length).toBe(1);
      await me.bet($(5)); await me.ready();
      const v = await me.waitState((x) => x.phase === 'preflop');
      expect(v.deadline).toBeNull();
      await me.decide('preflop', 'play4');
      const done = await me.waitState((x) => x.phase === 'settled');
      expect(done.seats[0]!.balance).toBe($(500) + done.seats[0]!.result!.net);
      void intToCard;
      await s.stop();
    });
  });
});

// ==================================================================== night.test.ts
describe('night', () => {
  type S = Awaited<ReturnType<typeof startServer>>;

  describe('table nights: running tab, End the night, recap', () => {
    let s: S; let code: string; let kim: TC; let lou: TC;
    beforeAll(async () => {
      s = await startServer();
      kim = await s.player('Kim'); lou = await s.player('Lou');
      code = await s.createTable(kim.token, { allowSpectators: false });
      await kim.join(code); await lou.join(code);
      await kim.waitState((v) => v.phase === 'betting' && !!v.seats[1]);
    });
    afterAll(() => s.stop());
    const recap = async (tok = kim.token, q = '') => (await s.api(`/api/tables/${code}/night${q}`, tok)).body.recap as NightRecap | null;

    async function hand(deck: number[], kimTrips = 0, louPlays = false) {
      s.decks.push(deck);
      await kim.waitState((v) => v.phase === 'betting');
      await kim.bet($(10), kimTrips); await lou.bet($(10));
      await Promise.all([kim.ready(), lou.ready()]);
      await kim.waitState((v) => v.phase === 'preflop');
      await kim.decide('preflop', 'play4');
      await lou.decide('preflop', 'check'); await lou.decide('flop', 'check');
      await lou.decide('river', louPlays ? 'play1' : 'fold');
      return kim.waitState((v) => v.phase === 'settled', 8000);
    }

    it('builds a running tab from the night’s settled hands', async () => {
      expect(await recap()).toBeNull();
      // 1: Kim trips aces (Trips+ hit); Lou folds.  2: Kim full house; Lou plays and loses.
      await hand(rigDeck(['As Ad', '2c 7d'], 'Kh Qd', 'Ac 9s 5h 3d Jc'), $(5));
      await hand(rigDeck(['Kc Kd', '2h 5s'], '4c 6d', 'Ks 9h 9d 3c Jh'), 0, true);
      const r = (await recap())!;
      expect(r.hands).toBe(2);
      expect(r.endedAt).toBeNull();
      expect(r.players.map((p) => p.name)).toEqual(['Kim', 'Lou']);              // sorted by net
      const kimRow = r.players[0], louRow = r.players[1];
      expect(louRow.net).toBe(-$(20) - $(30));                                   // fold −$20, then lost ante+blind+play
      expect(louRow.folds).toBe(1);
      expect(kimRow.bestHand).toBe('Full House');
      expect(r.biggestWin!.name).toBe('Kim');
      expect(r.biggestLoss).toMatchObject({ name: 'Lou', amount: -$(30), handNumber: 2 });
      expect(r.bestHands[0]).toMatchObject({ name: 'Kim', handName: 'Full House', hole: ['Kc', 'Kd'] });
      expect(r.bonusHits).toEqual([expect.objectContaining({ name: 'Kim', bet: 'Trips+', detail: 'Three of a Kind' })]);
      expect(kimRow.decisions).toBe(2);
      // The tab matches the ledger: each player's night net equals their balance change.
      for (const [c, row] of [[kim, kimRow], [lou, louRow]] as const)
        expect((await s.store.getStack(c.id, code))!.balance - $(1000)).toBe(row.net);
    });

    it('only people at the table can read it', async () => {
      const stranger = await s.guest('Zed');
      expect((await s.api(`/api/tables/${code}/night`, stranger.token)).status).toBe(404);
    });

    it('host ends the night between hands; everyone gets the recap; the next hand starts a new night', async () => {
      await kim.waitState((v) => v.phase === 'betting');
      expect((await lou.emit('host:endNight')).ok).toBe(false);
      expect((await kim.emit('host:endNight')).ok).toBe(true);
      await lou.waitState(() => lou.events.some((e) => e.ev === 'night:ended'), 2000);
      const id = (lou.events.find((e) => e.ev === 'night:ended')!.args[0] as { nightId: string }).nightId;
      const ended = (await recap(lou.token, `?id=${id}`))!;
      expect(ended.endedAt).not.toBeNull();
      expect(ended.hands).toBe(2);
      expect((await kim.emit('host:endNight')).ok).toBe(false);                 // nothing open

      await hand(rigDeck(['Qc Qd', '2s 8c'], '4h 6s', 'Qs 9c 7d 3h Jd'));
      const nights = (await s.api(`/api/tables/${code}/nights`, kim.token)).body.nights;
      expect(nights).toHaveLength(2);
      expect(nights[0]).toMatchObject({ endedAt: null, hands: 1 });
      expect((await recap())!.hands).toBe(1);
      await kim.waitState(() => kim.chat.some((m) => /A new night begins/.test(m.text)), 2000);
    });
  });

  describe('same bet every hand, and sit out / sit back in', () => {
    let s: S; let code: string; let kim: TC; let lou: TC;
    beforeAll(async () => {
      s = await startServer({ memory: true });
      kim = await s.player('Kim'); lou = await s.player('Lou');
      code = await s.createTable(kim.token);
      await kim.join(code); await lou.join(code);
      await kim.waitState((v) => v.phase === 'betting' && !!v.seats[1]);
    });
    afterAll(() => s.stop());

    it('re-places and deals in the same bet each hand until the player changes it', async () => {
      expect((await lou.emit('player:prefs', { autoRebet: true })).ok).toBe(false);   // nothing to repeat yet
      await lou.bet($(15), $(5), 0, 0, $(5));
      expect((await lou.emit('player:prefs', { autoRebet: true })).ok).toBe(true);
      let v = await lou.waitState((x) => x.seats[1]!.status === 'ready');
      expect(v.you.autoRebet).toEqual({ ante: $(15), trips: $(5), pairs: 0, badBeat: 0, progressive: $(5), pairPlus: 0, sixCard: 0 });
      await kim.bet($(10)); await kim.ready();
      await lou.waitState((x) => x.phase === 'preflop');
      for (const ph of ['preflop', 'flop', 'river'] as const) { await kim.decide(ph, ph === 'river' ? 'fold' : 'check'); await lou.decide(ph, ph === 'river' ? 'fold' : 'check'); }
      // Next round: Lou is already in with the same bet; nobody touched anything.
      v = await lou.waitState((x) => x.phase === 'betting' && x.seats[1]!.status === 'ready', 8000, 'auto rebet');
      expect(v.seats[1]!.bet).toMatchObject({ ante: $(15), trips: $(5), progressive: $(5) });
      // Changing the bet by hand turns it off.
      await lou.bet($(10));
      v = await lou.waitState((x) => x.you.autoRebet === null);
      expect(v.seats[1]!.status).toBe('betting');
    });

    it('sit out skips hands without losing the seat; sit back in deals you in again', async () => {
      expect((await lou.emit('player:prefs', { sitOut: true })).ok).toBe(true);
      let v = await kim.waitState((x) => x.seats[1]!.status === 'sitting-out');
      await kim.bet($(10)); await kim.ready();
      v = await kim.waitState((x) => x.phase === 'preflop');
      expect(v.seats[1]!.cards).toEqual([]);                                     // not dealt in
      expect(v.seats[1]!.balance).toBeGreaterThan(0);
      expect((await lou.emit('player:prefs', { sitOut: false })).ok).toBe(true);
      v = await lou.waitState((x) => x.seats[1]!.status !== 'sitting-out');
      expect(v.seats[1]!.status).toBe('waiting-next');                           // back from the next hand
      for (const ph of ['preflop', 'flop', 'river'] as const) await kim.decide(ph, ph === 'river' ? 'fold' : 'check');
      await kim.waitState((x) => x.phase === 'betting', 8000);
      await lou.bet($(10)); await lou.ready(); await kim.bet($(10)); await kim.ready();
      v = await lou.waitState((x) => x.phase === 'preflop');
      expect(v.seats[1]!.cards).toHaveLength(2);
    });
  });
});

// ==================================================================== progressive-audit.test.ts
// Audit of the $5 Five Card Progressive under load: a six-player hand with several winners and
// Envy, and jackpot claims that race each other from separate tables against one PostgreSQL meter.
describe('progressive-audit', () => {
  type S = Awaited<ReturnType<typeof startServer>>;
  const C = PROGRESSIVE.contribution, SEED = PROGRESSIVE.seed;

  describe('Progressive audit: six players, several winners, Envy eligibility', () => {
    let s: S; let code: string; let p: TC[]; let outsider: TC;
    beforeAll(async () => {
      s = await startServer();
      p = [];
      for (const n of ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo']) p.push(await s.player(n));
      outsider = await s.player('Gus');
      code = await s.createTable(p[0].token);
      for (const c of p) await c.join(code);
      const other = await s.createTable(outsider.token);
      await outsider.join(other);
      await p[0].waitState((v) => v.seats.filter(Boolean).length === 6);
    });
    afterAll(() => s.stop());

    it('pays every award once, Envy only to other $5 bettors at the same table, folded included', async () => {
      // Flop Q♠ J♠ 10♠.  Ann royal · Bo straight flush · Cy trips · Di straight · Ed two pair (folds) · Flo no progressive (folds)
      s.decks.push(rigDeck(['As Ks', '9s 8s', 'Qh Qc', 'Ah Kh', 'Jh Th', '2c 3d'], '4h 4d', 'Qs Js Ts 5c 7c'));
      const meter0 = await s.store.getJackpot();
      for (let i = 0; i < 6; i++) expect((await p[i].bet($(10), 0, 0, 0, i < 5 ? $(5) : 0)).ok).toBe(true);
      await Promise.all(p.map((c) => c.ready()));
      await p[0].waitState((v) => v.phase === 'preflop');
      expect(await s.store.getJackpot()).toBe(meter0 + 5 * C);
      // Everyone decides at once.
      await Promise.all([p[0].decide('preflop', 'play4'), p[1].decide('preflop', 'play4'), p[2].decide('preflop', 'play3'),
        p[3].decide('preflop', 'play4'), p[4].decide('preflop', 'check'), p[5].decide('preflop', 'check')]);
      await Promise.all([p[4].decide('flop', 'check'), p[5].decide('flop', 'check')]);
      await Promise.all([p[4].decide('river', 'fold'), p[5].decide('river', 'fold')]);
      const v = await p[0].waitState((x) => x.phase === 'settled', 10000);

      const m = meter0 + 5 * C;
      const royal = Math.floor(m / 100) * 100;
      const afterRoyal = SEED + (m - royal);
      const sf = Math.floor(afterRoyal / 1000) * 100;                 // 10%, whole dollars
      const want = [royal + 150_000, sf + 500_000, 4_500 + 650_000, 15_000 + 650_000, 650_000];
      for (let i = 0; i < 5; i++) {
        const line = v.seats[i]!.result!.lines.find((l) => l.wager === 'progressive')!;
        expect(line.credit, `seat ${i}`).toBe(want[i]);
        expect(line.stake).toBe(500);
      }
      expect(v.seats[5]!.result!.lines.find((l) => l.wager === 'progressive')).toBeUndefined();   // no bet, no Envy
      expect(v.seats[4]!.result!.net).toBe(-$(20) - 500 + 650_000);                                 // folded, still paid Envy
      expect(await s.store.getJackpot()).toBe(Math.max(SEED, afterRoyal - sf));
      for (let i = 0; i < 6; i++) expect(await s.store.ledgerSum(p[i].id, code)).toBe(v.seats[i]!.balance);
      // The other table's player bet nothing on this table and is untouched.
      expect(outsider.state.seats[0]!.balance).toBe($(1000));
      const pool = (s.store as any).pool;
      const hits = (await pool.query('SELECT player_id, hand_name, amount, meter_before FROM progressive_hits WHERE hand_id=$1 ORDER BY meter_before DESC', [v.handId])).rows;
      expect(hits.map((h: any) => [h.player_id, h.hand_name, h.amount, h.meter_before]))
        .toEqual([[p[0].id, 'Royal Flush', royal, m], [p[1].id, 'Straight Flush', sf, afterRoyal]]);
      // Envy is never taken from the meter: the meter only lost the two meter-paid awards.
      const credited = (await pool.query(`SELECT COALESCE(SUM(amount),0)::bigint s FROM ledger WHERE hand_id=$1 AND kind='payout'`, [v.handId])).rows[0].s;
      expect(Number(credited)).toBeGreaterThan(0);
    });
  });

  describe('Progressive audit: jackpot claims racing from separate tables', () => {
    let s: S;
    beforeAll(async () => { s = await startServer(); });
    afterAll(() => s.stop());

    it('two tables settling royals at the same moment: paid once each, in order, meter exact', async () => {
      const store = s.store;
      const ids: string[] = [];
      const codes: string[] = [];
      for (const n of ['Hal', 'Ivy', 'Jo', 'Kai']) {
        const g = await s.guest(n);
        const code = await s.createTable(g.token);
        await store.createStack(g.player.id, code, $(1000));
        ids.push(g.player.id); codes.push(code);
      }
      const hole = ['As', 'Ks'], community = ['Qs', 'Js', 'Ts', '2h', '3c'];
      const meter0 = await store.getJackpot();
      // Four hands on four tables, each with one $5 progressive bettor holding a royal.
      await Promise.all(ids.map((pid, i) => store.startHand({
        id: `race-${i}`, tableCode: codes[i], handNumber: 1, nightId: '', rulesVersion: '2026.11', deckCommitment: 'x', dealerCards: [], community, pairsVariant: 'up-bonus4', badBeatVariant: 'bb-01',
        players: [{ playerId: pid, seat: 0, name: 'p', hole, ante: 1000, blind: 1000, trips: 0, pairs: 0, badBeat: 0, progressive: 500 }],
      })));
      expect(await store.getJackpot()).toBe(meter0 + 4 * C);
      const settleOne = (i: number) => store.settleHand(`race-${i}`, codes[i], { hand: 'Pair', qualifies: true }, (meters) => {
        const r = resolveMeter(progSetup('five-card-5', 'casino'), [{ playerId: ids[i], seat: 0, combo: 'Royal Flush' }], meters.get('five-card-5')!);
        const award = r.awards.get(ids[i])!.amount;
        const row: PlayerSettlementRow = { playerId: ids[i], credit: award, net: award - 2500, outcome: 'loss', handName: 'Royal Flush', handRank: 9,
          tripsNet: 0, play: 0, folded: true, settlement: {}, pairsNet: 0, badBeatNet: 0, pairsCombo: null, badBeatCombo: null, pairsMultiplier: null,
          badBeatMultiplier: null, pairsVariant: null, badBeatVariant: null, baseNet: -2000, progressiveNet: award - 500, progressiveHand: 'Royal Flush' };
        return { rows: [row], meters: new Map([['five-card-5', r.meterAfter]]), hits: r.hits.map((h) => ({ meterId: 'five-card-5', playerId: h.playerId, hand: h.combo, amount: h.amount, meterBefore: h.meterBefore, meterAfter: h.meterAfter })) };
      }, ['five-card-5']);
      // Fire all four settlements at once, twice each (a retry must never pay again).
      const results = await Promise.all([0, 1, 2, 3, 0, 1, 2, 3].map(settleOne));
      expect(results.filter((r) => r.applied)).toHaveLength(4);
      const pool = (store as any).pool;
      const hits = (await pool.query(`SELECT amount, meter_before FROM progressive_hits WHERE hand_id LIKE 'race-%' ORDER BY created_at, meter_before DESC`)).rows;
      expect(hits).toHaveLength(4);
      // Serialized on the meter row: the first claim takes the whole meter, each later one takes the reseeded meter.
      const before = hits.map((h: any) => h.meter_before).sort((a: number, b: number) => b - a);
      expect(before[0]).toBe(meter0 + 4 * C);
      const paid = hits.reduce((t: number, h: any) => t + h.amount, 0);
      const final = await store.getJackpot();
      // Conservation: everything on the meter plus every reseed was either paid out or is still on the meter.
      expect(paid + final).toBe(meter0 + 4 * C + 4 * SEED);              // each royal reseeds once
      expect(final).toBeGreaterThanOrEqual(SEED);
      for (let i = 0; i < 4; i++) {
        const bal = (await store.getStack(ids[i], codes[i]))!.balance;
        expect(await store.ledgerSum(ids[i], codes[i])).toBe(bal);
      }
    });
  });
});

// ==================================================================== progressive.test.ts
describe('progressive', () => {
  type S = Awaited<ReturnType<typeof startServer>>;

  for (const memory of [false, true]) describe(`$5 Five Card Progressive — linked jackpot (${memory ? 'memory store' : 'PostgreSQL'})`, () => {
    let s: S; let code: string; let other: string; let p: TC[]; let lou: TC;

    beforeAll(async () => {
      s = await startServer({ memory });
      p = [await s.player('Kim'), await s.player('Ace'), await s.player('Jo')];
      lou = await s.player('Lou');
      code = await s.createTable(p[0].token);
      other = await s.createTable(lou.token);
      for (const c of p) await c.join(code);
      await lou.join(other);
    });
    afterAll(() => s.stop());

    it('shows the same seeded meter at every table', async () => {
      const a = await p[0].waitState((v) => v.phase === 'betting');
      const b = await lou.waitState((v) => !!v.jackpot);
      expect(a.jackpot).toMatchObject({ amount: PROGRESSIVE.seed, wager: 500, meterId: 'five-card-5' });
      expect(b.jackpot!.amount).toBe(PROGRESSIVE.seed);
      expect(a.config.progressive).toBe(true);
    });

    it('only accepts a $5 progressive', async () => {
      expect((await p[0].bet($(10), 0, 0, 0, $(10))).ok).toBe(false);
      expect((await p[0].bet($(10), 0, 0, 0, 250)).ok).toBe(false);
    });

    it('pays a royal the whole meter, a straight flush 10%, envy to everyone else — folded hands included', async () => {
      s.decks.push(rigDeck(['As Ks', '9s 8s', '2c 3d'], '4h 4d', 'Qs Js Ts 2h 7c'));
      for (const c of p) expect((await c.bet($(10), 0, 0, 0, $(5))).ok).toBe(true);
      await Promise.all(p.map((c) => c.ready()));

      const pre = await p[0].waitState((v) => v.phase === 'preflop');
      expect(pre.seats[0]!.balance).toBe($(1000) - $(25));                    // ante + blind + $5 progressive
      expect(pre.jackpot!.amount).toBe(PROGRESSIVE.seed + 3 * PROGRESSIVE.contribution);
      await lou.waitState((v) => v.jackpot!.amount === PROGRESSIVE.seed + 1050, 3000, 'linked meter rises');

      await p[0].decide('preflop', 'play4'); await p[1].decide('preflop', 'play4'); await p[2].decide('preflop', 'check');
      await p[2].decide('flop', 'check');
      await p[2].decide('river', 'fold');

      const done = await p[2].waitState((v) => v.phase === 'settled', 10000);
      const prog = (i: number) => done.seats[i]!.result!.lines.find((l) => l.wager === 'progressive')!;
      // Meter $10,010.50: the royal (seat 0, paid first) takes $10,010; 50¢ carries into the reset $10,000 meter.
      // The straight flush then takes 10% of $10,000.50 = $1,000; the meter can't go below the seed.
      expect(prog(0)).toMatchObject({ result: 'win', stake: 500, credit: 1_001_000 + 150_000, net: 1_151_000 - 500, combo: 'Royal Flush' });
      expect(prog(1)).toMatchObject({ result: 'win', credit: 100_000 + 500_000, combo: 'Straight Flush' });
      expect(prog(2)).toMatchObject({ result: 'win', credit: 650_000 });     // folded Jo: both Envy bonuses
      expect(prog(2).note).toMatch(/Envy/);
      expect(done.seats[2]!.result!.net).toBe(-$(20) + 650_000 - 500);
      expect(done.seats[2]!.cards).toEqual(['2c', '3d']);                    // folded hand shown after the round
      expect(done.jackpot!.amount).toBe(PROGRESSIVE.seed);
      expect(await s.store.getJackpot()).toBe(PROGRESSIVE.seed);

      for (let i = 0; i < 3; i++) expect(await s.store.ledgerSum(p[i].id, code)).toBe(done.seats[i]!.balance);
      if (memory) return;
      const pool = (s.store as any).pool;
      const hits = (await pool.query('SELECT hand_name, amount, meter_before FROM progressive_hits WHERE hand_id=$1 ORDER BY amount DESC', [done.handId])).rows;
      expect(hits.map((h: any) => h.hand_name)).toEqual(['Royal Flush', 'Straight Flush']);
      expect(hits.map((h: any) => Number(h.amount))).toEqual([1_001_000, 100_000]);
      expect(hits.map((h: any) => Number(h.meter_before))).toEqual([1_001_050, 1_000_050]);
    });

    it('announces the hit at the table and at every other table', async () => {
      await p[1].waitState(() => p[1].chat.some((m) => /JACKPOT! Kim hits Royal Flush on the Five Card/.test(m.text)), 3000);
      await lou.waitState(() => lou.events.some((e) => e.ev === 'jackpot:hit'), 3000, 'jackpot:hit');
      const ev = lou.events.filter((e) => e.ev === 'jackpot:hit').map((e) => e.args[0] as any);
      expect(ev[0]).toMatchObject({ playerName: 'Kim', hand: 'Royal Flush', amount: 1_001_000, same: false });
      expect(ev[1]).toMatchObject({ playerName: 'Ace', hand: 'Straight Flush', same: false });
      expect(p[0].events.find((e) => e.ev === 'jackpot:hit')!.args[0]).toMatchObject({ same: true });
      await lou.waitState((v) => v.jackpot!.amount === PROGRESSIVE.seed, 3000, 'meter reset seen elsewhere');
    });

    it('tracks the progressive in statistics', async () => {
      const st = (await s.api('/api/stats/me', p[2].token)).body.stats;
      expect(st.side.progressive).toMatchObject({ bets: 1, wins: 1, wagered: 500, net: 650_000 - 500 });
      expect(st.side.progressive.combos).toEqual([{ combo: 'Envy bonus', count: 1 }]);
    });

    it('host can switch the progressive off between hands', async () => {
      await p[0].waitState((v) => v.phase === 'betting', 6000);
      expect((await p[0].emit('host:settings', { progressive: false })).ok).toBe(true);
      await p[1].waitState((v) => v.config.progressive === false);
      expect((await p[1].bet($(10), 0, 0, 0, $(5))).error).toMatch(/progressive/i);
      expect((await p[1].bet($(10))).ok).toBe(true);
    });
  });
});

// ==================================================================== quality.test.ts
// §31 Wrong Call Wins / Decision Quality vs. Results, end to end against PostgreSQL.
describe('quality', () => {
  type S = Awaited<ReturnType<typeof startServer>>;

  describe('§31 Decision quality vs. results (PostgreSQL)', () => {
    let s: S; let ann: TC; let bo: TC; let cy: TC; let uth: string; let bj: string; let tcp: string;
    const q = async (t: TC, qs = '') => (await s.api(`/api/stats/quality${qs}`, t.token)).body;
    const hist = async (t: TC, qs: string) => (await s.api(`/api/stats/history?${qs}`, t.token)).body;
    beforeAll(async () => {
      s = await startServer();
      ann = await s.player('Ann'); bo = await s.player('Bo'); cy = await s.player('Cy');
      uth = await s.createTable(ann.token, { decisionSeconds: 20 });
      await ann.join(uth); await bo.join(uth);
      await ann.waitState((v) => v.phase === 'betting' && !!v.seats[1]);
    });
    afterAll(() => s.stop());

    it('UTH: a wrong 4× raise that wins is a Wrong Call Win; a correct raise that loses stays right', async () => {
      // Ann 2-4 offsuit raises 4× (chart: check) and flops trips; Bo A-K raises 4× (correct) and loses to the dealer's Jacks.
      s.decks.push(rigDeck(['2c 4d', 'As Kd'], 'Jc Jd', '2h 2s 9c Td 3h'));
      await ann.bet($(10)); await bo.bet($(10));
      await Promise.all([ann.ready(), bo.ready()]);
      await ann.waitState((v) => v.phase === 'preflop');
      await ann.decide('preflop', 'play4'); await bo.decide('preflop', 'play4');
      const v = await ann.waitState((x) => x.phase === 'settled', 10_000);
      expect(v.seats[0]!.result!.net).toBeGreaterThan(0);
      expect(v.seats[1]!.result!.net).toBeLessThan(0);
      const a = (await q(ann)).lifetime, b = (await q(bo)).lifetime;
      expect(a).toMatchObject({ hands: 1, wrongWins: 1, wrongHands: 1, wrongWinRate: 1, rightHands: 0, mistakes: 1 });
      expect(a.wrongWinProfit).toBe(v.seats[0]!.result!.baseNet);
      expect(b).toMatchObject({ hands: 1, rightLosses: 1, wrongHands: 0, rightWinRate: 0, evLostCents: 0 });
    });

    it('a fold with a winning side bet is still a main-game loss; several mistakes in one hand count once', async () => {
      await ann.waitState((v) => v.phase === 'betting', 10_000);
      // Ann 5-6 flops trips 5s with Trips+ up: checks the flop (should bet 2×) and folds the river (should call) — two mistakes.
      s.decks.push(rigDeck(['5c 6d', 'Ah Qd'], 'Jc Jd', '5h 5s Kc 8d 2d'));
      await ann.bet($(10), $(10)); await bo.bet($(10));
      await Promise.all([ann.ready(), bo.ready()]);
      await ann.waitState((v) => v.phase === 'preflop');
      await ann.decide('preflop', 'check'); await bo.decide('preflop', 'play4');
      await ann.waitState((v) => v.phase === 'flop');
      await ann.decide('flop', 'check');
      await ann.waitState((v) => v.phase === 'river');
      await ann.decide('river', 'fold');
      const v = await ann.waitState((x) => x.phase === 'settled', 10_000);
      const r = v.seats[0]!.result!;
      expect(r.net).toBeGreaterThan(0);                     // Trips+ 3:1 more than covers the folded Ante + Blind…
      expect(r.baseNet).toBe(-$(20));                       // …but the main game lost
      const a = (await q(ann)).lifetime;
      expect(a).toMatchObject({ hands: 2, wrongWins: 1, wrongLosses: 1, wrongHands: 2, mistakes: 3 });
      expect(a.wrongWinRate).toBe(0.5);
      expect(a.evLostCents).toBeGreaterThan(0);
      const h = await hist(ann, 'filter=wrong-losses');
      expect(h.total).toBe(1);
      expect(h.hands[0]).toMatchObject({ call: 'wrong', result: 'loss', mainNet: -$(20), game: 'uth', hole: ['5c', '6d'] });
      expect(h.hands[0].totalNet).toBeGreaterThan(0);
      expect(h.hands[0].mistakes.map((m: any) => `${m.phase}:${m.action}>${m.recommended}`)).toEqual(['flop:check>play2', 'river:fold>play1']);
      expect(h.hands[0].community).toEqual(['5h', '5s', 'Kc', '8d', '2d']);
    });

    it('Blackjack: standing 16 v 9 that wins is a Wrong Call Win with an EV cost fixed by the decision; a natural is ungraded', async () => {
      bj = await s.createTable(ann.token, { game: 'bj', minAnte: 100, maxAnte: 1_000_000 });
      // A second connection for the same player (same identity and token) at the Blackjack table.
      const annBj = new TC(ann.url, ann.token, ann.id, 'Ann@bj'); s.clients.push(annBj); await annBj.connected();
      await annBj.join(bj);
      await annBj.waitState((v) => v.phase === 'betting' && v.config.game === 'bj');
      s.rigShoe(bj, rigShoe(['Ts 6d'], '9c 7h', 'Th'));
      expect((await annBj.bet($(10))).ok).toBe(true);
      await annBj.ready();
      await annBj.waitState((v) => v.bj?.turn?.playerId === ann.id, 8000);
      await annBj.bj('stand');
      const v = await annBj.waitState((x) => x.phase === 'settled', 8000);
      expect(v.seats.find((x) => x?.playerId === ann.id)!.result!.net).toBe($(10));
      await annBj.waitState((x) => x.phase === 'betting', 10_000);
      s.rigShoe(bj, rigShoe(['As Kd'], '6c 9h', '5s 3c'));
      await annBj.bet($(10)); await annBj.ready();
      await annBj.waitState((x) => x.phase === 'settled', 10_000);
      const g = (await q(ann, '?game=bj')).lifetime;
      const cost = bjEvCost(newHand(['Ts', '6d'], $(10)), '9c', 'stand', 'hit', DEFAULT_BJ_RULES);
      expect(cost).toBeGreaterThan(0.02);                    // ≈0.033 bets: hit −0.508 vs stand −0.541
      expect(g).toMatchObject({ hands: 2, wrongWins: 1, ungraded: 1, evLostCents: Math.round(cost * $(10)), wrongWinProfit: $(10) });
      const all = (await q(ann)).lifetime;
      expect(all.hands).toBe(4);
      expect(all.byGame.bj.hands).toBe(2); expect(all.byGame.uth.hands).toBe(2);
      // reconciles: the four boxes + pushes + ungraded = every completed round
      expect(all.wrongWins + all.wrongLosses + all.rightWins + all.rightLosses + all.wrongPushes + all.rightPushes + all.ungraded).toBe(all.hands);
      const ww = await hist(ann, 'filter=wrong-wins');
      expect(ww.total).toBe(2);
      expect(ww.hands[0]).toMatchObject({ game: 'bj', mainNet: $(10), dealer: ['9c', '7h', 'Th'] });
      expect(ww.hands[0].mistakes[0]).toMatchObject({ action: 'stand', recommended: 'hit', evCents: Math.round(cost * $(10)) });
      expect(ww.hands[0].mistakes[0].reason).toMatch(/Hard 16 against a dealer 9/);
    });

    it('Three Card Poker: folding Q-6-4 is a mistake even when graded against a dealer who would have won', async () => {
      tcp = await s.createTable(cy.token, { game: 'tcp' });
      await cy.join(tcp);
      await cy.waitState((v) => v.phase === 'betting' && v.config.game === 'tcp');
      s.decks.push(rigTcp(['Qh 6c 4d'], 'Ah Kd 2c'));
      expect((await cy.emit('bet:place', { actionId: aid(), ante: $(10), trips: 0, pairPlus: 0, sixCard: 0 })).ok).toBe(true);
      await cy.ready();
      await cy.waitState((v) => v.phase === 'decide');
      await cy.decide('decide', 'fold');
      await cy.waitState((v) => v.phase === 'settled');
      const c = (await q(cy, '?game=tcp')).lifetime;
      expect(c).toMatchObject({ hands: 1, wrongLosses: 1, wrongWins: 0 });
      expect(c.evLostCents).toBeGreaterThanOrEqual(0);
    });

    it('the session view counts only the latest run of hands, and the browser cannot write any of this', async () => {
      const r = await q(ann);
      expect(r.session.hands).toBe(4);
      expect(r.sessionStart).toBeTypeOf('number');
      for (const m of ['POST', 'PUT', 'PATCH']) {
        const x = await s.api('/api/stats/quality', ann.token, { method: m, body: JSON.stringify({ wrongWins: 99 }) });
        expect(x.status).toBe(404);
      }
      expect((await q(ann)).lifetime.wrongWins).toBe(2);
      expect((await s.api('/api/stats/quality', undefined as any)).status).toBe(401);
      expect((await hist(ann, 'filter=bogus')).total).toBe(4);            // unknown filter = all
    });
  });
});

// ==================================================================== roast.test.ts
// §32 Dealer Roast Engine end to end over sockets (PostgreSQL): consent, verified triggers, timing, no effect on play.
describe('roast', () => {
  type S = Awaited<ReturnType<typeof startServer>>;
  const roasts = (t: TC) => t.chat.filter((m) => m.roast);

  describe('§32 dealer roasts (PostgreSQL)', () => {
    let s: S;
    beforeAll(async () => { s = await startServer(); });
    afterAll(() => s.stop());

    async function bjTable(attitude: string) {
      const ann = await s.player('Ann'), bo = await s.player('Bo');
      const code = await s.createTable(ann.token, { game: 'bj', minAnte: 100, maxAnte: 1_000_000, dealer: { attitude } });
      await ann.join(code); await bo.join(code);
      await ann.waitState((v) => v.phase === 'betting' && v.seats.filter(Boolean).length === 2);
      return { ann, bo, code };
    }
    async function hitOnTwenty(t: { ann: TC; bo: TC; code: string }) {
      // Ann (seat 1) and Bo (seat 2) both hold twenty and both hit; the dealer has 19.
      s.rigShoe(t.code, rigShoe(['Ts Qd', 'Th Kd'], '9c Tc', '2c 3c'));
      for (const p of [t.ann, t.bo]) expect((await p.bet($(10))).ok).toBe(true);
      await Promise.all([t.ann.ready(), t.bo.ready()]);
      await t.ann.waitState((v) => v.bj?.turn?.playerId === t.ann.id);
      expect((await t.ann.bj('hit')).ok).toBe(true);           // 22: bust, turn passes
      await t.bo.waitState((v) => v.bj?.turn?.playerId === t.bo.id);
      expect((await t.bo.bj('hit')).ok).toBe(true);
      return t.ann.waitState((v) => v.phase === 'settled', 8000);
    }

    it('No Mercy table: hitting 20 gets a short roast right away — only for the player who opted in', async () => {
      const t = await bjTable('nomercy');
      expect((await t.ann.emit('roast:prefs', { targeting: true, max: 4 })).ok).toBe(true);
      expect((await t.bo.emit('roast:prefs', { targeting: false, max: 4 })).ok).toBe(true);
      const v = await hitOnTwenty(t);
      const r = roasts(t.ann).filter((m) => m.roast!.cat === 'hit20');
      expect(r).toHaveLength(1);
      expect(r[0].roast).toMatchObject({ targetId: t.ann.id, size: 'short', vars: { name: 'Ann' } });
      const line = LINE.get(r[0].roast!.lineId)!;
      expect(line.dealer).toBe(v.house.dealerId);                 // the dealer on shift, in their own voice
      expect(fill(line.text, r[0].roast!.vars)).not.toMatch(/\{\w+\}/);
      expect(r[0].text).toBe('Ann hits.');                        // Professional fallback for viewers who want none
      // Bo opted out: nothing personal about Bo, from anyone's point of view.
      for (const m of [...roasts(t.ann), ...roasts(t.bo)]) expect(m.roast!.targetId).not.toBe(t.bo.id);
      expect(t.bo.chat.filter((m) => m.roast?.cat === 'hit20')).toHaveLength(1);   // Bo sees the roast about Ann (same message)
    });

    it('roasts never change the cards or the money: the same rigged round settles identically at a Professional table', async () => {
      const loud = await bjTable('nomercy');
      await loud.ann.emit('roast:prefs', { targeting: true, max: 4 });
      const quiet = await bjTable('professional');
      await quiet.ann.emit('roast:prefs', { targeting: true, max: 4 });
      const a = await hitOnTwenty(loud), b = await hitOnTwenty(quiet);
      const pick = (v: typeof a) => v.seats.filter(Boolean).map((x) => [x!.name, x!.balance, x!.bj?.hands.map((h) => h.cards.join(''))]);
      expect(pick(a)).toEqual(pick(b));
      expect(roasts(quiet.ann)).toEqual([]);
      expect(roasts(loud.ann).length).toBeGreaterThan(0);
      for (const t of [loud, quiet]) for (const p of [t.ann, t.bo]) expect(await s.store.ledgerSum(p.id, t.code)).toBe(p.state.seats.find((x) => x?.playerId === p.id)!.balance);
    });

    it('Hold\'em: a verified bad river fold is roasted only after the hand settles (no hidden cards), and the dealer never claims an unverified mistake', async () => {
      const ann = await s.player('Ann'), bo = await s.player('Bo');
      const code = await s.createTable(ann.token, { dealer: { attitude: 'nomercy' } });
      await ann.join(code); await bo.join(code);
      await ann.emit('roast:prefs', { targeting: true, max: 4 });
      await bo.emit('roast:prefs', { targeting: true, max: 4 });
      await ann.waitState((v) => v.phase === 'betting' && v.seats.filter(Boolean).length === 2);
      const phaseAt: string[] = [];
      ann.socket.on('chat:message', (m: { roast?: unknown }) => { if (m.roast) phaseAt.push(ann.state.phase); });
      // Ann flops a set and folds the river (graded mistake). Bo plays correctly throughout.
      s.decks.push(rigDeck(['7c 7d', 'Ah Kd'], '2c 3d', '7h Qs 9c 4d Jh'));
      await ann.bet($(10)); await bo.bet($(10));
      await Promise.all([ann.ready(), bo.ready()]);
      await ann.waitState((v) => v.phase === 'preflop');
      await ann.decide('preflop', 'check'); await bo.decide('preflop', 'play4');
      await ann.waitState((v) => v.phase === 'flop');
      await ann.decide('flop', 'check');
      await ann.waitState((v) => v.phase === 'river');
      await ann.decide('river', 'fold');
      await ann.waitState((v) => v.phase === 'settled');
      const deadline = Date.now() + 3000;
      while (!roasts(ann).some((m) => m.roast!.cat === 'badFold') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      if (process.env.DBG) console.log(JSON.stringify(ann.analysis), JSON.stringify(roasts(ann).map((m) => m.roast)), JSON.stringify(ann.chat.slice(-6)));
      const fold = roasts(ann).find((m) => m.roast!.cat === 'badFold')!;
      expect(fold.roast).toMatchObject({ targetId: ann.id, vars: { name: 'Ann', hand: 'Three of a Kind' } });
      expect(phaseAt.every((p) => p === 'settled' || p === 'betting')).toBe(true);     // never mid-hand in Hold'em
      // Bo made no graded mistake: no mistake category may ever target Bo.
      const mistakeCats = ['wrongWin', 'wrongLoss', 'badFold', 'badCall', 'tcpFold', 'badDouble', 'hit20', 'split10', 'ignoresStrategy'];
      expect(roasts(ann).filter((m) => m.roast!.targetId === bo.id && mistakeCats.includes(m.roast!.cat))).toEqual([]);
    });

    it('Dealer Attitude is a validated, host-only setting; private tables default to Asshole', async () => {
      const ann = await s.player('Ann'), bo = await s.player('Bo');
      const code = await s.createTable(ann.token, {});
      await ann.join(code); await bo.join(code);
      const v = await ann.waitState((x) => x.phase === 'betting' && x.seats.filter(Boolean).length === 2);
      expect(v.config.dealer.attitude).toBe('asshole');
      expect((await bo.emit('host:dealer', { settings: { attitude: 'nomercy' } })).ok).toBe(false);
      expect((await ann.emit('host:dealer', { settings: { attitude: 'apocalypse' } })).ok).toBe(false);
      expect((await ann.emit('host:dealer', { settings: { attitude: 'nomercy' } })).ok).toBe(true);
      expect((await ann.waitState((x) => x.config.dealer.attitude === 'nomercy')).config.dealer.attitude).toBe('nomercy');
      // A player's consent is their own: junk is sanitised (targeting stays off unless explicitly true).
      expect(await bo.emit('roast:prefs', { targeting: 'yes', max: 99 })).toEqual({ ok: true, targeting: false, max: 4 });
      expect(await bo.emit('roast:prefs', { targeting: true, max: 2 })).toEqual({ ok: true, targeting: true, max: 2 });
      // Public tables start at Smartass.
      const pub = await s.createTable(ann.token, { isPublic: true, name: 'Public' });
      const cy = await s.player('Cy'); await cy.join(pub);
      expect((await cy.waitState((x) => x.phase === 'betting' || x.phase === 'waiting')).config.dealer.attitude).toBe('smartass');
    });
  });
});

// ==================================================================== sidebets.test.ts
describe('sidebets', () => {
  type S = Awaited<ReturnType<typeof startServer>>;

  describe('Ultimate Pairs and Bad Beat at a multiplayer table (PostgreSQL)', () => {
    let s: S; let code: string; let p: TC[]; let ace2: TC;
    const BOARD = '9h 9s 2c 5d Kh';

    beforeAll(async () => {
      s = await startServer();
      p = [await s.player('Kim'), await s.player('Ace'), await s.player('Jo')];
      code = await s.createTable(p[0].token);
      for (const c of p) await c.join(code);
    });
    afterAll(() => s.stop());

    it('shows the selected pay tables before betting', async () => {
      const v = await p[0].waitState((x) => x.phase === 'betting');
      expect(v.config.pairsVariant).toBe('up-bonus4');
      expect(v.config.badBeatVariant).toBe('bb-01');
    });

    it('rejects ineligible and malformed side bets', async () => {
      expect((await p[0].bet($(10), 0, 0, $(5))).error).toMatch(/Trips\+/);
      expect((await p[0].bet($(10), $(5), -$(5), 0)).ok).toBe(false);
      expect((await p[0].emit('bet:place', { actionId: aid(), ante: $(10), trips: $(5), pairs: '500', badBeat: 0 })).ok).toBe(false);
      expect((await p[0].bet($(10), $(5), 250, 0)).error).toMatch(/whole dollars/);
      expect((await p[0].bet($(10), $(5), $(500), 0)).error).toMatch(/Ultimate Pairs/);
    });

    it('settles every player’s side bets independently against one dealer', async () => {
      s.decks.push(rigDeck(['Kd Kc', 'Ah Ad', 'Js 4h'], '9c 3d', BOARD));
      // Kim: everything. Ace: Ultimate Pairs only. Jo: Trips+ and Bad Beat.
      const dup = { actionId: aid(), ante: $(10), trips: $(5), pairs: $(5), badBeat: $(5) };
      expect((await p[0].emit('bet:place', dup)).ok).toBe(true);
      expect((await p[0].emit('bet:place', dup)).ok).toBe(true);            // duplicate message: idempotent
      expect((await p[1].bet($(10), 0, $(5), 0)).ok).toBe(true);
      expect((await p[2].bet($(10), $(5), 0, $(5))).ok).toBe(true);
      const betting = await p[1].waitState((v) => v.seats[0]!.bet.badBeat === $(5) && v.seats[2]!.bet.badBeat === $(5));
      expect(betting.seats[0]!.bet).toMatchObject({ ante: $(10), trips: $(5), pairs: $(5), badBeat: $(5) });
      await Promise.all(p.map((c) => c.ready()));

      const pre = await p[1].waitState((v) => v.phase === 'preflop');
      expect(pre.seats[1]!.cards).toEqual(['Ah', 'Ad']);
      expect(pre.seats[0]!.cards).toEqual([null, null]);
      expect((await p[0].bet($(20), $(5), $(5), $(5))).ok).toBe(false);     // side bets locked after the deal
      expect(pre.seats[0]!.balance).toBe($(1000) - $(35));                  // ante+blind+trips+pairs+bad beat debited once

      await p[0].decide('preflop', 'play4');
      await p[1].decide('preflop', 'check'); await p[2].decide('preflop', 'check');
      // Ace drops and reconnects mid-hand; payouts must still happen exactly once.
      p[1].socket.disconnect();
      await p[2].decide('flop', 'check');
      const { TC: TCc } = await import('./harness');
      ace2 = new TCc(s.url, p[1].token, p[1].id, 'Ace2');
      s.clients.push(ace2);
      await ace2.connected();
      await ace2.join(code);
      await ace2.decide('flop', 'check');
      await ace2.decide('river', 'fold');
      await p[2].decide('river', 'play1');

      const done = await p[0].waitState((v) => v.phase === 'settled', 10000);
      const [kim, ace, jo] = done.seats.slice(0, 3).map((x) => x!.result!);
      const line = (r: typeof kim, w: string) => r.lines.find((l) => l.wager === w)!;

      // Kim: full house beats dealer trips. Base +80 (ante 10, play 40, blind FH 3:1 = 30). Trips FH 8:1, Pairs KK 4:1, Bad Beat 9:1.
      expect(kim.baseNet).toBe($(80));
      expect(line(kim, 'trips').net).toBe($(40));
      expect(line(kim, 'pairs')).toMatchObject({ net: $(20), multiplier: 4, credit: $(25) });
      expect(line(kim, 'badBeat')).toMatchObject({ net: $(45), multiplier: 9, combo: 'Dealer Three of a Kind' });
      expect(kim.net).toBe($(185));

      // Ace folded, but Ultimate Pairs (A♥ A♦, 100:1) still pays. After settlement everyone sees the folded hand.
      expect(ace.net).toBe(-$(20) + $(500));
      expect(line(ace, 'pairs').combo).toBe('A♥ A♦');            // Kim's view of a folded seat
      expect(done.seats[1]!.cards).toEqual(['Ah', 'Ad']);
      const aceOwn = (await ace2.waitState((v) => v.phase === 'settled' && !!v.seats[1]!.result)).seats[1]!.result!;
      expect(aceOwn.lines.find((l) => l.wager === 'pairs')).toMatchObject({ combo: 'A♥ A♦', multiplier: 100, net: $(500) });

      // Jo: one pair loses to trips; Bad Beat needs the losing hand to be trips+.
      expect(line(jo, 'badBeat').result).toBe('lose');
      expect(jo.net).toBe(-$(30) - $(10));

      // Ledger reconciles, and each player got exactly one payout row.
      const pool = (s.store as any).pool;
      for (let i = 0; i < 3; i++) {
        expect(await s.store.ledgerSum(p[i].id, code)).toBe(done.seats[i]!.balance);
        const n = await pool.query(`SELECT COUNT(*)::int n FROM ledger WHERE player_id=$1 AND hand_id=$2 AND kind='payout'`, [p[i].id, done.handId]);
        expect(n.rows[0].n).toBeLessThanOrEqual(1);
      }
      expect(done.seats[1]!.balance).toBe($(1000) + $(480));

      // Hand history records pay tables, stakes, combinations and multipliers.
      const row = (await pool.query(`SELECT pairs, bad_beat, pairs_combo, pairs_multiplier, pairs_net, bad_beat_combo, bad_beat_multiplier,
        bad_beat_net, pairs_variant, bad_beat_variant, base_net FROM hand_players WHERE hand_id=$1 AND player_id=$2`, [done.handId, p[0].id])).rows[0];
      expect(row).toMatchObject({ pairs: $(5), bad_beat: $(5), pairs_combo: 'Pair of 2s through Kings', pairs_multiplier: 4, pairs_net: $(20),
        bad_beat_combo: 'Dealer Three of a Kind', bad_beat_multiplier: 9, bad_beat_net: $(45), pairs_variant: 'up-bonus4', bad_beat_variant: 'bb-01', base_net: $(80) });
      const hand = (await pool.query('SELECT pairs_variant, bad_beat_variant FROM hands WHERE id=$1', [done.handId])).rows[0];
      expect(hand).toEqual({ pairs_variant: 'up-bonus4', bad_beat_variant: 'bb-01' });
    });

    it('announces side-bet hits after the round, including for folded hands', () => {
      const texts = p[2].chat.map((m) => m.text);
      expect(texts.some((t) => /Bad Beat! Dealer’s Three of a Kind beaten — 9:1 for Kim/.test(t))).toBe(true);
      expect(texts.some((t) => /Ace: Ultimate Pairs — A♥ A♦ — 100:1/.test(t))).toBe(true);
    });

    it('reports each side bet separately in statistics', async () => {
      const st = (await s.api('/api/stats/me', p[1].token)).body.stats;
      expect(st.side.pairs).toMatchObject({ bets: 1, wins: 1, wagered: $(5), returned: $(505), net: $(500), biggestPayout: $(500) });
      expect(st.side.pairs.combos).toEqual([{ combo: 'A♥ A♦', count: 1 }]);
      expect(st.side.badBeat.bets).toBe(0);
      expect(st.baseNet).toBe(-$(20));
      const kim = (await s.api('/api/stats/me', p[0].token)).body.stats;
      expect(kim.side.badBeat).toMatchObject({ bets: 1, wins: 1, net: $(45) });
      expect(kim.side.trips).toMatchObject({ bets: 1, wins: 1, net: $(40) });
      expect(kim.baseNet).toBe($(80));
    });

    it('host can switch pay tables only between hands, and the change is announced', async () => {
      await p[0].waitState((v) => v.phase === 'betting', 6000);
      expect((await p[0].emit('host:settings', { pairsVariant: 'nope' })).ok).toBe(false);
      expect((await p[0].emit('host:settings', { pairsVariant: 'up-bonus2', badBeatVariant: 'bb-02' })).ok).toBe(true);
      const v = await p[2].waitState((x) => x.config.pairsVariant === 'up-bonus2');
      expect(v.config.badBeatVariant).toBe('bb-02');
      await p[2].waitState(() => p[2].chat.some((m) => /Ultimate Pairs is now Ultimate Pairs UP-02/.test(m.text)), 3000);
      expect(p[2].chat.some((m) => /Bad Beat is now Bad Beat BB-02/.test(m.text))).toBe(true);
      // During a hand: refused
      await p[0].bet($(10)); await p[2].bet($(10)); await ace2.bet($(10));
      await Promise.all([p[0].ready(), p[2].ready(), ace2.ready()]);
      await p[0].waitState((x) => x.phase === 'preflop');
      expect((await p[0].emit('host:settings', { pairsVariant: 'up-bonus4' })).error).toMatch(/between hands/);
    });

    it('pays the 1,000:1 Bonus 2 combination when player and dealer both hold aces', async () => {
      const s2 = await startServer();
      try {
        const a = await s2.player('Pocket');
        const t = await s2.createTable(a.token, { pairsVariant: 'up-bonus2', maxPairs: $(5) });
        await a.join(t);
        s2.decks.push(rigDeck(['As Ac'], 'Ah Ad', '2c 7d 9h Js 4c'));
        await a.bet($(5), 0, $(5), 0); await a.ready();
        const pre = await a.waitState((x) => x.phase === 'preflop');
        expect(pre.dealer.cards).toEqual([null, null]);             // dealer's aces stay hidden
        await a.decide('preflop', 'check'); await a.decide('flop', 'check'); await a.decide('river', 'fold');
        const done = await a.waitState((x) => x.phase === 'settled');
        const pairs = done.seats[0]!.result!.lines.find((l) => l.wager === 'pairs')!;
        expect(pairs).toMatchObject({ multiplier: 1000, net: $(5000), credit: $(5005) });
        expect(done.seats[0]!.balance).toBe($(1000) - $(10) + $(5000));
        expect(await s2.store.ledgerSum(a.id, t)).toBe(done.seats[0]!.balance);
      } finally { await s2.stop(); }
    });
  });
});

// ==================================================================== tcp.test.ts
// Three Card Poker at a multiplayer table (scope addendum §23), against real PostgreSQL.
describe('tcp', () => {
  type S = Awaited<ReturnType<typeof startServer>>;
  const tcpBet = (c: TC, ante: number, pairPlus = 0, sixCard = 0) => c.emit('bet:place', { actionId: aid(), ante, trips: 0, pairPlus, sixCard });

  describe('Three Card Poker: switching, dealing, settlement, isolation from Hold’em', () => {
    let s: S; let code: string; let host: TC; let a: TC; let b: TC;
    beforeAll(async () => {
      s = await startServer();
      host = await s.player('Tom'); a = await s.player('Ann'); b = await s.player('Bo');
      code = await s.createTable(host.token, { decisionSeconds: 5 });
      for (const c of [host, a, b]) await c.join(code);
      await host.waitState((v) => v.phase === 'betting' && v.seats.filter(Boolean).length === 3);
    });
    afterAll(() => s.stop());

    it('only the host can switch; a switch during a hand is queued until it settles; seats and chips are kept', async () => {
      expect((await a.emit('host:game', { game: 'tcp' })).ok).toBe(false);
      expect((await host.emit('host:game', { game: 'poker' })).ok).toBe(false);
      // Play one Hold'em hand with a progressive bet so there is jackpot history to preserve.
      s.decks.push(rigDeck(['As Ad', '2c 7d', '3h 8s'], 'Kh Qd', 'Ac 9s 5h 3d Jc'));
      await host.bet($(10), 0, 0, 0, $(5)); await a.bet($(10)); await b.bet($(10));
      await Promise.all([host.ready(), a.ready(), b.ready()]);
      await host.waitState((v) => v.phase === 'preflop');
      const r = await host.emit('host:game', { game: 'tcp' });
      expect(r).toMatchObject({ ok: true, queued: true });
      expect((await host.emit('host:game', { game: 'tcp' })).ok).toBe(false);          // no conflicting second switch
      await host.waitState((v) => v.pendingGame === 'tcp');
      expect(host.state.config.game).toBe('uth');                                         // not mid-hand
      for (const c of [host, a, b]) await c.decide('preflop', 'check');
      for (const c of [host, a, b]) await c.decide('flop', 'check');
      for (const c of [host, a, b]) await c.decide('river', 'fold');
      const settled = await host.waitState((v) => v.phase === 'settled');
      const balances = settled.seats.filter(Boolean).map((x) => x!.balance);
      const meter = await s.store.getJackpot();
      const v = await a.waitState((x) => x.config.game === 'tcp' && x.phase === 'betting', 8000, 'switched');
      expect(v.pendingGame).toBeNull();
      expect(v.seats.filter(Boolean).map((x) => x!.name)).toEqual(['Tom', 'Ann', 'Bo']);
      expect(v.seats.filter(Boolean).map((x) => x!.balance)).toEqual(balances);           // no new bankroll
      expect(v.you.lastBet).toBeNull();                                                  // Hold'em presets cleared
      await a.waitState(() => a.chat.some((m) => m.text === 'Tom changed the table to Three Card Poker.'), 2000);
      expect(await s.store.getJackpot()).toBe(meter);
    });

    it('rejects Hold’em side bets, deals three unique cards each, hides others until settlement', async () => {
      expect((await host.bet($(10), $(5))).error).toMatch(/Ultimate Texas Hold’em bets/);
      // §37: the $5 progressive circle is now the Three Card Progressive here (its own meter), so it is accepted…
      expect((await host.bet($(10), 0, 0, 0, $(5))).ok).toBe(true);
      expect((await host.bet($(10), 0, 0, 0, $(1))).error).toMatch(/fixed \$5 bet/);
      const meter0 = await s.store.getJackpot();
      // Tom: straight (Ante Bonus) loses to dealer trips; Ann: Q-6-4 plays and loses; Bo folds a pair with Pair Plus + Six Card.
      s.decks.push(rigTcp(['4c 5d 6s', 'Qh 6c 4d', '9h 9c 2s'], '7h 7d 7c'));
      expect((await tcpBet(host, $(10))).ok).toBe(true);
      expect((await tcpBet(a, $(10))).ok).toBe(true);
      expect((await tcpBet(b, $(10), $(5), $(5))).ok).toBe(true);
      await Promise.all([host.ready(), a.ready(), b.ready()]);
      const v = await host.waitState((x) => x.phase === 'decide');
      expect(v.community).toEqual([]);
      expect(v.dealer.cards).toEqual([null, null, null]);
      expect(v.seats[0]!.cards).toEqual(['4c', '5d', '6s']);
      expect(v.seats[1]!.cards).toEqual([null, null, null]);
      expect(v.you.legal.sort()).toEqual(['fold', 'play1']);
      expect(v.seats[0]!.handName).toBe('Straight');
      expect((await host.emit('player:decide', { actionId: aid(), handId: v.handId, phase: 'preflop', decision: 'check' })).ok).toBe(false);   // no Hold'em streets
      expect((await host.emit('player:decide', { actionId: aid(), handId: v.handId, phase: 'decide', decision: 'play4' })).ok).toBe(false);
      await host.decide('decide', 'play1'); await a.decide('decide', 'play1'); await b.decide('decide', 'fold');
      const done = await host.waitState((x) => x.phase === 'settled');
      const line = (i: number, k: string) => done.seats[i]!.result!.lines.find((l) => l.wager === k);
      // Tom: dealer trips beat his straight (Ante + Play lose), but the Ante Bonus pays 1:1 anyway.
      expect(done.seats[0]!.result!.outcome).toBe('lose');
      expect(line(0, 'anteBonus')).toMatchObject({ result: 'win', net: $(10) });
      expect(done.seats[0]!.result!.net).toBe(-$(20) + $(10));
      expect(line(1, 'anteBonus')).toBeUndefined();
      expect(done.seats[1]!.result!.net).toBe(-$(20));
      // Bo folded: Ante lost, no Ante Bonus, Pair Plus pays 1:1 on the pair, Six Card pays on 9-9-9... with dealer 7s: full house 20:1.
      expect(line(2, 'pairPlus')).toMatchObject({ result: 'win', net: $(5) });
      expect(line(2, 'sixCard')).toMatchObject({ result: 'win', net: $(100), combo: 'Full House' });
      expect(line(2, 'anteBonus')).toBeUndefined();
      expect(done.seats[2]!.result!.net).toBe(-$(10) + $(5) + $(100));
      expect(done.dealer).toMatchObject({ cards: ['7h', '7d', '7c'], handName: 'Three Sevens', qualifies: true });
      expect(done.seats[1]!.cards).toEqual(['Qh', '6c', '4d']);                         // face up after the round
      for (const c of [host, a, b]) expect(await s.store.ledgerSum(c.id, code)).toBe(done.seats.find((x) => x?.playerId === c.id)!.balance);
      expect(await s.store.getJackpot()).toBe(meter0);                                    // the Hold'em jackpot is untouched
      const pool = (s.store as any).pool;
      const row = (await pool.query(`SELECT game, rules_version FROM hands WHERE id=$1`, [done.handId])).rows[0];
      expect(row).toEqual({ game: 'tcp', rules_version: 'tcp-2026.11' });
    });

    it('dealer Jack high does not qualify: Ante pays, Play pushes; the trainer grades Q-6-4', async () => {
      s.decks.push(rigTcp(['2c 5d 9s', 'Qh 6c 4d', 'Kh 8c 3s'], 'Jh Td 8d'));
      await host.waitState((x) => x.phase === 'betting', 8000);
      for (const c of [host, a, b]) expect((await tcpBet(c, $(10))).ok).toBe(true);
      await Promise.all([host.ready(), a.ready(), b.ready()]);
      await host.waitState((x) => x.phase === 'decide');
      await host.decide('decide', 'play1');                                                // 9-5-2: should fold
      await a.decide('decide', 'fold');                                                    // Q-6-4: should play
      await b.decide('decide', 'play1');
      const done = await host.waitState((x) => x.phase === 'settled');
      expect(done.dealer.qualifies).toBe(false);
      for (const i of [0, 2]) {
        const r = done.seats[i]!.result!;
        expect(r.lines.find((l) => l.wager === 'ante')).toMatchObject({ result: 'win', net: $(10) });
        expect(r.lines.find((l) => l.wager === 'play')).toMatchObject({ result: 'push', net: 0 });
      }
      const forHand = (c: TC) => c.analysis.find((x) => x.handId === done.handId);
      await a.waitState(() => !!forHand(a) && !!forHand(host), 3000, 'analysis');
      const d = forHand(a)!.decisions[0];
      expect(d).toMatchObject({ phase: 'decide', action: 'fold', recommended: 'play1', correct: false, evExact: true });
      expect(d.evCost).toBeGreaterThan(0);
      const hd = forHand(host)!.decisions[0];
      expect(hd).toMatchObject({ action: 'play1', recommended: 'fold', correct: false });
    });

    it('times out to Fold; a reconnecting player keeps their wager and cards', async () => {
      s.decks.push(rigTcp(['Ac Ad As', '2h 3h 5c', 'Kd Qs 9c'], 'Jc 4h 2d'));
      await host.waitState((x) => x.phase === 'betting', 8000);
      for (const c of [host, a, b]) expect((await tcpBet(c, $(10), c === a ? $(5) : 0)).ok).toBe(true);
      await Promise.all([host.ready(), a.ready(), b.ready()]);
      await host.waitState((x) => x.phase === 'decide');
      a.socket.disconnect();
      await host.waitState((x) => !x.seats[1]!.connected);
      a.socket.connect();
      await a.join(code);
      const back = await a.waitState((x) => x.phase === 'decide' && x.seats[1]!.cards[0] !== null);
      expect(back.seats[1]!.cards).toEqual(['2h', '3h', '5c']);
      expect(back.seats[1]!.bet).toMatchObject({ ante: $(10), pairPlus: $(5) });
      await host.decide('decide', 'play1');                                                 // Ann and Bo never act
      const done = await host.waitState((x) => x.phase === 'settled', 12000, 'timeout');
      expect(done.seats[1]!.result!.outcome).toBe('fold');
      expect(done.seats[2]!.result!.outcome).toBe('fold');
      expect(done.seats[1]!.result!.lines.find((l) => l.wager === 'pairPlus')).toMatchObject({ result: 'lose' });   // 2-3-5 high card
      expect(done.seats[0]!.result!.lines.find((l) => l.wager === 'anteBonus')).toMatchObject({ net: $(40) });   // trips 4:1
    });

    it('switching back to Hold’em: UTH bets work again, TCP bets are refused, jackpot intact, stats split by game', async () => {
      const meter = await s.store.getJackpot();
      await host.waitState((x) => x.phase === 'betting', 8000);
      await tcpBet(a, $(10), $(5));                                                        // uncommitted bet is released by the switch
      expect(await host.emit('host:game', { game: 'uth' })).toMatchObject({ ok: true, queued: false });
      const v = await a.waitState((x) => x.config.game === 'uth');
      expect(v.seats[1]!.bet.ante).toBe(0);
      expect((await tcpBet(a, $(10), $(5))).error).toMatch(/Three Card Poker bets/);
      expect((await a.bet($(10), $(5))).ok).toBe(true);
      expect(await s.store.getJackpot()).toBe(meter);
      const tcp = (await s.api('/api/stats/me?game=tcp', host.token)).body.stats;
      const uth = (await s.api('/api/stats/me?game=uth', host.token)).body.stats;
      const all = (await s.api('/api/stats/me', host.token)).body.stats;
      expect([uth.hands, tcp.hands, all.hands]).toEqual([1, 3, 4]);
      expect(uth.net + tcp.net).toBe(all.net);
      expect(tcp.byPhase.every((p: any) => p.phase === 'decide')).toBe(true);
      expect(uth.side.progressive.bets).toBe(1);
      expect(tcp.side.progressive.bets).toBe(0);
      expect(all.series).toHaveLength(4);                                                   // one combined balance history
      const ledger = await s.store.ledgerSum(host.id, code);
      expect(ledger).toBe((await s.store.getStack(host.id, code))!.balance);
      // History of both games is kept and replays read their own rules.
      const replays = await Promise.all((await s.store.recentHands(code, 10)).map((h) => s.store.handReplay(h.handId)));
      expect(replays.map((r) => r!.game).sort()).toEqual(['tcp', 'tcp', 'tcp', 'uth']);
      expect(replays.find((r) => r!.game === 'tcp')!.community).toEqual([]);
    });
  });
});

// ==================================================================== §34–§39 Blackjack side bets, progressives, TCP repro (PostgreSQL)
import { BJ_SIDES } from '../../src/shared/bjsides';
describe('bonus', () => {
  type S = Awaited<ReturnType<typeof startServer>>;
  const ALL_ON = { preset: 'custom', bets: Object.fromEntries(BJ_SIDES.filter((d) => d.status === 'playable').map((d) => [d.id, { on: true, min: 100, max: 2500 }])) };
  const bjBet = (p: TC, ante: number, bjSides: Record<string, number> = {}, progressive = 0) =>
    p.emit('bet:place', { actionId: aid(), ante, trips: 0, pairs: 0, badBeat: 0, progressive, bjSides });
  const line = (v: TableView, p: TC, id: string) => v.seats.find((x) => x?.playerId === p.id)!.result!.lines.find((l) => l.sideId === id);

  describe('§34 six players, six different side-bet mixes, one shoe (PostgreSQL)', () => {
    let s: S; let code: string; const ps: TC[] = [];
    beforeAll(async () => {
      s = await startServer();
      for (const n of ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Fa']) ps.push(await s.player(n));
      code = await s.createTable(ps[0].token, { game: 'bj', minAnte: 100, maxAnte: 100_000, startingBankroll: 100_000, bjSides: ALL_ON });
      for (const p of ps) await p.join(code);
      await ps[0].waitState((v) => v.seats.filter(Boolean).length === 6);
    });
    afterAll(() => s.stop());

    it('every wager is recorded, evaluated and paid independently; results reconcile to the cent', async () => {
      const [ann, bo, cy, di, ed, fa] = ps;
      // Dealer 6♥ T♠ (16) draws K♦ and busts with three cards. Everyone stands.
      s.rigShoe(code, rigShoe(['8h 8h', '6h 6h', '7s 8s', 'Qh Qh', '6d 2c', 'Tc Kh'], '6h Ts', 'Kd'));
      expect((await bjBet(ann, $(25), { 'perfect-player': $(5), twentyone3: $(5), buster: $(5) })).ok).toBe(true);
      expect((await bjBet(bo, $(25), { twentyone3: $(5), top3: $(5), 'lucky-lucky': $(5) })).ok).toBe(true);
      expect((await bjBet(cy, $(25), { 'lucky-lucky': $(5), 'match-dealer': $(5) })).ok).toBe(true);
      expect((await bjBet(di, $(25), { 'lucky-ladies': $(5), 'perfect-dealer': $(5) })).ok).toBe(true);
      expect((await bjBet(ed, $(25), { 'match-dealer': $(5) }, $(5))).ok).toBe(true);
      expect((await bjBet(fa, $(25), { 'perfect-player': $(5), top3: $(5), 'lucky-lucky': $(5) })).ok).toBe(true);
      const before = new Map(ps.map((p) => [p.id, p.state.seats.find((x) => x?.playerId === p.id)!.balance]));
      await Promise.all(ps.map((p) => p.ready()));
      // Initial-card wagers show at once; dealer-hole wagers stay pending while the hole card is hidden.
      const dealt = await di.waitState((v) => v.phase === 'turns' && !!v.seats.find((x) => x?.playerId === di.id)?.bj?.sides?.length);
      const diSides = dealt.seats.find((x) => x?.playerId === di.id)!.bj!.sides!;
      expect(diSides.find((x) => x.id === 'perfect-dealer')!.result).toBeUndefined();
      expect(diSides.find((x) => x.id === 'lucky-ladies')!.result).toBeUndefined();
      expect(dealt.dealer.cards[1]).toBeNull();
      expect(dealt.seats.find((x) => x?.playerId === bo.id)!.bj!.sides!.find((x) => x.id === 'top3')).toMatchObject({ result: 'win', pays: 270 });
      for (const p of ps) await p.bj('stand');
      const v = await ann.waitState((x) => x.phase === 'settled', 8000, 'settled');
      expect(v.dealer.cards).toEqual(['6h', 'Ts', 'Kd']);
      const L = (p: TC, id: string) => line(v, p, id);
      expect(L(ann, 'perfect-player')).toMatchObject({ result: 'win', multiplier: 25, net: $(125) });
      expect(L(ann, 'twentyone3')).toMatchObject({ result: 'win', multiplier: 5 });               // 8♥ 8♥ 6♥: a flush
      expect(L(ann, 'buster')).toMatchObject({ result: 'win', multiplier: 2 });                   // three-card bust
      expect(L(bo, 'twentyone3')).toMatchObject({ result: 'win', multiplier: 100 });              // suited three of a kind (multi-deck)
      expect(L(bo, 'top3')).toMatchObject({ result: 'win', multiplier: 270 });
      expect(L(bo, 'lucky-lucky')).toMatchObject({ result: 'lose' });
      expect(L(cy, 'lucky-lucky')).toMatchObject({ result: 'win', multiplier: 25 });              // 6-7-8 unsuited
      expect(L(cy, 'match-dealer')).toMatchObject({ result: 'lose' });
      expect(L(di, 'lucky-ladies')).toMatchObject({ result: 'win', multiplier: 200 });            // Q♥ pair, no dealer blackjack
      expect(L(di, 'perfect-dealer')).toMatchObject({ result: 'lose' });
      expect(L(ed, 'match-dealer')).toMatchObject({ result: 'win', multiplier: 4 });
      const edProg = v.seats.find((x) => x?.playerId === ed.id)!.result!.lines.find((l) => l.wager === 'progressive')!;
      expect(edProg).toMatchObject({ result: 'lose', stake: $(5), credit: 0 });
      for (const id of ['perfect-player', 'top3', 'lucky-lucky']) expect(L(fa, id)).toMatchObject({ result: 'lose' });
      // Main hands are independent: everybody's stood hand wins against the bust.
      for (const p of ps) {
        const st = v.seats.find((x) => x?.playerId === p.id)!;
        expect(st.result!.lines.filter((l) => l.wager === 'ante')[0]).toMatchObject({ result: 'win', net: $(25) });
        const net = st.result!.lines.reduce((t, l) => t + l.net, 0);
        expect(st.result!.net).toBe(net);
        expect(st.balance - before.get(p.id)!).toBe(net);
        expect(await s.store.ledgerSum(p.id, code)).toBe(st.balance);
      }
      // §34.9 per-wager statistics (separate from strategy) and the §37.8 progressive history row.
      const bo1 = (await s.api('/api/stats/bonus', bo.token)).body;
      expect(bo1.stats.lifetime.top3).toMatchObject({ bets: 1, wins: 1, wagered: $(5), returned: $(5) * 271, topCombo: 'Suited Three of a Kind' });
      expect(bo1.hands[0].results.map((x: { id: string }) => x.id).sort()).toEqual(['lucky-lucky', 'top3', 'twentyone3']);
      const filtered = (await s.api('/api/stats/bonus?side=lucky-lucky', cy.token)).body;
      expect(filtered.hands).toHaveLength(1);
      const tx = (await s.api('/api/progressive/history', ed.token)).body.tx;
      expect(tx[0]).toMatchObject({ game: 'bj', variant: 'bj-213-16', profile: 'high-roller', wager: $(5), category: 'loss', amount: 0, net: -$(5) });
      const pool = (s.store as any).pool;
      const prof = (await pool.query(`SELECT rules_profile FROM hands WHERE id=$1`, [v.handId])).rows[0].rules_profile;
      expect(prof.sides.top3.variant).toBe('allbets');
      expect(prof.progressive).toMatchObject({ meterId: 'bj-213-16:high-roller', wager: $(5) });
      // The dealer roasts real outcomes only: a double 21+3 / Top 3 is recognised from the recorded results.
      await bo.waitState(() => bo.chat.some((m) => /Top 3/.test(m.text)), 3000, 'side-bet chat');
    });

    it('dealer blackjack before play: dealer-card wagers settle on the revealed hand; Buster loses; nothing else is dealt', async () => {
      const [ann, bo, , di] = ps;
      await ann.waitState((v) => v.phase === 'betting', 8000);
      s.rigShoe(code, rigShoe(['8h 8h', '9s 9d', '7s 8s', 'Qh Qh', '6d 2c', 'Td Th'], 'As Kd'));
      expect((await bjBet(ann, $(25), { buster: $(5) })).ok).toBe(true);
      expect((await bjBet(bo, $(25), { 'perfect-dealer': $(5) })).ok).toBe(true);
      for (const p of [ps[2], ps[4], ps[5]]) expect((await bjBet(p, $(25))).ok).toBe(true);
      expect((await bjBet(di, $(25), { 'lucky-ladies': $(5) })).ok).toBe(true);
      await Promise.all(ps.map((p) => p.ready()));
      for (const p of ps) await p.bj('no-insurance');
      const v = await ann.waitState((x) => x.phase === 'settled', 8000, 'settled');
      expect(v.dealer.cards).toEqual(['As', 'Kd']);
      expect(line(v, di, 'lucky-ladies')).toMatchObject({ result: 'win', multiplier: 1000 });
      expect(line(v, bo, 'perfect-dealer')).toMatchObject({ result: 'lose' });
      expect(line(v, ann, 'buster')).toMatchObject({ result: 'lose' });
      for (const p of ps) expect(await s.store.ledgerSum(p.id, code)).toBe(v.seats.find((x) => x?.playerId === p.id)!.balance);
    });

    it('every hand busts: the dealer draws nothing, so Buster loses — no card is dealt to settle it', async () => {
      const [ann] = ps;
      await ann.waitState((v) => v.phase === 'betting', 8000);
      s.rigShoe(code, rigShoe(['Ts 6d'], '5h 9c', 'Kc 2d 3d'));
      for (const p of ps.slice(1)) await p.emit('player:prefs', { sitOut: true });
      expect((await bjBet(ann, $(25), { buster: $(5) })).ok).toBe(true);
      await ann.ready();
      await ann.bj('hit');
      const v = await ann.waitState((x) => x.phase === 'settled', 8000, 'settled');
      expect(v.dealer.cards).toEqual(['5h', '9c']);
      expect(line(v, ann, 'buster')).toMatchObject({ result: 'lose', net: -$(5) });
      expect(await s.store.ledgerSum(ann.id, code)).toBe(v.seats[0]!.balance);
      for (const p of ps.slice(1)) await p.emit('player:prefs', { sitOut: false });
    });

    it('rebet after the host changes the bonus menu: closed wagers come off by name, the main bet stays', async () => {
      const [ann] = ps;
      await ann.waitState((v) => v.phase === 'betting', 8000);
      expect((await bjBet(ann, $(25), { top3: $(5), 'lucky-lucky': $(5) })).ok).toBe(true);
      expect((await ann.emit('host:settings', { bjSides: { preset: 'allbets' } })).ok).toBe(true);
      const v = await ann.waitState((x) => x.config.bjSides.preset === 'allbets');
      expect(v.you.pending.ante).toBe($(25));
      expect(v.you.pending.bjSides).toEqual({ top3: $(5), 'lucky-lucky': $(5) });       // both still open under All Bets
      expect((await ann.emit('host:settings', { bjSides: { preset: 'classic' } })).ok).toBe(true);
      const w = await ann.waitState((x) => x.config.bjSides.preset === 'classic');
      expect(w.you.pending).toMatchObject({ ante: $(25) });
      expect(w.you.pending.bjSides ?? {}).toEqual({});
      await ann.waitState(() => ann.chat.some((m) => /Top 3, Lucky Lucky taken back/.test(m.text)), 3000, 'taken back');
      expect((await bjBet(ann, $(25), { top3: $(5) })).error).toMatch(/not open at this table/);
      expect((await ann.emit('host:settings', { bjSides: ALL_ON })).ok).toBe(true);
    });
  });

  describe('§37 concurrent claims on one shared meter (PostgreSQL)', () => {
    let s: S;
    beforeAll(async () => { s = await startServer(); });
    afterAll(() => s.stop());
    it('four tables claiming the 21+3 jackpot at once: paid once each, serialized, meter never negative, history recorded', async () => {
      const store = s.store;
      const setup = progSetup('bj-213-16', 'high-roller');
      const ids: string[] = [], codes: string[] = [];
      for (const n of ['Q1', 'Q2', 'Q3', 'Q4']) {
        const g = await s.guest(n); const code = await s.createTable(g.token);
        await store.createStack(g.player.id, code, $(1000)); ids.push(g.player.id); codes.push(code);
      }
      const spec = { id: setup.meterId, seed: setup.seed, game: 'bj', variant: setup.variant.id, profile: setup.profile };
      await Promise.all(ids.map((pid, i) => store.startHand({ id: `bjrace-${i}`, tableCode: codes[i], handNumber: 1, nightId: '', rulesVersion: 'bj', deckCommitment: 'x', dealerCards: ['Qs', '2c'], community: [],
        pairsVariant: 'up-bonus4', badBeatVariant: 'bb-01', game: 'bj', meters: [spec],
        players: [{ playerId: pid, seat: 0, name: 'p', hole: ['As', 'Ks'], ante: 1000, blind: 0, trips: 0, pairs: 0, badBeat: 0, progressive: setup.wager, progMeter: setup.meterId, progContribution: setup.contribution }] })));
      const start = (await store.getMeters()).find((m) => m.id === setup.meterId)!.amount;
      expect(start).toBe(setup.seed + 4 * setup.contribution);
      const settleOne = (i: number) => store.settleHand(`bjrace-${i}`, codes[i], { hand: '12', qualifies: true }, (meters) => {
        const r = resolveMeter(setup, [{ playerId: ids[i], seat: 0, combo: 'Mini Royal (jackpot suit)' }], meters.get(setup.meterId)!);
        const amt = r.awards.get(ids[i])!.amount;
        const row: PlayerSettlementRow = { playerId: ids[i], credit: amt, net: amt - 1000 - setup.wager, outcome: 'lose', handName: '20', handRank: 0, tripsNet: 0, play: 0, folded: false, settlement: {},
          pairsNet: 0, badBeatNet: 0, pairsCombo: null, badBeatCombo: null, pairsMultiplier: null, badBeatMultiplier: null, pairsVariant: null, badBeatVariant: null, baseNet: -1000, progressiveNet: amt - setup.wager, progressiveHand: 'Mini Royal (jackpot suit)' };
        return { rows: [row], meters: new Map([[setup.meterId, r.meterAfter]]),
          hits: r.hits.map((h) => ({ meterId: setup.meterId, playerId: h.playerId, hand: h.combo, amount: h.amount, meterBefore: h.meterBefore, meterAfter: h.meterAfter })),
          progTx: [{ playerId: ids[i], game: 'bj', meterId: setup.meterId, variant: setup.variant.id, profile: setup.profile, wager: setup.wager, combo: 'Mini Royal (jackpot suit)', category: 'meter' as const, pct: 100,
            fixedAward: 0, meterAward: amt, envy: 0, meterBefore: r.hits[0].meterBefore, meterAfter: r.meterAfter, amount: amt, net: amt - setup.wager }] };
      }, [setup.meterId]);
      const results = await Promise.all([0, 1, 2, 3, 0, 1, 2, 3].map(settleOne));
      expect(results.filter((r) => r.applied)).toHaveLength(4);                       // replays never pay twice
      const pool = (store as any).pool;
      const hits = (await pool.query(`SELECT amount, meter_before, meter_after FROM progressive_hits WHERE meter_id=$1 ORDER BY id`, [setup.meterId])).rows.map((r: any) => ({ a: Number(r.amount), b: Number(r.meter_before), c: Number(r.meter_after) }));
      expect(hits).toHaveLength(4);
      expect(hits[0].b).toBe(start);
      for (let i = 1; i < 4; i++) expect(hits[i].b).toBe(hits[i - 1].c);              // each claim sees the previous claim's result
      const final = (await store.getMeters()).find((m) => m.id === setup.meterId)!.amount;
      expect(hits.reduce((t: number, h: { a: number }) => t + h.a, 0) + final).toBe(start + 4 * setup.seed);
      expect(final).toBeGreaterThanOrEqual(setup.seed);
      const tx = (await pool.query(`SELECT COUNT(*)::int n FROM progressive_tx WHERE meter_id=$1`, [setup.meterId])).rows[0].n;
      expect(tx).toBe(4);
      for (let i = 0; i < 4; i++) expect(await store.ledgerSum(ids[i], codes[i])).toBe((await store.getStack(ids[i], codes[i]))!.balance);
      // Other games' meters were never touched.
      expect((await store.getMeters()).find((m) => m.id === 'five-card-5')!.amount).toBe(PROGRESSIVE.seed);
    });
    it('a hand interrupted by a restart refunds every stake (side bets included) and takes its contribution back off its own meter', async () => {
      const store = s.store;
      const setup = progSetup('bj-213-16', 'casino');
      const g = await s.guest('Rx'); const code = await s.createTable(g.token);
      await store.createStack(g.player.id, code, $(1000));
      const spec = { id: setup.meterId, seed: setup.seed, game: 'bj', variant: setup.variant.id, profile: setup.profile };
      await store.startHand({ id: 'bjvoid', tableCode: code, handNumber: 1, nightId: '', rulesVersion: 'bj', deckCommitment: 'x', dealerCards: [], community: [], pairsVariant: 'up-bonus4', badBeatVariant: 'bb-01', game: 'bj', meters: [spec],
        players: [{ playerId: g.player.id, seat: 0, name: 'p', hole: ['2s', '3s'], ante: $(25), blind: 0, trips: 0, pairs: 0, badBeat: 0, progressive: setup.wager, progMeter: setup.meterId, progContribution: setup.contribution, sides: { top3: $(5), buster: $(5) } }] });
      expect((await store.getStack(g.player.id, code))!.balance).toBe($(1000) - $(25) - $(10) - setup.wager);
      const m0 = (await store.getMeters()).find((m) => m.id === setup.meterId)!.amount;
      await store.voidActiveHands();
      expect((await store.getStack(g.player.id, code))!.balance).toBe($(1000));
      expect((await store.getMeters()).find((m) => m.id === setup.meterId)!.amount).toBe(Math.max(setup.seed, m0 - setup.contribution));
      expect(await store.ledgerSum(g.player.id, code)).toBe($(1000));
    });
  });

  describe('§35 Three Card Poker reproduction at a live table (PostgreSQL)', () => {
    let s: S; let code: string; let a: TC; let b: TC;
    beforeAll(async () => {
      s = await startServer();
      a = await s.player('Tri'); b = await s.player('Flu');
      code = await s.createTable(a.token, { game: 'tcp', decisionSeconds: 5 });
      await a.join(code); await b.join(code);
      await a.waitState((v) => v.phase === 'betting' && v.seats.filter(Boolean).length === 2);
    });
    afterAll(() => s.stop());
    it('8♠ 8♥ 8♦ against the dealer’s A♣ J♣ 6♣: player wins; Ante, Play, Ante Bonus, Pair Plus and the Progressive all pay; history ranks Trips above Flush', async () => {
      // The exact case: dealer A♣ J♣ 6♣ (Flush) vs player 8♠ 8♥ 8♦ (Three of a Kind).
      s.decks.push(rigTcp(['8s 8h 8d', '2d 5h 9s'], 'Ac Jc 6c'));
      expect((await a.emit('bet:place', { actionId: aid(), ante: $(10), trips: 0, pairPlus: $(5), sixCard: 0, progressive: $(5) })).ok).toBe(true);
      expect((await b.emit('bet:place', { actionId: aid(), ante: $(10), trips: 0, pairPlus: 0, sixCard: 0 })).ok).toBe(true);
      const bal0 = a.state.seats[0]!.balance;
      await Promise.all([a.ready(), b.ready()]);
      await a.decide('decide', 'play1'); await b.decide('decide', 'fold');
      const v = await a.waitState((x) => x.phase === 'settled');
      expect(v.dealer).toMatchObject({ cards: ['Ac', 'Jc', '6c'], handName: 'Flush', qualifies: true });
      const r = v.seats[0]!.result!;
      const L = (k: string) => r.lines.find((l) => l.wager === k);
      expect(r.outcome).toBe('win');
      expect(L('ante')).toMatchObject({ result: 'win', net: $(10) });
      expect(L('play')).toMatchObject({ result: 'win', net: $(10) });
      expect(L('anteBonus')).toMatchObject({ result: 'win', net: $(40), multiplier: 4 });
      expect(L('pairPlus')).toMatchObject({ result: 'win', net: $(150), multiplier: 30 });       // default pp-8: Trips 30:1
      expect(L('progressive')).toMatchObject({ result: 'win', credit: $(500), net: $(495) });    // PT7 at $5: 100 for 1 = 500 chips, the $5 not returned
      expect(v.seats[0]!.balance - bal0 + $(10) + $(10) + $(5) + $(5)).toBe($(20) + $(20) + $(40) + $(155) + $(500));
      expect(await s.store.ledgerSum(a.id, code)).toBe(v.seats[0]!.balance);
      const pool = (s.store as any).pool;
      const rows = (await pool.query(`SELECT hand_name, hand_rank FROM hand_players WHERE player_id=$1 AND game='tcp' AND settled ORDER BY hand_rank DESC`, [a.id])).rows;
      expect(rows[0]).toEqual({ hand_name: 'Three of a Kind', hand_rank: 4 });
      const stats = (await s.api('/api/stats/me?game=tcp', a.token)).body.stats;
      expect(stats.bestHand).toBe('Three of a Kind');
      const tx = (await s.api('/api/progressive/history', a.token)).body.tx;
      expect(tx[0]).toMatchObject({ game: 'tcp', variant: 'tcp-pt7', combo: 'Three of a Kind', category: 'fixed', fixedAward: $(500), amount: $(500) });
      // Separate meters: the TCP meter moved; the Hold'em and Blackjack meters did not.
      const meters = await s.store.getMeters();
      expect(meters.find((m) => m.id === 'five-card-5')!.amount).toBe(PROGRESSIVE.seed);
    });
  });
});

describe('music', () => {
  type S = Awaited<ReturnType<typeof startServer>>;
  const track = (id: string, extra: object = {}) => ({ uri: `spotify:track:${id.padEnd(22, 'A')}`, name: `Song ${id}`, artist: 'Band', art: null, durationMs: 180_000, progressMs: 10_000, isPlaying: true, ...extra });
  const last = (c: TC) => [...c.events].reverse().find((e) => e.ev === 'music:state')?.args[0] as { music: any; serverNow: number } | undefined;
  const waitMusic = async (c: TC, pred: (m: any) => boolean) => { await c.waitState(() => { const l = last(c); return !!l && pred(l.music); }, 3000, 'music'); return last(c)!.music; };
  let s: S; let code: string; let host: TC; let guest: TC;
  beforeAll(async () => {
    s = await startServer({ memory: true });
    host = await s.player('Hana'); guest = await s.player('Gus');
    code = await s.createTable(host.token);
    await host.join(code); await guest.join(code);
    await host.waitState((v) => !!v.seats[1]);
  });
  afterAll(() => s.stop());

  it('exposes only the public Spotify client id (empty when not configured)', async () => {
    const r = await fetch(`${s.url}/api/music/config`);
    expect(await r.json()).toEqual({ spotifyClientId: '' });
  });

  it('the CSP allows exactly the Spotify SDK, API and artwork hosts', async () => {
    const csp = (await fetch(`${s.url}/api/health`)).headers.get('content-security-policy')!;
    expect(csp).toContain("script-src 'self' https://sdk.scdn.co");
    expect(csp).toContain('frame-src https://sdk.scdn.co');
    expect(csp).toContain('https://api.spotify.com https://accounts.spotify.com');
    expect(csp).toContain("img-src 'self' data: https://i.scdn.co");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('a joiner gets the current (empty) music state', async () => {
    expect(last(guest)).toMatchObject({ music: null });
  });

  it('only the host can share; everyone at the table receives it, server-stamped', async () => {
    expect((await guest.emit('music:now', track('g1')))).toMatchObject({ ok: false, error: 'Only the host can share music.' });
    expect((await host.emit('music:now', { ...track('x'), uri: 'spotify:episode:abc' })).ok).toBe(false);
    const t0 = Date.now();
    expect((await host.emit('music:now', track('a1'))).ok).toBe(true);
    const m = await waitMusic(guest, (x) => x?.name === 'Song a1');
    expect(m).toMatchObject({ hostId: host.id, hostName: 'Hana', progressMs: 10_000, isPlaying: true });
    expect(m.at).toBeGreaterThanOrEqual(t0);
    await guest.waitState(() => guest.chat.some((c) => /Hana is playing Song a1/.test(c.text)), 2000);
    // A play/pause update for the same track doesn't repeat the chat line.
    expect((await host.emit('music:now', track('a1', { isPlaying: false, progressMs: 20_000 }))).ok).toBe(true);
    await waitMusic(guest, (x) => x?.isPlaying === false);
    expect(guest.chat.filter((c) => /is playing Song a1/.test(c.text))).toHaveLength(1);
  });

  it('a spectator who joins later receives what is playing', async () => {
    const sp = await s.player('Sid');
    await sp.join(code, true);
    expect((await waitMusic(sp, (x) => !!x)).name).toBe('Song a1');
  });

  it('is rate limited', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => host.emit('music:now', track('a1'))));
    expect(rs.some((r) => r.ok === false && r.error === 'Slow down.')).toBe(true);
  });

  it('only the host can stop it; stopping clears it for everyone', async () => {
    expect((await guest.emit('music:stop')).ok).toBe(false);
    expect((await host.emit('music:stop')).ok).toBe(true);
    await waitMusic(guest, (x) => x === null);
  });

  it('sharing ends when the host leaves (hosting passes on)', async () => {
    await new Promise((r) => setTimeout(r, 4000));   // let the rate limit refill
    expect((await host.emit('music:now', track('b2'))).ok).toBe(true);
    await waitMusic(guest, (x) => x?.name === 'Song b2');
    await host.emit('table:leave');
    await waitMusic(guest, (x) => x === null);
    await guest.waitState((v) => v.you.isHost);
    // The new host can share; the old one (no longer at the table) cannot.
    expect((await guest.emit('music:now', track('c3'))).ok).toBe(true);
    expect((await host.emit('music:now', track('c4'))).ok).toBe(false);
  }, 15_000);

  it('tables never see each other’s music', async () => {
    const other = await s.player('Oz');
    const code2 = await s.createTable(other.token);
    await other.join(code2);
    await new Promise((r) => setTimeout(r, 200));
    expect(last(other)?.music ?? null).toBeNull();
    expect(other.events.filter((e) => e.ev === 'music:state' && (e.args[0] as any).music)).toHaveLength(0);
  });
});
