import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startPanel } from '../dist/panel.js';
import { panelExecutor } from './fixtures/panel-executor.mjs';

for (const viewport of [
  { width: 1440, height: 1100 },
  { width: 390, height: 844 },
]) {
  test(`web panel supports a complete scan workflow at ${viewport.width}px`, async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'localelens-panel-ui-'));
    const app = await startPanel({ port: 0, dataDir, executor: panelExecutor });
    let browser;
    t.after(async () => {
      await browser?.close();
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(app.url);
    await page.getByRole('heading', { name: 'Make room for every language.' }).waitFor();
    await page.getByRole('radio', { name: /Quick look/ }).check();
    await page.getByLabel('Website URL', { exact: true }).fill('design.google');
    await page.locator('summary').click();
    const name = 'UI fixture <img src=x onerror=alert(1)>';
    await page.getByLabel('Scan name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Start scan', exact: true }).click();
    const title = page.getByRole('button', { name, exact: true });
    await title.waitFor();
    await page.locator('#history-list').getByRole('link', { name: 'View report ↗' }).waitFor();
    assert.equal(await page.locator('#pipeline-body .pipeline-step.done').count(), 6);
    assert.equal(
      await page.locator('#history-list img').count(),
      0,
      'scan labels are text, never HTML',
    );
    await title.click();
    await page.getByRole('link', { name: 'Download JSON' }).waitFor();
    assert.match(await page.locator('#detail-content').innerText(), /baseline, expanded/);
    const reportPath = await page.getByRole('link', { name: 'Open report ↗' }).getAttribute('href');
    const report = await browser.newPage();
    await report.goto(`${app.url}${reportPath}`);
    await report.getByRole('heading', { name: /A different language/ }).waitFor();
    await report.getByRole('button', { name: 'Expand all', exact: true }).click();
    assert.match(await report.locator('body').innerText(), /UI test fixture only/);
    await report.close();
    await page.getByRole('button', { name: 'Close scan details' }).click();
    await page.getByRole('searchbox', { name: 'Search scan history' }).fill('no matching website');
    await page.getByRole('heading', { name: 'No matching scans' }).waitFor();
    await page.getByRole('searchbox', { name: 'Search scan history' }).fill('');
    await page.getByRole('button', { name: 'Run again', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.status-badge.cancelled').waitFor();
    await page.getByRole('combobox', { name: 'Filter by status' }).selectOption('cancelled');
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.scan-row').length === 1 &&
        document.querySelector('.status-badge')?.textContent === 'cancelled',
    );
    await page.getByRole('button', { name: /Delete .* scan/ }).click();
    await page.getByRole('button', { name: 'Keep scan', exact: true }).click();
    assert.equal(await page.locator('#confirm-delete').isVisible(), false);
    await page.reload();
    await page.locator('#history-list').getByRole('link', { name: 'View report ↗' }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(pageErrors, []);
  });
}
