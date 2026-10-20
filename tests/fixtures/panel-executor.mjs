import { setTimeout as delay } from 'node:timers/promises';

// Deterministic scan boundary for UI tests. Never visits a website or claims a browser scan.
export async function panelExecutor(config, hooks) {
  hooks.onStage?.('preparing');
  await delay(300, undefined, { signal: hooks.signal });
  hooks.onStage?.('launching');
  await delay(500, undefined, { signal: hooks.signal });
  hooks.onStage?.('scanning');
  const scenarios = [];
  const total = config.routes.length * config.viewports.length * config.modes.length;
  for (const route of config.routes)
    for (const viewport of config.viewports)
      for (const mode of config.modes) {
        hooks.onScenarioStart?.(route, viewport, mode);
        await delay(800, undefined, { signal: hooks.signal });
        const scenario = {
          id: `fixture-${scenarios.length}`,
          route,
          viewport,
          mode,
          url: config.url,
          status: 'passed',
          durationMs: 800,
          transformedNodes: 0,
          findings: [],
          omittedFindings: 0,
          notes: ['UI test fixture only. No website was scanned.'],
        };
        scenarios.push(scenario);
        hooks.onProgress(scenarios.length, total, scenario);
      }
  return {
    schemaVersion: 1,
    tool: { name: 'LocaleLens', version: '0.1.0' },
    startedAt: new Date().toISOString(),
    durationMs: 800 * total,
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
      scenarios: total,
      passed: total,
      failed: 0,
      errors: 0,
      warnings: 0,
      introduced: 0,
      omitted: 0,
    },
    scenarios,
  };
}
