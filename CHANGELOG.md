# Changelog

## Unreleased

- Bare-domain input with automatic HTTPS, local HTTP defaults, and canonical `www`/HTTPS redirect handling.
- Cloudflare challenge detection with immediate scan-wide stopping, skipped remaining scenarios, and no retries or challenge screenshots.
- Per-finding repair guides with code examples, RTL-specific CSS, copy support, and verification steps in offline HTML reports.
- Persisted live scan pipeline with stage timestamps, current scenarios, and failure/cancellation states.
- Local web workspace with scan presets, advanced settings, and progress updates.
- SQLite scan history with search, status filters, pagination, and restart recovery.
- Sequential scan queue, cancellation, reruns, saved HTML reports, and JSON downloads.
- Localhost request protections and isolated report pages.
- Double-click launchers for macOS and Windows, plus `npm start` and `localelens serve`.
- Node.js minimum raised to 22.13 for built-in SQLite support.

## 0.1.0 — Initial release candidate

- Local CLI for baseline, expanded-text, RTL, and combined layout stress tests.
- Desktop, mobile, tablet, and custom viewports.
- Horizontal-overflow, likely clipped-text, and uncaught JavaScript exception checks.
- Baseline comparisons, ignore selectors, sensitive-region masks, and authentication state.
- Standalone HTML reports with embedded screenshots, filtering, zoom, and responsive layout.
- Versioned JSON reports and explicit CI failure thresholds.
- Bounded execution, cancellation, output locks, atomic file writes, and retained screenshots.
- Demo site, strict configuration schema, real-browser tests, and cross-platform CI configuration.
