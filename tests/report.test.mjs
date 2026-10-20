import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderReport } from '../dist/report.js';
import { browserLaunchError, exitCode, writeReport } from '../dist/scanner.js';
import { remediationFor } from '../dist/remediation.js';

test('browser startup diagnostics preserve the cause after long launch arguments', () => {
  const error = browserLaunchError(
    new Error(
      `Target page closed\n<launching> ${'--argument '.repeat(300)}\nFATAL: bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.1: Permission denied (1100)`,
    ),
  );
  assert.match(error.message, /macOS denied browser startup/);
  assert.match(error.message, /normal Terminal/);
  assert.doesNotMatch(error.message, /Run "npx playwright install/);
  const missing = browserLaunchError(new Error("Executable doesn't exist at /browser/chromium"));
  assert.match(missing.message, /playwright install chromium/);
  assert.match(missing.message, /Executable doesn't exist/);
});

function report() {
  return {
    schemaVersion: 1,
    tool: { name: 'LocaleLens', version: '0.1.0' },
    startedAt: '2026-10-20T08:00:00.000Z',
    durationMs: 100,
    target: 'https://example.com/?x=<script>alert(1)</script>',
    config: {
      routes: ['/'],
      modes: ['baseline'],
      viewports: [{ name: 'mobile', width: 390, height: 844 }],
      expansion: 40,
      locale: 'en-US',
      checks: ['horizontal-overflow'],
      failOn: 'error',
    },
    summary: {
      scenarios: 1,
      passed: 0,
      failed: 0,
      errors: 1,
      warnings: 0,
      introduced: 0,
      omitted: 0,
    },
    scenarios: [
      {
        id: 'test',
        route: '/',
        viewport: { name: 'mobile', width: 390, height: 844 },
        mode: 'baseline',
        url: 'https://example.com',
        status: 'findings',
        durationMs: 100,
        transformedNodes: 0,
        findings: [
          {
            id: 'x',
            code: 'horizontal-overflow',
            severity: 'error',
            message: '<img src=x onerror=alert(1)>',
            suggestion: 'Use "wrapping" & flexible widths.',
            selector: '#a[title="<script>"]',
            text: '</script><script>alert(1)</script>',
            introduced: false,
          },
        ],
        omittedFindings: 0,
        notes: [],
      },
    ],
  };
}
test('report output escapes every page-supplied text boundary', () => {
  const html = renderReport(report());
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(!html.includes('</script><script>alert(1)</script>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('Use &quot;wrapping&quot; &amp; flexible widths.'));
});
test('offline report allows only the exact embedded script with its CSP hash', () => {
  const html = renderReport(report());
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!/<(?:link|script)[^>]+(?:href|src)="https?:/.test(html));
});

test('findings include scoped examples, inspection guidance, and verification steps', () => {
  const expected = {
    'horizontal-overflow': ['min-inline-size: 0', 'flex-wrap: wrap'],
    'clipped-text': ['block-size: auto', 'max-block-size: none'],
    'page-error': ['DOMContentLoaded', 'HTMLButtonElement'],
    'http-error': ['/existing-page', 'HTTP error'],
    'scan-error': ['waitFor', '60000'],
    'access-blocked': ['approved staging environment', 'localhost:3000'],
  };
  for (const [code, snippets] of Object.entries(expected)) {
    const data = report();
    data.scenarios[0].findings[0].code = code;
    const html = renderReport(data);
    assert.match(html, /How to fix this/);
    assert.match(html, /What to inspect/);
    assert.match(html, /Verify the change/);
    assert.match(html, /Example patterns, not an automatic patch/);
    assert.match(html, /class="copy-code"/);
    for (const snippet of snippets)
      assert.ok(html.includes(snippet), `${code}: missing ${snippet}`);
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  }
});

test('access barriers produce an explicit blocked report and never a passing CI result', () => {
  const data = report();
  data.config.failOn = 'none';
  data.summary.failed = 1;
  data.scenarios[0].status = 'failed';
  data.scenarios[0].findings[0].code = 'access-blocked';
  const html = renderReport(data);
  assert.match(html, /Access blocked: affected website layouts were not inspected/);
  assert.match(html, /class="badge error">Access blocked/);
  assert.match(html, /not detected layout defects/);
  assert.equal(exitCode(data), 2);
  data.scenarios[0].skipReason = 'Baseline access blocked.';
  assert.match(renderReport(data), /class="badge error">Skipped/);
});

test('RTL guidance is scenario-specific and authentication examples are restricted to HTTP 401/403', () => {
  const finding = report().scenarios[0].findings[0];
  const baseline = remediationFor(finding, 'baseline');
  const rtl = remediationFor(finding, 'expanded-rtl');
  assert.equal(baseline.examples.length, 1);
  assert.equal(rtl.examples.length, 2);
  assert.match(rtl.examples[1].code, /inset-inline-start/);
  const auth = remediationFor(
    { ...finding, code: 'http-error', message: 'HTTP 403 while loading the page.' },
    'baseline',
  );
  assert.match(auth.examples[0].code, /storageState/);
  assert.ok(auth.steps.some((step) => step.includes('web panel does not accept')));
  const missing = remediationFor(
    { ...finding, code: 'http-error', message: 'HTTP 404 while loading the page.' },
    'baseline',
  );
  assert.doesNotMatch(missing.examples[0].code, /storageState/);
  assert.doesNotThrow(() => JSON.parse(auth.examples[0].code));
  assert.doesNotThrow(() => JSON.parse(missing.examples[0].code));
});
test('CI thresholds cannot convert failed scans or HTTP failures into success', () => {
  const data = report();
  data.config.failOn = 'none';
  data.summary.failed = 1;
  assert.equal(exitCode(data), 2);
  data.summary.failed = 0;
  data.scenarios[0].findings[0].code = 'http-error';
  assert.equal(exitCode(data), 2);
  data.scenarios[0].findings[0].code = 'horizontal-overflow';
  assert.equal(exitCode(data), 0);
  data.config.failOn = 'error';
  assert.equal(exitCode(data), 1);
});

test('artifact path validation and embedded-image budgets preserve the previous report on failure', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'localelens-artifacts-'));
  try {
    await writeFile(path.join(output, 'index.html'), 'previous report');
    const data = report();
    data.scenarios[0].screenshot = '../outside.png';
    await assert.rejects(writeReport(data, output), /Invalid screenshot path/);
    data.scenarios[0].screenshot = 'oversized.png';
    const file = await open(path.join(output, 'oversized.png'), 'w');
    try {
      await file.truncate(50 * 1024 * 1024 + 1);
    } finally {
      await file.close();
    }
    await assert.rejects(writeReport(data, output), /50 MiB/);
    assert.equal(await readFile(path.join(output, 'index.html'), 'utf8'), 'previous report');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
