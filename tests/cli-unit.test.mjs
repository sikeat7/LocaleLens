import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
let root;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'localelens-cli-unit-'));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});
function run(args) {
  return new Promise((resolve) =>
    execFile(
      process.execPath,
      [cli, ...args],
      { cwd: root, timeout: 10000 },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }),
    ),
  );
}
test('help and version work without launching a browser', async () => {
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /localelens scan/);
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal((await run(['--version'])).stdout, `${metadata.version}\n`);
});
test('init never overwrites an existing configuration', async () => {
  const file = path.join(root, 'generated.json');
  assert.equal((await run(['init', '--config', file])).code, 0);
  const before = await readFile(file, 'utf8');
  assert.equal((await run(['init', '--config', file])).code, 2);
  assert.equal(await readFile(file, 'utf8'), before);
});
test('invalid commands and unsafe settings have useful nonzero failures', async () => {
  for (const args of [
    ['unknown'],
    ['scan', 'file:///etc/passwd'],
    ['scan', 'http://localhost:3000', '--typo'],
    ['scan', 'http://localhost:3000', '--concurrency', 'NaN'],
  ]) {
    const result = await run(args);
    assert.equal(result.code, 2);
    assert.ok(result.stderr.startsWith('LocaleLens:'));
  }
});

test('an existing output lock fails before any browser is launched', async () => {
  const output = path.join(root, 'locked-report');
  await mkdir(output);
  await writeFile(path.join(output, '.localelens.lock'), '{"pid":1}');
  const result = await run(['scan', 'http://localhost:3000', '--output', output]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Another scan/);
});
