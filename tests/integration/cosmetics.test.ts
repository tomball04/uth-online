import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $, rigDeck, rigTcp, startServer, type TC } from './harness';
import { DEFAULT_APPEARANCE } from '../../src/shared/cosmetics';

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
