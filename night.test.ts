import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $, rigDeck, startServer, type TC } from './harness';
import type { NightRecap } from '../../src/shared/recap';

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
