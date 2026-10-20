export type Mode = 'baseline' | 'expanded' | 'rtl' | 'expanded-rtl';
export type Severity = 'error' | 'warning';
export type FailOn = Severity | 'none';
export type Check = 'horizontal-overflow' | 'clipped-text' | 'page-error';

export type PipelineStage =
  | 'queued'
  | 'preparing'
  | 'launching'
  | 'scanning'
  | 'reporting'
  | 'finished'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export interface PipelineEvent {
  stage: PipelineStage;
  at: string;
  detail: string;
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface Config {
  url: string;
  routes: string[];
  modes: Mode[];
  viewports: Viewport[];
  expansion: number;
  locale: string;
  timeout: number;
  settle: number;
  concurrency: number;
  output: string;
  failOn: FailOn;
  ignore: string[];
  mask: string[];
  checks: Check[];
  screenshots: boolean;
  maxFindings: number;
  waitFor?: string;
  storageState?: string;
  executablePath?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Finding {
  id: string;
  code: Check | 'http-error' | 'scan-error' | 'access-blocked';
  severity: Severity;
  message: string;
  suggestion: string;
  selector?: string;
  text?: string;
  rect?: Rect;
  introduced: boolean;
}

export interface Scenario {
  id: string;
  route: string;
  viewport: Viewport;
  mode: Mode;
  url: string;
  status: 'passed' | 'findings' | 'failed';
  durationMs: number;
  transformedNodes: number;
  findings: Finding[];
  omittedFindings: number;
  notes: string[];
  screenshot?: string;
  skipReason?: string;
}

export interface Report {
  schemaVersion: 1;
  tool: { name: 'LocaleLens'; version: string };
  startedAt: string;
  durationMs: number;
  target: string;
  config: Pick<
    Config,
    'routes' | 'modes' | 'viewports' | 'expansion' | 'locale' | 'checks' | 'failOn'
  >;
  summary: {
    scenarios: number;
    passed: number;
    failed: number;
    errors: number;
    warnings: number;
    introduced: number;
    omitted: number;
  };
  scenarios: Scenario[];
}

export interface BrowserOptions {
  mode: Mode;
  expansion: number;
  ignore: string[];
  mask: string[];
  checks: Check[];
  maxFindings: number;
}

export interface Inspection {
  findings: Omit<Finding, 'id' | 'introduced'>[];
  omittedFindings: number;
  notes: string[];
}
