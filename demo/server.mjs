import http from 'node:http';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const port = Number(process.env.PORT ?? 4173);
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  if (!['/', '/healthy'].includes(url.pathname)) {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(
    url.pathname === '/healthy' ? html.replace('<body>', '<body class="healthy">') : html,
  );
});
server.listen(port, '127.0.0.1', () => {
  console.log(
    `LocaleLens demo: http://127.0.0.1:${port}\nIntentionally fragile: /\nFlexible layout: /healthy\nPress Ctrl+C to stop.`,
  );
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
