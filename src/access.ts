import type { Finding, Scenario } from './types.js';

/** Stop all workers for one scan as soon as any scenario encounters a challenge. */
export class AccessStop {
  private controller = new AbortController();
  finding: Finding | undefined;
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  stop(finding: Finding): void {
    if (this.finding) return;
    this.finding = finding;
    this.controller.abort();
  }
}

export function skippedForAccess(
  task: Pick<Scenario, 'id' | 'url' | 'route' | 'viewport' | 'mode'>,
  finding: Finding,
  started: boolean,
): Scenario {
  return {
    ...task,
    status: 'failed',
    durationMs: 0,
    transformedNodes: 0,
    findings: [
      {
        ...finding,
        message: 'Skipped: Cloudflare verification blocked this site. No retry was made.',
        introduced: false,
      },
    ],
    omittedFindings: 0,
    notes: [
      started
        ? 'This in-flight attempt was stopped when Cloudflare blocked the scan. No further page was opened.'
        : 'This scenario was never opened. Cloudflare already blocked this scan.',
    ],
    skipReason: 'Skipped after Cloudflare blocked the site.',
  };
}

/** A serializable DOM reader. A normal Turnstile widget is not an interstitial. */
export function readChallengeSignals() {
  const title = document.title.toLowerCase();
  const heading = Array.from(document.querySelectorAll('h1,h2'))
    .map((node) => node.textContent ?? '')
    .join(' ')
    .toLowerCase();
  const text = (document.body?.innerText ?? '').slice(0, 16000).toLowerCase();
  return {
    interstitialTitle:
      /just a moment|attention required|performing security verification|checking your browser/.test(
        `${title} ${heading}`,
      ),
    challengeStructure: Boolean(
      document.querySelector('#challenge-form,#challenge-running,#challenge-stage'),
    ),
    challengeScript: Array.from(document.querySelectorAll('script[src]')).some((script) => {
      const src = script.getAttribute('src') ?? '';
      return src.includes('/cdn-cgi/challenge-platform/') && !src.includes('/scripts/jsd/');
    }),
    verificationText:
      /performing security verification|verif(?:y|ies|ying) (?:that )?you (?:are|are not|are human)|checking your browser|enable javascript and cookies/.test(
        text,
      ),
  };
}

export function isCloudflareChallenge(
  header: string | undefined,
  signals: ReturnType<typeof readChallengeSignals>,
): boolean {
  if (header?.trim().toLowerCase() === 'challenge') return true;
  return (
    signals.verificationText &&
    signals.interstitialTitle &&
    (signals.challengeStructure || signals.challengeScript)
  );
}
