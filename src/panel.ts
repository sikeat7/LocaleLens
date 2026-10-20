import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { chmod, mkdir, open, readFile, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateConfig } from './config.js';
import { scan, version, writeReport } from './scanner.js';
import type { ScanHooks } from './scanner.js';
import { PanelStore } from './panel-store.js';
import type { SavedScan } from './panel-store.js';
import type { Config, Report } from './types.js';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const active = (record: SavedScan) => ['queued', 'running'].includes(record.status);
const editable = new Set([
  'label',
  'url',
  'routes',
  'modes',
  'viewports',
  'expansion',
  'locale',
  'timeout',
  'settle',
  'concurrency',
  'failOn',
  'ignore',
  'mask',
  'checks',
  'screenshots',
  'maxFindings',
  'waitFor',
]);

async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    throw new HttpError(400, 'Send Content-Type: application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 65536) throw new HttpError(413, 'Request exceeds 64 KiB.');
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

async function directoryLock(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'panel.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(file, 'wx', 0o600);
      await handle.writeFile(String(process.pid));
      return async () => {
        await handle.close();
        await unlink(file);
      };
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      const pid = Number(await readFile(file, 'utf8'));
      let alive = true;
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (check) {
          if (check instanceof Error && 'code' in check && check.code === 'ESRCH') alive = false;
        }
      }
      if (alive)
        throw new Error(
          `Another panel owns ${directory}. Close it first. If a stale lock remains, verify the process is stopped before removing ${file}.`,
        );
      await unlink(file);
    }
  }
  throw new Error('Could not lock the panel data directory.');
}

export interface PanelOptions {
  port?: number;
  dataDir?: string;
  executor?: (config: Config, hooks: ScanHooks) => Promise<Report>;
}

export async function startPanel(options: PanelOptions = {}) {
  const port = options.port ?? 4175;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port must be 0–65535.');
  const dataDir = path.resolve(options.dataDir ?? path.join(os.homedir(), '.localelens'));
  const release = await directoryLock(dataDir);
  let store: PanelStore;
  try {
    store = new PanelStore(path.join(dataDir, 'history.sqlite'));
    await chmod(path.join(dataDir, 'history.sqlite'), 0o600);
  } catch (error) {
    await release();
    throw error;
  }
  const token = randomBytes(32).toString('hex');
  const toolVersion = await version();
  const executor = options.executor ?? scan;
  const queue: string[] = [];
  let running: { id: string; controller: AbortController; task: Promise<void> } | undefined;
  let closing = false;
  let origin = '';
  const output = (id: string) => path.join(dataDir, 'reports', id);

  function pump(): void {
    if (running || closing) return;
    const id = queue.shift();
    if (!id) return;
    const record = store.get(id);
    if (!record || record.status !== 'queued') {
      pump();
      return;
    }
    const controller = new AbortController();
    store.update(id, { status: 'running', startedAt: new Date().toISOString() });
    store.recordStage(id, 'preparing', 'Preparing scan settings and output files.');
    const inProgress = new Map<string, string>();
    const scenarioKey = (route: string, viewport: string, mode: string) =>
      JSON.stringify([route, viewport, mode]);
    const task = (async () => {
      // Yield before executing so the running slot exists even for synchronous failures.
      await Promise.resolve();
      try {
        const report = await executor(
          { ...record.settings, output: output(id) },
          {
            signal: controller.signal,
            onStage(stage) {
              const messages = {
                preparing: 'Preparing scan settings and output files.',
                launching: 'Starting the Chromium scan browser.',
                scanning: 'Checking page layouts across the selected devices and modes.',
              };
              store.recordStage(id, stage, messages[stage]);
            },
            onScenarioStart(route, viewport, mode) {
              inProgress.set(
                scenarioKey(route, viewport.name, mode),
                `${viewport.name} · ${mode} · ${route}`,
              );
              store.update(id, { current: [...inProgress.values()].join(' | ') });
            },
            onProgress(completed, _total, scenario) {
              store.recordStage(
                id,
                'scanning',
                'Checking page layouts across the selected devices and modes.',
              );
              inProgress.delete(scenarioKey(scenario.route, scenario.viewport.name, scenario.mode));
              store.update(id, {
                completed,
                current: [...inProgress.values()].join(' | ') || 'Preparing the next scenario…',
              });
            },
          },
        );
        controller.signal.throwIfAborted();
        store.recordStage(id, 'reporting', 'Saving the offline HTML report and JSON results.');
        store.update(id, { current: '' });
        await writeReport(report, output(id));
        controller.signal.throwIfAborted();
        const blocked = report.scenarios
          .flatMap((scenario) => scenario.findings)
          .find((finding) => finding.code === 'access-blocked');
        store.update(id, {
          status:
            report.summary.failed ||
            report.scenarios.some((s) =>
              s.findings.some((f) => ['http-error', 'access-blocked'].includes(f.code)),
            )
              ? 'failed'
              : 'completed',
          completed: report.summary.scenarios,
          summary: report.summary,
          error: blocked?.message ?? null,
          hasReport: true,
          finishedAt: new Date().toISOString(),
          current: '',
        });
        store.recordStage(
          id,
          'finished',
          blocked
            ? 'Report saved. Access was blocked; the affected website layouts were not inspected.'
            : 'Reports saved and ready to review.',
        );
      } catch (error) {
        store.recordStage(
          id,
          controller.signal.aborted ? 'cancelled' : 'failed',
          controller.signal.aborted
            ? 'Scan cancelled before completion.'
            : 'Scan stopped. Open scan details for the error.',
        );
        store.update(id, {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          error: controller.signal.aborted
            ? 'Scan cancelled.'
            : error instanceof Error
              ? error.message.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 2000)
              : 'Scan failed.',
          finishedAt: new Date().toISOString(),
          current: '',
        });
      } finally {
        running = undefined;
        pump();
      }
    })();
    running = { id, controller, task };
  }

  function enqueue(input: unknown): SavedScan {
    if (closing) throw new HttpError(409, 'The panel is shutting down.');
    if (store.activeCount() >= 20)
      throw new HttpError(429, 'Queue is full. Wait for a scan to finish.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new HttpError(400, 'Expected a scan settings object.');
    const raw = input as Record<string, unknown>;
    for (const key of Object.keys(raw))
      if (!editable.has(key)) throw new HttpError(400, `Unknown panel setting: ${key}.`);
    if (raw.label !== undefined && (typeof raw.label !== 'string' || raw.label.length > 120))
      throw new HttpError(400, 'Label must be at most 120 characters.');
    const { label, ...settings } = raw;
    const id = randomUUID();
    let config: Config;
    try {
      config = validateConfig({ settle: 1000, ...settings, output: output(id) });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid settings.');
    }
    if (config.routes.length * config.modes.length * config.viewports.length > 1000)
      throw new HttpError(400, 'Use at most 1000 scenarios per scan.');
    const record = store.create(id, typeof label === 'string' ? label.trim() : '', config);
    queue.push(id);
    pump();
    return store.get(record.id)!;
  }

  function json(response: ServerResponse, status: number, value: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }
  const assets: Record<string, [string, string]> = {
    '/': ['../web/index.html', 'text/html; charset=utf-8'],
    '/app.js': ['../web/app.js', 'text/javascript; charset=utf-8'],
    '/style.css': ['../web/style.css', 'text/css; charset=utf-8'],
    '/logo.png': ['../docs/assets/localelens-logo.png', 'image/png'],
  };

  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (request.headers.host !== new URL(origin).host)
      throw new HttpError(403, 'Invalid local Host header.');
    if (request.headers.origin && request.headers.origin !== origin)
      throw new HttpError(403, 'Cross-origin requests are not allowed.');
    if (
      request.headers['sec-fetch-site'] &&
      !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site']))
    )
      throw new HttpError(403, 'Open the panel directly from its local address.');
    const url = new URL(request.url ?? '/', origin);
    const method = request.method ?? 'GET';
    if (method === 'GET' && assets[url.pathname]) {
      const [file, mime] = assets[url.pathname]!;
      const bytes = await readFile(new URL(file, import.meta.url));
      response.writeHead(200, { 'Content-Type': mime });
      response.end(bytes);
      return;
    }
    if (method === 'GET' && url.pathname === '/api/session') {
      json(response, 200, { token, version: toolVersion });
      return;
    }
    const reportPath = /^\/reports\/([\da-f-]{36})\/(html|json)$/.exec(url.pathname);
    if (method === 'GET' && reportPath) {
      const record = store.get(reportPath[1]!);
      if (!record) throw new HttpError(404, 'Scan not found.');
      if (!record.hasReport) throw new HttpError(409, 'This scan has no saved report yet.');
      const html = reportPath[2] === 'html';
      const bytes = await readFile(
        path.join(output(record.id), html ? 'index.html' : 'report.json'),
      );
      if (html)
        response.setHeader(
          'Content-Security-Policy',
          "sandbox allow-scripts allow-modals; default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        );
      else
        response.setHeader(
          'Content-Disposition',
          `attachment; filename="localelens-${record.id}.json"`,
        );
      response.writeHead(200, {
        'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      });
      response.end(bytes);
      return;
    }
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
    if (request.headers['x-localelens-token'] !== token)
      throw new HttpError(403, 'Session expired. Refresh the panel.');
    if (url.pathname === '/api/scans') {
      if (method === 'GET') {
        const page = Number(url.searchParams.get('page') ?? '1');
        const status = url.searchParams.get('status') ?? '';
        if (
          !Number.isSafeInteger(page) ||
          page < 1 ||
          page > 100000 ||
          (status &&
            !['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(
              status,
            ))
        )
          throw new HttpError(400, 'Invalid history filter or page.');
        json(
          response,
          200,
          store.list((url.searchParams.get('q') ?? '').slice(0, 500), status, page),
        );
        return;
      }
      if (method === 'POST') {
        json(response, 202, enqueue(await body(request)));
        return;
      }
    }
    const match = /^\/api\/scans\/([\da-f-]{36})(?:\/(rerun|cancel))?$/.exec(url.pathname);
    if (match) {
      const id = match[1]!;
      const record = store.get(id);
      if (!record) throw new HttpError(404, 'Scan not found.');
      if (method === 'GET' && !match[2]) {
        json(response, 200, record);
        return;
      }
      if (method === 'POST' && match[2]) {
        await body(request);
        if (match[2] === 'rerun') {
          json(response, 202, enqueue({ ...record.settings, label: record.label }));
          return;
        }
        if (!active(record)) throw new HttpError(409, 'This scan is already finished.');
        if (running?.id === id) {
          running.controller.abort();
          await running.task;
        } else {
          store.recordStage(id, 'cancelled', 'Cancelled while waiting in the queue.');
          store.update(id, {
            status: 'cancelled',
            error: 'Scan cancelled.',
            finishedAt: new Date().toISOString(),
          });
        }
        json(response, 200, store.get(id));
        return;
      }
      if (method === 'DELETE' && !match[2]) {
        await body(request);
        if (active(record)) throw new HttpError(409, 'Cancel the scan before deleting it.');
        await rm(output(id), { recursive: true, force: true });
        store.delete(id);
        response.writeHead(204);
        response.end();
        return;
      }
    }
    throw new HttpError(404, 'Not found.');
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      json(response, status, {
        error:
          error instanceof HttpError
            ? error.message
            : 'Could not complete the request. Check the panel terminal.',
      });
      if (status === 500) console.error(error);
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    store.close();
    await release();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No panel address.');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    dataDir,
    async close() {
      if (closing) return;
      closing = true;
      const stopped = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      running?.controller.abort();
      await running?.task;
      for (const id of queue)
        if (store.get(id)?.status === 'queued') {
          store.recordStage(id, 'interrupted', 'Panel closed before this scan started.');
          store.update(id, {
            status: 'interrupted',
            error: 'Panel closed before this scan started.',
            finishedAt: new Date().toISOString(),
          });
        }
      await stopped;
      store.close();
      await release();
    },
  };
}

export function openPanel(url: string): void {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'rundll32.exe'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => console.error(`Open ${url} in your browser.`));
  child.unref();
}
