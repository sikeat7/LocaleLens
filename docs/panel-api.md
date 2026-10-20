# Local panel API

The panel binds only to `127.0.0.1` (default port 4175). It is a single-user local application, not a hosted service. SQLite and report files live under `~/.localelens` by default; `localelens serve --data-dir <path>` selects another directory. One instance owns each data directory. Node.js 22.13+ is required for the panel's built-in SQLite support.

## Request rules

Responses use JSON except for static assets and report downloads. Errors have shape `{ "error": "message" }`. The server validates the Host header and rejects cross-origin requests. `GET /api/session` returns a per-process `token`; all API calls other than session require it in `X-LocaleLens-Token`. Mutations require `Content-Type: application/json` and are limited to 64 KiB. No permissive CORS headers are sent. Report HTML opens in a sandbox to isolate inspected page content from the panel.

## Operations

| Method and path                    | Behavior                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/session`                 | `{ token, version }`; bootstraps the local UI.                                                                                                                                  |
| `GET /api/scans?q=&status=&page=1` | Newest-first history, 20 per page. Returns `{ scans, total, page, pageSize, stats }`. Search matches URL or label. Status is an optional exact filter. Stats cover all history. |
| `POST /api/scans`                  | Validate and queue a scan. Returns `202` with the scan record. Maximum 20 unfinished scans.                                                                                     |
| `GET /api/scans/:id`               | One scan record, including its settings and persisted progress. `404` if absent.                                                                                                |
| `POST /api/scans/:id/rerun`        | Queue a new scan using the saved settings; returns `202`. Original history is preserved.                                                                                        |
| `POST /api/scans/:id/cancel`       | Cancel queued/running work. Returns `200`; `409` if already finished.                                                                                                           |
| `DELETE /api/scans/:id`            | Delete an inactive history record and its reports. Returns `204`; active work returns `409`.                                                                                    |
| `GET /reports/:id/html`            | Completed report HTML, sandboxed, or `409` while unavailable.                                                                                                                   |
| `GET /reports/:id/json`            | Download the saved JSON report, or `409` while unavailable.                                                                                                                     |

Reports are directly navigable without an API token but require the validated local Host and same-origin request checks. No other files in the data directory are served.

Scan records contain `id`, `label`, `url`, `status`, `createdAt`, `startedAt`, `finishedAt`, `completed`, `total`, `current`, `error`, `summary`, `settings`, and `hasReport`. Status values: `queued`, `running`, `completed`, `failed`, `cancelled`, `interrupted`. `completed` means the run finished and may include layout findings; `failed` means a scan or HTTP failure occurred. Findings are not silently treated as clean results. An interrupted server marks unfinished work `interrupted` on restart; it never silently rescans a website.

## Create a scan

```json
{
  "label": "Storefront",
  "url": "https://design.google/",
  "routes": ["/"],
  "viewports": ["desktop", "mobile"],
  "modes": ["baseline", "expanded", "rtl", "expanded-rtl"],
  "expansion": 40,
  "locale": "en-US",
  "timeout": 60000,
  "settle": 2000,
  "ignore": [],
  "mask": [],
  "screenshots": true
}
```

Only `url` is required. Optional fields also include `checks`, `concurrency`, `maxFindings`, `waitFor`, and `failOn`; defaults and validation match the CLI except the panel waits 1000 ms for page settling. Routes remain on the target origin. The panel does not accept filesystem paths (`output`, `storageState`, `executablePath`) or unknown fields. Validation returns `400`; origin/token rejection `403`; missing records `404`; unavailable state `409`; oversized body `413`; full queue `429`. Internal failures return `500`. The UI polls progress and preserves the last loaded view if a request fails.

## Storage and lifecycle

SQLite uses WAL mode and parameterized queries. Settings, progress, timestamps, summary, and failure details are persisted. Screenshot and HTML/JSON artifacts are stored in UUID-named directories next to the database. Cancellation and shutdown wait for browser cleanup. A data-directory lock prevents another server from interrupting existing jobs. After an unclean termination, a lock can be reclaimed only when its PID is no longer alive.

## Verification

`npm run test:panel` tests the real HTTP API and SQLite lifecycle with an injected deterministic scan executor. It covers persistence, validation, queue order, cancellation, interruption recovery, report downloads, deletion, and origin/Host/token protections. These checks do not claim that Chromium successfully scans a live external site. The existing full browser suite verifies the scan engine separately.

## Scan pipeline

Scan records also contain `pipeline`, an ordered array of `{ stage, at, detail }` events. Stages are `queued`, `preparing`, `launching`, `scanning`, `reporting`, and `finished`; terminal interruptions use `failed`, `cancelled`, or `interrupted`. `finished` means the report was saved, including reports with page failures. An execution failure records `failed` after the last reached stage. Timestamps are ISO 8601 UTC strings. Existing history is migrated in place; older completed records have an empty pipeline rather than invented timings.

History responses additionally contain `activeScans`: all queued/running scans, independent of search, page, and status filters (bounded by the queue limit of 20). This lets the live pipeline remain visible while browsing older history. `current` identifies the scenario being inspected, and `completed` counts only scenarios that have finished. Pipeline events and current progress survive refreshes and restarts.

## Website input and access challenges

`url` accepts a bare domain with an optional path, such as `design.google/components`. Public domains default to HTTPS; `localhost`, IPv4 loopback, and `[::1]` default to HTTP. Explicit HTTP(S) URLs remain valid, including `www` when it is part of the actual hostname. The API stores and returns the normalized full URL. Credentials, unsupported schemes, relative/protocol-relative inputs, and malformed addresses are rejected. A redirect to the same host's HTTPS origin or its exact `www` counterpart is accepted; unrelated origins and HTTPS downgrades remain rejected.

A detected Cloudflare interstitial produces a failed scenario with an `access-blocked` finding and stops the entire scan. The challenge is not captured, inspected for layout, or transformed. Active parallel checks are stopped; all remaining routes, viewports, and modes are represented as failed, skipped scenarios with `skipReason`, preserving planned scenario counts. No further page is opened and no retry is made. Requests already in flight before detection may have reached the site; their notes distinguish stopped attempts from scenarios that were never opened. Ordinary pages served through Cloudflare, including pages with an embedded Turnstile form, are not classified as interstitials from CDN headers or widget presence alone. This detection does not solve or bypass a challenge.
