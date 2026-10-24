import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { PROXY_USER_AGENT } from '../api/proxy.js';

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
  assert.match(res.body, /INLED/);
  assert.match(res.body, /name="url"/);
  // La landing no explica nada interno: solo input y formato
  assert.ok(!res.body.includes(PROXY_USER_AGENT), res.body);
  assert.ok(!/User-Agent|Cloudflare|WAF|cookie|país/i.test(res.body), res.body);
  assert.match(res.body, /\?url=https:\/\/apt\.inled\.es/);
});

test('403 si el destino no es inled.es', async () => {
  for (const url of ['https://evil.com/', 'https://inled.es.evil.com/', 'ftp://apt.inled.es/', 'not-a-url']) {
    const res = await runHandler(
      makeReq({ query: { url }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    assert.equal(res.status, 403, `debería bloquear ${url}`);
    assert.equal(res.headers['x-proxy-error'], 'target-not-allowed', `sin cabecera de error en ${url}`);
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
    // Diagnóstico en cabeceras (no visible en el front)
    assert.equal(res.headers['x-origin-status'], '201');
    assert.equal(res.headers['x-proxy-by'], 'vercel-proxy-inled');

    const seen = stub.calls[0];
    assert.equal(seen.init.headers['host'], 'apt.inled.es');
    // El User-Agent del cliente se sustituye por el del proxy
    assert.equal(seen.init.headers['user-agent'], PROXY_USER_AGENT);
    assert.match(PROXY_USER_AGENT, /^[A-Za-z][A-Za-z-]*\/\d+\.\d+$/);
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

test('reescribe en HTML todas las URLs absolutas del origen (nada escapa al CF)', async () => {
  const html = `<!doctype html><html><head>
<link rel="stylesheet" href="https://apt.inled.es/css/site.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/x.css">
<link rel="stylesheet" href="/rel.css">
<link rel="stylesheet" href="//apt.inled.es/proto.css">
<base href="https://apt.inled.es/app/">
</head><body>
<a href="https://apt.inled.es/ruta?x=1&amp;y=2">ir</a>
<img src="https://inled.es/logo.png" srcset="https://apt.inled.es/a.png 1x, https://apt.inled.es/b.png 2x">
<script src="https://apt.inled.es/app.js"></script>
<script>fetch('https://apt.inled.es/api/datos')</script>
</body></html>`;
  const stub = stubFetch(
    () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  );

  try {
    const res = await runHandler(
      makeReq({ query: { url: 'https://apt.inled.es/app/' }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    assert.equal(res.status, 200);
    const body = res.body;
    const O = '__origin=https%3A%2F%2Fapt.inled.es';

    // Absolutas del origen -> ruta del proxy con el origen marcado
    assert.ok(body.includes(`href="/css/site.css?${O}"`), 'css absoluto');
    assert.ok(body.includes(`href="/proto.css?${O}"`), 'protocol-relative');
    assert.ok(body.includes(`href="/app/?__origin=https%3A%2F%2Fapt.inled.es"`), 'base');
    assert.ok(body.includes(`href="/ruta?${O}&x=1&amp;y=2"`), 'ancla con query');
    assert.ok(body.includes(`src="/logo.png?__origin=https%3A%2F%2Finled.es"`), 'host inled.es');
    assert.ok(body.includes(`/a.png?${O} 1x`), 'srcset');
    assert.ok(body.includes(`/b.png?${O} 2x`), 'srcset 2');
    assert.ok(body.includes(`/api/datos?${O}`), 'fetch en JS');

    // Relativas y terceros intactos
    assert.ok(body.includes('href="/rel.css"'), 'relativa intacta');
    assert.ok(body.includes('href="https://fonts.googleapis.com/x.css"'), 'tercero intacto');
  } finally {
    stub.restore();
  }
});

test('reescribe también CSS, pero no JSON', async () => {
  const stub = stubFetch((url) =>
    url.includes('hoja')
      ? new Response('body{background:url(https://apt.inled.es/img/bg.png)}', {
          status: 200,
          headers: { 'content-type': 'text/css' },
        })
      : new Response('{"url":"https://apt.inled.es/x"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
  );

  try {
    const css = await runHandler(
      makeReq({ query: { url: 'https://apt.inled.es/hoja' }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    assert.ok(
      css.body.includes('url(/img/bg.png?__origin=https%3A%2F%2Fapt.inled.es)'),
      'url() de CSS reescrita'
    );

    const json = await runHandler(
      makeReq({ query: { url: 'https://apt.inled.es/api' }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    assert.equal(json.body, '{"url":"https://apt.inled.es/x"}', 'JSON intacto');
  } finally {
    stub.restore();
  }
});

test('un 403 normal del origen NO se confunde con un desafío (no se enmascara)', async () => {
  const stub = stubFetch(
    () =>
      new Response('<html><head><title>Acceso denegado</title></head><body>403 de la app</body></html>', {
        status: 403,
        headers: { server: 'cloudflare', 'content-type': 'text/html; charset=utf-8' },
      })
  );

  try {
    const res = await runHandler(
      makeReq({ query: { url: 'https://apt.inled.es/app' }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    // Se devuelve el 403 real del origen, sin sustituirlo por la página de error
    assert.equal(res.status, 403);
    assert.equal(res.headers['x-origin-status'], '403');
    assert.equal(res.headers['x-proxy-error'], undefined);
    assert.match(res.body, /403 de la app/);
  } finally {
    stub.restore();
  }
});

test('?__origin con ruta de la petición combina origen y ruta', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));

  try {
    await runHandler(
      makeReq({
        query: { path: 'panel', __origin: 'https://apt.inled.es', page: '2' },
        headers: { 'x-vercel-ip-country': 'ES' },
      })
    );
    assert.equal(stub.calls[0].url, 'https://apt.inled.es/panel?page=2');
  } finally {
    stub.restore();
  }
});

test('no se permite proxear el propio proxy (bucle)', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    const res = await runHandler(
      makeReq({
        query: { url: 'https://proxy.inled.es/algo' },
        headers: { 'x-vercel-ip-country': 'ES' },
      })
    );
    assert.equal(res.status, 403);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('si el primer intento recibe reto y el limpio pasa, se sirve la respuesta', async () => {
  const original = globalThis.fetch;
  const calls = [];
  let n = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    n += 1;
    if (n === 1) {
      return new Response('<html><head><title>Just a moment...</title></head></html>', {
        status: 403,
        headers: { server: 'cloudflare', 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('<html><body>ok limpio</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  try {
    const res = await runHandler(
      makeReq({
        query: { url: 'https://apt.inled.es/panel' },
        headers: {
          'x-vercel-ip-country': 'ES',
          cookie: 'cf_clearance=abc; sesion=1',
          referer: 'https://proxy.inled.es/panel',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'navigate',
        },
      })
    );

    assert.equal(res.status, 200);
    assert.match(res.body, /ok limpio/);
    assert.equal(calls.length, 2, 'debe reintentar una sola vez');
    // Primera petición: ya sin cookies de navegador atadas al cliente
    assert.equal(calls[0].init.headers['cookie'], 'sesion=1');
    // Reintento: sin cookies ni cabeceras de contexto
    assert.equal(calls[1].init.headers['cookie'], undefined);
    assert.equal(calls[1].init.headers['sec-fetch-site'], undefined);
    assert.equal(calls[1].init.headers['referer'], 'https://apt.inled.es/panel');
    assert.equal(calls[0].init.headers['referer'], 'https://apt.inled.es/panel');
    assert.equal(calls[1].init.headers['user-agent'], PROXY_USER_AGENT);
  } finally {
    globalThis.fetch = original;
  }
});

test('reescribe Referer y Origin del proxy (evita hotlink y CORS en el origen)', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    await runHandler(
      makeReq({
        method: 'POST',
        body: '{}',
        headers: {
          'x-vercel-ip-country': 'ES',
          host: 'proxy.inled.es',
          referer: 'https://proxy.inled.es/pagina?x=1&__origin=https%3A%2F%2Fapt.inled.es',
          origin: 'https://proxy.inled.es',
          'content-type': 'application/json',
        },
        query: { url: 'https://apt.inled.es/form' },
      })
    );
    const h = stub.calls[0].init.headers;
    assert.equal(h['referer'], 'https://apt.inled.es/pagina?x=1');
    assert.equal(h['origin'], 'https://apt.inled.es');
    assert.ok(!/__origin|proxy\.inled\.es/.test(h['referer']));
  } finally {
    stub.restore();
  }
});

test('Referer de un tercero no se reenvía al origen', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    await runHandler(
      makeReq({
        query: { url: 'https://apt.inled.es/' },
        headers: {
          'x-vercel-ip-country': 'ES',
          referer: 'https://ejemplo.com/articulo',
          origin: 'https://ejemplo.com',
        },
      })
    );
    const h = stub.calls[0].init.headers;
    assert.equal(h['referer'], undefined);
    assert.equal(h['origin'], undefined);
  } finally {
    stub.restore();
  }
});

test('Referer de propio origen inled se conserva tal cual', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    await runHandler(
      makeReq({
        query: { url: 'https://apt.inled.es/' },
        headers: { 'x-vercel-ip-country': 'ES', referer: 'https://inled.es/blog/entrada' },
      })
    );
    assert.equal(stub.calls[0].init.headers['referer'], 'https://inled.es/blog/entrada');
  } finally {
    stub.restore();
  }
});

test('no reenvía la cookie de sesión del proxy al origen', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    await runHandler(
      makeReq({
        query: { url: 'https://apt.inled.es/' },
        headers: {
          'x-vercel-ip-country': 'ES',
          cookie: `inled_proxy_origin=${encodeURIComponent('https://apt.inled.es')}; sesion=abc`,
        },
      })
    );
    assert.equal(stub.calls[0].init.headers['cookie'], 'sesion=abc');
  } finally {
    stub.restore();
  }
});

test('limpia el Domain de cookies que el navegador rechazaría', async () => {
  const originHeaders = new Headers();
  originHeaders.append('set-cookie', 'sesion=1; Path=/; Domain=apt.inled.es; HttpOnly');
  originHeaders.append('set-cookie', 'prefs=2; Path=/; Domain=inled.es');
  originHeaders.append('set-cookie', 'hostonly=3; Path=/');
  const stub = stubFetch(() => new Response('ok', { status: 200, headers: originHeaders }));

  try {
    const res = await runHandler(
      makeReq({ query: { url: 'https://apt.inled.es/' }, headers: { 'x-vercel-ip-country': 'ES' } })
    );
    const cookies = [].concat(res.headers['set-cookie']);
    const sesion = cookies.find((c) => c.startsWith('sesion=1'));
    assert.ok(sesion && !/domain=/i.test(sesion), `Domain inútil no eliminada: ${sesion}`);
    assert.ok(sesion.includes('HttpOnly'));
    assert.ok(cookies.some((c) => /Domain=inled\.es/i.test(c)), 'Domain=inled.es se conserva');
    assert.ok(cookies.some((c) => c.startsWith('hostonly=3')));
  } finally {
    stub.restore();
  }
});

test('desafío de Cloudflare -> página de diagnóstico, no bucle infinito', async () => {
  const stub = stubFetch(
    () =>
      new Response('<html><head><title>Just a moment...</title></head></html>', {
        status: 403,
        headers: {
          'cf-mitigated': 'challenge',
          server: 'cloudflare',
          'content-type': 'text/html; charset=utf-8',
        },
      })
  );

  try {
    const res = await runHandler(
      makeReq({
        query: { url: 'https://apt.inled.es/app' },
        headers: { 'x-vercel-ip-country': 'ES' },
      })
    );    assert.equal(res.status, 502);
    assert.equal(res.headers['x-proxy-error'], 'origin-refused');
    // El origen ya ha reintentado una vez y sigue exigiendo el reto
    assert.equal(stub.calls.length, 2);
    // El reintento va sin cookies ni marcas de contexto del navegador
    assert.equal(stub.calls[1].init.headers['cookie'], undefined);
    assert.equal(stub.calls[1].init.headers['sec-fetch-site'], undefined);
    assert.equal(stub.calls[1].init.headers['user-agent'], PROXY_USER_AGENT);
    // Diagnóstico: qué status y qué motivo ha dado el origen
    assert.equal(res.headers['x-origin-status'], '403');
    assert.equal(res.headers['x-origin-flag'], 'challenge-header');
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /No se ha podido cargar la página/);
  // Nada de detalles internos en el front
  assert.ok(!res.body.includes(PROXY_USER_AGENT), res.body);
  assert.ok(!/User-Agent|Cloudflare|WAF|desafío/i.test(res.body), res.body);
  assert.ok(res.body.includes('/?url=' + encodeURIComponent('https://apt.inled.es/app')));
  } finally {
    stub.restore();
  }
});
