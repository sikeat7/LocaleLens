# Security

## Reporting a vulnerability

After the GitHub repository is published, use its **Security → Report a vulnerability** feature for a private report. The repository owner must enable private vulnerability reporting during setup. If that feature is unavailable, ask the maintainer for a private contact method without disclosing the vulnerability in a public issue.

Include the affected version, reproduction steps, expected impact, and a minimal example without real credentials or customer data. No response-time or remediation guarantee is implied before maintainers establish one.

## Threat model

LocaleLens opens the URL you provide in Chromium. A fresh context is used per scenario, with downloads and service workers disabled. It does not sandbox network access beyond the browser's normal protections and is not a general-purpose safe browser for hostile sites.

HTTP(S) targets only are supported. Embedded URL credentials and cross-origin route definitions are rejected. Cross-origin redirects are reported as failures. Keep authentication state restricted to a dedicated test account.

Reports escape untrusted text, embed screenshots, block external assets with a Content Security Policy, and are written with restrictive permissions where supported. Mask selectors are a deliberate user control, not an automatic data-loss-prevention system. Review reports before sharing.

Only JSON configuration is accepted; there is no arbitrary configuration-code execution or automatic application of suggested fixes. Keep Playwright and its matched browser up to date, review dependency updates, and test before release.
