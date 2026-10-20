import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Check, Config, FailOn, Mode, Viewport } from './types.js';

export const MODES: Mode[] = ['baseline', 'expanded', 'rtl', 'expanded-rtl'];
export const CHECKS: Check[] = ['horizontal-overflow', 'clipped-text', 'page-error'];
export const VIEWPORTS: Record<string, Viewport> = {
  desktop: { name: 'desktop', width: 1440, height: 1000 },
  mobile: { name: 'mobile', width: 390, height: 844 },
  tablet: { name: 'tablet', width: 768, height: 1024 },
};

export function httpUrl(value: string, name = 'url'): URL {
  let url: URL;
  const input = value.trim();
  if (!input || /^[/?#]/.test(input) || /[\\\u0000-\u001f\u007f]/.test(input))
    throw new Error(`${name} must be a domain or a complete HTTP(S) URL.`);
  const explicit = /^https?:\/\//i.test(input);
  const authority = input.split(/[/?#]/)[0]!;
  const hostWithPort = /^(?:[a-z\d.-]+|\[[a-f\d:]+\]):\d+$/i.test(authority);
  if (!explicit && /^[a-z][a-z\d+.-]*:/i.test(input) && !hostWithPort)
    throw new Error(`${name} must use http: or https:.`);
  const local = /^(?:localhost\.?|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input);
  try {
    url = new URL(explicit ? input : `${local ? 'http' : 'https'}://${input}`);
  } catch {
    throw new Error(
      `${name} must be a valid domain or HTTP(S) URL, e.g. design.google or localhost:3000.`,
    );
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http: or https:.`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials. Use storageState for authentication.`);
  }
  if (!explicit && !local && !url.hostname.includes('.'))
    throw new Error(
      `${name} must be a domain. Include http:// or https:// for a single-label internal host.`,
    );
  return url;
}

export function allowedScanOrigin(target: string, landed: string): boolean {
  const from = httpUrl(target);
  const to = httpUrl(landed);
  if (from.origin === to.origin) return true;
  if (from.protocol === 'https:' && to.protocol !== 'https:') return false;
  return (
    from.hostname.replace(/^www\./, '') === to.hostname.replace(/^www\./, '') &&
    from.port === to.port
  );
}

export function routeUrl(base: string, route: string): string {
  const root = httpUrl(base);
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) {
    throw new Error(
      `Route ${JSON.stringify(route)} must start with a single / and stay on the target origin.`,
    );
  }
  const url = new URL(route, root);
  if (url.origin !== root.origin) throw new Error('Routes must stay on the target origin.');
  return url.href;
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} must be a nonempty string.`);
  return value;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function list(value: unknown, name: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${name} must be ${allowEmpty ? 'an' : 'a nonempty'} array of strings.`);
  }
  return [...new Set(value.map((item: unknown) => string(item, name)))];
}

function choices<T extends string>(value: unknown, name: string, options: readonly T[]): T[] {
  return list(value, name).map((item) => {
    if (!options.includes(item as T))
      throw new Error(`${name} must contain only: ${options.join(', ')}.`);
    return item as T;
  });
}

const fields = new Set([
  '$schema',
  'url',
  'routes',
  'modes',
  'viewports',
  'expansion',
  'locale',
  'timeout',
  'settle',
  'concurrency',
  'output',
  'failOn',
  'ignore',
  'mask',
  'checks',
  'screenshots',
  'maxFindings',
  'waitFor',
  'storageState',
  'executablePath',
]);

export function validateConfig(input: unknown, cwd = process.cwd()): Config {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Config must be a JSON object.');
  const raw = input as Record<string, unknown>;
  for (const field of Object.keys(raw)) {
    if (!fields.has(field))
      throw new Error(`Unknown config field: ${field}. Check for a spelling mistake.`);
  }
  const url = httpUrl(string(raw.url, 'url')).href;
  const parsed = new URL(url);
  const routes = list(raw.routes ?? [`${parsed.pathname}${parsed.search}${parsed.hash}`], 'routes');
  if (routes.length > 100) throw new Error('routes supports at most 100 pages per scan.');
  routes.forEach((route) => routeUrl(url, route));
  const modes = choices(raw.modes ?? ['baseline', 'expanded', 'rtl'], 'modes', MODES);
  const withBaseline: Mode[] = ['baseline', ...modes.filter((mode) => mode !== 'baseline')];
  const viewportInputs: unknown = raw.viewports ?? ['desktop', 'mobile'];
  if (!Array.isArray(viewportInputs) || !viewportInputs.length || viewportInputs.length > 10) {
    throw new Error('viewports must contain 1–10 presets or {name, width, height} objects.');
  }
  const viewports = viewportInputs.map((value: unknown): Viewport => {
    if (typeof value === 'string') {
      if (!VIEWPORTS[value])
        throw new Error(`Unknown viewport ${value}. Use desktop, mobile, or tablet.`);
      return { ...VIEWPORTS[value] };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid viewport.');
    const vp = value as Record<string, unknown>;
    for (const key of Object.keys(vp)) {
      if (!['name', 'width', 'height'].includes(key))
        throw new Error(`Unknown viewport field: ${key}.`);
    }
    const name = string(vp.name, 'viewport.name');
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name))
      throw new Error('Viewport names must use 1–40 letters, numbers, _ or -.');
    return {
      name,
      width: integer(vp.width, 'viewport.width', 240, 3840),
      height: integer(vp.height, 'viewport.height', 240, 2160),
    };
  });
  if (new Set(viewports.map((vp) => vp.name)).size !== viewports.length)
    throw new Error('Viewport names must be unique.');
  const locale = string(raw.locale ?? 'en-US', 'locale');
  try {
    new Intl.Locale(locale);
  } catch {
    throw new Error('locale must be a valid language tag, e.g. en-US or ar.');
  }
  const failOn = string(raw.failOn ?? 'error', 'failOn') as FailOn;
  if (!['error', 'warning', 'none'].includes(failOn))
    throw new Error('failOn must be error, warning, or none.');
  if (raw.screenshots !== undefined && typeof raw.screenshots !== 'boolean')
    throw new Error('screenshots must be a boolean.');
  const config: Config = {
    url,
    routes,
    modes: withBaseline,
    viewports,
    locale,
    failOn,
    expansion: integer(raw.expansion ?? 40, 'expansion', 10, 200),
    timeout: integer(raw.timeout ?? 30000, 'timeout', 1000, 120000),
    settle: integer(raw.settle ?? 300, 'settle', 0, 10000),
    concurrency: integer(raw.concurrency ?? 2, 'concurrency', 1, 8),
    output: path.resolve(cwd, string(raw.output ?? 'localelens-report', 'output')),
    ignore: list(raw.ignore ?? [], 'ignore', true),
    mask: list(raw.mask ?? [], 'mask', true),
    checks: choices(raw.checks ?? CHECKS, 'checks', CHECKS),
    screenshots: (raw.screenshots as boolean | undefined) ?? true,
    maxFindings: integer(raw.maxFindings ?? 100, 'maxFindings', 1, 1000),
  };
  if (raw.waitFor !== undefined) config.waitFor = string(raw.waitFor, 'waitFor');
  for (const field of ['storageState', 'executablePath'] as const) {
    if (raw[field] !== undefined) config[field] = path.resolve(cwd, string(raw[field], field));
  }
  return config;
}

export async function loadConfig(
  overrides: Record<string, unknown>,
  configFile?: string,
  cwd = process.cwd(),
): Promise<Config> {
  const file = path.resolve(cwd, configFile ?? 'localelens.config.json');
  let data: unknown = {};
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT' && !configFile)) {
      throw new Error(
        `Cannot read config ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Config must be a JSON object.');
  // Paths in files are relative to that file. CLI paths are relative to the invoking directory.
  const fromFile = { ...(data as Record<string, unknown>) };
  for (const key of ['output', 'storageState', 'executablePath'] as const) {
    if (typeof fromFile[key] === 'string')
      fromFile[key] = path.resolve(path.dirname(file), fromFile[key]);
  }
  return validateConfig({ ...fromFile, ...overrides }, cwd);
}
