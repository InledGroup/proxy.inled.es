/**
 * Reverse proxy para Vercel (proxy.inled.es)
 *
 * Entrada:
 *   https://proxy.inled.es/?url=https://apt.inled.es/ruta
 *
 * Navegación interna (una vez dentro):
 *   El rewrite de vercel.json manda la ruta original como ?path=...
 *   Si no hay ?url=, se reutiliza el origen guardado en la cookie `inled_proxy_origin`,
 *   de forma que los enlaces y recursos relativos del sitio proxificado siguen
 *   pasando por el proxy.
 *
 * Reglas:
 *  1. Si x-vercel-ip-country === 'ES' -> se pide el destino desde Vercel y se
 *     devuelve la respuesta completa (status, cabeceras y cuerpo) al cliente.
 *  2. Si no es España -> 302 directo a la URL original.
 *  3. Solo se permite proxy hacia *.inled.es (y el propio inled.es).
 *  4. Sin destino resoluble -> landing page de uso.
 */

import { renderLanding, renderChallenge } from '../lib/landing.js';

const DOMAIN = 'inled.es';

/** User-Agent con el que el proxy pide al origen (autorizable en Cloudflare). */
const PROXY_USER_AGENT = 'InledProxy/1.0';

/** Parámetro con el que se marca el origen en los enlaces reescritos. */
const ORIGIN_PARAM = '__origin';

/** Tipos de contenido cuyo cuerpo se reescribe para que no escape al origen. */
const REWRITABLE_TYPE = /(?:text\/html|application\/xhtml\+xml|text\/css|javascript|ecmascript)/i;
const UTF8_CHARSET = /^(?:utf-?8|us-ascii|ascii|unicode|)$/i;
const MAX_REWRITE_BYTES = 5 * 1024 * 1024;

/** Cookie que recuerda el origen de la sesión proxificada. */
const ORIGIN_COOKIE = 'inled_proxy_origin';

// Cabeceras hop-by-hop que no deben reenviarse (RFC 7230 §6.1)
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

// Cabeceras del cliente que gestiona Vercel / el propio proxy
const CLIENT_MANAGED = new Set([
  'host',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'forwarded',
  'content-length',
]);

const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';

function isAllowedHost(hostname) {
  if (!hostname) return false;
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  return host === DOMAIN || host.endsWith('.' + DOMAIN);
}

function firstValue(value) {
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'string' ? value : '';
}

/** Valida y normaliza una URL de destino. Devuelve null si no es válida. */
function parseTarget(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isAllowedHost(url.hostname)) return null;
  return url;
}

/** Lee una cookie de la petición. */
function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return '';
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const value = part.slice(i + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return '';
}

/** Query original leída de req.url (red de seguridad si ?path= no llega). */
function rawQueryParam(req, key) {
  const raw = String(req.url || '');
  const i = raw.indexOf('?');
  if (i === -1) return '';
  try {
    return new URLSearchParams(raw.slice(i + 1)).get(key) || '';
  } catch {
    return '';
  }
}

/**
 * Ruta original que el navegador pidió (sin query).
 * - `?path=` lo pone el rewrite de vercel.json.
 * - Si la petición es directa a /api/proxy, no hay ruta: se queda vacía.
 */
function requestPath(req) {
  const q = req.query || {};
  const fromQuery = firstValue(q.path);
  if (typeof q.path === 'string' || Array.isArray(q.path)) return fromQuery;

  const raw = String(req.url || '/').split('?')[0];
  if (raw === '/api/proxy' || raw === '/api/proxy/' || raw.startsWith('/api/proxy/')) return '';
  return raw;
}

/**
 * Convierte la ruta pedida en una ruta-URL relativa al origen.
 * Descarta host absoluto (?), heredado o cualquier intento de salirse del origen.
 */
function toRelativePath(pathname) {
  const value = String(pathname || '');
  if (!value) return '/';
  try {
    const u = new URL(value, 'http://proxy.local');
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

/** Query de la petición original a reenviar (sin nuestros parámetros internos). */
function forwardedSearch(req) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === 'path' || key === 'url' || key === ORIGIN_PARAM) continue;
    for (const item of [].concat(value)) {
      if (item !== undefined && item !== null) params.append(key, String(item));
    }
  }
  return params.toString();
}

/** Combina el origen con la ruta pedida por el navegador. */
function buildTarget(origin, pathParam, search) {
  try {
    const rel = toRelativePath(pathParam);
    return new URL(search ? `${rel}?${search}` : rel, origin);
  } catch {
    return null;
  }
}

/**
 * Resuelve qué destino toca.
 *  - con ?url= (o ?__origin=) -> ese origen; si no trae ruta propia, se le
 *    suma la ruta que pidió el navegador (así los enlaces reescritos funcionan).
 *  - sin parámetros -> origen guardado en cookie + ruta de la petición.
 */
function resolveTarget(req) {
  const q = req.query || {};
  const raw =
    firstValue(q.url) ||
    rawQueryParam(req, 'url') ||
    firstValue(q[ORIGIN_PARAM]) ||
    rawQueryParam(req, ORIGIN_PARAM);

  const pathParam = requestPath(req);
  const search = forwardedSearch(req);
  const requestHost = String((req.headers && req.headers.host) || '')
    .split(':')[0]
    .toLowerCase();

  let target;
  if (raw) {
    const parsed = parseTarget(raw);
    if (!parsed) return { error: 'forbidden' };
    target = parsed.pathname === '/' && !parsed.search ? buildTarget(parsed, pathParam, search) : parsed;
  } else {
    const base = parseTarget(readCookie(req, ORIGIN_COOKIE));
    if (!base) return { error: 'landing' };
    target = buildTarget(base, pathParam, search);
  }

  if (!target) return { error: 'forbidden' };
  if (!isAllowedHost(target.hostname)) return { error: 'forbidden' };
  // Nunca contra el propio proxy (bucle infinito)
  if (requestHost && target.hostname === requestHost) return { error: 'forbidden' };
  return { target };
}

/**
 * Convierte una URL absoluta del origen en un enlace que se quede en el proxy:
 *   https://apt.inled.es/ruta?x=1  ->  /ruta?__origin=https%3A%2F%2Fapt.inled.es&x=1
 */
function proxiedForm(origin, rest) {
  let value = String(rest || '');
  let hash = '';
  const h = value.indexOf('#');
  if (h >= 0) {
    hash = value.slice(h);
    value = value.slice(0, h);
  }
  let path = '/';
  let search = '';
  const q = value.indexOf('?');
  if (q >= 0) {
    path = value.slice(0, q);
    search = value.slice(q + 1);
  } else {
    path = value;
  }
  if (!path) path = '/';
  if (!path.startsWith('/')) path = '/' + path;
  return `${path}?${ORIGIN_PARAM}=${encodeURIComponent(origin)}${search ? `&${search}` : ''}${hash}`;
}

/**
 * Reescribe en HTML/CSS/JS todas las URLs absolutas hacia inled.es para que
 * el navegador las pida al proxy en vez de ir directo al origen (que es lo
 * que Cloudflare sigue desafiando con el User-Agent del navegador).
 * Las relativas y las de terceros se tocan solo si aplica.
 */
function rewriteProxiedUrls(text) {
  return text.replace(
    /(?:(https?):)?\/\/((?:[a-z0-9-]+\.)*inled\.es)(?![a-z0-9.-])((?::\d+)?)((?:[^\s"'`<>\\)\]]*))/gi,
    (match, scheme, host, port, rest) => {
      if (!isAllowedHost(host)) return match;
      const origin = `${(scheme || 'https').toLowerCase()}://${host}${port}`;
      return proxiedForm(origin, rest || '');
    }
  );
}

/** La cookie del propio proxy no debe reenviarse al origen. */
function stripOwnCookie(cookieHeader) {
  if (!cookieHeader) return cookieHeader;
  const kept = String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.split('=')[0].trim() !== ORIGIN_COOKIE);
  return kept.length ? kept.join('; ') : '';
}

/**
 * Cookies del origen: si apuntan a un dominio que el navegador rechazaría
 * desde proxy.inled.es (p. ej. Domain=apt.inled.es, cf_clearance...), se quita
 * el atributo Domain y queda host-only para el proxy.
 */
function normalizeSetCookie(cookie) {
  const match = /;\s*domain=([^;]*)/i.exec(cookie);
  if (!match) return cookie;
  const domain = match[1].trim().replace(/^\./, '').toLowerCase();
  if (domain === 'inled.es' || domain === 'proxy.inled.es') return cookie;
  return cookie.replace(match[0], '');
}

/** ¿La respuesta es un desafío de Cloudflare que el navegador no puede completar? */
function isCloudflareChallenge(response, payload) {
  const mitigated = String(response.headers.get('cf-mitigated') || '').toLowerCase();
  if (mitigated === 'challenge') return true;
  if (response.status !== 403 && response.status !== 503) return false;
  const server = String(response.headers.get('server') || '').toLowerCase();
  if (!server.includes('cloudflare')) return false;
  if (!payload || !payload.length) return false;
  const head = payload.subarray(0, 8192).toString('utf8');
  return /<title>Just a moment|cf-browser-verification|challenge-platform/i.test(head);
}

const CORS_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';

function sendText(res, status, message) {
  const payload = Buffer.from(String(message), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', String(payload.length));
  res.end(payload);
}

function sendHtml(res, status, html) {
  const payload = Buffer.from(String(html), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(payload.length));
  res.end(payload);
}

function sendRedirect(res, status, location) {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.setHeader('Content-Length', '0');
  res.end();
}

/** Cabeceras de la petición original reenviadas al destino (con Host correcto). */
function buildRequestHeaders(req, target) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const name = key.toLowerCase();
    if (HOP_BY_HOP.has(name) || CLIENT_MANAGED.has(name)) continue;
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }

  // Host de la infraestructura de destino (inled/Cloudflare) y encadenado de proxies
  headers['host'] = target.host;
  headers['x-forwarded-host'] = req.headers.host || target.host;
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-for'] =
    (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']) + ', ' : '') +
    (req.headers['x-real-ip'] || req.ip || '');
  if (req.headers['x-real-ip']) headers['x-real-ip'] = String(req.headers['x-real-ip']);

  // User-Agent propio del proxy: así se puede autorizar en Cloudflare y
  // esquivarle los desafíos (WAF / Bot Fight Mode).
  headers['user-agent'] = PROXY_USER_AGENT;

  // Nuestra cookie de sesión no le interesa al origen
  if (headers['cookie']) {
    const withoutOurs = stripOwnCookie(headers['cookie']);
    if (withoutOurs) headers['cookie'] = withoutOurs;
    else delete headers['cookie'];
  }

  // Evitamos compresión del origen: fetch() decodifica el cuerpo y reenviar
  // content-encoding original rompería la respuesta.
  headers['accept-encoding'] = 'identity';

  return headers;
}

/** Lee el cuerpo de la petición entrante sea cual sea su tipo. */
async function readRequestBody(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;

  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
    const contentType = String(req.headers['content-type'] || '');
    if (contentType.includes('application/json')) return Buffer.from(JSON.stringify(req.body));
    return Buffer.from(String(req.body));
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
}

function targetUrl(target) {
  return target.toString();
}

/** URL con la que el cliente vuelve a pasar por el proxy. */
function proxiedLocation(target) {
  return `/api/proxy?url=${encodeURIComponent(targetUrl(target))}`;
}

/** Set-Cookie del origen, preservando cada cookie por separado. */
function originCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Content-Length', '0');
    res.end();
    return;
  }

  const country = String(req.headers['x-vercel-ip-country'] || '').trim().toUpperCase();
  const fromSpain = country === 'ES' || (!isProduction && !country);

  // 1) ¿A qué destino vamos?
  const resolved = resolveTarget(req);

  if (resolved.error === 'forbidden') {
    sendText(res, 403, 'Solo se permite el proxy hacia dominios inled.es.');
    return;
  }

  if (resolved.error) {
    // Nada que proxificar -> landing con instrucciones de uso
    sendHtml(res, 200, renderLanding({ country }));
    return;
  }

  const target = resolved.target;

  // 2) Fuera de España -> redirección directa al destino original
  if (!fromSpain) {
    sendRedirect(res, 302, targetUrl(target));
    return;
  }

  // 3) Desde España -> proxy completo desde la infraestructura de Vercel
  const body = await readRequestBody(req);

  let response;
  try {
    response = await fetch(target, {
      method: req.method,
      headers: buildRequestHeaders(req, target),
      body: body && req.method !== 'HEAD' ? new Uint8Array(body) : undefined,
      redirect: 'manual',
    });
  } catch (err) {
    sendText(
      res,
      502,
      'No se pudo conectar con el destino: ' + (err && err.message ? err.message : 'error')
    );
    return;
  }

  // Cabeceras de la respuesta del destino
  const outHeaders = {};
  const originContentLength = response.headers.get('content-length');
  const setCookies = originCookies(response);
  response.headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (HOP_BY_HOP.has(key)) return;
    if (key === 'content-length' || key === 'content-encoding') return; // fetch() ya decodifica
    if (key === 'set-cookie') return; // se maneja aparte para no unirlas
    outHeaders[name] = value;
  });

  // Redirecciones del origen: se devuelven al cliente reescribiendo Location
  // para que el siguiente salto vuelva a pasar por el proxy (y por el filtro ES).
  if (outHeaders.location) {
    let next = null;
    try {
      next = new URL(outHeaders.location, target);
    } catch {
      next = null;
    }
    if (!next || !isAllowedHost(next.hostname)) {
      sendText(res, 403, 'El destino redirigido no pertenece a inled.es.');
      return;
    }
    outHeaders.location = proxiedLocation(next);
  }

  const status = response.status;
  const payload =
    status === 204 || status === 304 || req.method === 'HEAD'
      ? null
      : Buffer.from(await response.arrayBuffer());

  // Desafío de Cloudflare: el navegador no puede completarlo a través del
  // proxy (el challenge espera el host original), así que devolvemos una
  // página de diagnóstico en vez de un "Just a moment" infinito.
  if (isCloudflareChallenge(response, payload)) {
    sendHtml(
      res,
      502,
      renderChallenge({ host: target.host, url: target.toString(), country })
    );
    return;
  }

  // Reescribimos las URLs absolutas del origen (HTML/CSS/JS) para que el
  // navegador las pida al proxy y no vuelva a salir con su propio User-Agent.
  let outBody = payload;
  const contentType = String(outHeaders['content-type'] || '');
  if (outBody && REWRITABLE_TYPE.test(contentType) && outBody.length <= MAX_REWRITE_BYTES) {
    const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType);
    if (UTF8_CHARSET.test(charset ? charset[1].toLowerCase() : '')) {
      outBody = Buffer.from(rewriteProxiedUrls(outBody.toString('utf8')), 'utf8');
    }
  }

  res.statusCode = status;
  for (const [name, value] of Object.entries(outHeaders)) {
    try {
      res.setHeader(name, value);
    } catch {
      /* cabeceras inválidas para el runtime: se omiten */
    }
  }

  // Cookies del origen (con Domain incompatible limpiado) + la nuestra,
  // que recuerda el origen de la sesión
  const cookies = setCookies.map(normalizeSetCookie);
  cookies.push(
    `${ORIGIN_COOKIE}=${encodeURIComponent(target.origin)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
  );
  try {
    res.setHeader('Set-Cookie', cookies);
  } catch {
    /* ignorado */
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('X-Proxy-By', 'vercel-proxy-inled');
  if (outBody) res.setHeader('Content-Length', String(outBody.length));
  else if (req.method === 'HEAD' && originContentLength) {
    res.setHeader('Content-Length', originContentLength);
  }

  if (outBody === null) res.end();
  else res.end(outBody);
}
