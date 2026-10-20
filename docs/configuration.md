# Configuration

LocaleLens reads `localelens.config.json` from the current directory, or an explicit `--config <file>`. Configuration files contain JSON only; no JavaScript configuration is executed. CLI options override file values. Paths in a file resolve relative to that file; CLI paths resolve relative to the current directory. Unknown keys and invalid values fail explicitly.

The browser always runs a baseline first for each route/viewport pair, even when `modes` lists only stress modes. Every scenario gets a fresh context so one scan does not inherit mutations from another.

## Settings

| JSON key         | CLI flag                                    | Default / range                                            |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------- |
| `url`            | positional URL                              | Required, HTTP(S), no embedded credentials                 |
| `routes`         | `--routes /,/pricing`                       | Path/query/hash from target URL; max 100 same-origin paths |
| `modes`          | `--modes expanded,rtl`                      | `baseline,expanded,rtl`; baseline always added             |
| `viewports`      | `--viewports desktop,mobile`                | Desktop and mobile; max 10 unique names                    |
| `expansion`      | `--expansion 40`                            | 40; integer 10–200 percent                                 |
| `locale`         | `--locale de-DE`                            | `en-US`; browser locale and Accept-Language                |
| `timeout`        | `--timeout 30000`                           | 30,000ms per scenario; 1,000–120,000                       |
| `settle`         | `--settle 300`                              | 300ms after DOM ready; 0–10,000                            |
| `concurrency`    | `--concurrency 2`                           | 2 route/viewport groups; 1–8                               |
| `output`         | `--output ./report`                         | `localelens-report`                                        |
| `failOn`         | `--fail-on warning`                         | `error`; `error`, `warning`, `none`                        |
| `checks`         | `--checks horizontal-overflow,clipped-text` | All three checks                                           |
| `ignore`         | repeat `--ignore '.selector'`               | No selectors                                               |
| `mask`           | repeat `--mask '.selector'`                 | No selectors                                               |
| `screenshots`    | `--no-screenshots`                          | `true`                                                     |
| `maxFindings`    | `--max-findings 100`                        | 100 layout findings per scenario; 1–1,000                  |
| `waitFor`        | `--wait-for main`                           | Optional visible readiness selector                        |
| `storageState`   | `--storage-state auth.json`                 | Optional Playwright state file                             |
| `executablePath` | `--executable-path /path/to/chromium`       | Bundled Chromium installation                              |

Presets: desktop **1440×1000**, mobile **390×844**, tablet **768×1024**. These are viewport dimensions; mobile mode does not emulate a particular device, touchscreen, or mobile user agent.

## Custom viewports

```json
{
  "url": "http://localhost:3000",
  "viewports": ["desktop", { "name": "small-phone", "width": 320, "height": 640 }]
}
```

Custom widths must be 240–3840 and heights 240–2160. Names use letters, numbers, `_`, or `-` and must be unique.

## Modes

- `baseline`: original page content and direction.
- `expanded`: accents Latin vowels and distributes `~` padding across text words, targeting the configured percentage increase in visible text-node length. Whitespace is preserved. This simulates text growth rather than producing a real language. Fonts and glyph widths mean visual expansion will differ from character expansion.
- `rtl`: sets the document and body `dir` to `rtl`. It does not translate text or override every component-level direction.
- `expanded-rtl`: both transformations together.

Scripts, code, preformatted text, SVG/math content, editable regions, and ignored elements are not expanded. Input placeholders are expanded where eligible; form values are not changed. Attributes such as ARIA labels, image text, and canvas content are not translated or expanded.

## Ready state and dynamic applications

The scanner waits for `DOMContentLoaded`, the optional visible `waitFor` selector, the `settle` delay, and font readiness (at most five seconds, within the scenario budget). It does not wait for network idle: analytics and long-lived requests should not make scans hang. Lazy-loaded content outside the viewport may not be loaded.

Use a meaningful selector after application hydration:

```sh
node dist/cli.js scan http://localhost:3000 --wait-for '[data-app-ready]' --settle 700
```

Text transformation occurs after readiness. Later framework rerenders may replace transformed text; use a stable test route or increase `settle` when needed.

## Authentication

Create a state file with your own Playwright login setup, then pass it to LocaleLens. Follow [Playwright's authentication guidance](https://playwright.dev/docs/auth) for generating a storage state. Use a test account with the minimum access needed.

```sh
node dist/cli.js scan https://staging.example.com \
  --storage-state playwright/.auth/test-user.json \
  --wait-for '[data-dashboard-ready]'
```

Cookies/local storage are used only by the browser context. Session-storage authentication is not supported through a standard state file. Never commit authentication files. Cross-origin redirects produce a scan failure; target the actual application origin explicitly.

## Structured output

```sh
node dist/cli.js scan http://localhost:3000 --json > results.json
```

Stdout contains the report JSON; progress and errors go to stderr. `report.json` is also saved in the output folder. Reports use `schemaVersion: 1`, include a summary and scenarios, and contain findings with stable per-rule/selector IDs. Each scenario has a mode, viewport, route, status, notes, elapsed time, and optional screenshot path. `introduced` compares the rule/selector signature to the baseline, not severity or pixel differences.

An interrupted scan exits 130 and does not replace the previous HTML/JSON report. Complete files are written atomically. A fresh screenshot directory is created per run so old artifacts remain available. HTML and JSON are separate files; this is not a database transaction. Do not read them mid-write if your integration requires a matching pair.

The CLI locks its output directory. After a hard process kill, inspect `.localelens.lock` and remove it only after confirming the recorded process is no longer running. Old screenshot folders are retained intentionally; remove old output directories when you no longer need them.

## Browser installation

Use `npm run browser:install` after updating Playwright. For an environment with restricted cache access, Playwright supports a custom browser directory:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" npm run browser:install
PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright" node dist/cli.js scan http://localhost:3000
```

Set the same environment variable when running tests. Linux CI may need `npx playwright install --with-deps chromium`. A custom executable is supported, but the Playwright-matched browser is recommended.
