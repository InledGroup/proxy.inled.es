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

import { renderLanding } from '../lib/landing.js';

const DOMAIN = 'inled.es';

/** User-Agent con el que el proxy pide al origen (autorizable en Cloudflare). */
const PROXY_USER_AGENT = 'InledProxy/1.0';

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
    if (key === 'path' || key === 'url') continue;
    for (const item of [].concat(value)) {
      if (item !== undefined && item !== null) params.append(key, String(item));
    }
  }
  return params.toString();
}

/**
 * Resuelve qué destino toca.
 *  - con ?url= -> ese dominio (validado).
 *  - sin ?url= -> origen guardado en cookie + ruta de la petición.
 */
function resolveTarget(req) {
  const q = req.query || {};
  const rawUrl = firstValue(q.url) || rawQueryParam(req, 'url');

  if (rawUrl) {
    const target = parseTarget(rawUrl);
    return target ? { target } : { error: 'forbidden' };
  }

  const base = parseTarget(readCookie(req, ORIGIN_COOKIE));
  if (!base) return { error: 'landing' };

  const rel = toRelativePath(requestPath(req));
  const search = forwardedSearch(req);
  let target;
  try {
    target = new URL(search ? `${rel}?${search}` : rel, base);
  } catch {
    return { error: 'landing' };
  }
  if (!isAllowedHost(target.hostname)) return { error: 'forbidden' };
  return { target };
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

  res.statusCode = status;
  for (const [name, value] of Object.entries(outHeaders)) {
    try {
      res.setHeader(name, value);
    } catch {
      /* cabeceras inválidas para el runtime: se omiten */
    }
  }

  // Cookies del origen + la nuestra, que recuerda el origen de la sesión
  const cookies = setCookies.slice();
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
  if (payload) res.setHeader('Content-Length', String(payload.length));
  else if (req.method === 'HEAD' && originContentLength) {
    res.setHeader('Content-Length', originContentLength);
  }

  if (payload === null) res.end();
  else res.end(payload);
}
