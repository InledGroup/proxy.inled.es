/**
 * Landing page de uso del proxy (HTML plano, sin build ni dependencias).
 * Se sirve cuando una petición no tiene ?url= ni origen en la cookie.
 * Estilo alineado con la identidad de inled.
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
  .brand {
    position: relative; font-size: 2rem; font-weight: 800; letter-spacing: 0.01em;
    line-height: 1; padding-left: 0.02em;
  }
  .brand span {
    background: linear-gradient(180deg, var(--brand) 0%, var(--brand-deep) 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .brand::after {
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
  <div class="brand" aria-label="INLED"><span>&#305;NLED</span></div>

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
