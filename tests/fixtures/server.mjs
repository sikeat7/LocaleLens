import http from 'node:http';

export async function fixtureServer() {
  const server = http.createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname;
    if (route === '/missing') {
      response.writeHead(404).end('Missing page');
      return;
    }
    if (route === '/redirect') {
      response.writeHead(302, { Location: 'http://localhost:1/' }).end();
      return;
    }
    if (route === '/auth' && !request.headers.cookie?.includes('session=allowed')) {
      response.writeHead(401).end('Authentication required');
      return;
    }
    const styles = `*{box-sizing:border-box}body{margin:0;font:16px/24px Arial,sans-serif}main{padding:24px;max-width:600px}h1{font-size:24px;line-height:32px}button{font:16px/24px Arial,sans-serif}.fixed{width:100px;white-space:nowrap;overflow:hidden}.wide{width:800px;height:32px;background:#eee}.safe{overflow-wrap:anywhere;max-width:100%}.ellipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:40px}.scroller{width:200px;overflow-x:auto}.intentional{width:600px}.hidden{display:none}.rtl-trap{position:relative;left:calc(100% - 100px);width:100px}`;
    let body =
      '<main><h1>Welcome home</h1><p class="safe">A flexible interface with space for every language.</p></main>';
    if (route === '/expansion')
      body = '<main><button id="tight" class="fixed">Continue</button></main>';
    if (route === '/wide')
      body = '<main><div class="wide" id="wide">Existing overflow</div></main>';
    if (route === '/ignore')
      body = '<main><div class="wide" data-localelens-ignore>Ignored overflow</div></main>';
    if (route === '/false-positives')
      body =
        '<main><div class="ellipsis">Intentional truncation</div><div class="scroller"><div class="intentional">A horizontally scrolling list</div></div><div class="hidden wide">Hidden text</div></main>';
    if (route === '/rtl') body = '<main><div class="rtl-trap" id="trap">Saved</div></main>';
    if (route === '/secret')
      body =
        '<main><div class="wide" id="wrapper"><span id="secret">PRIVATE-SECRET-98765</span><span>Public text</span></div></main>';
    if (route === '/script-error')
      body += '<script>throw new Error("Deliberate app failure")</script>';
    if (route === '/long') body += '<div style="height:18000px">Long page</div>';
    if (route === '/xss')
      body =
        '<main><div class="wide" id="injection">&lt;img src=x onerror=alert(1)&gt;</div></main>';
    if (route === '/many')
      body =
        '<main>' +
        Array.from(
          { length: 12 },
          (_, index) =>
            `<button id="clip-${index}" class="fixed">A very long fixed width button label</button>`,
        ).join('') +
        '</main>';
    if (route === '/delayed')
      body =
        '<main><script>setTimeout(()=>{const e=document.createElement("h1");e.id="ready";e.textContent="Ready";document.body.append(e)},150)</script></main>';
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${styles}</style></head><body>${body}</body></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
