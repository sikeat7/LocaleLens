import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { allowedScanOrigin, loadConfig, routeUrl, validateConfig } from '../dist/config.js';

test('URL path, query and hash survive defaults; every stress scan has a baseline', () => {
  const config = validateConfig({
    url: 'http://localhost:3000/app?lang=de#content',
    modes: ['expanded-rtl', 'expanded-rtl'],
  });
  assert.deepEqual(config.routes, ['/app?lang=de#content']);
  assert.deepEqual(config.modes, ['baseline', 'expanded-rtl']);
  assert.equal(routeUrl(config.url, '/pricing?q=a%20b'), 'http://localhost:3000/pricing?q=a%20b');
});

test('reject unsafe targets and routes instead of visiting unintended destinations', () => {
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    '//evil.test',
    '/relative',
    'not-a-domain',
    'https:example.com',
    'https://name:password@example.com',
  ]) {
    assert.throws(() => validateConfig({ url }));
  }
  for (const route of [
    '//evil.test',
    '/\\evil.test',
    'https://evil.test',
    'relative',
    '\\evil.test',
  ]) {
    assert.throws(() => validateConfig({ url: 'https://example.com', routes: [route] }));
  }
});

test('bare domains normalize without losing paths or inventing www', () => {
  for (const [input, expected] of [
    ['design.google', 'https://design.google/'],
    [' design.google/components?q=a#top ', 'https://design.google/components?q=a#top'],
    ['www.example.com/path', 'https://www.example.com/path'],
    ['example.com:8443', 'https://example.com:8443/'],
    ['localhost:3000/app', 'http://localhost:3000/app'],
    ['127.0.0.1:4173', 'http://127.0.0.1:4173/'],
    ['[::1]:3000', 'http://[::1]:3000/'],
    ['http://example.com/path', 'http://example.com/path'],
  ]) {
    const config = validateConfig({ url: input });
    assert.equal(config.url, expected);
    const url = new URL(expected);
    assert.deepEqual(config.routes, [url.pathname + url.search + url.hash]);
  }
});

test('canonical www/HTTPS redirects preserve the target while unrelated origins and downgrades stay rejected', () => {
  assert.equal(allowedScanOrigin('https://example.com', 'https://www.example.com/app'), true);
  assert.equal(allowedScanOrigin('https://www.example.com', 'https://example.com/app'), true);
  assert.equal(allowedScanOrigin('http://example.com', 'https://example.com/app'), true);
  for (const [from, to] of [
    ['https://example.com', 'http://example.com'],
    ['https://example.com', 'https://example.com.evil.test'],
    ['https://example.com', 'https://login.example.com'],
    ['https://example.com:8443', 'https://example.com:9443'],
    ['https://www.example.com', 'https://www.www.example.com'],
  ])
    assert.equal(allowedScanOrigin(from, to), false);
});

test('strict validation catches misspellings, wrong types and unreasonable budgets', () => {
  for (const extra of [
    { expension: 50 },
    { expansion: '40' },
    { expansion: NaN },
    { concurrency: 0 },
    { timeout: 999 },
    { settle: -1 },
    { modes: ['arabic'] },
    { routes: [] },
    { checks: [] },
    { screenshots: 'false' },
    { ignore: 'div' },
    { locale: 'not_a_locale' },
    { failOn: 'everything' },
    { maxFindings: 0 },
    { viewports: ['phone'] },
    { viewports: [{ name: 'a/../b', width: 390, height: 844 }] },
    { viewports: [{ name: 'tiny', width: 100, height: 844 }] },
    { viewports: ['mobile', 'mobile'] },
    { viewports: [{ name: 'test', width: 400, height: 800, typo: 1 }] },
  ])
    assert.throws(
      () => validateConfig({ url: 'https://example.com', ...extra }),
      JSON.stringify(extra),
    );
});

test('custom viewport dimensions and explicit no-screenshot mode are accepted', () => {
  const config = validateConfig({
    url: 'https://example.com',
    screenshots: false,
    viewports: [{ name: 'small-phone', width: 320, height: 640 }],
  });
  assert.equal(config.screenshots, false);
  assert.deepEqual(config.viewports[0], { name: 'small-phone', width: 320, height: 640 });
});

test('config-file paths and CLI paths resolve relative to their respective sources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'localelens-config-'));
  try {
    await mkdir(path.join(root, 'project'));
    await writeFile(
      path.join(root, 'project/config.json'),
      JSON.stringify({
        url: 'http://localhost:3000',
        output: 'reports',
        storageState: 'auth.json',
        expansion: 60,
      }),
    );
    const config = await loadConfig({ expansion: 80 }, 'project/config.json', root);
    assert.equal(config.output, path.join(root, 'project/reports'));
    assert.equal(config.storageState, path.join(root, 'project/auth.json'));
    assert.equal(config.expansion, 80);
    const overridden = await loadConfig({ output: 'cli-report' }, 'project/config.json', root);
    assert.equal(overridden.output, path.join(root, 'cli-report'));
    await assert.rejects(loadConfig({}, 'missing.json', root), /Cannot read config/);
    await writeFile(path.join(root, 'invalid.json'), '[1,2]');
    await assert.rejects(loadConfig({}, 'invalid.json', root), /JSON object/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
