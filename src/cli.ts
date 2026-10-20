#!/usr/bin/env node
import { open, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { exitCode, scan, version, writeReport } from './scanner.js';

const HELP = `
LocaleLens — catch localization layout bugs before they ship.

Usage
  localelens serve [--open] [--port 4175] [--data-dir <directory>]
  localelens scan <url> [options]
  localelens scan --config localelens.config.json
  localelens init [--config localelens.config.json]

Examples
  localelens scan design.google
  localelens scan http://localhost:3000
  localelens scan https://example.com --routes /,/pricing --fail-on warning
  localelens scan http://localhost:3000 --modes expanded,expanded-rtl --json

Options
  --open                   Open the local web panel in your browser (serve)
  --port <number>          Local web panel port (default: 4175)
  --data-dir <directory>   SQLite history and report directory (serve)
  --config <file>          JSON configuration (auto-loads localelens.config.json)
  --routes <list>          Comma-separated same-origin paths (default: URL path)
  --modes <list>           baseline,expanded,rtl,expanded-rtl (baseline always included)
  --viewports <list>       desktop,mobile,tablet (default: desktop,mobile)
  --expansion <percent>    Text expansion, 10–200 (default: 40)
  --locale <tag>           Browser locale, e.g. en-US, ar (default: en-US)
  --output <directory>    Report directory (default: localelens-report)
  --fail-on <level>        error, warning, none (default: error)
  --checks <list>          horizontal-overflow,clipped-text,page-error
  --ignore <selector>     Skip a CSS selector; repeat for multiple selectors
  --mask <selector>       Mask an element in screenshots and snippets; repeatable
  --wait-for <selector>   Wait for a visible element before inspecting
  --storage-state <file>  Playwright authentication state (never included in reports)
  --timeout <ms>          Per-scenario budget, 1000–120000 (default: 30000)
  --settle <ms>           Wait after DOM ready, 0–10000 (default: 300)
  --concurrency <count>   Parallel route/viewport groups, 1–8 (default: 2)
  --max-findings <count>  Layout findings per scenario, 1–1000 (default: 100)
  --executable-path <file> Use a custom Chromium executable
  --no-screenshots        Generate findings without screenshots
  --json                  Print report JSON to stdout; progress goes to stderr
  -h, --help              Show this help
  -v, --version           Show version

Exit codes: 0 = pass, 1 = findings meet fail-on threshold, 2 = scan/config error,
            130 = interrupted. Scan/HTTP failures return 2 even with --fail-on none.

Local operation. No account, hosted backend, telemetry, or AI API key required.
Expanded text and RTL are simulations, not translations or a full accessibility audit.
`;

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      config: { type: 'string' },
      routes: { type: 'string' },
      modes: { type: 'string' },
      viewports: { type: 'string' },
      expansion: { type: 'string' },
      locale: { type: 'string' },
      output: { type: 'string' },
      'fail-on': { type: 'string' },
      checks: { type: 'string' },
      ignore: { type: 'string', multiple: true },
      mask: { type: 'string', multiple: true },
      'wait-for': { type: 'string' },
      'storage-state': { type: 'string' },
      timeout: { type: 'string' },
      settle: { type: 'string' },
      concurrency: { type: 'string' },
      'max-findings': { type: 'string' },
      'executable-path': { type: 'string' },
      'no-screenshots': { type: 'boolean' },
      json: { type: 'boolean' },
      open: { type: 'boolean' },
      port: { type: 'string' },
      'data-dir': { type: 'string' },
    },
  });
  if (values.version) {
    process.stdout.write(`${await version()}\n`);
    return 0;
  }
  if (values.help || !positionals.length) {
    process.stdout.write(HELP);
    return 0;
  }
  const [command, url, ...extra] = positionals;
  if (extra.length)
    throw new Error('Too many positional arguments. Use --routes for multiple pages.');
  if (command === 'serve') {
    if (url) throw new Error('serve does not take a URL. Enter it in the web panel.');
    const { startPanel, openPanel } = await import('./panel.js');
    const panel = await startPanel({
      ...(values.port !== undefined ? { port: Number(values.port) } : {}),
      ...(values['data-dir'] ? { dataDir: values['data-dir'] } : {}),
    });
    process.stdout.write(
      `LocaleLens workspace: ${panel.url}\nLocal history: ${panel.dataDir}\nKeep this terminal open. Press Ctrl+C to stop.\n`,
    );
    if (values.open) openPanel(panel.url);
    const close = () => {
      void panel.close().catch((error: unknown) => {
        process.stderr.write(`Could not close the panel: ${String(error)}\n`);
        process.exitCode = 2;
      });
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    return 0;
  }
  if (command === 'init') {
    if (url) throw new Error('init does not take a URL. Edit the generated JSON configuration.');
    const file = path.resolve(values.config ?? 'localelens.config.json');
    await writeFile(
      file,
      `${JSON.stringify(
        {
          url: 'http://localhost:3000',
          routes: ['/'],
          modes: ['baseline', 'expanded', 'rtl', 'expanded-rtl'],
          viewports: ['desktop', 'mobile'],
          expansion: 40,
          output: 'localelens-report',
          failOn: 'error',
          ignore: [],
          mask: [],
        },
        null,
        2,
      )}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    process.stdout.write(`Created ${file}\nEdit the URL, then run: localelens scan\n`);
    return 0;
  }
  if (command !== 'scan') throw new Error(`Unknown command ${command}. Run localelens --help.`);
  const overrides: Record<string, unknown> = {};
  if (url !== undefined) overrides.url = url;
  for (const key of ['routes', 'modes', 'viewports', 'checks'] as const) {
    if (values[key] !== undefined) overrides[key] = csv(values[key]);
  }
  for (const key of ['expansion', 'timeout', 'settle', 'concurrency'] as const) {
    if (values[key] !== undefined) overrides[key] = Number(values[key]);
  }
  for (const key of ['locale', 'output', 'ignore', 'mask'] as const) {
    if (values[key] !== undefined) overrides[key] = values[key];
  }
  for (const [flag, field] of [
    ['fail-on', 'failOn'],
    ['wait-for', 'waitFor'],
    ['storage-state', 'storageState'],
    ['executable-path', 'executablePath'],
  ] as const) {
    if (values[flag] !== undefined) overrides[field] = values[flag];
  }
  if (values['max-findings'] !== undefined) overrides.maxFindings = Number(values['max-findings']);
  if (values['no-screenshots']) overrides.screenshots = false;
  const config = await loadConfig(overrides, values.config);
  await mkdir(config.output, { recursive: true, mode: 0o700 });
  const lockPath = path.join(config.output, '.localelens.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error(
        `Another scan is using ${config.output}. Choose another --output. If a previous process was killed, remove ${lockPath} after confirming it is no longer running.`,
      );
    }
    throw error;
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    await lock.writeFile(
      `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
    );
    const total = config.routes.length * config.viewports.length * config.modes.length;
    process.stderr.write(`LocaleLens ${await version()} · ${total} scenarios · ${config.url}\n`);
    const report = await scan(config, {
      signal: controller.signal,
      onProgress(completed, count, scenario) {
        process.stderr.write(
          `[${completed}/${count}] ${scenario.viewport.name} · ${scenario.mode} · ${scenario.route} — ${scenario.status === 'failed' ? 'FAILED' : `${scenario.findings.length} finding(s)`}\n`,
        );
      },
    });
    await writeReport(report, config.output);
    if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else
      process.stdout.write(
        `\n${report.summary.errors} errors · ${report.summary.warnings} warnings · ${report.summary.introduced} introduced\nHTML: ${path.join(config.output, 'index.html')}\nJSON: ${path.join(config.output, 'report.json')}\n`,
      );
    return exitCode(report);
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write('Scan interrupted.\n');
      return 130;
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await lock.close();
    await unlink(lockPath);
  }
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`LocaleLens: ${message}\n`);
    process.exitCode = 2;
  });
