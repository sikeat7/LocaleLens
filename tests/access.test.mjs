import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessStop, isCloudflareChallenge, skippedForAccess } from '../dist/access.js';

test('one access block aborts every subscribed worker and keeps the first block reason', () => {
  const stop = new AccessStop();
  const finding = {
    id: 'blocked',
    code: 'access-blocked',
    severity: 'error',
    message: 'Cloudflare blocked the site',
    suggestion: 'Skip',
    introduced: false,
  };
  let cancelledWorkers = 0;
  stop.signal.addEventListener('abort', () => cancelledWorkers++);
  stop.signal.addEventListener('abort', () => cancelledWorkers++);
  stop.stop(finding);
  stop.stop({ ...finding, message: 'A later worker also stopped' });
  assert.equal(stop.signal.aborted, true);
  assert.equal(cancelledWorkers, 2);
  assert.equal(stop.finding, finding);
  const task = {
    id: 'unopened',
    route: '/other',
    url: 'https://example.com/other',
    mode: 'rtl',
    viewport: { name: 'mobile', width: 390, height: 844 },
  };
  for (const started of [false, true]) {
    const skipped = skippedForAccess(task, finding, started);
    assert.equal(skipped.status, 'failed');
    assert.equal(skipped.transformedNodes, 0);
    assert.equal(skipped.screenshot, undefined);
    assert.match(skipped.skipReason, /Skipped/);
    assert.match(skipped.findings[0].message, /No retry/);
    assert.equal(skipped.findings[0].introduced, false);
  }
});

const normal = {
  interstitialTitle: false,
  challengeStructure: false,
  challengeScript: false,
  verificationText: false,
};
test('Cloudflare challenge header is authoritative even without recognizable markup', () => {
  assert.equal(isCloudflareChallenge('challenge', normal), true);
  assert.equal(isCloudflareChallenge(' Challenge ', normal), true);
  assert.equal(isCloudflareChallenge(undefined, normal), false);
});
test('DOM fallback requires an interstitial title, verification text, and challenge structure', () => {
  const challenge = {
    ...normal,
    interstitialTitle: true,
    verificationText: true,
    challengeStructure: true,
  };
  assert.equal(isCloudflareChallenge(undefined, challenge), true);
  assert.equal(
    isCloudflareChallenge(undefined, {
      ...challenge,
      challengeStructure: false,
      challengeScript: true,
    }),
    true,
  );
  assert.equal(isCloudflareChallenge(undefined, { ...challenge, interstitialTitle: false }), false);
  assert.equal(isCloudflareChallenge(undefined, { ...challenge, verificationText: false }), false);
});
test('an embedded verification widget, CDN hosting, or challenge-related text alone is not a challenge page', () => {
  assert.equal(isCloudflareChallenge(undefined, { ...normal, verificationText: true }), false);
  assert.equal(isCloudflareChallenge(undefined, { ...normal, challengeScript: true }), false);
  assert.equal(
    isCloudflareChallenge(undefined, {
      ...normal,
      verificationText: true,
      interstitialTitle: true,
    }),
    false,
  );
});
