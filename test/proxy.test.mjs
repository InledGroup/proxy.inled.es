import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/proxy.js';

const ORIGIN_COOKIE = 'inled_proxy_origin';

function makeReq({ method = 'GET', headers = {}, query = {}, body } = {}) {
  const chunks = body ? [Buffer.from(body)] : [];
  const req = {
    method,
    headers: { host: 'proxy.inled.es', ...headers },
    query,
    ip: '203.0.113.10',
    [Symbol.asyncIterator]: async function* () {
      for (const c of chunks) yield c;
    },
  };
  return req;
}

function runHandler(req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      ended: false,
      body: Buffer.alloc(0),
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[name.toLowerCase()];
      },
      end(chunk) {
        if (this.ended) return;
        this.ended = true;
        if (chunk) this.body = Buffer.from(chunk);
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: this.body.toString('utf8'),
        });
      },
    };
    handler(req, res).catch((err) => resolve({ error: err }));
  });
}

function stubFetch(impl) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test('sin parámetro url ni cookie -> landing page', async () => {
  const res = await runHandler(makeReq({ headers: { 'x-vercel-ip-country': 'ES' } }));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Proxy inled/);
  assert.match(res.body, /apt\.inled\.es/);
});

test('403 si el destino no es inled.es', async () => {
  for (const url of ['https://evil.com/', 'https://inled.es.evil.com/', 'ftp://apt.inled.es/', 'not-a-url']) {
    const res = await runHandler(
      makeReq({ query: { url }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    assert.equal(res.status, 403, `debería bloquear ${url}`);
  }
});

test('302 directo al destino si no viene de España', async () => {
  const res = await runHandler(
    makeReq({
      query: { url: 'https://apt.inled.es/sistema' },
      headers: { 'x-vercel-ip-country': 'DE' },
    })
  );
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, 'https://apt.inled.es/sistema');
});

test('proxy completo con ES: devuelve status, cabeceras y cuerpo', async () => {
  const stub = stubFetch(
    () =>
      new Response(Buffer.from('<html>ok</html>'), {
        status: 201,
        headers: { 'content-type': 'text/html; charset=utf-8', 'x-origen': 'cloudflare' },
      })
  );

  try {
    const res = await runHandler(
      makeReq({
        query: { url: 'https://apt.inled.es/api/datos' },
        headers: { 'x-vercel-ip-country': 'ES', 'user-agent': 'test-agent' },
      })
    );

    assert.equal(res.status, 201);
    assert.equal(res.body, '<html>ok</html>');
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['x-origen'], 'cloudflare');
    assert.equal(res.headers['access-control-allow-origin'], '*');

    const seen = stub.calls[0];
    assert.equal(seen.init.headers['host'], 'apt.inled.es');
    assert.equal(seen.init.headers['user-agent'], 'test-agent');
    assert.equal(seen.init.headers['x-forwarded-host'], 'proxy.inled.es');
    assert.equal(seen.init.headers['x-forwarded-proto'], 'https');
    assert.ok(seen.init.headers['x-forwarded-for'].includes('203.0.113.10'));
    assert.equal(seen.init.headers['accept-encoding'], 'identity');
    assert.equal(seen.url, 'https://apt.inled.es/api/datos');
  } finally {
    stub.restore();
  }
});

test('guarda el origen en la cookie de sesión al proxificar con ?url=', async () => {
  const stub = stubFetch(
    () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })
  );

  try {
    const res = await runHandler(
      makeReq({
        query: { url: 'https://apt.inled.es/pagina' },
        headers: { 'x-vercel-ip-country': 'ES' },
      })
    );
    const cookies = [].concat(res.headers['set-cookie']);
    const ours = cookies.find((c) => c.startsWith(`${ORIGIN_COOKIE}=`));
    assert.ok(ours, 'falta la cookie de origen');
    assert.match(ours, /Path=\//);
    assert.match(ours, /Secure/);
    assert.ok(decodeURIComponent(ours.split(';')[0].split('=')[1]) === 'https://apt.inled.es');
  } finally {
    stub.restore();
  }
});

test('sin ?url= usa la cookie + la ruta pedida (navegación interna)', async () => {
  const stub = stubFetch(() => new Response('css', { status: 200 }));

  try {
    const res = await runHandler(
      makeReq({
        query: { path: 'css/site.css', v: '5' },
        headers: {
          'x-vercel-ip-country': 'ES',
          cookie: `${ORIGIN_COOKIE}=${encodeURIComponent('https://apt.inled.es')}`,
        },
      })
    );

    assert.equal(res.status, 200);
    assert.equal(stub.calls[0].url, 'https://apt.inled.es/css/site.css?v=5');
  } finally {
    stub.restore();
  }
});

test('la ruta de la cookie no puede salirse del origen (//host, rutas raras)', async () => {
  const stub = stubFetch(() => new Response('x', { status: 200 }));

  try {
    for (const path of ['//evil.com/robo', 'https://evil.com/robo', '/../../algo']) {
      const res = await runHandler(
        makeReq({
          query: { path },
          headers: {
            'x-vercel-ip-country': 'ES',
            cookie: `${ORIGIN_COOKIE}=${encodeURIComponent('https://apt.inled.es')}`,
          },
        })
      );
      assert.equal(res.status, 200, path);
      const host = new URL(stub.calls.at(-1).url).host;
      assert.equal(host, 'apt.inled.es', `se escapó el host con ${path}: ${stub.calls.at(-1).url}`);
    }
  } finally {
    stub.restore();
  }
});

test('cookie de origen inválida -> landing, sin tocar la red', async () => {
  const stub = stubFetch(() => new Response('x', { status: 200 }));

  try {
    const res = await runHandler(
      makeReq({
        query: { path: 'algo' },
        headers: { 'x-vercel-ip-country': 'ES', cookie: `${ORIGIN_COOKIE}=https%3A%2F%2Fevil.com` },
      })
    );
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('preserva las cookies del origen por separado', async () => {
  const originHeaders = new Headers();
  originHeaders.append('set-cookie', 'a=1; Path=/');
  originHeaders.append('set-cookie', 'b=2; Path=/x');
  const stub = stubFetch(() => new Response('ok', { status: 200, headers: originHeaders }));

  try {
    const res = await runHandler(
      makeReq({ query: { url: 'https://apt.inled.es/' }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    const cookies = [].concat(res.headers['set-cookie']);
    assert.ok(cookies.some((c) => c.startsWith('a=1;')));
    assert.ok(cookies.some((c) => c.startsWith('b=2;')));
    assert.ok(cookies.some((c) => c.startsWith(`${ORIGIN_COOKIE}=`)));
  } finally {
    stub.restore();
  }
});

test('redirección del origen hacia otro dominio inled.es se reenvía por el proxy', async () => {
  const stub = stubFetch(
    () => new Response(null, { status: 301, headers: { location: 'https://inled.es/nuevo' } })
  );

  try {
    const res = await runHandler(
      makeReq({ query: { url: 'https://apt.inled.es/' }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, '/api/proxy?url=https%3A%2F%2Finled.es%2Fnuevo');
  } finally {
    stub.restore();
  }
});

test('redirección del origen hacia un dominio ajeno se bloquea', async () => {
  const stub = stubFetch(
    () => new Response(null, { status: 302, headers: { location: 'https://evil.com/phish' } })
  );

  try {
    const res = await runHandler(
      makeReq({ query: { url: 'https://apt.inled.es/' }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    assert.equal(res.status, 403);
  } finally {
    stub.restore();
  }
});

test('reenvía el cuerpo de peticiones POST', async () => {
  const stub = stubFetch(
    () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
  );

  try {
    const res = await runHandler(
      makeReq({
        method: 'POST',
        body: '{"a":1}',
        headers: { 'x-vercel-ip-country': 'ES', 'content-type': 'application/json' },
        query: { url: 'https://apt.inled.es/api' },
      })
    );
    assert.equal(res.status, 200);
    assert.equal(res.body, '{"ok":true}');
    assert.equal(Buffer.from(stub.calls[0].init.body).toString(), '{"a":1}');
    assert.equal(stub.calls[0].init.method, 'POST');
  } finally {
    stub.restore();
  }
});

test('OPTIONS responde 204 con CORS', async () => {
  const res = await runHandler(makeReq({ method: 'OPTIONS' }));
  assert.equal(res.status, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
});
