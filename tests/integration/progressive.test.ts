import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $, rigDeck, startServer, type TC } from './harness';
import { PROGRESSIVE } from '../../src/shared/progressive';

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
    expect(a.jackpot).toEqual({ amount: PROGRESSIVE.seed, wager: 500 });
    expect(b.jackpot.amount).toBe(PROGRESSIVE.seed);
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
    expect(pre.jackpot.amount).toBe(PROGRESSIVE.seed + 3 * PROGRESSIVE.contribution);
    await lou.waitState((v) => v.jackpot.amount === PROGRESSIVE.seed + 1050, 3000, 'linked meter rises');

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
    expect(done.jackpot.amount).toBe(PROGRESSIVE.seed);
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
    await p[1].waitState(() => p[1].chat.some((m) => /JACKPOT! Kim hits a Royal Flush on the progressive/.test(m.text)), 3000);
    await lou.waitState(() => lou.events.some((e) => e.ev === 'jackpot:hit'), 3000, 'jackpot:hit');
    const ev = lou.events.filter((e) => e.ev === 'jackpot:hit').map((e) => e.args[0] as any);
    expect(ev[0]).toMatchObject({ playerName: 'Kim', hand: 'Royal Flush', amount: 1_001_000, same: false });
    expect(ev[1]).toMatchObject({ playerName: 'Ace', hand: 'Straight Flush', same: false });
    expect(p[0].events.find((e) => e.ev === 'jackpot:hit')!.args[0]).toMatchObject({ same: true });
    await lou.waitState((v) => v.jackpot.amount === PROGRESSIVE.seed, 3000, 'meter reset seen elsewhere');
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
