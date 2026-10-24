/**
 * Test end-to-end a nivel HTTP:
 *   cliente -> servidor Node real con el handler -> fetch -> origen real local
 * Se parchea globalThis.fetch para apuntar al origen local, porque el sandbox
 * no tiene salida a internet, y se simula el rewrite de vercel.json
 * (`/(.*)` -> `/api/proxy?path=$1`).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import handler from '../api/proxy.js';

const ORIGIN_PORT = 8099;
const PROXY_PORT = 8100;
const ORIGIN = `http://127.0.0.1:${ORIGIN_PORT}`;
const ORIGIN_COOKIE = 'inled_proxy_origin';
const realFetch = globalThis.fetch;
let originServer;
let proxyServer;
let originRequests = [];

before(async () => {
  originServer = http.createServer((req, res) => {
    const seen = { url: req.url, method: req.method, headers: req.headers, body: '' };
    originRequests.push(seen);
    req.on('data', (c) => (seen.body += c.toString()));
    req.on('end', () => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: '/destino' });
        return res.end();
      }
      if (req.url === '/salida') {
        res.writeHead(302, { Location: 'https://otro.dominio.com/' });
        return res.end();
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Origin': 'cloudflare-inled',
        'Set-Cookie': ['sesion=abc; Path=/', 'otra=xyz; Path=/api'],
      });
      res.end(JSON.stringify({ ok: true, url: req.url, method: req.method }));
    });
  });
  await new Promise((r) => originServer.listen(ORIGIN_PORT, '127.0.0.1', r));

  // El destino autorizado (apt.inled.es) se resuelve al origen local
  globalThis.fetch = (url, init) =>
    realFetch(String(url).replace('https://apt.inled.es', ORIGIN), init);

  proxyServer = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://proxy.local');

    // Como Vercel: query de la petición + la ruta original vía el rewrite
    req.query = Object.fromEntries(u.searchParams);
    if (u.pathname !== '/api/proxy' && !u.pathname.startsWith('/api/proxy/')) {
      req.query.path = u.pathname.slice(1);
    }
    req.ip = '198.51.100.7';
    req.headers.host = 'proxy.inled.es';

    handler(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(String(err && err.stack));
    });
  });
  await new Promise((r) => proxyServer.listen(PROXY_PORT, '127.0.0.1', r));
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise((r) => proxyServer.close(r));
  await new Promise((r) => originServer.close(r));
});

const go = (path, init = {}) =>
  fetch(`http://127.0.0.1:${PROXY_PORT}${path}`, {
    ...init,
    redirect: 'manual',
    headers: { 'x-vercel-ip-country': 'ES', ...(init.headers || {}) },
  });

test('landing: sin ?url= ni cookie devuelve la página de uso', async () => {
  originRequests = [];
  const res = await go('/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /Proxy inled/);
  assert.match(html, /name="url"/);
  assert.match(html, /Licenciado bajo MIT-INLED/);
  assert.equal(originRequests.length, 0, 'no debe tocar el origen');
});

test('proxy end-to-end: devuelve status, cabeceras y cuerpo del origen', async () => {
  originRequests = [];
  const res = await go('/?url=' + encodeURIComponent('https://apt.inled.es/api/prueba'), {
    headers: { 'user-agent': 'e2e-agent' },
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-origin'), 'cloudflare-inled');
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('x-proxy-by'), 'vercel-proxy-inled');
  assert.deepEqual(await res.json(), { ok: true, url: '/api/prueba', method: 'GET' });

  // La petición llegó al origen con el Host correcto y los encadenados de Vercel
  const seen = originRequests.at(-1);
  assert.equal(seen.headers.host, `127.0.0.1:${ORIGIN_PORT}`);
  assert.equal(seen.headers['user-agent'], 'InledProxy/1.0');
  assert.equal(seen.headers['x-forwarded-host'], 'proxy.inled.es');
  assert.equal(seen.headers['x-forwarded-proto'], 'https');
  assert.ok(seen.headers['x-forwarded-for'].includes('198.51.100.7'));

  // Cookies del origen preservadas + cookie de sesión del proxy
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('sesion=abc')));
  assert.ok(cookies.some((c) => c.startsWith('otra=xyz')));
  assert.ok(cookies.some((c) => c.startsWith(`${ORIGIN_COOKIE}=https%3A%2F%2Fapt.inled.es`)));
});

test('proxy end-to-end: navegación interna con cookie y ruta relativa', async () => {
  originRequests = [];
  const cookie = `${ORIGIN_COOKIE}=${encodeURIComponent('https://apt.inled.es')}`;

  const page = await go('/pagina?seccion=1', { headers: { cookie } });
  assert.equal(page.status, 200);
  const seen = originRequests.at(-1);
  assert.equal(seen.url, '/pagina?seccion=1');

  const asset = await go('/css/site.css?v=5', { headers: { cookie } });
  assert.equal(asset.status, 200);
  assert.equal(originRequests.at(-1).url, '/css/site.css?v=5');
});

test('proxy end-to-end: POST reenvía el cuerpo', async () => {
  originRequests = [];
  const res = await go('/?url=' + encodeURIComponent('https://apt.inled.es/api/datos'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hola: 'mundo' }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, url: '/api/datos', method: 'POST' });

  const seen = originRequests.at(-1);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.body, JSON.stringify({ hola: 'mundo' }));
  assert.equal(seen.headers['content-type'], 'application/json');
});

test('proxy end-to-end: no España -> 302 al destino original', async () => {
  const res = await fetch(
    `http://127.0.0.1:${PROXY_PORT}/?url=${encodeURIComponent('https://apt.inled.es/')}`,
    { redirect: 'manual', headers: { 'x-vercel-ip-country': 'FR' } }
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://apt.inled.es/');
});

test('proxy end-to-end: redirección interna del origen se reenvía por el proxy', async () => {
  const res = await go('/?url=' + encodeURIComponent('https://apt.inled.es/redirect'));
  assert.equal(res.status, 302);
  assert.equal(
    res.headers.get('location'),
    '/api/proxy?url=' + encodeURIComponent('https://apt.inled.es/destino')
  );
});

test('proxy end-to-end: redirección de salida del origen -> 403', async () => {
  const res = await go('/?url=' + encodeURIComponent('https://apt.inled.es/salida'));
  assert.equal(res.status, 403);
});

test('proxy end-to-end: dominio ajeno -> 403 sin tocar el origen', async () => {
  originRequests = [];
  const res = await go('/?url=' + encodeURIComponent('https://evil.com/'));
  assert.equal(res.status, 403);
  assert.equal(originRequests.length, 0);
});
