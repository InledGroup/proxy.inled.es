# Proxy Inled 

Serverless Function de **Vercel** que sirve los dominios de `inled.es` a través de
`proxy.inled.es`.

```
https://proxy.inled.es/?url=https://apt.inled.es/ruta
```

## Uso

| Situación | Qué pasa |
|---|---|
| Petición desde **España** | El proxy consulta el destino y te devuelve aquí su respuesta completa (status, cabeceras y cuerpo). |
| Petición **fuera de España** | `302` directo a la URL original. |
| Dominio de destino **distinto de `inled.es`** | `403`. Solo se permite `inled.es` y sus subdominios. |
| Petición **sin `?url=`** | Landing page con el formulario de uso. |

Formas de llamarlo:

```
https://proxy.inled.es/?url=https://apt.inled.es/sistema   # entrada principal
https://proxy.inled.es/api/proxy?url=https://apt.inled.es   # llamada directa a la función
```

También hay una landing en `https://proxy.inled.es/` con formulario, formato y ejemplos.

### Navegación interna

Al entrar, la función recuerda el origen en la cookie `inled_proxy_origin`. A partir de
ahí, las peticiones **sin `?url=`** (enlaces, `css`, `js`, `fetch()`, formularios con URL
relativa) resuelven su ruta contra ese origen:

```
/?url=https://apt.inled.es/pagina   ->  https://apt.inled.es/pagina
/css/site.css?v=5                   ->  https://apt.inled.es/css/site.css?v=5   (con la cookie)
```

La ruta original la manda `vercel.json` a la función mediante el rewrite
`/(.*)` → `/api/proxy?path=$1`.

### Reescritura de contenido

Las respuestas `text/html`, `text/css` y `javascript` (UTF-8, hasta 5 MB) se reescriben
**en el servidor** para que todo el sitio se pida a través del proxy y ninguna referencia
se vaya al origen por su cuenta:

```
https://apt.inled.es/ruta?x=1   ->  /ruta?__origin=https%3A%2F%2Fapt.inled.es&x=1
//apt.inled.es/img.png          ->  /img.png?__origin=https%3A%2F%2Fapt.inled.es
```

Se reescriben `href`, `src`, `srcset`, `action`, `<base>`, `url()` de CSS, meta refresh y
cualquier URL absoluta o `//` hacia `*.inled.es` en HTML/CSS/JS. Las relativas y los
recursos de terceros no se tocan. Si `?url=` o `?__origin=` no traen ruta propia, se
combina con la ruta de la petición.

Y además:

- Las cabeceras de identidad del navegador (`Referer`, `Origin`) se reescriben al origen
  real o se omiten, para que el destino no las vea como peticiones externas.
- La cookie del propio proxy **no se reenvía** al origen.
- Las `Set-Cookie` con un `Domain=` que el navegador no aceptaría desde `proxy.inled.es`
  se reenvían sin atributo Domain (host-only); `Domain=inled.es` se conserva tal cual.
- Nunca se permite proxear el propio host (evita bucles).
- Las redirecciones internas del origen se devuelven con `Location` reescrito, para que el
  siguiente salto vuelva a pasar por el proxy.

### Diagnóstico

Toda respuesta lleva cabeceras de ayuda para depurar sin mirar el front:

| Cabecera | Significado |
|---|---|
| `X-Proxy-By` | La ha servido esta función. |
| `X-Origin-Status` | Status real devuelto por el origen. |
| `X-Origin-Flag` | Motivo del aviso mostrado (`challenge-header`, `challenge-title`). |
| `X-Proxy-Error` | `target-not-allowed`, `redirect-not-allowed`, `origin-unreachable`, `origin-refused`. |

Si el origen responde con algo que el navegador no podría completar por su cuenta, el
proxy **reintenta una vez** con cabeceras mínimas (sin cookies ni marcas de contexto del
navegador) antes de mostrar la página de aviso.

Los eventos también se imprimen en los logs de la función (`[proxy] ...`).

### Limitaciones conocidas

- Las URLs absolutas dentro de **JSON** (`application/json`) no se reescriben, ni las
  comparaciones de cadenas en JS (`x === "https://apt.inled.es"`). Un `fetch()` con URL
  absoluta en JS **sí** se reescribe.
- Si el origen redirige hacia un dominio ajeno a `inled.es`, el proxy devuelve `403`.
- Si el destino no responde, se muestra una página de aviso con opción de reintentar.

## Estructura

```
api/proxy.js      # la función proxy (país, allowlist, cookies, reescritura, landing)
lib/landing.js    # landing + página de aviso (HTML plano, sin build)
vercel.json       # rewrite de ruta + maxDuration
test/             # tests unitarios y end-to-end (npm test)
```

No hay dependencias ni build: `package.json` solo marca `"type": "module"`.

## Despliegue

### CLI

```bash
npm i -g vercel
vercel login
vercel            # preview
vercel --prod     # producción
```

### Git

Sube el repo a GitHub y en vercel.com → *Add New → Project* → importa el repo →
*Deploy* (sin build command ni output directory). En el plan Hobby el repositorio
conectado tiene que ser **público**.

### Dominio `proxy.inled.es`

1. En Vercel: *Settings → Domains → Add* → `proxy.inled.es`.
2. En tu DNS, crea el registro **solo resolución** (sin CDN por delante):

   | Tipo | Nombre | Valor |
   |---|---|---|
   | `CNAME` | `proxy` | `cname.vercel-dns.com` |

   (Alternativa: registro `A` → `76.76.21.21`.)

3. Espera la validación; Vercel emite el SSL solo.

## Tests

```bash
npm test
```

33 tests: unitarios (allowlist, país, cookies, reescritura de HTML/CSS/JS, cabeceras de
identidad, antibucle, aviso cuando el destino no responde, POST, CORS) y end-to-end sobre
HTTP real (servidor de origen local, simulando el rewrite de `vercel.json`).
