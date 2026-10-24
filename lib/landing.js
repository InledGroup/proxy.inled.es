/**
 * Landing page de uso del proxy (HTML plano, sin build ni dependencias).
 * Se sirve cuando una petición no tiene ?url= ni origen en la cookie.
 * Estilo alineado con la identidad de inled.
 */

/** Mismo nombre que usa api/proxy.js para recordar el origen de la sesión. */
const ORIGIN_COOKIE_TEXT = 'inled_proxy_origin';

/** Logotipo oficial, servido a través del proxy para que tampoco escape al CF. */
const LOGO_URL = 'https%3A%2F%2Fhosted.inled.es%2Fcdn%2FINLED_simple-removebg-preview.png';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderLanding({ country = '' } = {}) {
  const flag = country ? escapeHtml(country) : 'desconocido';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proxy inled</title>
<style>
  :root {
    --ink: #0d1b2a;
    --muted: #8b98ae;
    --line: #e6edf7;
    --bg: #f2f6fb;
    --brand: #2ab5f2;
    --brand-deep: #1a7fd4;
    --accent: #ff3b30;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 26px; padding: 40px 20px;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--ink);
  }

  /* Marca */
  .brand { display: flex; align-items: center; justify-content: center; }
  .brand img { height: 54px; width: auto; display: block; }
  .brand-fallback {
    position: relative; font-size: 2rem; font-weight: 800; letter-spacing: 0.01em;
    line-height: 1; padding-left: 0.02em;
  }
  .brand-fallback span {
    background: linear-gradient(180deg, var(--brand) 0%, var(--brand-deep) 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .brand-fallback::after {
    content: ""; position: absolute; left: 0.07em; top: -0.1em;
    width: 0.19em; height: 0.19em; background: var(--accent); border-radius: 1px;
  }

  /* Tarjeta */
  .card {
    width: 100%; max-width: 620px; background: #fff; border: 1px solid var(--line);
    border-radius: 16px; padding: 38px 40px 32px;
    box-shadow: 0 12px 34px rgba(13, 27, 42, 0.06);
  }
  h1 { margin: 0 0 6px; font-size: 1.9rem; text-align: center; letter-spacing: -0.02em; }
  .lead { margin: 0 0 26px; text-align: center; color: var(--muted); }

  label {
    display: block; margin-bottom: 8px; font-size: 0.78rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted);
  }
  form { margin-bottom: 28px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  input[type="url"] {
    flex: 1 1 240px; padding: 14px 16px; font-size: 1rem; color: var(--ink);
    background: #fff; border: 1px solid #d5deea; border-radius: 10px;
  }
  input[type="url"]::placeholder { color: #aab6c8; }
  input[type="url"]:focus { outline: 2px solid rgba(42, 181, 242, 0.35); border-color: var(--brand); }
  button {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 14px 26px; font-size: 1rem; font-weight: 700; cursor: pointer;
    background: var(--ink); color: #fff; border: 0; border-radius: 10px;
  }
  button:hover { background: #16283d; }
  button .chev { font-size: 1.15em; line-height: 1; }

  hr { border: 0; border-top: 1px solid var(--line); margin: 0 0 22px; }
  h2 {
    margin: 0 0 10px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--muted);
  }
  ul { margin: 0 0 20px; padding-left: 18px; }
  li { margin: 6px 0; color: #33415a; }
  code { background: #f1f5fb; padding: 2px 6px; border-radius: 6px; font-size: 0.9em; color: #274060; }
  a { color: var(--brand-deep); }
  .links { list-style: none; padding: 0; display: flex; gap: 10px; flex-wrap: wrap; margin: 0; }
  .links a {
    display: inline-block; padding: 9px 16px; text-decoration: none; font-weight: 600;
    background: #f4f8fd; border: 1px solid var(--line); border-radius: 999px;
  }
  .links a:hover { border-color: var(--brand); color: var(--brand-deep); }
  .note { margin: 18px 0 0; font-size: 0.9rem; color: var(--muted); }
  footer { font-size: 0.9rem; color: #b9c3d4; }
</style>
</head>
<body>
  <div class="brand">
    <img src="/api/proxy?url=${LOGO_URL}" alt="INLED" height="54"
         onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
    <div class="brand-fallback" style="display:none" aria-label="INLED"><span>&#305;NLED</span></div>
  </div>

  <main class="card">
    <h1>Proxy inled</h1>
    <p class="lead">Accede a los servicios de <strong>inled.es</strong> desde la infraestructura de Vercel.</p>

    <form action="/" method="get">
      <label for="url">URL de destino</label>
      <div class="row">
        <input id="url" type="url" name="url" value="https://apt.inled.es" placeholder="https://apt.inled.es" required>
        <button type="submit">Entrar <span class="chev">›</span></button>
      </div>
    </form>

    <hr>

    <h2>Cómo funciona</h2>
    <ul>
      <li><strong>España (ES)</strong>: la petición se realiza desde Vercel y te devolvemos aquí la respuesta completa del origen.</li>
      <li><strong>Fuera de España</strong>: te redirigimos directamente al sitio original.</li>
      <li>Solo se permite el dominio <code>inled.es</code> y sus subdominios.</li>
      <li>Mientras navegas, la ruta actual se resuelve contra el origen con la cookie <code>${ORIGIN_COOKIE_TEXT}</code>.</li>
      <li>Las peticiones salen con el identificador <code>User-Agent: InledProxy/1.0</code>.</li>
    </ul>
    <p class="note">País detectado en esta petición: <code>${flag}</code></p>

    <h2 style="margin-top:22px">Ejemplos</h2>
    <ul class="links">
      <li><a href="/?url=https://apt.inled.es">apt.inled.es</a></li>
      <li><a href="/?url=https://inled.es">inled.es</a></li>
      <li><a href="/api/proxy?url=https%3A%2F%2Fapt.inled.es">/api/proxy?url=…</a></li>
    </ul>

    <p class="note">
      Forma directa: <code>https://proxy.inled.es/?url=https://apt.inled.es/ruta</code>.
      Los enlaces y recursos con URL absoluta al origen (por ejemplo
      <code>https://apt.inled.es/archivo</code>) no pasan por este proxy.
    </p>
  </main>

  <footer>Licenciado bajo MIT-INLED</footer>
</body>
</html>`;
}

/**
 * Página de diagnóstico cuando el origen devuelve un desafío de Cloudflare
 * que el navegador no puede completar a través del proxy.
 */
export function renderChallenge({ host = '', url = '', country = '' } = {}) {
  const safeHost = escapeHtml(host);
  const safeCountry = escapeHtml(country || 'desconocido');
  const retry = url ? `/?url=${encodeURIComponent(url)}` : '/';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desafío de Cloudflare · Proxy inled</title>
<style>
  :root { --ink: #0d1b2a; --muted: #8b98ae; --line: #e6edf7; --bg: #f2f6fb; --accent: #ff3b30; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 26px; padding: 40px 20px; background: var(--bg); color: var(--ink);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .brand-fallback { position: relative; font-size: 2rem; font-weight: 800; line-height: 1; }
  .brand-fallback span { color: #1a7fd4; }
  .brand-fallback::after {
    content: ""; position: absolute; left: 0.07em; top: -0.1em;
    width: 0.19em; height: 0.19em; background: var(--accent); border-radius: 1px;
  }
  main {
    width: 100%; max-width: 620px; background: #fff; border: 1px solid var(--line);
    border-radius: 16px; padding: 36px 40px 32px; box-shadow: 0 12px 34px rgba(13, 27, 42, 0.06);
  }
  h1 { margin: 0 0 6px; font-size: 1.7rem; text-align: center; letter-spacing: -0.02em; }
  .lead { margin: 0 0 22px; text-align: center; color: var(--muted); }
  h2 {
    margin: 24px 0 8px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--muted);
  }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 6px 0; color: #33415a; }
  code { background: #f1f5fb; padding: 2px 6px; border-radius: 6px; font-size: 0.9em; color: #274060; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 26px; }
  .actions a {
    display: inline-flex; align-items: center; gap: 8px; padding: 13px 22px; font-weight: 700;
    text-decoration: none; background: var(--ink); color: #fff; border-radius: 10px;
  }
  .actions a.alt { background: #f4f8fd; color: #1a7fd4; border: 1px solid var(--line); }
  .note { margin: 18px 0 0; font-size: 0.9rem; color: var(--muted); }
  footer { font-size: 0.9rem; color: #b9c3d4; }
</style>
</head>
<body>
  <div class="brand-fallback" aria-label="INLED"><span>&#305;NLED</span></div>

  <main>
    <h1>El origen está exigiendo un desafío</h1>
    <p class="lead">
      <code>${safeHost}</code> ha respondido con un reto de Cloudflare
      (país detectado: <code>${safeCountry}</code>). El proxy ya ha enviado la petición con
      <code>User-Agent: InledProxy/1.0</code>, pero el reto no se puede completar desde
      <code>proxy.inled.es</code>.
    </p>

    <h2>Qué revisar en Cloudflare</h2>
    <ul>
      <li>Regla personalizada con acción <strong>Skip</strong> para
        <code>User-Agent equals InledProxy/1.0</code> y prioridad alta.</li>
      <li><strong>Bot Fight Mode</strong>: en el plan gratuito no se puede saltar con reglas;
        hay que desactivarlo para ese hostname.</li>
      <li>Si usas <strong>Super Bot Fight Mode</strong>, marca <em>Definitely automated</em>
        como <em>Managed Challenge</em> o <em>Allow</em>.</li>
      <li>Comprueba en <em>Security → Events</em> si aparece la acción <em>Skip</em> o
        <em>Managed Challenge</em> para la petición fallida.</li>
      <li>Prueba en ventana de incógnito: cookies antiguas del desafío
        (<code>cf_clearance</code>) o caché pueden estar colgando la página.</li>
    </ul>

    <div class="actions">
      <a href="${retry}">Reintentar <span>›</span></a>
      <a class="alt" href="/">Volver al inicio</a>
    </div>

    <p class="note">Si el reto desaparece, vuelve a navegar con normalidad: la landing y el
      proxy siguen en <code>/</code>.</p>
  </main>

  <footer>Licenciado bajo MIT-INLED</footer>
</body>
</html>`;
}
