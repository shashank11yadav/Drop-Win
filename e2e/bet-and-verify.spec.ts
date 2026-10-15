import { expect, type Page, test } from '@playwright/test';

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

test('places a bet, reveals the seed and verifies the round in the browser', async ({ page }) => {
  const problems = collectProblems(page);
  await page.goto('/');

  const balance = page.getByTestId('balance');
  await expect(balance).toHaveText('$1,000.00');
  const committedHash = await page.getByTestId('server-seed-hash').innerText();

  await page.getByRole('button', { name: /Drop ball/ }).click();

  // The row appears once the ball has landed; the animation takes a few seconds.
  const verifyLink = page.getByRole('link', { name: /bet with nonce 0$/ });
  await expect(verifyLink).toBeVisible({ timeout: 10_000 });
  const row = page.getByRole('row').filter({ has: verifyLink });
  const paidMultiplier = await row.getByRole('cell').nth(-3).innerText();
  await expect(balance).not.toHaveText('$1,000.00');

  await page.getByRole('button', { name: 'Reveal and rotate seeds' }).click();
  await expect(page.getByTestId('revealed-seed')).toBeVisible();
  await expect(page.getByTestId('server-seed-hash')).not.toHaveText(committedHash);
  await expect(verifyLink).toHaveText(/^Verify/);

  await verifyLink.click();
  await expect(page).toHaveURL(/#\/verify\?/);
  await expect(page.getByTestId('hash-check')).toContainText('Pass');
  await expect(page.getByTestId('result-check')).toContainText('Pass');
  await expect(page.getByTestId('verified-result')).toContainText(paidMultiplier);
  await expect(page.getByLabel('Server seed hash (committed)')).toHaveValue(committedHash);

  // Tampering with the revealed seed must fail the hash check.
  const seedField = page.getByLabel('Server seed (revealed)');
  const seed = await seedField.inputValue();
  await seedField.fill(`${seed.slice(0, -1)}${seed.endsWith('0') ? '1' : '0'}`);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByTestId('hash-check')).toContainText('Fail');

  expect(problems).toEqual([]);
});

test('Space drops a ball and reduced motion lands it at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('balance')).toHaveText('$1,000.00');
  await page.locator('body').press('Space');
  await expect(page.getByRole('link', { name: /bet with nonce 0$/ })).toBeVisible({
    timeout: 2_000,
  });
  await expect(page.getByText(/^Landed on .+\. (Won|Lost) \$/)).toBeAttached();
});
