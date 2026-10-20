// Browser-only verification for environments that cannot launch Chromium subprocesses.
// This is supplementary: it does not replace the scanner/CLI Chromium integration suite.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fixtureServer } from './fixtures/server.mjs';

const fixture = await fixtureServer();
const html = await readFile(new URL('./browser-harness.html', import.meta.url));
const browserCode = await readFile(new URL('../dist/browser.js', import.meta.url));
const demoHtml = await readFile(new URL('../demo/index.html', import.meta.url), 'utf8');
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/report') {
      response
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(await readFile(new URL('../work/preview-report/index.html', import.meta.url)));
      return;
    }
    if (url.pathname === '/capture') {
      const route = ['/demo', '/demo-healthy'].includes(url.searchParams.get('route'))
        ? url.searchParams.get('route')
        : '/demo';
      const mode = ['baseline', 'expanded', 'rtl'].includes(url.searchParams.get('mode'))
        ? url.searchParams.get('mode')
        : 'baseline';
      response
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(
          `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>LocaleLens verified browser capture</title><style>html,body{margin:0;padding:0}iframe{border:0;display:block;width:390px;height:844px}</style></head><body><iframe title="Verified layout" src="${route}?harness=1&mode=${mode}"></iframe></body></html>`,
        );
      return;
    }
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
      return;
    }
    if (url.pathname === '/browser.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(browserCode);
      return;
    }
    if (url.pathname === '/browser-adapter.js') {
      response
        .writeHead(200, { 'Content-Type': 'text/javascript' })
        .end(
          'import * as checks from "/browser.js"; window.localelensChecks = checks; const mode = new URL(location.href).searchParams.get("mode"); if(mode) { const options={mode,expansion:40,ignore:[],mask:[],checks:["horizontal-overflow","clipped-text"],maxFindings:100}; checks.transformPage(options); requestAnimationFrame(()=>requestAnimationFrame(()=>{checks.annotatePage(checks.inspectPage(options).findings);document.documentElement.dataset.captureReady="true";})); }',
        );
      return;
    }
    const target = await fetch(`${fixture.url}${url.pathname}${url.search}`);
    let body =
      url.pathname === '/demo'
        ? demoHtml
        : url.pathname === '/demo-healthy'
          ? demoHtml.replace('<body>', '<body class="healthy">')
          : await target.text();
    if (url.searchParams.has('harness'))
      body = body.replace(
        '</body>',
        '<script type="module" src="/browser-adapter.js"></script></body>',
      );
    response
      .writeHead(url.pathname.startsWith('/demo') ? 200 : target.status, {
        'Content-Type': 'text/html; charset=utf-8',
      })
      .end(body);
  } catch {
    response.writeHead(500).end('Harness fixture failed');
  }
});
server.listen(4174, '127.0.0.1', () =>
  console.log('Supplementary browser checks: http://127.0.0.1:4174'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    server.close();
    await fixture.close();
  });
