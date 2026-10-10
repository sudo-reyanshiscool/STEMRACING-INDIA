import { expect, test } from '@playwright/test';

test('scrutineer inspects a car offline and the work survives a reload', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Event name').fill('Regional round');
  await page.getByRole('button', { name: 'Create event' }).click();

  await page.getByLabel('Team number').fill('12');
  await page.getByLabel('Team name').fill('Apex <b>Racing</b>');
  await page.getByRole('button', { name: 'Add team' }).click();
  await expect(page.getByRole('heading', { name: /Team 12 · Apex <b>Racing<\/b>/ })).toBeVisible();

  // Duplicate number is refused in words.
  await page.getByLabel('Team number').fill('12');
  await page.getByLabel('Team name').fill('Another');
  await page.getByRole('button', { name: 'Add team' }).click();
  await expect(page.getByRole('alert')).toContainText('already used');

  await page.getByRole('link', { name: /Car A/ }).click();

  // The service worker must be controlling the page before we go offline.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  await context.setOffline(true);

  const weight = page.getByLabel('T3.6 Total weight (no cartridge) (g)', { exact: true });
  await weight.fill('46,5');
  const row = page.locator('[id="rule-T3.6"]');
  await expect(row).toContainText('Fail');
  await expect(row).toContainText('20 pts');
  await expect(row).toContainText('3 g');
  await expect(page.getByRole('status', { name: 'Penalty total' })).toContainText('20');

  // Garbage is never scored.
  await weight.fill('abc');
  await expect(row).toContainText('Enter a number');
  await expect(page.getByRole('status', { name: 'Penalty total' })).toContainText('0');
  await weight.fill('46.5');

  // Rear wing: shortest line governs.
  await page.getByLabel('T9.5.1 Trailing edge (mm)', { exact: true }).fill('47.2');
  await expect(page.locator('[id="rule-T9.5.1"]')).toContainText('6 pts');
  await expect(page.getByRole('status', { name: 'Penalty total' })).toContainText('26');

  // Reload while offline: the app shell and the saved values both come back.
  await page.reload();
  await expect(page.getByLabel('T3.6 Total weight (no cartridge) (g)', { exact: true })).toHaveValue('46.5');
  await expect(page.getByRole('status', { name: 'Penalty total' })).toContainText('26');

  // Summary shows the award warning.
  await page.getByRole('link', { name: 'See summary' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Not eligible for Fastest Car' })).toBeVisible();

  // PDF downloads with a safe name.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^STEM-Racing-Scrutineering_Regional-round_Team-12A\.pdf$/);
});
