import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureServer } from './fixtures/server.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
let root;
let server;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'localelens-cli-'));
  server = await fixtureServer();
});
after(async () => {
  await server?.close();
  await rm(root, { recursive: true, force: true });
});
function run(args, cwd = root) {
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      [cli, ...args],
      { cwd, timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }),
    ),
  );
}

test('CLI produces valid JSON, standalone HTML and threshold exit codes', async () => {
  const output = path.join(root, 'results');
  const result = await run([
    'scan',
    `${server.url}/expansion`,
    '--modes',
    'expanded',
    '--viewports',
    'mobile',
    '--settle',
    '0',
    '--fail-on',
    'warning',
    '--output',
    output,
    '--json',
  ]);
  assert.equal(result.code, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.scenarios, 2);
  assert.ok(report.summary.introduced > 0);
  assert.equal(
    JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8')).schemaVersion,
    1,
  );
  assert.match(
    await readFile(path.join(output, 'index.html'), 'utf8'),
    /class="screenshot-button"[^>]*><img[^>]*src="data:image\/png;base64,/,
  );
  assert.match(result.stderr, /\[2\/2\]/);
});

test('scan auto-loads a config and respects a concurrent output lock', async () => {
  const file = path.join(root, 'localelens.config.json');
  const output = path.join(root, 'configured-results');
  await writeFile(
    file,
    JSON.stringify({
      url: server.url,
      routes: ['/healthy'],
      modes: ['baseline'],
      viewports: ['mobile'],
      screenshots: false,
      output,
      settle: 0,
    }),
  );
  const success = await run(['scan']);
  assert.equal(success.code, 0, success.stderr);
  await writeFile(path.join(output, '.localelens.lock'), '{"pid":1}');
  const locked = await run(['scan']);
  assert.equal(locked.code, 2);
  assert.match(locked.stderr, /Another scan/);
});
