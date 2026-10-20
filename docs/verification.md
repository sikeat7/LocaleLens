# Initial verification record

Date: 20 October 2026. Local environment: macOS arm64, Node.js 22.23.3.

## Completed

- TypeScript strict compilation and type checking.
- 13 Node/CLI unit checks: configuration validation, same-origin routes, unsafe schemes and credentials, path resolution, help/version, safe initialization, output locking, report escaping/CSP, CI failure policy, and artifact size/path limits.
- 27 supplementary in-app browser checks using the production DOM functions: baseline, expanded text, RTL and combined modes; clean controls; known clipping/overflow; ignored elements; intentional truncation and scrolling; sensitive snippets; finding caps; invalid selectors; inert page-supplied HTML; and the broken/flexible demo at mobile and desktop widths.
- Nine report interaction checks: mode and severity filters, empty search results, introduced-scenario filtering, expand/collapse, screenshot zoom/close, and layout fitting the observed browser width.
- Production dependency audit: zero known advisories at verification time.
- npm package allowlist and installation smoke check; see the generated local verification outputs for command results.

The README preview shows actual browser-observed demo scenarios. The supplementary report identifies the capture method and uses viewport screenshots. It is not evidence that the separate headless Chromium screenshot pipeline has passed.

## Still required before publishing a production release

The desktop shell sandbox prevented Chromium subprocess startup. The browser reported a macOS bootstrap/Mach-port permission denial. Therefore the complete `npm test` integration suite could not execute in this environment. It remains part of the repository and must pass in a terminal or CI runner that permits Chromium processes.

The configured Linux/macOS/Windows GitHub Actions matrix has not been run because this local repository has no remote. Registry publication and GitHub release creation have not been performed.

Run `npm run check` and the CI matrix before treating this initial release candidate as production-verified. Add regression fixtures for issues found in real applications; heuristic checks need continuing validation.
