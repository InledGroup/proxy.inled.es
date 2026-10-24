/**
 * Landing page de uso del proxy (HTML plano, sin build ni dependencias).
 * Se sirve cuando una petición no tiene ?url= ni origen en la cookie.
 */

/** Mismo nombre que usa api/proxy.js para recordar el origen de la sesión. */
const ORIGIN_COOKIE_TEXT = 'inled_proxy_origin';

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
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0b1020; color: #e8ecf8; padding: 32px 20px;
  }
  main { width: 100%; max-width: 640px; }
  h1 { margin: 0 0 4px; font-size: 2rem; letter-spacing: -0.02em; }
  .lead { margin: 0 0 24px; color: #a9b4d0; }
  form { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 28px; }
  input[type="url"] {
    flex: 1 1 260px; padding: 13px 14px; font-size: 1rem; color: inherit;
    background: #141b33; border: 1px solid #2a3557; border-radius: 10px;
  }
  input[type="url"]:focus { outline: 2px solid #4f8cff; outline-offset: 1px; }
  button {
    padding: 13px 20px; font-size: 1rem; font-weight: 600; cursor: pointer;
    background: #2f6bff; color: #fff; border: 0; border-radius: 10px;
  }
  button:hover { background: #3f79ff; }
  section { background: #111832; border: 1px solid #212b4d; border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
  section h2 { margin: 0 0 8px; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8ea3d6; }
  ul { margin: 0; padding-left: 20px; }
  li { margin: 4px 0; }
  code { background: #0a0f22; padding: 2px 6px; border-radius: 6px; font-size: 0.92em; }
  a { color: #79a6ff; }
  .links { list-style: none; padding: 0; display: flex; gap: 10px; flex-wrap: wrap; }
  .links a { display: inline-block; padding: 8px 14px; background: #141b33; border: 1px solid #2a3557; border-radius: 999px; text-decoration: none; }
  .note { color: #8fa0c6; font-size: 0.92rem; }
</style>
</head>
<body>
<main>
  <h1>Proxy inled</h1>
  <p class="lead">Accede a los servicios de <strong>inled.es</strong> a través de la infraestructura de Vercel.</p>

  <form action="/" method="get">
    <input type="url" name="url" value="https://apt.inled.es" placeholder="https://apt.inled.es" required>
    <button type="submit">Abrir en el proxy</button>
  </form>

  <section>
    <h2>Cómo funciona</h2>
    <ul>
      <li><strong>España (ES)</strong>: la petición se realiza desde Vercel y te devolvemos aquí la respuesta completa del origen.</li>
      <li><strong>Fuera de España</strong>: te redirigimos directamente al sitio original.</li>
      <li>Solo se permite el dominio <code>inled.es</code> y sus subdominios.</li>
      <li>Mientras navegas, la ruta actual se resuelve contra el origen con la cookie <code>${ORIGIN_COOKIE_TEXT}</code>.</li>
    </ul>
    <p class="note">País detectado en esta petición: <code>${flag}</code></p>
  </section>

  <section>
    <h2>Ejemplos</h2>
    <ul class="links">
      <li><a href="/?url=https://apt.inled.es">apt.inled.es</a></li>
      <li><a href="/?url=https://inled.es">inled.es</a></li>
      <li><a href="/api/proxy?url=https%3A%2F%2Fapt.inled.es">/api/proxy?url=…</a></li>
    </ul>
  </section>

  <p class="note">
    Forma directa: <code>https://proxy.inled.es/?url=https://apt.inled.es/ruta</code>.
    Los enlaces y recursos con URL absoluta al origen (por ejemplo
    <code>https://apt.inled.es/archivo</code>) no pasan por este proxy.
  </p>
</main>
</body>
</html>`;
}
