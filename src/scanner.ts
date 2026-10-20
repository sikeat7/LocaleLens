import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { annotatePage, inspectPage, transformPage } from './browser.js';
import { allowedScanOrigin, routeUrl } from './config.js';
import {
  AccessStop,
  isCloudflareChallenge,
  readChallengeSignals,
  skippedForAccess,
} from './access.js';
import { renderReport } from './report.js';
import type { BrowserOptions, Config, Finding, Mode, Report, Scenario, Viewport } from './types.js';

export async function version(): Promise<string> {
  const file = fileURLToPath(new URL('../package.json', import.meta.url));
  return (JSON.parse(await readFile(file, 'utf8')) as { version: string }).version;
}

function findingId(finding: Pick<Finding, 'code' | 'selector'>): string {
  return createHash('sha256')
    .update(`${finding.code}:${finding.selector ?? 'page'}`)
    .digest('hex')
    .slice(0, 12);
}

function failure(
  message: string,
  code: 'scan-error' | 'http-error' | 'access-blocked' = 'scan-error',
): Finding {
  return {
    id: findingId({ code }),
    code,
    severity: 'error',
    message,
    suggestion:
      code === 'access-blocked'
        ? 'Cloudflare verification prevented website inspection. For a site you control, use an approved staging environment or coordinate authorized automated testing with its administrator.'
        : code === 'http-error'
          ? 'Verify the route and authentication state, then rerun the scan.'
          : 'Verify the URL, readiness selector, browser installation, and timeout. Rerun the scan once the page is reachable.',
    introduced: false,
  };
}

function conciseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 1200);
}

export function browserLaunchError(error: unknown): Error {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /\u001b\[[0-9;]*m/g,
    '',
  );
  if (
    /bootstrap_check_in.*Permission denied|MachPortRendezvousServer.*Permission denied/i.test(
      message,
    )
  ) {
    return new Error(
      'Could not launch Chromium. macOS denied browser startup in the restricted execution environment. Close this panel and restart LocaleLens from your normal Terminal or the project launcher. The browser is installed; reinstalling it will not resolve this permission restriction.',
    );
  }
  const lines = message
    .split('\n')
    .filter((line) => line.trim() && !/<launching>|<launched>/.test(line));
  const details = lines.filter((line) =>
    /FATAL|ERROR|Permission denied|error while loading shared libraries|executable doesn't exist/i.test(
      line,
    ),
  );
  return new Error(
    `Could not launch Chromium. Run "npx playwright install chromium" (Linux CI: add --with-deps). ${[lines[0], ...details].filter(Boolean).join('\n').slice(0, 1500)}`,
  );
}

async function captureScenario(
  page: Page,
  config: Config,
  result: Scenario,
  directory: string,
  annotate: boolean,
): Promise<void> {
  if (!config.screenshots) return;
  const size = await page.evaluate(() => ({
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
  }));
  if (size.height > 16000)
    result.notes.push('Screenshot cropped to the first 16,000 vertical pixels.');
  if (annotate) await page.evaluate(annotatePage, result.findings);
  const file = `${result.id}.png`;
  await page.screenshot({
    path: path.join(directory, file),
    fullPage: true,
    clip: {
      x: 0,
      y: 0,
      width: result.viewport.width,
      height: Math.min(Math.max(size.height, result.viewport.height), 16000),
    },
    animations: 'disabled',
    timeout: config.timeout,
    mask: config.mask.map((selector) => page.locator(selector)),
    maskColor: '#253348',
  });
  await chmod(path.join(directory, file), 0o600);
  result.screenshot = `screenshots/${path.basename(directory)}/${file}`;
}

async function inspectScenario(
  browser: Browser,
  config: Config,
  route: string,
  viewport: Viewport,
  mode: Mode,
  id: string,
  screenshotsDirectory: string,
  signal?: AbortSignal,
  onAccessBlocked?: (finding: Finding) => void,
): Promise<Scenario> {
  const started = Date.now();
  const url = routeUrl(config.url, route);
  const result: Scenario = {
    id,
    route,
    viewport,
    mode,
    url,
    status: 'passed',
    durationMs: 0,
    transformedNodes: 0,
    findings: [],
    omittedFindings: 0,
    notes: [],
  };
  let context: BrowserContext | undefined;
  let abort: (() => void) | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    signal?.throwIfAborted();
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: config.locale,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      acceptDownloads: false,
      ...(config.storageState ? { storageState: config.storageState } : {}),
    });
    const activeContext = context;
    deadline = setTimeout(() => {
      timedOut = true;
      void activeContext.close().catch(() => undefined);
    }, config.timeout);
    abort = () => {
      void activeContext.close().catch(() => undefined);
    };
    signal?.addEventListener('abort', abort, { once: true });
    signal?.throwIfAborted();
    context.setDefaultTimeout(config.timeout);
    context.setDefaultNavigationTimeout(config.timeout);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('dialog', (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
    page.on('pageerror', (error) => {
      if (pageErrors.length < 20) pageErrors.push(conciseError(error));
    });
    // Closing popups prevents a scanned page from leaving orphan tabs open.
    context.on('page', (popup) => {
      if (popup !== page) void popup.close().catch(() => undefined);
    });
    signal?.throwIfAborted();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    result.url = page.url();
    if (!allowedScanOrigin(config.url, page.url())) {
      throw new Error(
        'The page redirected to a different origin. Scan that origin explicitly, or provide a valid authentication state.',
      );
    }
    const stopForChallenge = async () => {
      if (
        !isCloudflareChallenge(
          response?.headers()['cf-mitigated'],
          await page.evaluate(readChallengeSignals),
        )
      )
        return false;
      result.status = 'failed';
      result.findings.push(
        failure(
          'Access blocked by Cloudflare security verification. The website layout was not inspected.',
          'access-blocked',
        ),
      );
      result.notes.push(
        'Cloudflare blocked access. This site was skipped immediately: no screenshot, layout inspection, text expansion, or RTL transformation was performed. No retry was made.',
      );
      onAccessBlocked?.(result.findings[0]!);
      return true;
    };
    if (await stopForChallenge()) return result;
    if (response && response.status() >= 400) {
      result.status = 'failed';
      result.findings.push(
        failure(`HTTP ${response.status()} while loading the page.`, 'http-error'),
      );
      result.notes.push(
        'The server returned an error page. Layout inspection and transformations were skipped.',
      );
      await captureScenario(page, config, result, screenshotsDirectory, false);
      return result;
    }
    if (config.waitFor) await page.locator(config.waitFor).first().waitFor({ state: 'visible' });
    await page.waitForTimeout(config.settle);
    if (await stopForChallenge()) return result;
    const fontsReady = await page.evaluate(
      async (timeout) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            document.fonts.ready.then(() => true),
            new Promise<boolean>((resolve) => {
              timer = setTimeout(() => resolve(false), timeout);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
      Math.min(config.timeout, 5000),
    );
    if (!fontsReady) result.notes.push('Fonts were not fully loaded before inspection.');
    const options: BrowserOptions = {
      mode,
      expansion: config.expansion,
      ignore: config.ignore,
      mask: config.mask,
      checks: config.checks,
      maxFindings: config.maxFindings,
    };
    result.transformedNodes = await page.evaluate(transformPage, options);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const inspection = await page.evaluate(inspectPage, options);
    result.omittedFindings = inspection.omittedFindings;
    result.notes.push(...inspection.notes);
    result.findings.push(
      ...inspection.findings.map((item) => ({ ...item, id: findingId(item), introduced: false })),
    );
    if (config.checks.includes('page-error')) {
      for (const [index, message] of pageErrors.entries()) {
        result.findings.push({
          id: `page-error-${index}`,
          code: 'page-error',
          severity: 'warning',
          message,
          suggestion: 'Inspect the application’s JavaScript errors in browser developer tools.',
          introduced: false,
        });
      }
    }
    await captureScenario(page, config, result, screenshotsDirectory, true);
    result.status = result.findings.length ? 'findings' : 'passed';
  } catch (error) {
    result.status = 'failed';
    result.findings.push(
      failure(
        signal?.aborted
          ? 'Scan cancelled.'
          : timedOut
            ? `Scenario exceeded its ${config.timeout}ms time budget.`
            : conciseError(error),
      ),
    );
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    if (deadline) clearTimeout(deadline);
    await context?.close().catch(() => undefined);
    result.durationMs = Date.now() - started;
  }
  return result;
}

export interface ScanHooks {
  signal?: AbortSignal;
  onStage?: (stage: 'preparing' | 'launching' | 'scanning') => void;
  onScenarioStart?: (route: string, viewport: Viewport, mode: Mode) => void;
  onProgress?: (completed: number, total: number, scenario: Scenario) => void;
}

export async function scan(config: Config, hooks: ScanHooks = {}): Promise<Report> {
  hooks.onStage?.('preparing');
  const started = Date.now();
  const scanId = `${new Date(started).toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  // Always use a fresh scan directory. Rerunning never deletes prior screenshots or unrelated files.
  const screenshotsDirectory = path.join(config.output, 'screenshots', scanId);
  await mkdir(screenshotsDirectory, { recursive: true, mode: 0o700 });
  if (config.storageState) {
    try {
      await readFile(config.storageState);
    } catch {
      throw new Error(
        'Cannot read storageState. Supply a readable Playwright storage-state JSON file.',
      );
    }
  }
  hooks.signal?.throwIfAborted();
  let browser: Browser;
  hooks.onStage?.('launching');
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: config.timeout,
      ...(config.executablePath ? { executablePath: config.executablePath } : {}),
    });
  } catch (error) {
    throw browserLaunchError(error);
  }
  const tasks = config.routes.flatMap((route) =>
    config.viewports.map((viewport) => ({ route, viewport })),
  );
  const groups: Scenario[][] = Array.from({ length: tasks.length }, () => []);
  const total = tasks.length * config.modes.length;
  let next = 0;
  let completed = 0;
  const accessStop = new AccessStop();
  const scanSignal = hooks.signal
    ? AbortSignal.any([hooks.signal, accessStop.signal])
    : accessStop.signal;
  try {
    hooks.onStage?.('scanning');
    const worker = async () => {
      while (next < tasks.length) {
        const index = next++;
        const task = tasks[index];
        if (!task) return;
        const baselineIds = new Set<string>();
        let baselineFailed = false;
        for (const [modeIndex, mode] of config.modes.entries()) {
          hooks.signal?.throwIfAborted();
          const descriptor = {
            id: `page-${index + 1}-${modeIndex + 1}-${mode}`,
            route: task.route,
            viewport: task.viewport,
            mode,
            url: routeUrl(config.url, task.route),
          };
          let scenario: Scenario;
          if (accessStop.finding) {
            scenario = skippedForAccess(descriptor, accessStop.finding, false);
          } else {
            hooks.onScenarioStart?.(task.route, task.viewport, mode);
            scenario = await inspectScenario(
              browser,
              config,
              task.route,
              task.viewport,
              mode,
              descriptor.id,
              screenshotsDirectory,
              scanSignal,
              (finding) => accessStop.stop(finding),
            );
            if (
              accessStop.finding &&
              !scenario.findings.some((finding) => finding.code === 'access-blocked')
            )
              scenario = skippedForAccess(descriptor, accessStop.finding, true);
          }
          if (mode === 'baseline') {
            baselineFailed = scenario.status === 'failed';
            scenario.findings.forEach((finding) => baselineIds.add(finding.id));
          } else if (baselineFailed) {
            scenario.notes.push(
              'Baseline failed; introduced/existing comparisons are unavailable.',
            );
          } else {
            scenario.findings.forEach((finding) => {
              finding.introduced =
                !baselineIds.has(finding.id) &&
                finding.code !== 'scan-error' &&
                finding.code !== 'access-blocked' &&
                finding.code !== 'http-error';
            });
          }
          groups[index]?.push(scenario);
          completed++;
          hooks.onProgress?.(completed, total, scenario);
          if (hooks.signal?.aborted) throw new Error('Scan cancelled.');
        }
      }
    };
    // Settle all workers before closing the browser on cancellation or an observer error.
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(config.concurrency, tasks.length) }, worker),
    );
    const rejected = workers.find((result) => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
  } finally {
    await browser.close();
  }
  const scenarios = groups.flat();
  const findings = scenarios.flatMap((scenario) => scenario.findings);
  return {
    schemaVersion: 1,
    tool: { name: 'LocaleLens', version: await version() },
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
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
      scenarios: scenarios.length,
      passed: scenarios.filter((item) => item.status === 'passed').length,
      failed: scenarios.filter((item) => item.status === 'failed').length,
      errors: findings.filter((item) => item.severity === 'error').length,
      warnings: findings.filter((item) => item.severity === 'warning').length,
      introduced: findings.filter((item) => item.introduced).length,
      omitted: scenarios.reduce((sum, item) => sum + item.omittedFindings, 0),
    },
    scenarios,
  };
}

export function exitCode(report: Report): number {
  if (
    report.summary.failed ||
    report.scenarios.some((item) =>
      item.findings.some((finding) => ['http-error', 'access-blocked'].includes(finding.code)),
    )
  )
    return 2;
  if (report.config.failOn === 'none') return 0;
  if (report.summary.errors || (report.config.failOn === 'warning' && report.summary.warnings))
    return 1;
  // A truncated scan cannot establish a clean run for CI.
  return report.summary.omitted ? 1 : 0;
}

export async function writeReport(report: Report, output: string): Promise<void> {
  await mkdir(output, { recursive: true });
  const images: Record<string, string> = {};
  let embeddedBytes = 0;
  for (const scenario of report.scenarios) {
    if (!scenario.screenshot) continue;
    const imagePath = path.resolve(output, scenario.screenshot);
    if (!imagePath.startsWith(`${path.resolve(output)}${path.sep}`))
      throw new Error('Invalid screenshot path.');
    embeddedBytes += (await stat(imagePath)).size;
    if (embeddedBytes > 50 * 1024 * 1024) {
      throw new Error(
        'Screenshots exceed the 50 MiB embedded-report limit. Scan fewer routes or use --no-screenshots. Captured PNGs have been retained.',
      );
    }
    images[scenario.screenshot] =
      `data:image/png;base64,${(await readFile(imagePath)).toString('base64')}`;
  }
  // Publish complete files atomically; an interrupted write never leaves partial JSON or HTML.
  for (const [file, contents] of [
    ['report.json', `${JSON.stringify(report, null, 2)}\n`],
    ['index.html', renderReport(report, images)],
  ]) {
    if (!file || !contents) continue;
    const destination = path.join(output, file);
    const temp = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temp, contents, { mode: 0o600 });
    await rename(temp, destination);
  }
}
