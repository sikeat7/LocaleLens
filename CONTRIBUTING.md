# Contributing

Useful bug reports, minimal reproductions, documentation fixes, and focused pull requests are welcome.

## Setup

```sh
npm ci
npm run browser:install
npm run check
```

Requires Node.js 22 or later. If Chromium's default cache is unavailable, use the custom-cache instructions in [configuration](docs/configuration.md). Browser process launch must be allowed by your execution environment.

## Project structure

- `src/cli.ts`: command parsing, output lock, cancellation, and exit codes.
- `src/config.ts`: strict configuration validation and path resolution.
- `src/browser.ts`: self-contained functions executed in the inspected page.
- `src/scanner.ts`: isolated contexts, scheduling, artifact writing, and summaries.
- `src/report.ts`: escaped offline HTML, report styling, and interactions.
- `tests/`: Node test runner with real local HTTP fixtures and Chromium integration tests.
- `demo/`: intentionally fragile and flexible example layouts.

`src/browser.ts` must stay serializable: runtime helpers cannot depend on imports or closures outside the function. Keep checks conservative and explain known false positives. Add a minimal browser fixture for detection changes and a healthy control that must remain clean.

Before proposing a change, run `npm run format`, `npm run check`, and `npm pack --dry-run`. Do not commit generated reports, authentication states, browser downloads, or local caches. Packaging is explicit through `package.json`'s `files` allowlist.

## Reporting an issue

Include the command, redacted configuration, OS, Node/LocaleLens/Playwright versions, expected behavior, and a small reproducible page. Do not upload production screenshots, private URLs, credentials, or full customer reports. Use the security process below for vulnerabilities.

Keep changes small enough to review. Describe the user-visible problem, the behavior after the change, and the verification performed. Be considerate of other contributors and discuss disagreements through concrete examples.
