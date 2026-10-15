import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/**
 * Collects anything that would mean the static build is broken or leaking:
 * console errors (CSP violations are reported there too), uncaught errors,
 * CSP violation events, and any request that leaves the page's own folder.
 */
async function watch(page: Page, baseURL: string | undefined) {
  if (!baseURL) throw new Error('baseURL is not set');
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL)) problems.push(`request: ${request.url()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      // Runs in the page, where the console listener above picks it up.
      // eslint-disable-next-line no-console
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return problems;
}

async function open(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('balance')).toHaveText('$1,000.00');
}

async function drop(page: Page, nonce: number) {
  await page.getByRole('button', { name: /Drop ball/ }).click();
  await expect(
    page.getByRole('link', { name: new RegExp(`bet with nonce ${String(nonce)}$`) }),
  ).toBeVisible({
    timeout: 10_000,
  });
}

test.beforeEach(async ({ page }) => {
  // Balls land at once, which keeps these tests quick; the drop animation is
  // covered by the server-mode suite.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('runs under the meta-tag CSP and says it is a demo', async ({ page, baseURL }) => {
  const problems = await watch(page, baseURL);
  await open(page);
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).toContain("form-action 'none'");
  expect(csp).not.toContain('unsafe');

  const banner = page.getByRole('complementary', { name: 'Demo mode' });
  await expect(banner).toContainText("can't stop a dishonest house");
  await expect(banner).toContainText('Play money only.');
  await expect(banner.getByRole('link', { name: 'How the two modes differ' })).toHaveAttribute(
    'href',
    'https://github.com/shashank11yadav/Drop-Win#two-modes',
  );
  expect(problems).toEqual([]);
});

test('places bets, reveals the seed and verifies a round in the browser', async ({
  page,
  baseURL,
}) => {
  const problems = await watch(page, baseURL);
  await open(page);
  const committedHash = await page.getByTestId('server-seed-hash').innerText();

  for (const nonce of [0, 1, 2]) await drop(page, nonce);
  await expect(page.getByTestId('balance')).not.toHaveText('$1,000.00');

  const verifyLink = page.getByRole('link', { name: /bet with nonce 1$/ });
  const row = page.getByRole('row').filter({ has: verifyLink });
  const paidMultiplier = await row.getByRole('cell').nth(-3).innerText();

  await page.getByRole('button', { name: 'Reveal and rotate seeds' }).click();
  await expect(page.getByTestId('revealed-seed')).toContainText('used for 3 bets');
  await expect(page.getByTestId('server-seed-hash')).not.toHaveText(committedHash);
  await expect(verifyLink).toHaveText(/^Verify/);

  await verifyLink.click();
  await expect(page).toHaveURL(/\/Drop-Win\/#\/verify\?/);
  await expect(page.getByTestId('hash-check')).toContainText('Pass');
  await expect(page.getByTestId('result-check')).toContainText('Pass');
  await expect(page.getByTestId('verified-result')).toContainText(paidMultiplier);
  await expect(page.getByLabel('Server seed hash (committed)')).toHaveValue(committedHash);

  // One changed character in the revealed seed must fail the commitment.
  const seedField = page.getByLabel('Server seed (revealed)');
  const seed = await seedField.inputValue();
  await seedField.fill(`${seed.slice(0, -1)}${seed.endsWith('0') ? '1' : '0'}`);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByTestId('hash-check')).toContainText('Fail');

  expect(problems).toEqual([]);
});

test('keeps the demo across a reload and resets it on request', async ({ page, baseURL }) => {
  const problems = await watch(page, baseURL);
  await open(page);
  const committedHash = await page.getByTestId('server-seed-hash').innerText();
  await drop(page, 0);
  await drop(page, 1);
  const balance = await page.getByTestId('balance').innerText();

  await page.reload();
  await expect(page.getByTestId('balance')).toHaveText(balance);
  await expect(page.getByTestId('server-seed-hash')).toHaveText(committedHash);
  await expect(page.getByRole('link', { name: /bet with nonce 1$/ })).toBeVisible();

  const reset = page.getByRole('button', { name: 'Reset demo' });
  await reset.click();
  await page.getByRole('button', { name: 'Click again to reset' }).click();
  await expect(page.getByTestId('balance')).toHaveText('$1,000.00');
  await expect(page.getByTestId('server-seed-hash')).not.toHaveText(committedHash);
  await expect(page.getByText('No bets yet.')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('balance')).toHaveText('$1,000.00');
  await expect(page.getByText('No bets yet.')).toBeVisible();
  expect(problems).toEqual([]);
});

test('throws away a tampered save and starts a fresh demo', async ({ page }) => {
  await open(page);
  const committedHash = await page.getByTestId('server-seed-hash').innerText();
  await drop(page, 0);

  // Swap the hidden server seed in IndexedDB for one the player picked.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('drop-win-demo');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(new Error('open failed'));
      };
    });
    const tx = db.transaction('seeds', 'readwrite');
    const store = tx.objectStore('seeds');
    const seeds = await new Promise<{ serverSeed: string }[]>((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => {
        resolve(request.result as { serverSeed: string }[]);
      };
    });
    for (const seed of seeds) store.put({ ...seed, serverSeed: '0'.repeat(64) });
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
    db.close();
  });

  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'failed its checks' })).toBeVisible();
  await expect(page.getByTestId('balance')).toHaveText('$1,000.00');
  await expect(page.getByTestId('server-seed-hash')).not.toHaveText(committedHash);
  await expect(page.getByText('No bets yet.')).toBeVisible();
});

test('a second tab plays without touching the save of the first', async ({ page, context }) => {
  await open(page);
  await drop(page, 0);
  const balance = await page.getByTestId('balance').innerText();

  const second = await context.newPage();
  await second.emulateMedia({ reducedMotion: 'reduce' });
  await second.goto('./');
  await expect(
    second.getByRole('status').filter({ hasText: 'already open in another tab' }),
  ).toBeVisible({
    timeout: 5_000,
  });
  await expect(second.getByTestId('balance')).toHaveText('$1,000.00');
  await drop(second, 0);
  await second.close();

  await page.reload();
  await expect(page.getByTestId('balance')).toHaveText(balance);
});

test('has no axe violations on the play and verify pages', async ({ page }) => {
  await open(page);
  await drop(page, 0);
  const play = await new AxeBuilder({ page }).analyze();
  expect(play.violations).toEqual([]);

  await page.getByRole('link', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify a round' })).toBeVisible();
  const verify = await new AxeBuilder({ page }).analyze();
  expect(verify.violations).toEqual([]);
});

test('fits a 375 px screen without sideways scrolling', async ({ page, baseURL }) => {
  const problems = await watch(page, baseURL);
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  await drop(page, 0);
  for (const hash of ['#/', '#/verify']) {
    await page.goto(`./${hash}`);
    await expect(page.locator('#main')).toBeVisible();
    const [scrollWidth, innerWidth] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  }
  await page.goto('./');
  await expect(page.getByRole('complementary', { name: 'Demo mode' })).toBeInViewport();
  await expect(page.getByRole('button', { name: /Drop ball/ })).toBeVisible();
  expect(problems).toEqual([]);
});
