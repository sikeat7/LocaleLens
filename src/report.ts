import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Finding, Report, Scenario } from './types.js';
import { remediationFor } from './remediation.js';

const brandLogo = `data:image/png;base64,${readFileSync(
  new URL('../docs/assets/localelens-logo.png', import.meta.url),
).toString('base64')}`;

export function escapeHtml(value: string | number): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

const modeNames = {
  baseline: 'Original',
  expanded: 'Expanded text',
  rtl: 'Right to left',
  'expanded-rtl': 'Expanded + RTL',
};

function findingRow(finding: Finding, index: number, mode: Scenario['mode']): string {
  const guide = remediationFor(finding, mode);
  const remediation = `<details class="remediation"><summary><span>How to fix this</span><span class="guide-label">Guide + code examples</span></summary>
    <div class="guide-content"><h3>${escapeHtml(guide.title)}</h3><p>${escapeHtml(guide.explanation)}</p>
    <div class="guide-kicker">What to inspect</div><ol>${guide.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
    <p class="guide-disclaimer">Example patterns, not an automatic patch. Replace placeholder selectors and URLs with your own, and apply only the changes relevant to this component.</p>
    ${guide.examples.map((example) => `<div class="code-example"><div class="code-toolbar"><strong>${escapeHtml(example.title)}</strong><span>${escapeHtml(example.language)}</span><button class="copy-code" type="button" aria-label="Copy ${escapeHtml(example.title)}">Copy code</button></div><pre><code tabindex="0">${escapeHtml(example.code)}</code></pre><span class="copy-status" role="status"></span></div>`).join('')}
    <div class="guide-kicker">Verify the change</div><ul>${guide.verify.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ul>
    ${guide.reference ? `<a class="guide-reference" href="${escapeHtml(guide.reference.url)}" rel="noreferrer">${escapeHtml(guide.reference.title)} ↗ <span>(online reference)</span></a>` : ''}</div></details>`;
  return `<li class="finding ${finding.severity}">
    <span class="finding-number">${index + 1}</span>
    <div class="finding-body"><div class="finding-heading"><strong>${escapeHtml(finding.code.replaceAll('-', ' '))}</strong><span class="badge ${finding.severity}">${finding.severity}</span>${finding.introduced ? '<span class="badge new">Introduced</span>' : '<span class="baseline-label">Existing / baseline</span>'}</div>
    <p>${escapeHtml(finding.message)}</p>
    ${finding.selector ? `<code class="selector">${escapeHtml(finding.selector)}</code>` : ''}
    ${finding.text ? `<blockquote>${escapeHtml(finding.text)}</blockquote>` : ''}
    <p class="suggestion">${escapeHtml(finding.suggestion)}</p>${remediation}</div></li>`;
}

function preview(scenario: Scenario, images: Record<string, string>, caption: string): string {
  const src = scenario.screenshot ? images[scenario.screenshot] : undefined;
  if (scenario.skipReason) caption += ' · skipped';
  else if (scenario.findings.some((finding) => finding.code === 'access-blocked'))
    caption += ' · verification page';
  return `<figure class="preview"><figcaption><span>${escapeHtml(caption)}</span><span>${scenario.viewport.width} × ${scenario.viewport.height}</span></figcaption>${
    src
      ? `<button class="screenshot-button" type="button" aria-label="Enlarge ${escapeHtml(caption)} screenshot"><img loading="lazy" src="${src}" alt="${escapeHtml(caption)} screenshot of ${escapeHtml(scenario.route)}" /></button>`
      : '<div class="no-preview">Screenshot unavailable</div>'
  }</figure>`;
}

function scenarioCard(
  scenario: Scenario,
  report: Report,
  images: Record<string, string>,
  index: number,
): string {
  const baseline = report.scenarios.find(
    (item) =>
      item.route === scenario.route &&
      item.viewport.name === scenario.viewport.name &&
      item.mode === 'baseline',
  );
  const errors = scenario.findings.filter((finding) => finding.severity === 'error').length;
  const warnings = scenario.findings.length - errors;
  const introduced = scenario.findings.some((finding) => finding.introduced);
  const severity =
    scenario.status === 'failed' ? 'failed' : errors ? 'error' : warnings ? 'warning' : 'passed';
  const failureLabel = scenario.skipReason
    ? 'Skipped'
    : scenario.findings.some((finding) => finding.code === 'access-blocked')
      ? 'Access blocked'
      : 'Scan failed';
  const search = [
    scenario.route,
    scenario.viewport.name,
    ...scenario.findings.flatMap((finding) => [
      finding.code,
      finding.selector ?? '',
      finding.text ?? '',
    ]),
  ]
    .join(' ')
    .toLowerCase();
  return `<details class="scenario" id="${escapeHtml(scenario.id)}" data-mode="${scenario.mode}" data-severity="${severity}" data-new="${introduced}" data-search="${escapeHtml(search)}" ${index === 0 ? 'open' : ''}>
    <summary><span class="scenario-dot ${severity}"></span><span class="scenario-title"><strong>${escapeHtml(scenario.route)}</strong><span>${escapeHtml(scenario.viewport.name)} <span class="separator">/</span> ${modeNames[scenario.mode]}</span></span><span class="scenario-count">${scenario.status === 'failed' ? `<span class="badge error">${escapeHtml(failureLabel)}</span>` : scenario.findings.length ? `${errors ? `<span class="badge error">${errors} error${errors === 1 ? '' : 's'}</span>` : ''}${warnings ? `<span class="badge warning">${warnings} warning${warnings === 1 ? '' : 's'}</span>` : ''}` : '<span class="badge passed">Passed</span>'}</span><span class="chevron" aria-hidden="true">⌄</span></summary>
    <div class="scenario-content"><div class="run-meta"><span>${(scenario.durationMs / 1000).toFixed(1)}s scan</span><span>${scenario.transformedNodes} text node${scenario.transformedNodes === 1 ? '' : 's'} expanded</span><span>${scenario.findings.filter((finding) => finding.introduced).length} introduced finding${scenario.findings.filter((finding) => finding.introduced).length === 1 ? '' : 's'}</span></div>
    <div class="previews ${scenario.mode === 'baseline' ? 'single' : ''}">${scenario.mode !== 'baseline' && baseline ? preview(baseline, images, 'Original') : ''}${preview(scenario, images, modeNames[scenario.mode])}</div>
    ${scenario.findings.length ? `<ol class="findings">${scenario.findings.map((finding, i) => findingRow(finding, i, scenario.mode)).join('')}</ol>` : '<div class="clean-state"><span aria-hidden="true">✓</span><div><strong>No issues detected by the enabled checks.</strong><p>Review the screenshot for visual problems that automated checks may miss.</p></div></div>'}
    ${scenario.skipReason ? `<p class="note warning-note">${escapeHtml(scenario.skipReason)} No retry was made.</p>` : ''}
    ${scenario.omittedFindings ? `<p class="note warning-note">${scenario.omittedFindings} additional findings omitted. Increase maxFindings or narrow the scan.</p>` : ''}
    ${scenario.notes.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join('')}
    </div></details>`;
}

const script = `
document.querySelector('#report-icon').href = document.querySelector('.logo').src;
const search = document.querySelector('#search');
const mode = document.querySelector('#mode');
const severity = document.querySelector('#severity');
const introduced = document.querySelector('#introduced');
const cards = [...document.querySelectorAll('.scenario')];
function filter() {
  let visible = 0;
  for (const card of cards) {
    const match = card.dataset.search.includes(search.value.toLowerCase()) &&
      (!mode.value || card.dataset.mode === mode.value) &&
      (!severity.value || card.dataset.severity === severity.value) &&
      (!introduced.checked || card.dataset.new === 'true');
    card.hidden = !match;
    if (match) visible++;
  }
  document.querySelector('#visible-count').textContent = String(visible);
  document.querySelector('#empty').hidden = visible > 0;
}
for (const field of [search, mode, severity, introduced]) field.addEventListener('input', filter);
document.querySelector('#expand').addEventListener('click', () => { for (const card of cards) if (!card.hidden) card.open = true; });
document.querySelector('#collapse').addEventListener('click', () => { for (const card of cards) card.open = false; });
const dialog = document.querySelector('#zoom');
for (const button of document.querySelectorAll('.screenshot-button')) button.addEventListener('click', () => {
  const source = button.querySelector('img');
  const image = dialog.querySelector('img');
  image.src = source.src;
  image.alt = source.alt;
  dialog.showModal();
});
document.querySelector('#close-zoom').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
for (const button of document.querySelectorAll('.copy-code')) button.addEventListener('click', async () => {
  const example = button.closest('.code-example');
  const code = example.querySelector('code');
  const status = example.querySelector('.copy-status');
  try {
    await navigator.clipboard.writeText(code.textContent);
    status.textContent = 'Copied to clipboard.';
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    code.focus({ preventScroll: true });
    status.textContent = 'Code selected. Press Ctrl+C (or Command+C on Mac) to copy.';
  }
});
filter();
`;

const styles = `
:root{color-scheme:light;--ink:#172b2a;--muted:#657571;--line:#dfe5df;--paper:#f6f7f2;--green:#294f43;--lime:#d7ef92;--red:#ac3539;--amber:#95630f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}button,summary,select{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #648d35;outline-offset:3px}[hidden]{display:none!important}a{color:inherit}.shell{display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh}.sidebar{padding:32px 24px;background:#183b33;color:#edf5ed;display:flex;flex-direction:column;gap:36px;position:sticky;top:0;height:100vh}.brand{font-size:23px;font-weight:750;letter-spacing:-1px;display:flex;align-items:center;gap:10px;text-decoration:none}.logo{display:block;flex:0 0 36px;width:36px;height:36px;object-fit:contain;border-radius:8px}.brand small{display:block;font-size:10px;letter-spacing:2px;font-weight:500;color:#a9c4b8}.nav-label{font-size:10px;letter-spacing:1.8px;color:#94b5a6;margin-bottom:12px;font-weight:650}.nav-item{display:flex;gap:12px;align-items:center;border-radius:8px;padding:11px 12px;background:#ffffff12;text-decoration:none}.nav-icon{color:var(--lime);font-size:17px}.sidebar-note{font-size:12px;color:#aec5b9;margin-top:auto;border-top:1px solid #ffffff20;padding-top:20px}.private{display:inline-flex;gap:7px;align-items:center;font-size:11px;letter-spacing:.6px;color:#cfe6c7}.private:before{content:'';width:6px;height:6px;border-radius:50%;background:var(--lime)}main{max-width:1320px;width:100%;padding:38px 52px 24px;margin:0 auto;min-width:0}.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:38px;font-size:11px;color:var(--muted);letter-spacing:1px}.eyebrow{font:600 11px/1.4 ui-monospace,monospace;letter-spacing:1.7px;color:var(--green)}.hero{display:flex;gap:24px;justify-content:space-between;align-items:center;margin-bottom:30px}h1{font-size:clamp(30px,3vw,42px);line-height:1.15;letter-spacing:-1.8px;margin:10px 0 12px;font-weight:650}.subtitle{margin:0;color:var(--muted);font-size:14px;max-width:700px;overflow-wrap:anywhere}.run-status{display:flex;align-items:center;gap:8px;white-space:nowrap;padding:8px 13px;border:1px solid var(--line);border-radius:99px;background:white;font-size:12px}.run-status i{width:7px;height:7px;border-radius:50%;background:var(--green)}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:28px 0 22px}.stat{border:1px solid var(--line);border-radius:12px;background:white;padding:20px 22px;min-width:0}.stat.primary{background:var(--lime);border-color:var(--lime)}.stat-label{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--muted)}.stat-number{font-size:38px;line-height:1.3;font-weight:600;letter-spacing:-1.5px;display:block;margin:10px 0 4px}.stat small{font-size:11px;color:var(--muted)}.method{padding:14px 17px;border:1px solid var(--line);border-radius:8px;background:#edf1e7;color:#4c6254;font-size:12px;margin-bottom:32px}.method strong{color:var(--ink)}.section-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;gap:12px}h2{font-size:18px;letter-spacing:-.4px;margin:0;font-weight:650}.section-heading small{font-size:12px;color:var(--muted);margin-left:8px}.text-button{border:0;background:none;color:var(--muted);font-size:12px;padding:6px 9px}.filters{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}.search{flex:1;min-width:180px}.filters input[type=search],.filters select{width:100%;border:1px solid var(--line);background:white;color:var(--ink);padding:10px 12px;border-radius:7px;min-height:42px}.select-field{min-width:145px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.checkbox{display:flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap;color:var(--muted);padding:0 5px}.checkbox input{accent-color:var(--green)}.scenario{border:1px solid var(--line);border-radius:10px;background:white;margin-bottom:10px;overflow:hidden;scroll-margin-top:16px}.scenario > summary{list-style:none;display:flex;align-items:center;gap:14px;padding:17px 20px}.scenario > summary::-webkit-details-marker{display:none}.scenario[open] > summary{border-bottom:1px solid var(--line)}.scenario-dot{width:8px;height:8px;flex:0 0 8px;border-radius:50%;background:#547a60}.scenario-dot.error,.scenario-dot.failed{background:#d65c5f}.scenario-dot.warning{background:#cf9b3d}.scenario-title{min-width:0;display:flex;flex-direction:column;gap:2px}.scenario-title strong{font-size:14px;overflow-wrap:anywhere;font-weight:600}.scenario-title>span{font-size:11px;color:var(--muted)}.separator{margin:0 5px;color:#bdc5bd}.scenario-count{margin-left:auto;display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.badge{display:inline-block;border:1px solid transparent;border-radius:5px;padding:2px 7px;font-size:10px;font-weight:600;white-space:nowrap}.badge.error{background:#fbeded;color:var(--red);border-color:#f2d9d9}.badge.warning{background:#fcf5e6;color:var(--amber);border-color:#f0e2be}.badge.passed{background:#ecf3e9;color:#3d6845;border-color:#d7e6d2}.badge.new{background:#eaf0fd;color:#4c65a0}.baseline-label{font-size:10px;color:var(--muted)}.chevron{font-size:19px;color:var(--muted);transition:transform .1s}.scenario[open] .chevron{transform:rotate(180deg)}.scenario-content{padding:20px}.run-meta{display:flex;gap:18px;flex-wrap:wrap;font:11px ui-monospace,monospace;color:var(--muted);margin-bottom:16px}.previews{display:grid;grid-template-columns:1fr 1fr;gap:12px}.previews.single{grid-template-columns:1fr}.preview{margin:0;border:1px solid var(--line);border-radius:7px;overflow:hidden;background:#f1f3ef;min-width:0}.preview figcaption{display:flex;justify-content:space-between;gap:8px;padding:8px 12px;background:#fafbf8;font-size:10px;color:var(--muted);border-bottom:1px solid var(--line)}.screenshot-button{display:block;width:100%;padding:0;border:0;background:#e7ebe5;max-height:310px;overflow:hidden;text-align:left}.screenshot-button img{width:100%;display:block;object-fit:cover;object-position:top}.no-preview{height:150px;display:grid;place-items:center;color:var(--muted);font-size:12px}.findings{list-style:none;padding:0;margin:20px 0 0}.finding{display:flex;gap:12px;padding:18px 0;border-top:1px solid var(--line)}.finding-number{flex:0 0 22px;height:22px;border-radius:5px;background:#f9e8e7;color:var(--red);text-align:center;font:600 11px/22px ui-monospace,monospace}.finding.warning .finding-number{color:var(--amber);background:#fcf0d6}.finding-body{min-width:0;flex:1}.finding-heading{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.finding-heading strong{font-size:12px;text-transform:capitalize;font-weight:650}.finding p{font-size:12px;margin:8px 0;color:#4a5a54;overflow-wrap:anywhere}.selector{display:block;font:11px/1.7 ui-monospace,monospace;background:#f4f5f0;border-radius:5px;padding:7px 10px;overflow-wrap:anywhere}.finding blockquote{margin:10px 0;padding-left:12px;border-left:2px solid #d2dec9;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.finding p.suggestion{color:var(--muted);font-size:11px}.clean-state{display:flex;gap:12px;align-items:center;padding:20px 0 0;color:#3e674c;font-size:12px}.clean-state>span{width:27px;height:27px;display:grid;place-items:center;border-radius:50%;background:#edf4e6}.clean-state p{margin:3px 0 0;color:var(--muted);font-size:11px}.note{font-size:11px;padding:10px 12px;margin:12px 0 0;border:1px solid var(--line);border-radius:5px;color:var(--muted);overflow-wrap:anywhere}.warning-note{border-color:#ead7ae;background:#fff9ed}.empty-state{text-align:center;padding:44px 20px;border:1px dashed #cad5c7;border-radius:10px;color:var(--muted)}footer{border-top:1px solid var(--line);margin-top:30px;padding:19px 0;display:flex;gap:12px;justify-content:space-between;font-size:10px;color:var(--muted)}dialog{width:min(1200px,95vw);height:90vh;border:0;border-radius:12px;padding:16px;background:var(--paper);overflow:auto}dialog::backdrop{background:#10251fcc;backdrop-filter:blur(4px)}dialog img{display:block;width:100%;height:auto}#close-zoom{position:sticky;top:0;float:right;border:1px solid var(--line);background:white;border-radius:7px;padding:7px 14px;z-index:1}.skip-link{position:fixed;top:-100px;left:10px;background:white;padding:10px;z-index:100}.skip-link:focus{top:10px}@media(min-width:1700px){main{padding-top:48px}}@media(max-width:1000px){.shell{grid-template-columns:180px minmax(0,1fr)}.sidebar{padding:26px 18px}.brand{font-size:20px}main{padding:28px 26px}.stats{gap:8px}.stat{padding:16px}.hero{align-items:flex-start;flex-direction:column;gap:14px}}@media(max-width:700px){.shell{display:block}.sidebar{position:static;height:auto;padding:16px 20px;flex-direction:row;gap:0;align-items:center;justify-content:space-between}.sidebar nav,.sidebar-note,.brand small{display:none}.private{font-size:10px}main{padding:24px 16px}.topbar{margin-bottom:25px;font-size:9px;letter-spacing:.3px;gap:10px}.stats{grid-template-columns:1fr 1fr}.stat-number{font-size:32px}.hero{margin-bottom:20px}h1{font-size:32px}.previews{grid-template-columns:1fr}.scenario > summary{padding:15px 12px;gap:9px}.scenario-content{padding:14px}.scenario-count{max-width:105px}.filters .select-field{flex:1;min-width:120px}.search{flex-basis:100%}.checkbox{padding:8px 0}.section-heading{align-items:flex-start}.section-heading small{display:block;margin:3px 0 0}.run-meta{gap:8px 14px}footer{flex-direction:column}.method{font-size:11px}.finding-heading{gap:6px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}@media print{.sidebar,.filters,.text-button,.topbar,.screenshot-button:after{display:none}.shell{display:block}main{padding:0}.scenario{break-inside:avoid}details:not([open])>div{display:block}.stats{grid-template-columns:repeat(4,1fr)}body{background:white}}
`;

const guideStyles = `
.access-notice{border:1px solid #e7c3a9;background:#fff6ea;border-radius:9px;padding:16px 18px;margin:0 0 24px;font-size:12px;color:#83532f;line-height:1.8}.access-notice strong{display:block;color:#76472d;margin-bottom:4px}
.remediation{margin:15px 0 2px;border:1px solid #dce6d1;border-radius:8px;background:#fafcf6;overflow:hidden}
.remediation>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:12px 14px;color:#35513d;font-size:11px;font-weight:650;cursor:pointer}
.remediation>summary::-webkit-details-marker{display:none}
.remediation>summary:after{content:'+';margin-left:auto;font-size:17px;font-weight:400}
.remediation[open]>summary{border-bottom:1px solid #dce6d1}
.remediation[open]>summary:after{content:'−'}
.guide-label{font-size:9px;font-weight:400;color:#77866c}
.guide-content{padding:17px 16px}
.guide-content h3{margin:0 0 9px;font-size:14px;line-height:1.5;font-weight:600;letter-spacing:-.2px}
.guide-content p{font-size:11px;line-height:1.8;margin:8px 0 14px}
.guide-kicker{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#687c5a;margin:18px 0 10px}
.guide-content ol,.guide-content ul{padding-left:19px;margin:0 0 14px}
.guide-content li{font-size:11px;line-height:1.8;margin:0 0 8px;color:#52634f;overflow-wrap:anywhere}
.guide-content .guide-disclaimer{padding:10px 12px;border-left:2px solid #b7ce8d;background:#eef4e4;color:#687958;font-size:10px}
.code-example{border:1px solid #d7e0d0;border-radius:7px;overflow:hidden;background:#fff;margin:15px 0;min-width:0}
.code-toolbar{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #dce4d5;background:#f0f4e9}
.code-toolbar strong{font-size:10px;font-weight:600;line-height:1.6;min-width:0;overflow-wrap:anywhere}
.code-toolbar>span{font:9px ui-monospace,monospace;color:#7c8d71;margin-left:auto}
.copy-code{border:1px solid #cedbbd;border-radius:5px;background:#fff;color:#35513d;padding:5px 9px;font-size:10px;white-space:nowrap}
.copy-code:hover{background:#e7efd9}
.code-example pre{margin:0;padding:15px;overflow-x:auto;max-width:100%;color:#dcecc5;background:#193b33;font:11px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2}
.code-example pre code{display:block;font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}
.copy-status{display:block;font-size:10px;line-height:1.7;color:#5c7350;padding:8px 12px}
.copy-status:empty{display:none}
.guide-reference{display:inline-block;margin-top:5px;color:#526e3b;font-size:10px;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}
.guide-reference span{color:#849277}
@media(max-width:600px){.guide-label{display:none}.guide-content{padding:14px 12px}.code-toolbar{flex-wrap:wrap;gap:7px}.code-toolbar strong{flex-basis:100%}.code-toolbar>span{margin-left:0}.copy-code{margin-left:auto}.code-example pre{padding:12px;font-size:10px}}
`;

export function renderReport(report: Report, images: Record<string, string> = {}): string {
  const totalFindings = report.summary.errors + report.summary.warnings;
  const scriptHash = createHash('sha256').update(script).digest('base64');
  const failed =
    report.summary.failed > 0 ||
    report.scenarios.some((scenario) =>
      scenario.findings.some((finding) => ['http-error', 'access-blocked'].includes(finding.code)),
    );
  const blocked = report.scenarios.some((scenario) =>
    scenario.findings.some((finding) => finding.code === 'access-blocked'),
  );
  const accessNotice = blocked
    ? `<aside class="access-notice" role="status"><strong>Access blocked: affected website layouts were not inspected.</strong>Cloudflare returned a verification page. The scan stopped immediately without capturing or inspecting it. All remaining scenarios were skipped, with no retry. Blocked and skipped scenarios count as scan errors, not detected layout defects. Use a local build or an approved test environment for a site you control.</aside>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; base-uri 'none'; form-action 'none'"><title>LocaleLens · Layout report</title><link id="report-icon" rel="icon" type="image/png"><style>${styles}${guideStyles}</style></head>
<body><a class="skip-link" href="#results">Skip to results</a><div class="shell"><aside class="sidebar"><a class="brand" href="#"><img class="logo" src="${brandLogo}" width="36" height="36" alt="" /><span>LocaleLens<small>LAYOUT INTELLIGENCE</small></span></a><nav aria-label="Report navigation"><div class="nav-label">WORKSPACE</div><a class="nav-item" href="#results"><span class="nav-icon" aria-hidden="true">▤</span>Scan report</a></nav><div class="sidebar-note">Built for a world<br>with more than one language.<br><br>v${escapeHtml(report.tool.version)}</div><span class="private">OFFLINE REPORT</span></aside>
<main><div class="topbar"><span>LOCAL WORKSPACE <span class="separator">/</span> LAYOUT REPORT</span><time datetime="${escapeHtml(report.startedAt)}">${escapeHtml(new Date(report.startedAt).toISOString().replace('T', ' ').slice(0, 19))} UTC</time></div>
<header class="hero"><div><div class="eyebrow">GIVE YOUR INTERFACE ROOM TO SPEAK.</div><h1>A different language.<br>A clearer picture.</h1><p class="subtitle">${escapeHtml(report.target)}</p></div><div class="run-status"><i aria-hidden="true"></i>${failed ? 'Completed with scan failures' : 'Scan complete'} · ${(report.durationMs / 1000).toFixed(1)}s</div></header>
<section class="stats" aria-label="Scan summary"><div class="stat primary"><span class="stat-label">Introduced findings</span><span class="stat-number">${report.summary.introduced}</span><small>Appeared in stress tests</small></div><div class="stat"><span class="stat-label">Errors</span><span class="stat-number">${report.summary.errors}</span><small>Across all scenarios</small></div><div class="stat"><span class="stat-label">Warnings</span><span class="stat-number">${report.summary.warnings}</span><small>Need a closer look</small></div><div class="stat"><span class="stat-label">Scenarios passed</span><span class="stat-number">${report.summary.passed}<span style="font-size:18px;color:var(--muted)"> / ${report.summary.scenarios}</span></span><small>${report.summary.failed} failed to scan</small></div></section>
<div class="method"><strong>A stress test, not a translation.</strong> Text expansion +${report.config.expansion}% · ${report.config.viewports.length} viewport${report.config.viewports.length === 1 ? '' : 's'} · Browser locale ${escapeHtml(report.config.locale)}. Findings are heuristics; review screenshots and validate with real translations.${report.summary.omitted ? ` <strong>${report.summary.omitted} findings omitted by the configured limit.</strong>` : ''}</div>
${accessNotice}
<section id="results" aria-labelledby="results-heading"><div class="section-heading"><div><h2 id="results-heading">The details</h2><small aria-live="polite"><span id="visible-count">${report.summary.scenarios}</span> scenarios · ${totalFindings} findings</small></div><div><button class="text-button" id="expand" type="button">Expand all</button><button class="text-button" id="collapse" type="button">Collapse all</button></div></div>
<div class="filters"><label class="search"><span class="sr-only">Search routes or selectors</span><input type="search" id="search" placeholder="Search routes, selectors, findings…" /></label><label class="select-field"><span class="sr-only">Filter by mode</span><select id="mode"><option value="">All modes</option>${report.config.modes.map((mode) => `<option value="${mode}">${modeNames[mode]}</option>`).join('')}</select></label><label class="select-field"><span class="sr-only">Filter by result</span><select id="severity"><option value="">All results</option><option value="error">Errors</option><option value="warning">Warnings only</option><option value="passed">Passed</option><option value="failed">Scan failures</option></select></label><label class="checkbox"><input type="checkbox" id="introduced" />Introduced only</label></div>
${report.scenarios.map((scenario, index) => scenarioCard(scenario, report, images, index)).join('')}
<div id="empty" class="empty-state" hidden>No scenarios match these filters.</div></section>
<footer><span>LocaleLens v${escapeHtml(report.tool.version)} · Created by <a href="https://github.com/sikeat7" rel="noreferrer">@sikeat7</a> · Report schema ${report.schemaVersion}</span><span>No external assets. No analytics. Your report stays with you.</span></footer></main></div>
<dialog id="zoom" aria-label="Screenshot preview"><button type="button" id="close-zoom">Close preview</button><img alt="" /></dialog><script>${script}</script></body></html>`;
}
