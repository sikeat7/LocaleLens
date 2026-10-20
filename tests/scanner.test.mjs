import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { validateConfig } from '../dist/config.js';
import { scan, writeReport, exitCode } from '../dist/scanner.js';
import { fixtureServer } from './fixtures/server.mjs';

let server;
let root;
before(async () => {
  server = await fixtureServer();
  root = await mkdtemp(path.join(os.tmpdir(), 'localelens-scan-'));
});
after(async () => {
  await server?.close();
  await rm(root, { recursive: true, force: true });
});
function config(routes, extra = {}) {
  return validateConfig({
    url: server.url,
    routes,
    viewports: ['mobile'],
    modes: ['baseline', 'expanded', 'rtl', 'expanded-rtl'],
    screenshots: false,
    settle: 0,
    output: path.join(root, String(Math.random())),
    ...extra,
  });
}

test('real browser: healthy pages pass; expansion, RTL and baseline bugs are distinguished', async () => {
  const report = await scan(config(['/healthy', '/expansion', '/rtl', '/wide']));
  assert.equal(report.summary.scenarios, 16);
  const healthy = report.scenarios.filter((scenario) => scenario.route === '/healthy');
  assert.ok(
    healthy.every((scenario) => scenario.status === 'passed'),
    JSON.stringify(healthy),
  );
  const original = report.scenarios.find(
    (scenario) => scenario.route === '/expansion' && scenario.mode === 'baseline',
  );
  const expanded = report.scenarios.find(
    (scenario) => scenario.route === '/expansion' && scenario.mode === 'expanded',
  );
  assert.equal(original.findings.length, 0);
  assert.ok(expanded.transformedNodes > 0);
  assert.ok(
    expanded.findings.some((finding) => finding.code === 'clipped-text' && finding.introduced),
  );
  const rtl = report.scenarios.find(
    (scenario) => scenario.route === '/rtl' && scenario.mode === 'rtl',
  );
  assert.ok(
    rtl.findings.some((finding) => finding.code === 'horizontal-overflow' && finding.introduced),
  );
  const existing = report.scenarios.filter((scenario) => scenario.route === '/wide');
  assert.ok(
    existing.every((scenario) =>
      scenario.findings.some((finding) => !finding.introduced && finding.selector === '#wide'),
    ),
  );
  assert.equal(exitCode(report), 1);
});

test('ignore selectors, ignore attributes, ellipses, scrollers and hidden content do not fail clean scans', async () => {
  const report = await scan(
    config(['/ignore', '/false-positives', '/wide'], { ignore: ['#wide'] }),
  );
  assert.equal(report.summary.errors, 0, JSON.stringify(report.scenarios));
  assert.equal(report.summary.warnings, 0, JSON.stringify(report.scenarios));
  assert.equal(exitCode(report), 0);
});

test('masking excludes sensitive descendants from finding snippets and embeds offline screenshot data', async () => {
  const options = config(['/secret'], {
    modes: ['baseline'],
    screenshots: true,
    mask: ['#secret'],
  });
  const report = await scan(options);
  assert.ok(report.scenarios[0].screenshot);
  assert.ok(!JSON.stringify(report).includes('PRIVATE-SECRET-98765'));
  await writeReport(report, options.output);
  const html = await readFile(path.join(options.output, 'index.html'), 'utf8');
  assert.match(html, /class="screenshot-button"[^>]*><img[^>]*src="data:image\/png;base64,/);
  assert.ok(!html.includes('PRIVATE-SECRET-98765'));
});

test('offline report works under its CSP, filters scenarios, zooms images and escapes untrusted page content', async () => {
  const options = config(['/healthy', '/xss'], { modes: ['baseline'], screenshots: true });
  const report = await scan(options);
  await writeReport(report, options.output);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => {
      errors.push('XSS dialog');
      void dialog.dismiss();
    });
    page.on('request', (request) => {
      if (request.url().startsWith('http')) requests.push(request.url());
    });
    await page.goto(pathToFileURL(path.join(options.output, 'index.html')).href);
    assert.equal(await page.locator('.scenario:visible').count(), 2);
    await page.locator('#severity').selectOption('error');
    assert.equal(await page.locator('.scenario:visible').count(), 1);
    await page.locator('#search').fill('no such route');
    assert.equal(await page.locator('#empty').isVisible(), true);
    await page.locator('#search').fill('');
    await page.locator('#severity').selectOption('');
    await page.locator('#expand').click();
    assert.equal(await page.locator('.scenario[open]').count(), 2);
    assert.ok(
      (await page.locator('.findings').allTextContents())
        .join('')
        .includes('<img src=x onerror=alert(1)>'),
    );
    const guide = page.locator('.remediation').first();
    await guide.locator('summary').click();
    assert.equal(await guide.isVisible(), true);
    // innerText includes CSS text-transform, so presentation casing can vary.
    assert.match(await guide.innerText(), /Verify the change/i);
    await guide.locator('.copy-code').first().click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.copy-status')].some((node) => node.textContent.length > 0),
    );
    const copyStatus = await guide.locator('.copy-status').first().textContent();
    assert.match(copyStatus, /Copied to clipboard|Code selected/);
    if (copyStatus.includes('Code selected')) {
      assert.equal(
        await page.evaluate(() => window.getSelection().toString()),
        await guide.locator('pre code').first().textContent(),
      );
    }
    await page.locator('.screenshot-button').first().click();
    assert.equal(await page.locator('#zoom').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#zoom').isVisible(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally {
    await browser.close();
  }
});

test('HTTP and navigation failures remain errors even when finding thresholds are disabled', async () => {
  const report = await scan(config(['/missing'], { modes: ['baseline'], failOn: 'none' }));
  assert.ok(report.scenarios[0].findings.some((finding) => finding.code === 'http-error'));
  assert.equal(exitCode(report), 2);
  const unavailable = await scan(
    validateConfig({
      url: 'http://127.0.0.1:1',
      modes: ['baseline'],
      viewports: ['mobile'],
      screenshots: false,
      settle: 0,
      output: path.join(root, 'unavailable'),
      failOn: 'none',
    }),
  );
  assert.equal(unavailable.summary.failed, 1);
  assert.equal(exitCode(unavailable), 2);
});

test('warnings are opt-in failures, but truncated results cannot silently pass CI', async () => {
  const report = await scan(config(['/expansion'], { modes: ['expanded'], failOn: 'error' }));
  assert.equal(exitCode(report), 0);
  report.config.failOn = 'warning';
  assert.equal(exitCode(report), 1);
  const limited = await scan(config(['/many'], { modes: ['baseline'], maxFindings: 2 }));
  assert.equal(limited.scenarios[0].findings.length, 2);
  assert.ok(limited.summary.omitted > 0);
  assert.equal(exitCode(limited), 1);
});

test('readiness selectors and authentication state support real application workflows', async () => {
  const ready = await scan(config(['/delayed'], { modes: ['baseline'], waitFor: '#ready' }));
  assert.equal(ready.summary.failed, 0);
  const file = path.join(root, 'storage-state.json');
  await writeFile(
    file,
    JSON.stringify({
      cookies: [
        {
          name: 'session',
          value: 'allowed',
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  );
  const authenticated = await scan(config(['/auth'], { modes: ['baseline'], storageState: file }));
  assert.equal(exitCode(authenticated), 0);
  assert.ok(!JSON.stringify(authenticated).includes('"allowed"'));
});

test('invalid CSS selectors and readiness timeouts fail explicitly', async () => {
  const invalid = await scan(config(['/healthy'], { modes: ['baseline'], ignore: ['['] }));
  assert.equal(exitCode(invalid), 2);
  const timeout = await scan(
    config(['/healthy'], { modes: ['baseline'], waitFor: '#never', timeout: 1000 }),
  );
  assert.equal(exitCode(timeout), 2);
});

test('screenshots are bounded for long documents and previous run images are preserved', async () => {
  const options = config(['/long'], { modes: ['baseline'], screenshots: true });
  const first = await scan(options);
  assert.equal(first.summary.failed, 0, JSON.stringify(first.scenarios));
  assert.ok(first.scenarios[0].notes.some((note) => note.includes('16,000')));
  const png = await readFile(path.join(options.output, first.scenarios[0].screenshot));
  assert.equal(png.readUInt32BE(20), 16000);
  const second = await scan(options);
  assert.notEqual(first.scenarios[0].screenshot, second.scenarios[0].screenshot);
  await readFile(path.join(options.output, first.scenarios[0].screenshot));
});

test('cancellation closes browser work and does not produce a successful report', async () => {
  const controller = new AbortController();
  const promise = scan(config(['/healthy'], { modes: ['baseline'], waitFor: '#never' }), {
    signal: controller.signal,
  });
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    await assert.rejects(promise, /cancelled|abort/i);
  } finally {
    clearTimeout(timer);
  }
});

test('verification interstitials are failed access barriers; stress modes are not requested again', async () => {
  for (const route of ['/challenge-header', '/challenge-dom']) {
    const before = server.visits(route);
    const result = await scan(config([route], { waitFor: 'main', failOn: 'none' }));
    assert.equal(result.summary.scenarios, 4);
    assert.equal(result.summary.failed, 4);
    assert.equal(result.summary.passed, 0);
    assert.equal(result.summary.introduced, 0);
    assert.equal(server.visits(route) - before, 1);
    assert.equal(result.scenarios.filter((scenario) => scenario.skipReason).length, 3);
    for (const scenario of result.scenarios) {
      assert.equal(scenario.transformedNodes, 0);
      assert.deepEqual(
        scenario.findings.map((finding) => finding.code),
        ['access-blocked'],
      );
    }
    assert.equal(exitCode(result), 2);
  }
});

test('a normal page on Cloudflare with an embedded widget still gets layout inspection', async () => {
  const result = await scan(config(['/cloudflare-normal'], { modes: ['baseline', 'expanded'] }));
  assert.equal(result.summary.failed, 0);
  assert.ok(
    result.scenarios.every(
      (scenario) => !scenario.findings.some((finding) => finding.code === 'access-blocked'),
    ),
  );
  assert.ok(result.scenarios.find((scenario) => scenario.mode === 'expanded').transformedNodes > 0);
});

test('Cloudflare blocks stop the whole scan, including other routes and devices, without screenshots or retries', async () => {
  for (const concurrency of [1, 2]) {
    const blockedBefore = server.visits('/challenge-header');
    const healthyBefore = server.visits('/healthy');
    const result = await scan(
      config(['/challenge-header', '/healthy'], {
        concurrency,
        viewports: ['mobile', 'desktop'],
        screenshots: true,
        failOn: 'none',
      }),
    );
    assert.equal(result.summary.scenarios, 16);
    assert.equal(result.summary.failed, 16);
    assert.equal(result.summary.passed, 0);
    assert.equal(server.visits('/healthy'), healthyBefore, 'unstarted routes must never be opened');
    const attempts = server.visits('/challenge-header') - blockedBefore;
    assert.ok(
      attempts >= 1 && attempts <= concurrency,
      'only already-started workers may have made a request',
    );
    assert.ok(
      result.scenarios.every((scenario) => !scenario.screenshot && scenario.transformedNodes === 0),
    );
    assert.ok(
      result.scenarios.every((scenario) =>
        scenario.findings.every((finding) => finding.code === 'access-blocked'),
      ),
    );
    assert.equal(exitCode(result), 2);
  }
});
