import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $, rigDeck, startServer, type TC } from './harness';

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

  it('each reload adds a marker; the dealer jokes and suggests something to pawn', async () => {
    await loseEverything();
    await ed.waitState((v) => v.phase === 'betting' && v.you.canReload, 8000, 'broke');
    const r1 = await ed.emit('player:reload');
    expect(r1).toMatchObject({ ok: true, balance: $(15), debt: $(15) });
    let v = await ed.waitState((x) => x.seats[0]!.debt === $(15));
    expect(v.seats[0]!.balance).toBe($(15));
    await ed.waitState(() => ed.chat.some((m) => /Ed takes a \$15 marker\. Total debt: \$15\..*pawn your AirPods/.test(m.text)), 2000);

    await loseEverything();
    await ed.waitState((x) => x.phase === 'betting' && x.you.canReload, 8000, 'broke again');
    expect(await ed.emit('player:reload')).toMatchObject({ ok: true, debt: $(30) });
    v = await ed.waitState((x) => x.seats[0]!.debt === $(30));
    const lines = ed.chat.filter((m) => /marker/.test(m.text)).map((m) => m.text);
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toEqual(lines[1].replace('$30', '$15'));                         // a different joke each time
    // Debt survives in the database and is in the stats; it never touches the ledger reconciliation.
    expect((await s.store.getStack(ed.id, code))!.debt).toBe($(30));
    expect(await s.store.ledgerSum(ed.id, code)).toBe(v.seats[0]!.balance);
    const st = (await s.api('/api/stats/me', ed.token)).body.stats;
    expect(st.debt).toBe($(30));
  });
});
