# What the results mean

LocaleLens finds common layout symptoms. It is not a proof that a product is fully localized or safe to ship.

## Detection boundaries

- Horizontal overflow uses element geometry and document width with a two-pixel tolerance. Descendants inside an intentional scroller or clipped region are excluded when that region fits the viewport.
- Clipping checks elements with direct text nodes, hidden/clip overflow, and scroll dimensions larger than their client dimensions. Containers that only wrap other elements can be missed. Ellipsis and line-clamp truncation are treated as intentional and skipped.
- Fixed overlays, unusual transforms, canvas/SVG text, CSS pseudo-elements, complex clipping, and custom layout engines can produce false positives or missed findings.
- An ignored overflowing element can explain document-level overflow. In that case the fallback document-level finding is suppressed; other eligible elements are still checked individually.
- Iframes and shadow-root contents are not inspected. A scenario note identifies their presence.
- DOM checks are capped at 20,000 elements per page. A report note identifies the cap. Layout findings are capped separately by `maxFindings`; omitted findings are counted and cause a threshold failure unless `failOn` is `none`.
- Screenshots show at most 16,000 vertical pixels and the configured viewport width. Offscreen horizontal overflow may be outside the screenshot. Checks still inspect eligible elements beyond the screenshot's vertical crop.
- Standalone HTML report generation is limited to 50 MiB of source PNGs to bound memory use. Larger runs retain captured PNGs and fail with instructions to reduce the scan or disable screenshots.
- Uncaught JavaScript exceptions are reported as warnings. Console logging, every failed resource request, and all possible network errors are not collected.
- No interaction flows are exercised: menus, dialogs, tabs, and authentication steps must already be in the desired state. Each route is loaded once per scenario.

## Simulations

Expanded text and changed direction are applied to the rendered DOM. They do not replace a real translation, pluralization tests, locale-sensitive date/currency tests, bidirectional text review, or native-speaker testing. A later application rerender may restore original strings.

RTL mode changes inherited direction. A component with its own explicit direction may remain unchanged. Existing RTL pages may show no direction difference. Baselines are separate page loads, so random data and server-side changes can affect comparisons.

## Introduced findings

A stress finding is introduced when its rule/selector signature was absent from the corresponding baseline. It does not prove causality. Selector changes, dynamically reordered DOM, truncated baselines, and varying page content can affect this comparison. Counts include repeated findings in different scenarios and are not unique-bug counts.

## Privacy

There is no telemetry or analysis upload. The inspected website can make normal requests and execute its own scripts; only service workers are blocked. Browser installation downloads Chromium from Playwright's distribution. Do not scan untrusted sites with privileged credentials.

Reports include page snippets, URLs, uncaught exception messages, and screenshots. Masking covers chosen DOM regions and excludes those subtrees from finding snippets. It does not automatically find every secret, remove query parameters, sanitize exception messages, or redact other copies of the same text elsewhere. Review all reports before sharing or uploading CI artifacts.

The HTML report embeds screenshots, uses no external assets, escapes page-supplied text, and includes a restrictive Content Security Policy. Report files are created with owner-only permissions where supported. Filesystem ACLs and platform behavior can differ, especially on Windows.

## Access barriers

A website served through Cloudflare can be scanned when it permits the browser request. A verification interstitial is different: LocaleLens recognizes the documented challenge header or a conservative combination of page signals, marks access as blocked, and does not inspect or transform that page. Customized protection pages that lack those signals may instead produce an HTTP or scan error. Normal CDN headers and embedded Turnstile widgets alone do not trigger interstitial detection.

Any detected Cloudflare challenge stops the entire scan without a challenge screenshot or retry. Active parallel checks are stopped, and no remaining route, viewport, or mode is opened. Requests already in flight before detection may have reached the site. The report distinguishes stopped attempts from scenarios that were never opened and retains skipped scenario slots. Planned/completed counts include these skipped entries; their errors represent blocked checks rather than layout defects. These errors cannot become a clean CI result even with `failOn: none`.

The scanner does not solve CAPTCHAs, supply a human browser identity, or circumvent a site's verification. Use an approved local/staging environment for a site you control, or coordinate permission with its administrator. Reusing application authentication state does not guarantee admission through a separate verification layer.
