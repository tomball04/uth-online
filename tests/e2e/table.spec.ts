import { expect, test, devices, type Browser, type Page } from '@playwright/test';

async function newPlayer(browser: Browser, name: string, device: 'desktop' | 'iphone' = 'desktop') {
  const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 13'];
  const ctx = await browser.newContext(device === 'iphone' ? iphone : { viewport: { width: 1366, height: 860 } });
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
  await expect(h.locator('.seat:not(.mine):not(.empty-seat) .ms-pairs')).toHaveText('$5');

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
