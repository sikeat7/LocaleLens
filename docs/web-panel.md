# The LocaleLens web panel

The panel is a single-user workspace running on your own computer. It uses the same scan engine as the CLI. No hosting, domain, subscription, or database service is needed.

## Start it

Install Node.js 22.13 or later first. In a source checkout, double-click `Start-LocaleLens.command` on macOS or `Start-LocaleLens.bat` on Windows. They prepare the dependencies and Chromium browser, then open the workspace. On Linux, or if your OS blocks a downloaded launcher, open a terminal in the project folder:

```sh
npm ci --include=dev
npm run browser:install
npm start
```

Run these commands in the extracted/cloned project folder where `package.json` is located, using your normal Terminal or PowerShell. For complete download and clone instructions, see [the README](../README.md#first-time-setup). The web panel is unreleased; the `v0.1.0-rc.1` release contains only the CLI.

After setup, `npm start` is all you need. Keep its terminal open; Ctrl+C shuts the server down and cancels active work. After updating the source, run `npm ci --include=dev` and reinstall the matched browser before starting. Chromium's Linux system libraries may need installing with `npx playwright install --with-deps chromium`.

The browser opens at `http://127.0.0.1:4175`. If that port is occupied, choose another:

```sh
npm run build
node dist/cli.js serve --open --port 4180
```

An installed package exposes the same command as `localelens serve --open`. The web assets are included in the npm tarball. Installing or publishing to npm is not required when running from source.

## Scan a website

1. Enter a domain, such as `design.google`, or paste a complete HTTP(S) URL.
2. Pick **Quick look** (desktop, original and expanded text), **Everyday check** (desktop and mobile, all four modes), or **Full perspective** (desktop, mobile, tablet, all four modes).
3. Click **Start scan**. Its live status appears in your history.
4. Click **View report** when the scan finishes. Reports show screenshots, findings, selectors, and suggestions. Open the scan name to see its saved settings or download the JSON result.

The **Scan pipeline** appears when you start a scan: **Queued → Preparing → Browser → Scenarios → Saving report → Ready**. It shows stages reached by the engine, elapsed time, the active route/device/mode, and the count of scenarios that have finished. The percentage measures scenario completion; report saving is a separate stage. With parallel checks, current activity can list several scenarios.

Use **Stage timestamps** for the event timeline or the scan picker to follow another queued/running scan. The live pipeline remains visible when you search or filter history. Failed, cancelled, and interrupted scans mark their last reached stage; a saved report can still contain page failures or layout findings. Open a previous scan's details to revisit its recorded pipeline. Older history is preserved without invented stage timings.

After updating this feature, stop the existing panel, rebuild with `npm run build`, and restart using your usual command and **the same data directory**. Refresh the browser. `npm start` rebuilds automatically if you normally use that command. Existing SQLite history is migrated automatically.

A completed scan may still have findings. A failed scan means some work could not run, such as an unreachable page, an HTTP error, or a browser-launch failure. Failure details are saved with the scan. Reports are available for runs that completed the report-writing stage, including runs with page failures.

**Fine-tune your scan** exposes a name, page paths (one per line), device and mode choices, text expansion, locale, timeout, page settling, a readiness selector, ignore selectors, screenshot masks, and a screenshot toggle. Blank paths mean the pasted URL's own path, query, and hash; entering `/` explicitly scans the root. Page paths are not automatically discovered. The original baseline is always included.

The UI intentionally does not accept arbitrary browser executable paths, authentication-state files, or output directories. The CLI remains available for authenticated scans and custom viewport dimensions.

Public domains use HTTPS automatically; `localhost:3000`, `127.0.0.1:3000`, and `[::1]:3000` use HTTP. Paths, queries, and fragments are retained. A pasted full URL keeps its chosen protocol and hostname. `www` is optional to type, but is not stripped from a supplied hostname because it can identify a different server. Redirects to the exact `www` counterpart or the same host's HTTPS origin are accepted. Unrelated-origin redirects, port changes, and HTTPS downgrades remain rejected.

## Protected websites

Cloudflare hosting alone does not prevent a scan. When it serves a verification interstitial, LocaleLens marks the scenario **Access blocked** and stops the scan without capturing a challenge screenshot, inspecting its layout, or transforming it. Active parallel checks are stopped; all remaining routes, devices, and modes are marked **Skipped** without opening another page. No retry is made. Those entries count as scan failures, not layout defects or clean results. Requests already in flight before detection may have reached the site.

Detection uses Cloudflare's documented [`cf-mitigated: challenge` header](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/) or a conservative combination of interstitial text and page structure. A normal embedded Turnstile widget, a Cloudflare CDN header, or verification-related text alone is not sufficient. Unknown or customized protection pages may still appear as generic HTTP/scan failures.

For a website you control, scan a local build or an approved staging origin and coordinate production automation with the administrator. If you do not control it, ask the owner for a permitted test environment. LocaleLens does not solve CAPTCHAs, spoof a human session, or bypass verification. Saved login state for your application is not a guarantee of Cloudflare clearance.

## History and queue

Only one scan runs at a time. Up to 20 unfinished scans can be queued; each scan can contain up to 1000 scenarios. Routes, modes, and viewports multiply the number of scenarios, so begin with a small set of pages.

- **Run again** creates a separate history entry with the same settings.
- **Cancel** stops queued or active work and keeps its history.
- **Delete** asks for confirmation, then permanently removes that inactive history entry and its report directory.
- Search matches the URL or scan name. Status filters and pagination help with larger histories.
- An unexpected restart marks unfinished work **Interrupted**. It does not silently visit the site again.

## Local files

By default, the SQLite database is `~/.localelens/history.sqlite`, with HTML, JSON, and screenshots beneath `~/.localelens/reports/<scan-id>/`. Choose a different location if needed:

```sh
node dist/cli.js serve --open --data-dir ./work/my-scans
```

Close the panel before backing up or moving its entire data directory. SQLite uses WAL journaling; copying just the database while it is running can omit recent changes. Only one panel may own a data directory at a time. If a process crashes, its lock is reclaimed automatically when that PID is no longer alive. A lock belonging to a live process is never removed automatically.

Reports can contain website content, exception messages, URLs, and screenshots. Screenshot masks help hide matching page regions, but do not sanitize URLs or JavaScript exception messages. Scanned websites still make their usual network requests.

## Troubleshooting

- **Chromium's executable is missing:** run `npm run browser:install`, or reopen through the launcher. On Linux, use `npx playwright install --with-deps chromium`.
- **macOS denied browser startup / bootstrap permission denied:** stop the panel started inside the restricted runner and reopen it from your normal Terminal or the project launcher. Chromium is already installed in this case; reinstalling it does not resolve the execution restriction.
- **Page could not be scanned:** review the failed scenario; verify the URL, redirects, timeout, and readiness selector. Unrelated-origin redirects must be scanned at their final origin explicitly; ordinary `www` and HTTPS upgrades are accepted.
- **Another panel owns this directory:** use the existing panel, close it, or choose a different data directory. Only remove a stale `panel.lock` after verifying the owning process is no longer running.
- **Session expired:** refresh the page. Tokens change whenever the panel restarts.

See [panel-api.md](panel-api.md) for the local HTTP contract and automated API-test scope.

## Verification for this change

On 20 October 2026, strict TypeScript checking, repository formatting, and all 18 non-browser checks passed, including five HTTP/SQLite lifecycle tests. A clean offline installation of the npm tarball served all panel assets and the session endpoint successfully.

The in-app browser at 486 px verified presets, advanced settings, starting scans, persisted details, report interactions, search, status filtering, rerunning, cancellation, safe display of HTML-like labels, and dismissal of the deletion confirmation. Completed-flow checks used the deterministic executor in `tests/fixtures/panel-executor.mjs`, which does not visit a website; its reports explicitly identify themselves as UI fixtures. The actual scan engine was also invoked from the panel and its Chromium-launch failure was correctly saved and displayed.

The full Chromium integration attempt remained blocked by the desktop sandbox's browser-launch restriction. `tests/panel-ui.test.mjs` adds automated workflows at 390 px and 1440 px for an environment that permits Chromium; those two headless workflows have not been executed successfully here. Run `npm run check` in a normal terminal or CI to verify the complete suite.
