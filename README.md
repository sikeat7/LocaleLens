<p align="center">
  <img src="docs/assets/localelens-logo.png" alt="LocaleLens logo" width="128" height="128" />
</p>

# LocaleLens

**Catch broken layouts before translating your app.**

LocaleLens stress-tests a website with longer text and right-to-left layouts, then shows you what broke. It runs on your computer and produces a self-contained HTML report. No domain, hosted backend, account, telemetry, or AI API key required.

Created and maintained by [@sikeat7](https://github.com/sikeat7). [Sponsor this project](#sponsor).

[Download the PNG logo](docs/assets/localelens-logo.png) · [Brand assets](docs/branding.md)

![LocaleLens offline report](docs/report-preview.png)

## What it checks

- **Horizontal overflow:** elements that extend beyond the viewport.
- **Likely text clipping:** text cut off by fixed-size containers.
- **JavaScript exceptions:** uncaught page errors encountered during the scan.
- **Introduced vs. existing issues:** compare each stress scenario with the same route and viewport in its original layout.

Try normal, expanded-text, RTL, and combined expanded + RTL modes. Desktop, mobile, tablet, and custom viewport sizes are supported. Screenshots include numbered findings; reports include selectors, text snippets, and suggested fixes.

**This is a layout stress test, not a translation service.** It does not establish linguistic correctness, complete RTL support, accessibility compliance, or the absence of layout bugs. See [limitations](docs/limitations.md).

## Run from source

Requires **Node.js 22 or later** and an application URL to inspect.

```sh
npm ci
npm run build
npm run browser:install
node dist/cli.js scan http://localhost:3000
```

Open `localelens-report/index.html` in your browser. The HTML embeds its screenshots and works offline; you can share that single file. Structured results are saved in `localelens-report/report.json`.

To install the command locally after building:

```sh
npm link
localelens scan http://localhost:3000
```

This repository is prepared for npm packaging. Registry installation instructions will be added after the first public release; the source instructions above work without a published package.

## See it catch a bug

Start the included fictional travel website:

```sh
npm run demo
```

In another terminal:

```sh
node dist/cli.js scan http://127.0.0.1:4173 \
  --routes /,/healthy \
  --modes baseline,expanded,rtl,expanded-rtl \
  --fail-on warning
```

The `/` page deliberately uses fragile fixed-width labels and a physical left offset. `/healthy` uses a more flexible layout. A nonzero exit code is expected when scanning the broken version.

## Make it fit your app

```sh
node dist/cli.js init
```

Edit `localelens.config.json`:

```json
{
  "url": "http://localhost:3000",
  "routes": ["/", "/pricing"],
  "modes": ["baseline", "expanded", "rtl", "expanded-rtl"],
  "viewports": ["desktop", "mobile"],
  "expansion": 40,
  "waitFor": "main",
  "ignore": [".carousel"],
  "mask": [".customer-email"],
  "output": "localelens-report",
  "failOn": "warning"
}
```

```sh
node dist/cli.js scan
```

Use `data-localelens-ignore` on an intentionally unusual layout region, or pass `--ignore '.selector'`. Ignored regions are still visible in screenshots; use `--mask` for sensitive content. Masks exclude matching subtrees from text snippets and cover them in screenshots. Masks do not sanitize URLs or application exception messages.

For authentication, readiness settings, custom viewports, JSON output, and all options, see the [configuration guide](docs/configuration.md). A [JSON Schema](localelens.schema.json) is included for editor completion.

## Use it in CI

```sh
npx playwright install --with-deps chromium
node dist/cli.js scan http://127.0.0.1:3000 --fail-on warning
```

Start your application and wait until it is ready before scanning. Preserve the report as a CI artifact even if checks fail. See the [GitHub Actions example](docs/ci.md).

| Exit code | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `0`       | No findings at the configured failure threshold                    |
| `1`       | Findings meet the threshold, or the finding limit was exceeded     |
| `2`       | Invalid configuration, browser failure, failed scan, or HTTP error |
| `130`     | Interrupted                                                        |

Default `--fail-on error` fails on overflow. Use `--fail-on warning` to also fail on clipping and JavaScript exceptions. `--fail-on none` allows findings but still fails when a page could not be scanned.

## Privacy and repeatability

LocaleLens has no telemetry or external analysis service. The inspected website still makes its normal network requests; scanning is **not** network isolation. Reports may contain page content, URLs, exception messages, and screenshots. Review them before sharing.

Each scenario uses a fresh browser context. Motion is disabled, fonts are awaited within the time budget, and screenshot size is bounded. Run comparisons on the same OS and browser build for consistent rendering. Authentication files are not embedded in reports and should never be committed.

## Development

```sh
npm ci
npm run browser:install
npm run check
npm pack --dry-run
```

The tests launch real Chromium against local fixtures. They cover clean and broken layouts, baseline comparisons, masks and ignores, offline report interactions, authentication, errors, cancellation, and CLI exit codes.

In restricted desktop environments, `npm run test:unit` runs checks that do not launch a browser. `npm run test:browser-ui` starts supplementary DOM checks at `http://127.0.0.1:4174`; open that page and click **Run browser checks**. This supplements the full Chromium integration suite and does not replace it. See the [initial verification record](docs/verification.md) for the checks completed during this build.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the [release guide](docs/releasing.md). LocaleLens is available under the [MIT license](LICENSE).

## Sponsor

If LocaleLens saves you time, consider supporting its ongoing maintenance and development.

[**Sponsor @sikeat7 on GitHub**](https://github.com/sponsors/sikeat7)

You can also support the project by starring the repository, reporting reproducible bugs, sharing LocaleLens, or contributing improvements.
