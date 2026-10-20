import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { startPanel } from '../dist/panel.js';
import { PanelStore } from '../dist/panel-store.js';
import { validateConfig } from '../dist/config.js';

function report(config) {
  return {
    schemaVersion: 1,
    tool: { name: 'LocaleLens', version: '0.1.0' },
    startedAt: new Date().toISOString(),
    durationMs: 1,
    target: config.url,
    config: {
      routes: config.routes,
      modes: config.modes,
      viewports: config.viewports,
      expansion: config.expansion,
      locale: config.locale,
      checks: config.checks,
      failOn: config.failOn,
    },
    summary: {
      scenarios: 1,
      passed: 1,
      failed: 0,
      errors: 0,
      warnings: 0,
      introduced: 0,
      omitted: 0,
    },
    scenarios: [
      {
        id: 'fixture',
        route: '/',
        viewport: config.viewports[0],
        mode: 'baseline',
        url: config.url,
        status: 'passed',
        durationMs: 1,
        transformedNodes: 0,
        findings: [],
        omittedFindings: 0,
        notes: ['Deterministic API test executor, not a browser scan.'],
      },
    ],
  };
}
const input = { url: 'https://example.com/', modes: ['baseline'], viewports: ['desktop'] };
async function fixture(t, executor = async (config) => report(config)) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'localelens-panel-'));
  let app = await startPanel({ port: 0, dataDir, executor });
  let token = (await (await fetch(`${app.url}/api/session`)).json()).token;
  const request = (route, method = 'GET', payload, extraHeaders = {}) =>
    fetch(`${app.url}${route}`, {
      method,
      headers: {
        'X-LocaleLens-Token': token,
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      ...(method !== 'GET'
        ? { body: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}) }
        : {}),
    });
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    dataDir,
    request,
    get app() {
      return app;
    },
    async restart() {
      await app.close();
      app = await startPanel({ port: 0, dataDir, executor });
      token = (await (await fetch(`${app.url}/api/session`)).json()).token;
    },
  };
}
async function waitFor(request, id, status) {
  for (let i = 0; i < 100; i++) {
    const scan = await (await request(`/api/scans/${id}`)).json();
    if (scan.status === status) return scan;
    await delay(20);
  }
  assert.fail(`Scan did not reach ${status}`);
}

test('panel stores scans in SQLite, serves isolated reports, and preserves history across restart', async (t) => {
  const f = await fixture(t, async (config, hooks) => {
    const result = report(config);
    hooks.onProgress(1, 1, result.scenarios[0]);
    return result;
  });
  const home = await fetch(f.app.url);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Make room for every language/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  for (const asset of ['/app.js', '/style.css', '/logo.png'])
    assert.equal((await fetch(`${f.app.url}${asset}`)).status, 200);
  const response = await f.request('/api/scans', 'POST', {
    ...input,
    label: '<img src=x onerror=alert(1)>',
  });
  assert.equal(response.status, 202);
  const { id } = await response.json();
  const saved = await waitFor(f.request, id, 'completed');
  assert.equal(saved.hasReport, true);
  assert.equal(saved.completed, 1);
  assert.deepEqual(
    saved.pipeline.map((event) => event.stage),
    ['queued', 'preparing', 'scanning', 'reporting', 'finished'],
  );
  assert.ok(saved.pipeline.every((event) => Number.isFinite(Date.parse(event.at))));
  const html = await fetch(`${f.app.url}/reports/${id}/html`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.doesNotMatch(html.headers.get('content-security-policy'), /allow-same-origin/);
  const json = await fetch(`${f.app.url}/reports/${id}/json`);
  assert.match(json.headers.get('content-disposition'), /attachment/);
  assert.equal((await json.json()).target, input.url);
  assert.equal(
    (await readFile(path.join(f.dataDir, 'history.sqlite'))).subarray(0, 15).toString(),
    'SQLite format 3',
  );
  await f.restart();
  const history = await (await f.request('/api/scans?q=example')).json();
  assert.equal(history.total, 1);
  assert.equal(history.scans[0].id, id);
  assert.deepEqual(history.scans[0].pipeline, saved.pipeline);
  assert.equal(history.scans[0].label, '<img src=x onerror=alert(1)>');
  const rerun = await f.request(`/api/scans/${id}/rerun`, 'POST');
  assert.equal(rerun.status, 202);
  const again = await rerun.json();
  assert.notEqual(again.id, id);
  await waitFor(f.request, again.id, 'completed');
  assert.equal((await (await f.request('/api/scans')).json()).total, 2);
  assert.equal((await f.request(`/api/scans/${id}`, 'DELETE')).status, 204);
  assert.equal((await f.request(`/api/scans/${id}`)).status, 404);
  await assert.rejects(stat(path.join(f.dataDir, 'reports', id)), { code: 'ENOENT' });
});

test('API rejects cross-origin, invalid Host, missing tokens, unsafe settings, and oversized bodies', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.app.url}/api/scans`)).status, 403);
  assert.equal(
    (await fetch(`${f.app.url}/api/session`, { headers: { Origin: 'https://outside.example' } }))
      .status,
    403,
  );
  const invalidHost = await new Promise((resolve, reject) => {
    const request = httpRequest(
      `${f.app.url}/api/session`,
      { headers: { Host: 'outside.example' } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(invalidHost, 403);
  assert.equal(
    (await fetch(`${f.app.url}/api/session`, { headers: { 'Sec-Fetch-Site': 'cross-site' } }))
      .status,
    403,
  );
  for (const bad of [
    null,
    [],
    { url: 'file:///etc/passwd' },
    { ...input, output: '/tmp/wrong' },
    { ...input, storageState: 'auth.json' },
    { ...input, executablePath: '/bin/sh' },
    { ...input, routes: ['//outside.example'] },
    { ...input, viewports: [] },
    { ...input, label: 'x'.repeat(121) },
  ]) {
    assert.equal((await f.request('/api/scans', 'POST', bad)).status, 400);
  }
  assert.equal((await f.request('/api/scans', 'POST', '{invalid')).status, 400);
  assert.equal(
    (await f.request('/api/scans', 'POST', input, { 'Content-Type': 'text/plain' })).status,
    400,
  );
  assert.equal((await f.request('/api/scans', 'POST', 'x'.repeat(65537))).status, 413);
  assert.equal((await f.request('/api/scans?page=-1')).status, 400);
  assert.equal((await f.request('/api/scans?status=anything')).status, 400);
  assert.equal((await f.request('/api/scans?page=9007199254740992')).status, 400);
  assert.equal((await fetch(`${f.app.url}/reports/../../history.sqlite`)).status, 404);
});

test('queue is sequential, bounded, cancellable, and active scans cannot be deleted', async (t) => {
  const started = [];
  const f = await fixture(t, async (config, hooks) => {
    started.push(config.url);
    await delay(30000, undefined, { signal: hooks.signal });
    return report(config);
  });
  const first = await (await f.request('/api/scans', 'POST', input)).json();
  const second = await (
    await f.request('/api/scans', 'POST', { ...input, url: 'https://second.example/' })
  ).json();
  assert.equal(first.status, 'running');
  assert.equal(second.status, 'queued');
  assert.equal(started.length, 1);
  const filtered = await (await f.request('/api/scans?q=unmatched&status=completed&page=2')).json();
  assert.equal(filtered.scans.length, 0);
  assert.deepEqual(
    filtered.activeScans.map((scan) => scan.id),
    [first.id, second.id],
  );
  assert.equal((await f.request(`/api/scans/${first.id}`, 'DELETE')).status, 409);
  assert.equal((await fetch(`${f.app.url}/reports/${first.id}/html`)).status, 409);
  assert.equal((await f.request(`/api/scans/${second.id}/cancel`, 'POST')).status, 200);
  assert.equal((await f.request(`/api/scans/${first.id}/cancel`, 'POST')).status, 200);
  assert.equal(started.length, 1, 'cancelled queued scans must never start');
  const cancelled = await (await f.request(`/api/scans/${second.id}`)).json();
  assert.deepEqual(
    cancelled.pipeline.map((event) => event.stage),
    ['queued', 'cancelled'],
  );
  assert.equal((await f.request(`/api/scans/${first.id}/cancel`, 'POST')).status, 409);
  for (let i = 0; i < 20; i++)
    assert.equal((await f.request('/api/scans', 'POST', input)).status, 202);
  assert.equal((await f.request('/api/scans', 'POST', input)).status, 429);
  const list = await (await f.request('/api/scans')).json();
  assert.equal(list.scans.length, 20);
  assert.equal(list.total, 22);
  assert.equal((await (await f.request('/api/scans?page=2')).json()).scans.length, 2);
  const literal = await (await f.request('/api/scans?q=%25')).json();
  assert.equal(literal.total, 0, 'search wildcards are literal');
  await f.restart();
  const recovered = await (await f.request('/api/scans?status=interrupted')).json();
  assert.equal(recovered.total, 19);
});

test('failed executor and failed scenarios persist actionable errors instead of clean results', async (t) => {
  const f = await fixture(t, async (config) => {
    if (config.url.includes('launch'))
      throw new Error('Could not launch Chromium. Install the browser.');
    const result = report(config);
    result.summary.failed = 1;
    result.summary.passed = 0;
    result.scenarios[0].status = 'failed';
    return result;
  });
  const launch = await (
    await f.request('/api/scans', 'POST', { ...input, url: 'https://launch.example/' })
  ).json();
  const failed = await waitFor(f.request, launch.id, 'failed');
  assert.match(failed.error, /Install the browser/);
  assert.equal(failed.hasReport, false);
  assert.equal(failed.pipeline.at(-1).stage, 'failed');
  assert.equal(
    failed.pipeline.some((event) => event.stage === 'finished'),
    false,
  );
  const page = await (await f.request('/api/scans', 'POST', input)).json();
  const result = await waitFor(f.request, page.id, 'failed');
  assert.equal(result.hasReport, true);
  assert.equal(result.summary.failed, 1);
});

test('unclean restart recovers unfinished records and refuses a second live data-directory owner', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'localelens-recovery-'));
  const store = new PanelStore(path.join(dir, 'history.sqlite'));
  const config = validateConfig(input);
  store.create('a', 'Recovered queue', config);
  store.create('b', 'Recovered run', config);
  store.update('b', { status: 'running' });
  store.close();
  // A stale lock owned by a known nonexistent PID can be reclaimed.
  await writeFile(path.join(dir, 'panel.lock'), '2147483647');
  const panel = await startPanel({ port: 0, dataDir: dir });
  t.after(async () => {
    await panel.close();
    await rm(dir, { recursive: true, force: true });
  });
  await assert.rejects(startPanel({ port: 0, dataDir: dir }), /Another panel owns/);
  const token = (await (await fetch(`${panel.url}/api/session`)).json()).token;
  const result = await (
    await fetch(`${panel.url}/api/scans`, { headers: { 'X-LocaleLens-Token': token } })
  ).json();
  assert.equal(result.total, 2);
  assert.ok(result.scans.every((scan) => scan.status === 'interrupted'));
});

test('pipeline migration keeps legacy history without inventing past stages', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'localelens-pipeline-migration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'history.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE scans (
    id TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL, status TEXT NOT NULL,
    createdAt TEXT NOT NULL, startedAt TEXT, finishedAt TEXT, completed INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL, current TEXT NOT NULL DEFAULT '', error TEXT,
    summary TEXT, settings TEXT NOT NULL, hasReport INTEGER NOT NULL DEFAULT 0
  )`);
  const { output, ...settings } = validateConfig(input);
  db.prepare(
    "INSERT INTO scans (id,label,url,status,createdAt,total,settings) VALUES (?,?,?,'completed',?,1,?)",
  ).run('legacy', 'My saved scan', input.url, new Date().toISOString(), JSON.stringify(settings));
  db.close();
  let store = new PanelStore(file);
  assert.equal(store.get('legacy').label, 'My saved scan');
  assert.deepEqual(store.get('legacy').pipeline, []);
  store.create('new', 'A new scan', validateConfig(input));
  store.recordStage('new', 'preparing', 'Preparing');
  store.recordStage('new', 'preparing', 'Repeated observer update');
  assert.equal(store.get('new').pipeline.length, 2, 'repeated stage updates are deduplicated');
  store.close();
  store = new PanelStore(file);
  assert.deepEqual(store.get('legacy').pipeline, []);
  assert.equal(store.get('new').pipeline.at(-1).stage, 'interrupted');
  store.close();
});

test('pipeline observes active scenarios before completion and records browser and report stages', async (t) => {
  let unblock;
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  t.after(() => unblock());
  const f = await fixture(t, async (config, hooks) => {
    hooks.onStage('launching');
    hooks.onStage('scanning');
    hooks.onScenarioStart('/', config.viewports[0], 'baseline');
    await gate;
    const result = report(config);
    hooks.onProgress(1, 1, result.scenarios[0]);
    return result;
  });
  const created = await (await f.request('/api/scans', 'POST', input)).json();
  const running = await (await f.request(`/api/scans/${created.id}`)).json();
  assert.equal(running.completed, 0);
  assert.equal(running.current, 'desktop · baseline · /');
  assert.deepEqual(
    running.pipeline.map((event) => event.stage),
    ['queued', 'preparing', 'launching', 'scanning'],
  );
  unblock();
  const done = await waitFor(f.request, created.id, 'completed');
  assert.deepEqual(
    done.pipeline.map((event) => event.stage),
    ['queued', 'preparing', 'launching', 'scanning', 'reporting', 'finished'],
  );
  assert.equal(done.current, '');
});

test('panel accepts a bare domain and stores its normalized address and page path', async (t) => {
  const f = await fixture(t);
  const response = await f.request('/api/scans', 'POST', {
    ...input,
    url: 'design.google/components?lang=en#main',
  });
  assert.equal(response.status, 202);
  const saved = await response.json();
  assert.equal(saved.url, 'https://design.google/components?lang=en#main');
  assert.deepEqual(saved.settings.routes, ['/components?lang=en#main']);
  await waitFor(f.request, saved.id, 'completed');
});
