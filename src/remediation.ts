import type { Finding, Mode } from './types.js';

export interface CodeExample {
  title: string;
  language: 'css' | 'javascript' | 'json' | 'sh';
  code: string;
}
export interface Remediation {
  title: string;
  explanation: string;
  steps: string[];
  examples: CodeExample[];
  verify: string[];
  reference?: { title: string; url: string };
}

const layoutVerification = [
  'Rerun this route at the same viewport and stress mode, then compare the original and changed screenshots.',
  'Check nearby components, keyboard focus, and the longest real translations; a clean automated result still needs visual review.',
];
const sizingReference = {
  title: 'MDN: logical sizing properties',
  url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Logical_properties_and_values/Sizing',
};

export function remediationFor(finding: Finding, mode: Mode): Remediation {
  let guide: Remediation;
  switch (finding.code) {
    case 'horizontal-overflow':
      guide = {
        title: 'Let the component fit its container',
        explanation:
          'This element or the page extends past the viewport. A fixed width, an unbroken label, a flex/grid minimum size, or a positioned child can cause this. Inspect the element and its parents to identify which constraint applies.',
        steps: [
          'Locate the reported selector in browser DevTools and inspect its computed size and the parent layout. For a document-level finding, locate the child extending outside the page first.',
          'Replace the fixed sizing or no-wrap rule on that component. If it is a flex/grid item, let it shrink; if a row is crowded, allow the parent row to wrap.',
          'For intentionally scrollable tables or carousels, keep scrolling inside their own container rather than hiding overflow on the whole page.',
        ],
        examples: [
          {
            title: 'Responsive component sizing',
            language: 'css',
            code: `/* Replace these classes with your component's selectors.
   Replace conflicting fixed-width / no-wrap rules in its stylesheet. */
.affected-element {
  box-sizing: border-box;
  min-inline-size: 0;
  max-inline-size: 100%;
  inline-size: auto;
  white-space: normal;
  overflow-wrap: anywhere;
}

/* Use on a parent row when its children should wrap. */
.affected-layout {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}`,
          },
        ],
        verify: [
          ...layoutVerification,
          'Confirm that the page no longer scrolls horizontally. Do not use body { overflow-x: hidden } to conceal a broken layout.',
        ],
        reference: {
          title: 'MDN: flex wrapping',
          url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/flex-wrap',
        },
      };
      break;
    case 'clipped-text':
      guide = {
        title: 'Give longer text room to grow',
        explanation:
          'The text appears larger than its visible container. Fixed heights, line clamping, white-space rules, or overflow clipping can cause this. Intentional truncation is also detected, so first decide whether the full label should be visible.',
        steps: [
          'Inspect the reported element for a fixed height, max-height, white-space: nowrap, overflow: hidden/clip, or a line clamp.',
          'For text that must remain visible, replace fixed-height and truncation rules with a content-driven block size and wrapping. Apply the example only to that text component.',
          'If truncation is intentional, preserve its design and provide a keyboard/touch-accessible way to read the full text, then consider ignoring only that region in this scan.',
        ],
        examples: [
          {
            title: 'A label that grows with its content',
            language: 'css',
            code: `/* Replace this selector with the affected text component.
   Remove its conflicting height, max-height, or line-clamp rule. */
.affected-element {
  box-sizing: border-box;
  block-size: auto;
  min-block-size: 2.75rem;
  max-block-size: none;
  min-inline-size: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  padding-block: 0.625rem;
}

/* Only if this text component's clipping is unintended.
   Keep deliberate clipping on image frames and other wrappers. */
.affected-element {
  overflow: visible;
}`,
          },
        ],
        verify: [
          ...layoutVerification,
          'Check that every line is readable and that the expanded component does not overlap the next row.',
        ],
        reference: sizingReference,
      };
      break;
    case 'page-error':
      guide = {
        title: 'Trace and fix the uncaught exception',
        explanation:
          'Page JavaScript threw an uncaught exception. Read the message above and reproduce it in DevTools to locate the source. The example addresses one common cause—accessing an element that is not present—and is not a diagnosis of every JavaScript error.',
        steps: [
          'Open this route in your own browser, enable DevTools pause on uncaught exceptions, and reload at the reported viewport.',
          'Follow the stack trace to your source. Check missing DOM nodes, data that has not loaded yet, and assumptions about the selected locale.',
          'Handle the actual error with an appropriate fallback. Avoid hiding it with an empty catch block or disabling the page-error check.',
        ],
        examples: [
          {
            title: 'Guard an optional element after the DOM is ready',
            language: 'javascript',
            code: `function initializeOptionalControl() {
  const control = document.querySelector('.optional-control');
  if (!(control instanceof HTMLButtonElement)) {
    return; // This control is intentionally absent on some routes.
  }

  control.addEventListener('click', () => {
    // Call your existing action handler here.
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeOptionalControl, {
    once: true,
  });
} else {
  initializeOptionalControl();
}`,
          },
        ],
        verify: [
          'Reproduce the same navigation and confirm the exception is gone while the feature still works.',
          'Rerun the same LocaleLens scenario and check that page content loaded correctly rather than merely suppressing the exception.',
        ],
      };
      break;
    case 'access-blocked':
      guide = {
        title: 'Get authorized access before testing layouts',
        explanation:
          'Cloudflare served a security verification page instead of the website. The scan stopped immediately; no challenge screenshot or layout result was captured. LocaleLens cannot guarantee access through an interactive verification gate.',
        steps: [
          'If you control the website, scan your local build or an approved staging environment that permits automated tests.',
          'For production testing, coordinate an approved test approach with the site administrator. Installing Chromium again or increasing text expansion does not grant access.',
          'If you do not control the website, ask its owner for a permitted test environment. The scanner does not solve CAPTCHAs or bypass verification.',
        ],
        examples: [
          {
            title: 'Scan your local development build instead',
            language: 'json',
            code: `{
  "url": "http://localhost:3000",
  "routes": ["/"],
  "modes": ["baseline", "expanded", "rtl", "expanded-rtl"],
  "viewports": ["desktop", "mobile"]
}`,
          },
        ],
        verify: [
          'Blocked and skipped scenarios provide no layout conclusion for the protected website.',
          'If needed, start a separate scan against your own local build or an approved test environment that permits access.',
        ],
        reference: {
          title: 'Cloudflare: detect a Challenge Page response',
          url: 'https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/',
        },
      };
      break;
    case 'http-error': {
      const authentication = /HTTP (401|403)\b/.test(finding.message);
      guide = authentication
        ? {
            title: 'Check authentication and access',
            explanation:
              'The server rejected the request. The page may require a session, access permission, or a request that an automated browser cannot satisfy. Confirm which applies before changing scan settings.',
            steps: [
              'Open the exact route in your browser and confirm your account is permitted to access it.',
              'For a session-protected application you control, use a locally saved Playwright authentication state with the CLI. The web panel does not accept authentication file paths.',
              'If the site blocks automation, use an approved test environment or adjust the application’s test configuration; authentication state does not bypass an access policy.',
            ],
            examples: [
              {
                title: 'CLI configuration for an authenticated test environment',
                language: 'json',
                code: `{
  "url": "https://your-site.example/",
  "routes": ["/protected-page"],
  "storageState": "./auth.json",
  "modes": ["baseline", "expanded", "rtl"]
}`,
              },
            ],
            verify: [
              'Keep the authentication file private and out of Git. Use your existing Playwright login flow to create it.',
              'Rerun with that configuration and confirm the report shows the intended application page rather than a login screen.',
            ],
          }
        : {
            title: 'Make the route respond successfully',
            explanation:
              'The page returned an HTTP error. A missing route, a server failure, or an unavailable dependency needs attention before the layout result can be trusted.',
            steps: [
              'Open the exact reported URL and check its HTTP response in the browser Network panel.',
              'For a missing page, correct the route or deploy its handler. For a server error, inspect the application logs and fix the failing dependency or request.',
              'If the page redirects to another origin, scan the final origin explicitly. A longer timeout does not fix an HTTP error response.',
            ],
            examples: [
              {
                title: 'Point the scan at a route that exists',
                language: 'json',
                code: `{
  "url": "https://your-site.example/",
  "routes": ["/existing-page"],
  "modes": ["baseline", "expanded", "rtl"]
}`,
              },
            ],
            verify: [
              'Confirm that the final page responds successfully and contains the expected content.',
              'Rerun the route and review its baseline before interpreting layout findings.',
            ],
          };
      break;
    }
    case 'scan-error':
      guide = {
        title: 'Check page readiness and the scan environment',
        explanation:
          'This scenario could not be inspected. Use its error message to distinguish a timeout, invalid selector, navigation failure, or unavailable browser resource. A failed scenario does not establish that the layout passed.',
        steps: [
          'Confirm that the URL is reachable from the computer running LocaleLens and that any readiness selector actually becomes visible.',
          'For pages that load asynchronously, wait for a stable content element and use a suitable timeout. The example main selector must match your own page.',
          'If the message says macOS denied browser startup, restart LocaleLens in your normal Terminal. Install Chromium only when the message says its executable is missing.',
        ],
        examples: [
          {
            title: 'Wait for your application content',
            language: 'json',
            code: `{
  "url": "https://your-site.example/",
  "routes": ["/"],
  "waitFor": "main",
  "timeout": 60000,
  "settle": 2000
}`,
          },
        ],
        verify: [
          'Rerun and confirm the scenario finishes with a screenshot or layout findings instead of a scan failure.',
          'Verify that the captured page is the expected content, not a loading placeholder or error screen.',
        ],
      };
      break;
  }
  if (
    ['rtl', 'expanded-rtl'].includes(mode) &&
    ['horizontal-overflow', 'clipped-text'].includes(finding.code)
  ) {
    guide.steps.push(
      'For this RTL scenario, inspect physical left/right positioning and spacing. Replace the relevant physical declarations with logical properties; do not layer conflicting left/right declarations underneath them.',
    );
    guide.examples.push({
      title: 'Direction-aware spacing and positioning',
      language: 'css',
      code: `/* Replace physical margin-left / padding-left / text-align: left. */
.direction-aware-item {
  margin-inline-start: 1rem;
  padding-inline: 1rem;
  text-align: start;
}

/* For a positioned child: replace its left/right declarations. */
.positioned-label {
  inset-inline-start: 1rem;
  inset-inline-end: auto;
}`,
    });
    guide.verify.push(
      'Compare both LTR and RTL layouts with real translated content. Mirror only directional icons, not logos or all images.',
    );
    guide.reference = sizingReference;
  }
  return guide;
}
