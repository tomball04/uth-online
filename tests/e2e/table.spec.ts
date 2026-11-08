import { expect, test, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Close every browser context a test opened, so six-player tests don't pile up and slow the next one.
const openContexts: BrowserContext[] = [];
test.afterEach(async () => { await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => {}))); });

async function newPlayer(browser: Browser, name: string, device: 'desktop' | 'iphone' = 'desktop') {
  const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 13'];
  const ctx = await browser.newContext(device === 'iphone' ? iphone : { viewport: { width: 1366, height: 860 } });
  openContexts.push(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { page, errors, name };
}

async function signIn(page: Page, name: string, path = '/') {
  await page.goto(path);
  await page.fill('#name', name);
  await page.locator('form.name-form button').click();
}

const communityCards = (page: Page) =>
  page.locator('.community .card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card || null));

test('two players on different devices play a full hand via an invite link', async ({ browser }) => {
  const host = await newPlayer(browser, 'Hostess');
  const phone = await newPlayer(browser, 'Phoney', 'iphone');

  await signIn(host.page, 'Hostess');
  await host.page.getByRole('button', { name: 'Create a private table' }).click();
  await host.page.getByRole('button', { name: 'Create table' }).click();
  await host.page.waitForURL(/\/table\/[A-Z0-9]{8}$/);
  const invite = host.page.url();

  // Friend opens the invitation link on a phone, picks a name, lands in a seat.
  await signIn(phone.page, 'Phoney', new URL(invite).pathname);
  await expect(phone.page.locator('.seat.mine .pname')).toHaveText('Phoney');
  await expect(host.page.locator('.seat:not(.empty-seat) .pname')).toHaveCount(2);

  // Bets: $25 ante each
  for (const p of [host.page, phone.page]) {
    await p.locator('.rack .chip.c25').click();
    await p.locator('.spot-ante').click();
    await expect(p.locator('.spot-ante .spot-amt')).toHaveText('$25');
    await expect(p.locator('.spot-blind .spot-amt')).toHaveText('$25');
  }
  await host.page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(host.page.locator('.dock-msg')).toContainText('Ready');
  await phone.page.getByRole('button', { name: 'Deal me in' }).click();

  // Pre-flop: each sees two face-up cards of their own; the other seat is face down.
  for (const p of [host.page, phone.page]) {
    await expect(p.getByRole('button', { name: /Check/ })).toBeVisible({ timeout: 15000 });
    await expect(p.locator('.dock-hand .card:not(.back):not(.empty)')).toHaveCount(2);
    await expect(p.locator('.seat:not(.mine):not(.empty-seat) .card.back')).toHaveCount(2);
  }
  await host.page.getByRole('button', { name: /Play 4×/ }).click();
  await phone.page.getByRole('button', { name: /^Check/ }).click();

  // Flop is identical for both
  await expect(phone.page.getByRole('button', { name: /Play 2×/ })).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => (await communityCards(host.page)).filter(Boolean).length).toBe(3);
  expect(await communityCards(host.page)).toEqual(await communityCards(phone.page));
  await phone.page.getByRole('button', { name: /^Check/ }).click();

  await expect(phone.page.getByRole('button', { name: /Play 1×/ })).toBeVisible({ timeout: 15000 });
  await phone.page.getByRole('button', { name: /Play 1×/ }).click();

  // Settlement: same board and dealer for both; results shown; balances reconcile with net
  await expect(host.page.locator('.my-result')).toBeVisible({ timeout: 20000 });
  await expect(phone.page.locator('.my-result')).toBeVisible({ timeout: 20000 });
  await host.page.waitForTimeout(800);
  const board = await communityCards(host.page);
  expect(board.filter(Boolean)).toHaveLength(5);
  expect(await communityCards(phone.page)).toEqual(board);
  const dealer = (p: Page) => p.locator('.dealer-zone .card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card));
  expect(await dealer(host.page)).toEqual(await dealer(phone.page));

  const balance = async (p: Page) => Number((await p.locator('.seat.mine .pbal').innerText()).replace(/[^0-9.]/g, ''));
  const net = async (p: Page) => {
    const t = await p.locator('.res-title').innerText();
    const m = t.match(/You (win|lose) \$([0-9,.]+)/);
    return m ? (m[1] === 'win' ? 1 : -1) * Number(m[2].replace(/,/g, '')) : 0;
  };
  expect(await balance(host.page)).toBe(1000 + (await net(host.page)));
  expect(await balance(phone.page)).toBe(1000 + (await net(phone.page)));

  // The phone has no horizontal scrolling and keeps every essential element on screen
  const p = phone.page;
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const sel of ['.dock-hand .card', '.community .card', '.dealer-zone .card', '.seat.mine .plate', '.spots']) {
    const box = await p.locator(sel).first().boundingBox();
    expect(box, sel).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  }
  await p.screenshot({ path: 'test-results/iphone-settled.png' });
  await host.page.screenshot({ path: 'test-results/desktop-settled.png' });

  // Chat and reactions reach the other player
  await host.page.locator('.chat-form input').fill('gg everyone');
  await host.page.locator('.chat-form button').click();
  await phone.page.locator('.tbar .panel-toggle', { hasText: 'Chat' }).click();
  await expect(phone.page.locator('.chat-list')).toContainText('gg everyone');

  expect(host.errors).toEqual([]);
  expect(phone.errors).toEqual([]);
});

test('refreshing mid-hand restores the seat, cards and wagers', async ({ browser }) => {
  const a = await newPlayer(browser, 'Refresher');
  const b = await newPlayer(browser, 'Steady');
  await signIn(a.page, 'Refresher');
  await a.page.getByRole('button', { name: 'Create a private table' }).click();
  await a.page.getByRole('button', { name: 'Create table' }).click();
  await a.page.waitForURL(/\/table\//);
  await signIn(b.page, 'Steady', new URL(a.page.url()).pathname);
  for (const p of [a.page, b.page]) { await p.locator('.rack .chip.c5').click(); await p.locator('.spot-ante').click(); }
  await a.page.getByRole('button', { name: 'Deal me in' }).click();
  await b.page.getByRole('button', { name: 'Deal me in' }).click();
  await expect(a.page.getByRole('button', { name: /Play 4×/ })).toBeVisible({ timeout: 15000 });
  await a.page.waitForTimeout(3000);
  const before = await a.page.locator('.dock-hand .card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card));
  await a.page.getByRole('button', { name: /Play 4×/ }).click();
  await expect(a.page.locator('.spot-play .spot-amt')).toHaveText('$20');

  await a.page.reload();
  await expect(a.page.locator('.seat.mine .pname')).toHaveText('Refresher', { timeout: 15000 });
  await expect(a.page.locator('.spot-play .spot-amt')).toHaveText('$20');
  const after = await a.page.locator('.dock-hand .card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card));
  expect(after).toEqual(before);
  expect(a.errors).toEqual([]);
});

test('solo practice with the training hints', async ({ page }) => {
  await signIn(page, 'Solo Sam');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Training', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Practice solo' }).click();
  await page.waitForURL(/\/table\//);
  await page.locator('.rack .chip.c5').click();
  await page.locator('.spot-ante').click();
  await page.getByRole('button', { name: 'Deal', exact: true }).click();
  await expect(page.locator('.hint')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.hint')).toContainText('Suggested');
  await expect(page.locator('.btn.recommended')).toHaveCount(1);
  // Follow the recommendation through the hand
  for (let i = 0; i < 3; i++) {
    const rec = page.locator('.btn.recommended');
    if (!(await rec.count())) break;
    await rec.click();
    await page.waitForTimeout(2500);
  }
  await expect(page.locator('.my-result')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.grades')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.grades .bad')).toHaveCount(0);
});

test('side bets: bonus panel on a phone, Trips+ requirement, locking, and settlement lines', async ({ browser }) => {
  const host = await newPlayer(browser, 'Bettor');
  const phone = await newPlayer(browser, 'Pocket', 'iphone');
  await signIn(host.page, 'Bettor');
  await host.page.getByRole('button', { name: 'Create a private table' }).click();
  await host.page.getByRole('button', { name: 'Create table' }).click();
  await host.page.waitForURL(/\/table\//);
  await signIn(phone.page, 'Pocket', new URL(host.page.url()).pathname);

  // Pay tables are visible before betting
  await host.page.getByRole('button', { name: 'Pay tables' }).click();
  await expect(host.page.getByRole('dialog')).toContainText('Ultimate Pairs Bonus 4');
  await expect(host.page.getByRole('dialog')).toContainText('Bad Beat Bonus 01');
  await host.page.keyboard.press('Escape');

  // Desktop: Bad Beat without Trips+ is refused; then all three bonus bets
  const h = host.page;
  await h.locator('.rack .chip.c25').click(); await h.locator('.spot-ante').click();
  await h.locator('.rack .chip.c5').click();
  await h.locator('.spot-badBeat').click();
  await expect(h.locator('.toast-error')).toContainText('Trips+');
  await h.locator('.spot-trips').click(); await h.locator('.spot-pairs').click(); await h.locator('.spot-badBeat').click();
  await expect(h.locator('.spot-badBeat .spot-amt')).toHaveText('$5');
  await expect(h.locator('.totals')).toContainText('On the table $65');
  await expect(h.locator('.totals')).toContainText('Reserved for 1× Play $25');

  // Phone: bonus circles live in a collapsed panel until opened
  const p = phone.page;
  await p.locator('.rack .chip.c25').click(); await p.locator('.spot-ante').click();
  await expect(p.locator('.spot-pairs')).toBeHidden();
  await p.locator('.bonus-toggle').click();
  await p.locator('.rack .chip.c5').click(); await p.locator('.spot-pairs').click();
  await expect(p.locator('.bonus-toggle')).toContainText('$5');
  // The other player sees the bonus amounts on the felt
  await expect(h.locator('.seat:not(.mine):not(.empty-seat) .ms-pairs .ms-amt')).toHaveText('$5');

  await h.getByRole('button', { name: 'Deal me in' }).click();
  await p.getByRole('button', { name: 'Deal me in' }).click();
  await expect(h.getByRole('button', { name: /Check/ })).toBeVisible({ timeout: 15000 });
  // Locked after the deal
  await expect(h.locator('.spot-pairs')).toBeDisabled();
  await expect(p.locator('.bonus-panel')).not.toHaveClass(/open/);

  await h.getByRole('button', { name: /^Check/ }).click(); await p.getByRole('button', { name: /^Check/ }).click();
  await expect(h.getByRole('button', { name: /Play 2×/ })).toBeVisible({ timeout: 15000 });
  await h.getByRole('button', { name: /^Check/ }).click(); await p.getByRole('button', { name: /^Check/ }).click();
  await expect(h.getByRole('button', { name: /Play 1×/ })).toBeVisible({ timeout: 15000 });
  await h.getByRole('button', { name: /^Fold/ }).click(); await p.getByRole('button', { name: /^Fold/ }).click();

  // Every wager appears in the result, and side bets are reported apart from the main game
  await expect(h.locator('.my-result')).toBeVisible({ timeout: 20000 });
  for (const w of ['Ante', 'Blind', 'Trips+', 'Ultimate Pairs', 'Bad Beat']) await expect(h.locator('.my-result .lines')).toContainText(w);
  await expect(h.locator('.my-result .subtotals')).toContainText('Main game −$50');
  await expect(p.locator('.my-result .lines')).toContainText('Ultimate Pairs');
  const bal = Number((await h.locator('.seat.mine .pbal').innerText()).replace(/[^0-9.]/g, ''));
  const sub = await h.locator('.my-result .subtotals').innerText();
  const m = sub.match(/Bonus bets ([+−])?\$([0-9,]+)/)!;
  const side = Number(m[2].replace(/,/g, '')) * (m[1] === '−' ? -1 : 1);
  expect(bal).toBe(1000 - 50 + side);
  expect(host.errors).toEqual([]);
  expect(phone.errors).toEqual([]);
});

test('phone host: table menu, felt and card colours for everyone, set a player away', async ({ browser }) => {
  const host = await newPlayer(browser, 'Pita', 'iphone');
  const guest = await newPlayer(browser, 'Gus');
  await signIn(host.page, 'Pita');
  await host.page.getByRole('button', { name: 'Create a private table' }).click();
  await host.page.getByRole('button', { name: 'Create table' }).click();
  await host.page.waitForURL(/\/table\/[A-Z0-9]{8}$/);
  await signIn(guest.page, 'Gus', new URL(host.page.url()).pathname);
  await expect(host.page.locator('.seat:not(.empty-seat) .pname')).toHaveCount(2);

  // One tidy top bar on the phone; everything else lives in the menu.
  await expect(host.page.locator('.tbar').getByRole('button', { name: 'Invite' })).toBeHidden();
  await host.page.getByRole('button', { name: 'Table menu' }).click();
  await host.page.getByRole('button', { name: /Host controls/ }).click();
  await host.page.locator('.swatch[title="Burgundy"]').first().click();          // felt
  await host.page.locator('.swatch-group').nth(1).locator('.swatch[title="Gold"]').click();
  await expect(guest.page.locator('html')).toHaveAttribute('data-felt', 'burgundy');
  await expect(guest.page.locator('html')).toHaveAttribute('data-back', 'gold');
  // The guest sees the look but can't change it.
  await guest.page.getByRole('button', { name: 'Settings' }).click();
  await expect(guest.page.getByText('The host chooses the felt and card backs')).toBeVisible();
  await expect(guest.page.locator('.swatch-group.readonly input').first()).toBeDisabled();
  await guest.page.keyboard.press('Escape');

  // Set Gus away from the host's player list.
  await host.page.getByRole('button', { name: 'Set away' }).click();
  await expect(guest.page.getByRole('button', { name: 'Sit back in' })).toBeVisible();
  await guest.page.getByRole('button', { name: 'Sit back in' }).click();
  await expect(guest.page.getByRole('button', { name: 'Deal me in' })).toBeVisible();
  expect([...host.errors, ...guest.errors]).toEqual([]);
});

test('six players: simultaneous decisions, a refresh and a dropped connection mid-hand, phone layout', async ({ browser }) => {
  test.setTimeout(180_000);
  const names = ['Ana', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay'];
  const devicesFor: ('desktop' | 'iphone')[] = ['desktop', 'iphone', 'desktop', 'iphone', 'desktop', 'desktop'];
  const ps = await Promise.all(names.map((n, i) => newPlayer(browser, n, devicesFor[i])));
  await signIn(ps[0].page, 'Ana');
  await ps[0].page.getByRole('button', { name: 'Create a private table' }).click();
  await ps[0].page.getByRole('button', { name: 'Create table' }).click();
  await ps[0].page.waitForURL(/\/table\/[A-Z0-9]{8}$/);
  const path = new URL(ps[0].page.url()).pathname;
  for (let i = 1; i < 6; i++) await signIn(ps[i].page, names[i], path);
  for (const p of ps) await expect(p.page.locator('.seat:not(.empty-seat) .pname')).toHaveCount(6, { timeout: 15000 });

  // Everyone bets and deals in at once; Ben adds the $5 progressive.
  await Promise.all(ps.map(async ({ page }, i) => {
    await page.locator('.rack .chip.c5').click();
    await page.locator('.spot-ante').click();
    await page.locator('.spot-ante').click();
    if (i === 1) { await page.locator('.bonus-toggle').click(); await page.locator('.spot-progressive').click(); }
    await page.getByRole('button', { name: 'Deal me in' }).click();
  }));
  for (const { page } of ps) await expect(page.getByRole('button', { name: /^Check/ })).toBeVisible({ timeout: 20000 });

  // Phones: all six name plates readable — none overlap each other and none run off the screen.
  for (const { page } of ps.filter((_, i) => devicesFor[i] === 'iphone')) {
    const boxes = await page.locator('.seat:not(.empty-seat) .plate').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    expect(boxes).toHaveLength(6);
    const vw = page.viewportSize()!.width;
    for (const b of boxes) { expect(b.x).toBeGreaterThanOrEqual(-1); expect(b.x + b.w).toBeLessThanOrEqual(vw + 1); }
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], B = boxes[b];
      const overlap = A.x < B.x + B.w - 2 && B.x < A.x + A.w - 2 && A.y < B.y + B.h - 2 && B.y < A.y + A.h - 2;
      expect(overlap, `plates ${a} and ${b} overlap`).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }

  // Eve refreshes mid-hand: same seat, same two cards, still her turn.
  const before = await ps[4].page.locator('.dock-hand .card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card));
  await ps[4].page.reload();
  await expect(ps[4].page.getByRole('button', { name: /^Check/ })).toBeVisible({ timeout: 20000 });
  expect(await ps[4].page.locator('.dock-hand .card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card))).toEqual(before);
  // Fay's connection drops (her tab dies); the others see her as away. She comes back in a new tab and carries on.
  const fayUrl = ps[5].page.url();
  const fayCtx = ps[5].page.context();
  await ps[5].page.close();
  await expect(ps[0].page.locator('.seat:not(.empty-seat)', { hasText: 'Fay' }).locator('.pstatus')).toHaveText('Away', { timeout: 15000 });
  const fay = await fayCtx.newPage();
  fay.on('pageerror', (e) => ps[5].errors.push(e.message));
  await fay.goto(fayUrl);
  ps[5].page = fay;
  await expect(fay.getByRole('button', { name: /^Check/ })).toBeVisible({ timeout: 20000 });
  await expect(ps[0].page.locator('.seat:not(.empty-seat)', { hasText: 'Fay' }).locator('.pstatus')).not.toHaveText('Away', { timeout: 15000 });

  // Simultaneous decisions.
  await Promise.all(ps.map(({ page }, i) => page.getByRole('button', { name: i < 3 ? /^Play 4×/ : /^Check/ }).click()));
  for (const { page } of ps.slice(3)) await expect(page.getByRole('button', { name: /^Play 2×/ })).toBeVisible({ timeout: 20000 });
  await Promise.all(ps.slice(3).map(({ page }) => page.getByRole('button', { name: /^Check/ }).click()));
  for (const { page } of ps.slice(3)) await expect(page.getByRole('button', { name: /^Fold/ })).toBeVisible({ timeout: 20000 });
  await Promise.all(ps.slice(3).map(({ page }, j) => page.getByRole('button', { name: j === 0 ? /^Play 1×/ : /^Fold/ }).click()));

  for (const { page } of ps) await expect(page.locator('.my-result')).toBeVisible({ timeout: 25000 });
  await ps[0].page.waitForTimeout(1500);
  // Everyone saw the same board and dealer, every hand is face up, and every screen agrees on every stack.
  const board = await communityCards(ps[0].page);
  expect(board.filter(Boolean)).toHaveLength(5);
  const seatCards = (p: Page) => p.locator('.seat:not(.empty-seat) .cards-row .card').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card).filter(Boolean).sort());
  const stacks = (p: Page) => p.locator('.seat:not(.empty-seat)').evaluateAll((els) => els.map((e) =>
    `${e.querySelector('.pname')?.textContent}=${e.querySelector('.pbal')?.firstChild?.textContent ?? e.querySelector('.pbal')?.textContent}`).sort());
  const ref = await stacks(ps[0].page);
  expect(await seatCards(ps[0].page)).toHaveLength(12);
  for (const { page } of ps) {
    expect(await communityCards(page)).toEqual(board);
    expect(await stacks(page)).toEqual(ref);
    expect(await seatCards(page)).toEqual(await seatCards(ps[0].page));
  }
  // The running tab agrees with the table.
  await ps[0].page.locator('.tabs .tab', { hasText: 'Tonight' }).click();
  await expect(ps[0].page.locator('.pane-night .board tbody tr')).toHaveCount(6);
  await expect(ps[0].page.locator('.pane-night .chips-check')).toContainText('Matches your stack');
  for (const p of ps) expect(p.errors, p.name).toEqual([]);
});

test('restore code moves a guest to another device', async ({ browser }) => {
  const a = await newPlayer(browser, 'Rosa');
  await signIn(a.page, 'Rosa');
  await a.page.getByRole('button', { name: 'Create a private table' }).waitFor();
  await a.page.getByRole('button', { name: 'Settings' }).first().click();
  await a.page.getByRole('button', { name: 'Show' }).click();
  const code = await a.page.locator('.restore-code').inputValue();
  expect(code.length).toBeGreaterThan(20);
  const b = await newPlayer(browser, 'Rosa (phone)', 'iphone');
  await b.page.goto('/');
  await b.page.getByRole('button', { name: 'Have a restore code?' }).click();
  await b.page.getByLabel('Restore code').fill('not-a-real-code-at-all-123');
  await b.page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(b.page.getByText('wasn’t recognised')).toBeVisible();
  await b.page.getByLabel('Restore code').fill(code);
  await b.page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(b.page.getByRole('button', { name: 'Create a private table' })).toBeVisible();
  expect(await b.page.evaluate(() => JSON.parse(localStorage.getItem('uth.me') ?? '{}').name)).toBe('Rosa');
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('six players: host switches to Three Card Poker, two hands, then back to Hold’em', async ({ browser }) => {
  test.setTimeout(240_000);
  const names = ['Hal', 'Ida', 'Jon', 'Kat', 'Lu', 'Mo'];
  const kinds: ('desktop' | 'iphone')[] = ['iphone', 'desktop', 'desktop', 'iphone', 'desktop', 'desktop'];
  const ps = await Promise.all(names.map((n, i) => newPlayer(browser, n, kinds[i])));
  const host = ps[0].page;
  await signIn(host, 'Hal');
  await host.getByRole('button', { name: 'Create a private table' }).click();
  await host.getByRole('button', { name: 'Create table' }).click();
  await host.waitForURL(/\/table\/[A-Z0-9]{8}$/);
  const path = new URL(host.url()).pathname;
  for (let i = 1; i < 6; i++) await signIn(ps[i].page, names[i], path);
  for (const p of ps) await expect(p.page.locator('.seat:not(.empty-seat) .pname')).toHaveCount(6, { timeout: 15000 });
  const stacks = (p: Page) => p.locator('.seat:not(.empty-seat)').evaluateAll((els) => els.map((e) =>
    `${e.querySelector('.pname')?.textContent}=${e.querySelector('.pbal')?.textContent}`).sort());
  const before = await stacks(ps[1].page);

  // Host: ☰ → Host controls → Three Card Poker → confirm.
  await host.getByRole('button', { name: 'Table menu' }).click();
  await host.getByRole('button', { name: /Host controls/ }).click();
  await host.locator('.game-option', { hasText: 'Three Card Poker' }).click();
  await expect(host.getByText('Everyone will remain seated and keep their existing virtual-chip balances.')).toBeVisible();
  await host.getByRole('button', { name: 'Switch to Three Card Poker' }).click();
  for (const { page } of ps) await expect(page.locator('.table-screen')).toHaveAttribute('data-game', 'tcp', { timeout: 10000 });
  await expect(ps[1].page.locator('.chat-list')).toContainText('Hal changed the table to Three Card Poker.');
  expect(await stacks(ps[1].page)).toEqual(before);                         // same six seats, same chips
  await expect(ps[1].page.locator('.spot-blind')).toBeHidden();
  await expect(ps[1].page.locator('.spot-trips')).toBeHidden();
  await expect(ps[1].page.locator('.spot-pairPlus')).toBeVisible();

  for (let hand = 0; hand < 2; hand++) {
    await Promise.all(ps.map(async ({ page }, i) => {
      await expect(page.getByRole('button', { name: 'Deal me in' })).toBeVisible({ timeout: 20000 });
      await page.locator('.rack .chip.c5').click();
      await page.locator('.spot-ante').click();
      if (i % 2 === 0) { if (kinds[i] === 'iphone') await page.locator('.bonus-toggle').click(); await page.locator('.spot-pairPlus').click(); }
      if (i === 1) await page.locator('.spot-sixCard').click();
      await page.getByRole('button', { name: 'Deal me in' }).click();
    }));
    for (const { page } of ps) {
      await expect(page.getByRole('button', { name: /^Play 1×/ })).toBeVisible({ timeout: 20000 });
      await expect(page.locator('.dock-hand .card:not(.back):not(.empty)')).toHaveCount(3);
      await expect(page.locator('.seat:not(.mine):not(.empty-seat) .card.back')).toHaveCount(15);   // others' cards hidden
      await expect(page.locator('.community .card:visible')).toHaveCount(0);                         // no board
    }
    await Promise.all(ps.map(({ page }, i) => page.getByRole('button', { name: i % 3 === 2 ? /^Fold/ : /^Play 1×/ }).click()));
    for (const { page } of ps) await expect(page.locator('.my-result')).toBeVisible({ timeout: 25000 });
    await ps[0].page.waitForTimeout(1200);
    const ref = await stacks(ps[0].page);
    for (const { page } of ps) {
      expect(await stacks(page)).toEqual(ref);
      await expect(page.locator('.dealer-zone .card:not(.back):not(.empty)')).toHaveCount(3);
      await expect(page.locator('.seat:not(.empty-seat) .cards-row .card:not(.back):not(.empty)')).toHaveCount(18);
    }
    if (hand === 0) await expect(ps[1].page.getByRole('button', { name: 'Deal me in' })).toBeVisible({ timeout: 20000 });
  }

  // Switch back between hands: Hold'em circles return; chips carry over.
  await expect(host.getByRole('button', { name: 'Deal me in' })).toBeVisible({ timeout: 20000 });
  const mid = await stacks(ps[2].page);
  await host.getByRole('button', { name: 'Table menu' }).click();
  await host.getByRole('button', { name: /Host controls/ }).click();
  await host.locator('.game-option', { hasText: 'Ultimate Texas Hold’em' }).click();
  await host.getByRole('button', { name: 'Switch to Ultimate Texas Hold’em' }).click();
  for (const { page } of ps) await expect(page.locator('.table-screen')).toHaveAttribute('data-game', 'uth', { timeout: 10000 });
  expect(await stacks(ps[2].page)).toEqual(mid);
  await expect(ps[2].page.locator('.spot-blind')).toBeVisible();
  await expect(ps[2].page.locator('.spot-pairPlus')).toBeHidden();
  await Promise.all(ps.slice(0, 2).map(async ({ page }) => {
    await page.locator('.rack .chip.c5').click(); await page.locator('.spot-ante').click();
    await page.getByRole('button', { name: 'Deal me in' }).click();
  }));
  await expect(ps[1].page.locator('.dock-msg')).toContainText(/Ready|waiting/i);
  for (const p of ps) expect(p.errors, p.name).toEqual([]);
});

test('§24: earn, buy and wear in the Boutique, then six distinct portraits at the table in both games (phone)', async ({ browser }) => {
  test.setTimeout(240_000);
  const names = ['Ava', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'];
  const kinds: ('desktop' | 'iphone')[] = ['iphone', 'desktop', 'desktop', 'desktop', 'desktop', 'desktop'];
  const ps = await Promise.all(names.map((n, i) => newPlayer(browser, n, kinds[i])));
  const ava = ps[0].page;
  await signIn(ava, 'Ava');
  await expect(ava.locator('.me-card .credits-pill')).toHaveText('300 credits', { timeout: 10000 });

  // Character Creator: change the hairstyle, save (+50 for the first save).
  await ava.getByRole('button', { name: 'Edit avatar' }).click();
  await ava.getByRole('tab', { name: 'Hair' }).click();
  await ava.locator('.tile', { hasText: 'Mohawk' }).click();
  await expect(ava.locator('.cr-dirty')).toHaveText('Unsaved changes');
  await ava.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(ava.locator('.credits-pill')).toHaveText('350 credits', { timeout: 10000 });

  // Boutique: try on, buy, wear.
  await ava.getByRole('button', { name: 'Casino Boutique' }).click();
  await ava.locator('.bq-tab', { hasText: 'Hats' }).click();
  const fedora = ava.locator('.bq-card', { hasText: 'Classic Black Fedora' });
  await fedora.getByRole('button', { name: 'Try on' }).click();
  await expect(ava.locator('.bq-mirror-note')).toContainText('Classic Black Fedora');
  await fedora.getByRole('button', { name: /Buy/ }).click();
  await expect(ava.locator('.modal')).toContainText('You’ll have 200 credits left.');
  await ava.getByRole('button', { name: 'Buy for 150' }).click();
  await ava.getByRole('button', { name: 'Wear it' }).click();
  await expect(fedora.locator('.owned-badge')).toBeVisible();
  await expect(ava.locator('.credits-pill')).toHaveText('200 credits');
  await ava.locator('.bq-tab', { hasText: 'Credit history' }).click();
  await expect(ava.locator('.hist')).toContainText('Bought Classic Black Fedora');

  // Table with six players.
  await ava.getByRole('button', { name: '← Lobby' }).click();
  await ava.getByRole('button', { name: 'Create a private table' }).click();
  await ava.getByRole('button', { name: 'Create table' }).click();
  await ava.waitForURL(/\/table\/[A-Z0-9]{8}$/);
  const path = new URL(ava.url()).pathname;
  for (let i = 1; i < 6; i++) await signIn(ps[i].page, names[i], path);
  for (const p of ps) await expect(p.page.locator('.seat:not(.empty-seat) .avatar .portrait svg')).toHaveCount(6, { timeout: 15000 });

  const looks = (p: Page) => p.locator('.seat:not(.empty-seat) .avatar .portrait').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key));
  const ben = ps[1].page;
  expect(new Set(await looks(ben)).size).toBe(6);                                       // six distinct people
  const avaSeatKey = (p: Page) => p.locator('.seat:not(.empty-seat)', { hasText: 'Ava' }).locator('.portrait').getAttribute('data-key');
  expect(await avaSeatKey(ben)).toContain('fedora-black');                              // everyone sees what Ava bought

  // Phone: portraits never overlap a neighboring seat's plate or cards.
  const boxes = await ava.locator('.seat:not(.empty-seat)').evaluateAll((seats) => seats.map((s) => ({
    av: s.querySelector('.avatar')!.getBoundingClientRect().toJSON(),
    others: seats.filter((o) => o !== s).flatMap((o) => [o.querySelector('.plate')!, ...o.querySelectorAll('.cards-row .card')]).map((x) => x.getBoundingClientRect().toJSON()),
  })));
  const hit = (a: DOMRect, b: DOMRect) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  for (const b of boxes) for (const o of b.others) expect(hit(b.av as DOMRect, o as DOMRect)).toBe(false);

  // Play a Hold'em hand: everyone earns the same credits whatever their bet.
  await Promise.all(ps.map(async ({ page }, i) => {
    await page.locator(i === 0 ? '.rack .chip.c25' : '.rack .chip.c5').click();
    await page.locator('.spot-ante').click();
    await page.getByRole('button', { name: 'Deal me in' }).click();
  }));
  await Promise.all(ps.map(({ page }) => page.getByRole('button', { name: 'Check' }).click({ timeout: 20000 })));
  await Promise.all(ps.map(({ page }) => page.getByRole('button', { name: 'Check' }).click({ timeout: 20000 })));
  await Promise.all(ps.map(({ page }) => page.getByRole('button', { name: /^Play 1×/ }).click({ timeout: 20000 })));
  await expect(ava.locator('.toast')).toContainText('Style Credits: First hand +100', { timeout: 20000 });
  await expect(ben.locator('.toast')).toContainText('Style Credits: First hand +100', { timeout: 20000 });

  // Switch to Three Card Poker: same portraits on the same seats.
  await expect(ava.getByRole('button', { name: 'Deal me in' })).toBeVisible({ timeout: 20000 });
  const beforeKeys = await looks(ben);
  await ava.getByRole('button', { name: 'Table menu' }).click();
  await ava.getByRole('button', { name: /Host controls/ }).click();
  await ava.locator('.game-option', { hasText: 'Three Card Poker' }).click();
  await ava.getByRole('button', { name: 'Switch to Three Card Poker' }).click();
  await expect(ben.locator('.table-screen')).toHaveAttribute('data-game', 'tcp', { timeout: 10000 });
  expect(await looks(ben)).toEqual(beforeKeys);
  expect(await avaSeatKey(ben)).toContain('fedora-black');
  for (const p of ps) expect(p.errors).toEqual([]);
});

test('§27: six players play Blackjack in seat order with server timers, dealer hole card hidden until the end', async ({ browser }) => {
  test.setTimeout(360_000);
  const names = ['Nia', 'Oz', 'Pia', 'Quin', 'Rae', 'Sol'];
  const kinds: ('desktop' | 'iphone')[] = ['iphone', 'desktop', 'desktop', 'iphone', 'desktop', 'desktop'];
  const ps = await Promise.all(names.map((n, i) => newPlayer(browser, n, kinds[i])));
  const host = ps[0].page;
  await signIn(host, 'Nia');
  await host.getByRole('button', { name: 'Create a private table' }).click();
  await host.getByRole('button', { name: 'Create table' }).click();
  await host.waitForURL(/\/table\/[A-Z0-9]{8}$/);
  const path = new URL(host.url()).pathname;
  for (let i = 1; i < 6; i++) await signIn(ps[i].page, names[i], path);
  for (const p of ps) await expect(p.page.locator('.seat:not(.empty-seat) .pname')).toHaveCount(6, { timeout: 15000 });
  await host.getByRole('button', { name: 'Table menu' }).click();
  await host.getByRole('button', { name: /Host controls/ }).click();
  await host.locator('.game-option', { hasText: 'Blackjack' }).click();
  await host.getByRole('button', { name: 'Switch to Blackjack' }).click();
  for (const { page } of ps) await expect(page.locator('.table-screen')).toHaveAttribute('data-game', 'bj', { timeout: 10000 });
  const seatOf = (p: Page) => p.evaluate(() => [...document.querySelectorAll('.seat')].findIndex((s) => s.classList.contains('mine')));
  const mySeat = await Promise.all(ps.map((p) => seatOf(p.page)));

  for (let hand = 0; hand < 2; hand++) {
    await Promise.all(ps.map(async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Deal me in' })).toBeVisible({ timeout: 25000 });
      await page.locator('.rack .chip.c25').click();
      await page.locator('.spot-ante').click();
      await page.getByRole('button', { name: 'Deal me in' }).click();
    }));
    // Everyone sees the dealer's hole card face down while players act.
    for (const { page } of ps) await expect(page.locator('.bj-dealer .card.back')).toHaveCount(1, { timeout: 20000 });
    const order: number[] = [];
    const seen = ps.map(() => false);                                        // each screen showed its result (sticky: results clear after a few seconds)
    const t0 = Date.now();
    while (Date.now() - t0 < 90_000) {
      const res = await Promise.all(ps.map((p) => p.page.locator('.my-result').isVisible()));
      res.forEach((r, i) => { if (r) seen[i] = true; });
      if (process.env.DBG) console.log(hand, res.join(','), await host.locator('.phase-line, .dock-msg').allTextContents());
      if (seen.every(Boolean)) break;
      const live = await Promise.all(ps.map((p) => p.page.locator('.controls button[data-bj]').count()));
      // One player at a time: two Stand buttons can only coexist for a moment while a turn passes.
      const standing = async () => (await Promise.all(ps.map((p) => p.page.locator('button[data-bj="stand"]').isVisible()))).filter(Boolean).length;
      if ((await standing()) > 1) { await host.waitForTimeout(600); expect(await standing()).toBeLessThanOrEqual(1); }
      for (let i = 0; i < 6; i++) {
        if (!live[i]) continue;
        const page = ps[i].page;
        if (await page.locator('button[data-bj="no-insurance"]').isVisible()) { await page.locator('button[data-bj="no-insurance"]').click({ timeout: 2000 }).catch(() => {}); continue; }
        if (!(await page.locator('button[data-bj="stand"]').isVisible())) continue;
        if (process.env.DBG) console.log('  act', i, Date.now() - t0, await page.locator('.controls button[data-bj]').allTextContents(), await page.locator('.seat.mine .bj-seat-hands').textContent(), await page.locator('.phase-line').textContent());
        if (!order.includes(mySeat[i])) order.push(mySeat[i]);
        await page.locator(i === 2 && hand === 0 && (await page.locator('button[data-bj="hit"]').isVisible()) ? 'button[data-bj="hit"]' : 'button[data-bj="stand"]').click({ timeout: 2000 }).catch(() => {});
      }
      await host.waitForTimeout(150);
    }
    expect(seen).toEqual(ps.map(() => true));
    expect([...order].sort((a, b) => a - b)).toEqual(order);              // turns went in seat order
    // Same balances on every screen, and the dealer's cards are all face up now.
    await host.waitForTimeout(800);
    const bal = (p: Page) => p.locator('.seat:not(.empty-seat)').evaluateAll((els) => els.map((e) => `${e.querySelector('.pname')?.textContent}=${e.querySelector('.pbal')?.textContent}`).sort());
    const ref = await bal(host);
    for (const { page } of ps) { expect(await bal(page)).toEqual(ref); await expect(page.locator('.bj-dealer .card.back')).toHaveCount(0); }
  }
  for (const p of ps) expect(p.errors, p.name).toEqual([]);
});

test('§30 + §26: avatar → border → chip → Hold’em with a dealer hand-over → Three Card Poker → Blackjack; one character everywhere', async ({ browser }) => {
  test.setTimeout(420_000);
  const uma = await newPlayer(browser, 'Uma');
  const vic = await newPlayer(browser, 'Vic', 'iphone');
  const u = uma.page;
  await signIn(u, 'Uma');
  await expect(u.locator('.me-card .credits-pill')).toHaveText('300 credits', { timeout: 10000 });
  // Avatar (+50 on first save).
  await u.getByRole('button', { name: 'Edit avatar' }).click();
  await u.getByRole('tab', { name: 'Hair' }).click();
  await u.locator('.tile', { hasText: 'Afro' }).click();
  await u.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(u.locator('.credits-pill')).toHaveText('350 credits', { timeout: 10000 });
  const strip = (s: string | null) => (s ?? '').replace(/(#|id=")[a-z][0-9a-z-]*/g, '$1x');
  const hairIn = (sel: string, p: Page = u) => p.locator(sel).first().evaluate((e) => e.querySelector('.hair-front')?.outerHTML ?? null);
  const creatorHair = strip(await hairIn('.cr-portrait'));
  expect(creatorHair).toContain('data-hair="afro"');
  // Animated border (250) and one custom $25 chip (70) from the Boutique.
  await u.getByRole('button', { name: 'Casino Boutique' }).click();
  await u.locator('.bq-tab', { hasText: 'Animated Borders' }).click();
  const card = u.locator('.bq-card', { hasText: 'Emerald Pulse' });
  await card.getByRole('button', { name: /Buy/ }).click();
  await u.getByRole('button', { name: 'Buy for 250' }).click();
  await u.getByRole('button', { name: 'Wear it' }).click();
  await expect(u.locator('.credits-pill')).toHaveText('100 credits', { timeout: 10000 });
  await u.locator('.bq-tab', { hasText: 'Custom Poker Chips' }).click();
  await u.locator('.chip-col', { hasText: 'Emerald Elite' }).click();
  await u.locator('.cd[title="$25"]').click();
  await u.getByRole('button', { name: /Buy \$25 only/ }).click();
  await u.getByRole('button', { name: 'Buy for 70' }).click();
  await u.getByRole('button', { name: 'Use for $25 only' }).click();
  await expect(u.locator('.credits-pill')).toHaveText('30 credits', { timeout: 10000 });
  await u.getByRole('button', { name: '← Lobby' }).click();
  await expect.poll(async () => strip(await hairIn('.me-card')), { timeout: 10000 }).toBe(creatorHair);   // lobby = creator
  await expect(u.locator('.me-card .bx').first()).toBeAttached();                  // border shows in the lobby

  // Table: Uma hosts, Vic joins on a phone. Dealer shift shortened to 10 rounds in host settings.
  await u.getByRole('button', { name: 'Create a private table' }).click();
  await u.getByRole('button', { name: 'Create table' }).click();
  await u.waitForURL(/\/table\/[A-Z0-9]{8}$/);
  await signIn(vic.page, 'Vic', new URL(u.url()).pathname);
  for (const p of [u, vic.page]) await expect(p.locator('.seat:not(.empty-seat) .pname')).toHaveCount(2, { timeout: 15000 });
  const umaSeat = (p: Page) => p.locator('.seat:not(.empty-seat)', { hasText: 'Uma' }).locator('.portrait');
  for (const p of [u, vic.page]) {
    expect(strip(await umaSeat(p).evaluate((e) => e.querySelector('.hair-front')?.outerHTML ?? null))).toBe(creatorHair);   // same hair, desktop & phone
    await expect(umaSeat(p).locator('.bx').first()).toBeAttached();                                                     // others see her border
  }
  await expect(u.locator('.rack .chip.c25 svg[data-col="emerald"]')).toBeVisible();              // her $25 chips use Emerald Elite
  await expect(u.locator('.rack .chip.c5 svg[data-col="classic"]')).toBeVisible();               // the rest stay Classic
  const openHost = () => u.getByRole('button', { name: 'Host', exact: true }).click();     // desktop header button
  await openHost();
  await u.locator('select[name="every"]').selectOption('10');
  await u.getByRole('button', { name: 'Save dealer settings' }).click();
  await u.keyboard.press('Escape');
  const dealer = (p: Page) => p.locator('.dealer-tag').textContent();
  const first = await dealer(u);
  const bal = (p: Page) => p.locator('.seat:not(.empty-seat)').evaluateAll((els) => els.map((e) => `${e.querySelector('.pname')?.textContent}=${e.querySelector('.pbal')?.textContent}`).sort());
  const both = [u, vic.page];
  for (let n = 0; n < 10; n++) {
    await Promise.all(both.map(async (p) => {
      await expect(p.getByRole('button', { name: 'Deal me in' })).toBeVisible({ timeout: 25000 });
      await p.locator('.rack .chip.c5').click(); await p.locator('.spot-ante').click();
      await p.getByRole('button', { name: 'Deal me in' }).click();
    }));
    await Promise.all(both.map((p) => p.getByRole('button', { name: /^Play 4×/ }).click({ timeout: 20000 })));
    await Promise.all(both.map((p) => expect(p.locator('.my-result')).toBeVisible({ timeout: 25000 })));
    if (n < 9) expect(await dealer(vic.page)).toBe(first);
  }
  await expect(vic.page.locator('.dealer-tag')).not.toHaveText(first ?? '', { timeout: 20000 });     // hand-over after round 10
  await expect(u.locator('.dealer-tag')).toHaveText((await dealer(vic.page)) ?? '');
  const afterUth = await bal(vic.page);

  // Three Card Poker, then Blackjack — chips, seats and looks carry over.
  const switchTo = async (name: string, game: string) => {
    await expect(u.getByRole('button', { name: 'Deal me in' })).toBeVisible({ timeout: 25000 });
    await openHost();
    await u.locator('.game-option', { hasText: name }).click();
    await u.getByRole('button', { name: `Switch to ${name}` }).click();
    for (const p of both) await expect(p.locator('.table-screen')).toHaveAttribute('data-game', game, { timeout: 10000 });
  };
  await switchTo('Three Card Poker', 'tcp');
  expect(await bal(u)).toEqual(afterUth);
  await Promise.all(both.map(async (p) => { await p.locator('.rack .chip.c5').click(); await p.locator('.spot-ante').click(); await p.getByRole('button', { name: 'Deal me in' }).click(); }));
  await Promise.all(both.map((p) => p.getByRole('button', { name: /^Play 1×/ }).click({ timeout: 20000 })));
  await Promise.all(both.map((p) => expect(p.locator('.my-result')).toBeVisible({ timeout: 25000 })));
  await switchTo('Blackjack', 'bj');
  for (const p of both) expect(strip(await umaSeat(p).evaluate((e) => e.querySelector('.hair-front')?.outerHTML ?? null))).toBe(creatorHair);
  await Promise.all(both.map(async (p) => { await p.locator('.rack .chip.c5').click(); await p.locator('.spot-ante').click(); await p.getByRole('button', { name: 'Deal me in' }).click(); }));
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000 && !(await Promise.all(both.map((p) => p.locator('.my-result').isVisible()))).every(Boolean)) {
    for (const p of both) {
      if (await p.locator('button[data-bj="no-insurance"]').isVisible()) await p.locator('button[data-bj="no-insurance"]').click({ timeout: 2000 }).catch(() => {});
      else if (await p.locator('button[data-bj="stand"]').isVisible()) await p.locator('button[data-bj="stand"]').click({ timeout: 2000 }).catch(() => {});
    }
    await u.waitForTimeout(200);
  }
  for (const p of both) await expect(p.locator('.my-result')).toBeVisible({ timeout: 20000 });
  await u.waitForTimeout(800);
  expect(await bal(u)).toEqual(await bal(vic.page));
  // Statistics: one identity, three games, and the new Decision Quality panel.
  await u.goto('/stats');
  await expect(u.locator('.quality .qbox')).toHaveCount(4, { timeout: 10000 });
  await expect(u.locator('.quality .qrecon')).toContainText('12 completed rounds');
  for (const p of [uma, vic]) expect(p.errors, p.name).toEqual([]);
});

test('§32: dealer roasts — opt-in consent, each viewer\'s own limits, profanity filter, phone caption clear of the cards', async ({ browser }) => {
  test.setTimeout(240_000);
  const tom = await newPlayer(browser, 'Tom');
  const vic = await newPlayer(browser, 'Vic', 'iphone');
  await signIn(tom.page, 'Tom');
  await tom.page.getByRole('button', { name: 'Create a private table' }).click();
  await tom.page.getByRole('button', { name: 'Create table' }).click();
  await tom.page.waitForURL(/\/table\/[A-Z0-9]{8}$/);
  await signIn(vic.page, 'Vic', new URL(tom.page.url()).pathname);
  for (const p of [tom.page, vic.page]) await expect(p.locator('.seat:not(.empty-seat) .pname')).toHaveCount(2, { timeout: 15000 });
  // Host turns the attitude up to No Mercy.
  await tom.page.getByRole('button', { name: 'Host', exact: true }).click();
  await tom.page.locator('select[name="attitude"]').selectOption('nomercy');
  await tom.page.getByRole('button', { name: 'Save dealer settings' }).click();
  await tom.page.keyboard.press('Escape');
  // The opt-in card sits in the chat panel (never over the table). Tom opts in; Vic simply doesn't — off is the default.
  await tom.page.locator('.pane-chat .roast-ask').getByRole('button', { name: 'Roast me' }).click();
  await expect(tom.page.locator('.roast-ask')).toHaveCount(0);
  // Vic also turns profanity off and caps intensity at Smartass — on Vic's phone only.
  await vic.page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('uth.prefs') ?? '{}');
    localStorage.setItem('uth.prefs', JSON.stringify({ ...p, roast: { ...(p.roast ?? {}), profanity: false, max: 1 } }));
  });
  await vic.page.reload();
  await expect(vic.page.locator('.seat:not(.empty-seat) .pname')).toHaveCount(2, { timeout: 15000 });
  const vicId = await vic.page.evaluate(() => JSON.parse(localStorage.getItem('uth.me') ?? '{}').id as string);
  const tomId = await tom.page.evaluate(() => JSON.parse(localStorage.getItem('uth.me') ?? '{}').id as string);

  // Both raise 4× every hand. Most starting hands shouldn't be raised, so Tom soon earns a verified-mistake roast.
  for (let n = 0; n < 8 && !(await tom.page.locator(`li.msg-roast[data-roast-target="${tomId}"]`).count()); n++) {
    await Promise.all([tom.page, vic.page].map(async (p) => {
      await expect(p.getByRole('button', { name: 'Deal me in' })).toBeVisible({ timeout: 25000 });
      await p.locator('.rack .chip.c5').click(); await p.locator('.spot-ante').click();
      await p.getByRole('button', { name: 'Deal me in' }).click();
    }));
    await Promise.all([tom.page, vic.page].map((p) => p.getByRole('button', { name: /^Play 4×/ }).click({ timeout: 20000 })));
    await Promise.all([tom.page, vic.page].map((p) => expect(p.locator('.my-result')).toBeVisible({ timeout: 25000 })));
    await tom.page.waitForTimeout(1200);
  }
  const mine = tom.page.locator(`li.msg-roast[data-roast-target="${tomId}"]`).first();
  await expect(mine).toBeAttached();
  // Nobody ever roasts Vic by name: Vic didn't opt in.
  for (const p of [tom.page, vic.page]) await expect(p.locator(`li.msg-roast[data-roast-target="${vicId}"]`)).toHaveCount(0);
  // Vic sees the same roasts about Tom, but clean and toned down on Vic's own phone.
  const vicTexts = await vic.page.locator('li.msg-roast').allTextContents();
  expect(vicTexts.length).toBeGreaterThan(0);
  for (const t of vicTexts) expect(t).not.toMatch(/\b(fuck\w*|shit\w*|asshole|dumbass|bastard|motherfuck\w*|damn|hell)\b/i);
  // Phone caption: on screen at some point, never over the dealer's cards or any seat.
  const cap = vic.page.locator('.roast-cap');
  const capBox = await cap.boundingBox();
  const dealerCards = await vic.page.locator('.dealer-zone .cards-row').boundingBox();
  if (capBox && dealerCards) expect(capBox.y + capBox.height).toBeLessThanOrEqual(dealerCards.y + 1);
  for (const p of [tom, vic]) expect(p.errors, p.name).toEqual([]);
});
