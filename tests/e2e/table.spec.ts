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
