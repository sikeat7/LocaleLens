import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderReport } from '../dist/report.js';
import { exitCode, writeReport } from '../dist/scanner.js';

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
