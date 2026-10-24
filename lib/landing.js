/**
 * Páginas HTML del proxy (sin build ni dependencias):
 *  - renderLanding: landing con el formulario de uso.
 *  - renderChallenge: aviso genérico cuando el destino no responde.
 * Sin detalles internos: solo entrada de URL y formato.
 */

/** Logotipo oficial, servido a través del proxy. */
const LOGO_URL = 'https%3A%2F%2Fhosted.inled.es%2Fcdn%2FINLED_simple-removebg-preview.png';

const STYLE = `
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
  main {
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
  form { margin-bottom: 4px; }
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
  .hint { margin: 14px 0 0; font-size: 0.92rem; color: var(--muted); }
  hr { border: 0; border-top: 1px solid var(--line); margin: 26px 0 22px; }
  h2 {
    margin: 0 0 12px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--muted);
  }
  .links { list-style: none; padding: 0; display: flex; gap: 10px; flex-wrap: wrap; margin: 0; }
  .links a {
    display: inline-block; padding: 9px 16px; text-decoration: none; font-weight: 600;
    background: #f4f8fd; border: 1px solid var(--line); border-radius: 999px;
  }
  .links a:hover { border-color: var(--brand); color: var(--brand-deep); }
  code { background: #f1f5fb; padding: 2px 6px; border-radius: 6px; font-size: 0.9em; color: #274060; }
  a { color: var(--brand-deep); }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 26px; }
  .actions a {
    display: inline-flex; align-items: center; gap: 8px; padding: 13px 22px; font-weight: 700;
    text-decoration: none; background: var(--ink); color: #fff; border-radius: 10px;
  }
  .actions a.alt { background: #f4f8fd; color: #1a7fd4; border: 1px solid var(--line); }
  .note { margin: 18px 0 0; font-size: 0.9rem; color: var(--muted); }
  footer { font-size: 0.9rem; color: #b9c3d4; }
`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BRAND_HTML = `
  <div class="brand">
    <img src="/api/proxy?url=${LOGO_URL}" alt="INLED" height="54"
         onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
    <div class="brand-fallback" style="display:none" aria-label="INLED"><span>&#305;NLED</span></div>
  </div>`;

/** Landing de uso: formulario de URL y cómo formatearla. */
export function renderLanding() {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proxy inled</title>
<style>${STYLE}</style>
</head>
<body>
  ${BRAND_HTML}

  <main>
    <h1>Proxy inled</h1>
    <p class="lead">Introduce la URL a la que quieres acceder.</p>

    <form action="/" method="get">
      <label for="url">URL de destino</label>
      <div class="row">
        <input id="url" type="url" name="url" value="https://apt.inled.es" placeholder="https://apt.inled.es" required>
        <button type="submit">Entrar <span class="chev">›</span></button>
      </div>
      <p class="hint">
        Formato: <code>https://proxy.inled.es/?url=https://apt.inled.es/ruta</code><br>
        Solo se admiten dominios <code>inled.es</code> y sus subdominios.
      </p>
    </form>

    <hr>

    <h2>Ejemplos</h2>
    <ul class="links">
      <li><a href="/?url=https://apt.inled.es">apt.inled.es</a></li>
      <li><a href="/?url=https://inled.es">inled.es</a></li>
    </ul>
  </main>

  <footer>Licenciado bajo MIT-INLED</footer>
</body>
</html>`;
}

/** Aviso genérico cuando el destino no responde a través del proxy. */
export function renderChallenge({ host = '', url = '' } = {}) {
  const safeHost = escapeHtml(host);
  const retry = url ? `/?url=${encodeURIComponent(url)}` : '/';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>No disponible · Proxy inled</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="brand-fallback" aria-label="INLED"><span>&#305;NLED</span></div>

  <main>
    <h1>No se ha podido cargar la página</h1>
    <p class="lead">
      <code>${safeHost}</code> no está respondiendo en este momento.
    </p>

    <h2>Qué puedes hacer</h2>
    <ul class="links" style="list-style:none">
      <li><span style="display:inline-block;padding:9px 16px;background:#f4f8fd;border:1px solid var(--line);border-radius:999px">Espera unos segundos y vuelve a intentarlo</span></li>
      <li><span style="display:inline-block;padding:9px 16px;background:#f4f8fd;border:1px solid var(--line);border-radius:999px">Comprueba que la URL es correcta</span></li>
      <li><span style="display:inline-block;padding:9px 16px;background:#f4f8fd;border:1px solid var(--line);border-radius:999px">Si persiste, avisa al administrador</span></li>
    </ul>

    <div class="actions">
      <a href="${retry}">Reintentar <span>›</span></a>
      <a class="alt" href="/">Volver al inicio</a>
    </div>
  </main>

  <footer>Licenciado bajo MIT-INLED</footer>
</body>
</html>`;
}
