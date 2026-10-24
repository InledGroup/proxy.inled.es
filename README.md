# Proxy inled

Serverless Function de **Vercel** que hace de **proxy inverso** para los dominios de
`inled.es`, con control de país por la cabecera `x-vercel-ip-country`.

```
https://proxy.inled.es/?url=https://apt.inled.es/ruta
```

## Uso

| Situación | Qué pasa |
|---|---|
| Petición desde **España** (`x-vercel-ip-country: ES`) | Se pide el destino desde la infraestructura de Vercel y se devuelve la respuesta completa (status, cabeceras y cuerpo) al cliente. |
| Petición **fuera de España** | `302` directo a la URL original. |
| Dominio de destino **distinto de `inled.es`** | `403`. Solo se permite `inled.es` y sus subdominios. |
| Petición **sin `?url=` ni cookie** | Landing page con el formulario de uso. |

Formas de llamarlo:

```
https://proxy.inled.es/?url=https://apt.inled.es/sistema   # entrada principal
https://proxy.inled.es/api/proxy?url=https://apt.inled.es   # llamada directa a la función
```

También hay una landing en `https://proxy.inled.es/` con formulario y ejemplos.

### Navegación interna

Al proxificar, la función guarda el origen en la cookie `inled_proxy_origin`.
A partir de ahí, las peticiones **sin `?url=`** (enlaces, `css`, `js`, `fetch()`,
formularios con URL relativa) resuelven su ruta contra ese origen:

```
/?url=https://apt.inled.es/pagina   ->  https://apt.inled.es/pagina
/css/site.css?v=5                   ->  https://apt.inled.es/css/site.css?v=5   (con la cookie)
```

La ruta original la manda `vercel.json` a la función mediante el rewrite
`/(.*)` → `/api/proxy?path=$1`.

### Reescritura de contenido (nada escapa al origen)

Las respuestas `text/html`, `text/css` y `javascript` (UTF-8, hasta 5 MB) se reescriben
**en el servidor** para que el navegador no pida nada directamente al origen con su
propio User-Agent (que es lo que Cloudflare sigue desafiando):

```
https://apt.inled.es/ruta?x=1   ->  /ruta?__origin=https%3A%2F%2Fapt.inled.es&x=1
//apt.inled.es/img.png          ->  /img.png?__origin=https%3A%2F%2Fapt.inled.es
```

Se reescriben `href`, `src`, `srcset`, `action`, `<base>`, `url()` de CSS, meta refresh y
cualquier URL absoluta o `//` hacia `*.inled.es` en HTML/CSS/JS (incluidos los `fetch()`
de las aplicaciones). Las relativas y los recursos de terceros no se tocan. Si `?url=` o
`?__origin=` no traen ruta propia, se combina con la ruta de la petición.

Y además:

- La cookie del propio proxy (`inled_proxy_origin`) **no se reenvía** al origen.
- Las `Set-Cookie` del origen con un `Domain=` que el navegador rechazaría desde
  `proxy.inled.es` (p. ej. `Domain=apt.inled.es`, `cf_clearance`) se quedan **host-only**;
  `Domain=inled.es` se conserva tal cual.
- Nunca se permite proxear el propio host (evita bucles).

### Si el origen devuelve un desafío de Cloudflare

Si la respuesta trae `cf-mitigated: challenge` (o un `403/503` de Cloudflare con la
página "Just a moment"), el navegador **no puede completar el reto a través del proxy**.
En vez de dejar un bucle infinito, el proxy devuelve una **página de diagnóstico (502)**
con la checklist: regla *Skip* con prioridad alta, Bot Fight Mode, Super Bot Fight Mode,
eventos en *Security → Events* y prueba en incógnito.

### User-Agent del proxy

Todas las peticiones al origen salen identificadas con:

```
User-Agent: InledProxy/1.0
```

El `User-Agent` del cliente original no se reenvía (se sustituye por el del proxy).
Para que Cloudflare no le ponga desafíos, crea una regla en el dominio de destino:

*Security → WAF → Custom rules → Create rule*

| Campo | Valor |
|---|---|
| Field | `User Agent` (`http.user_agent`) |
| Operator | `equals` |
| Value | `InledProxy/1.0` |
| Action | `Skip` (o `Allow` si tu plan no tiene *Skip*) |

En el *Skip* puedes marcar Managed Challenge, Rate limiting, Security Level, etc.
Si usas **Bot Fight Mode** en plan gratuito, no se puede saltar con reglas: hay que
desactivarlo para ese hostname (`Security → Bots → Bot Fight Mode`).

> Un User-Agent se puede falsificar, así que esto es una comodidad de operación, no un
> control de acceso. Si quieres blindar el origen de verdad, se puede añadir una cabecera
> secreta (p. ej. `X-Inled-Token`) que el origen compruebe.

### Limitaciones conocidas

- Las URLs absolutas dentro de **JSON** (`application/json`) no se reescriben, ni las
  comparaciones de *cadenas* en JS (`x === "https://apt.inled.es"`), que se romperían.
  Un `fetch()` con URL absoluta en JS **sí** se reescribe.
- Las `Set-Cookie` con `Domain=` que no sea `inled.es`/`proxy.inled.es` se reenvían sin
  atributo Domain (host-only para el proxy), para que el navegador no las descarte.
- Si el origen redirige (o meta-refresh) hacia un dominio ajeno a `inled.es`, el proxy
  devuelve `403`.
- Las redirecciones internas del origen se devuelven con `Location` reescrito para que
  el siguiente salto vuelva a pasar por el proxy.

## Estructura

```
api/proxy.js      # la función proxy (país, allowlist, cookies, reescritura, landing)
lib/landing.js    # landing + página de diagnóstico (HTML plano, sin build)
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
*Deploy* (sin build command ni output directory).

### Dominio sin pasar por Cloudflare

1. En Vercel: *Settings → Domains → Add* → `proxy.inled.es`.
2. En Cloudflare, en la zona `inled.es`, crea el registro con **nube gris (DNS only)**:

   | Tipo | Nombre | Valor |
   |---|---|---|
   | `CNAME` | `proxy` | `cname.vercel-dns.com` |

   (Alternativa: registro `A` → `76.76.21.21`.)

3. Espera la validación; Vercel emite el SSL solo.

## Verificación tras desplegar

```bash
# Landing
curl -sI https://proxy.inled.es/

# Desde España debe hacer proxy (200 del origen y cabecera X-Proxy-By)
curl -sI https://proxy.inled.es/?url=https://apt.inled.es/

# Fuera de España debe redirigir (302)
curl -sI -H "x-vercel-ip-country: FR" "https://proxy.inled.es/?url=https://apt.inled.es/"

# Dominio no permitido (403)
curl -sI "https://proxy.inled.es/?url=https://evil.com/"

# Ruta relativa con cookie (debe pedir /css/site.css al origen)
curl -sI -H "Cookie: inled_proxy_origin=https%3A%2F%2Fapt.inled.es" \
  https://proxy.inled.es/css/site.css
```

El `User-Agent: InledProxy/1.0` saliente se ve en los logs de Cloudflare del origen
(`Security → Events`): si aparece ahí sin desafío, la regla funciona.

> Nota: en producción Vercel sobreescribe `x-vercel-ip-country` con la IP real del
> cliente, así que esa cabecera solo se puede forzar en local (`vercel dev` o `npm test`).

## Tests

```bash
npm test
```

29 tests: unitarios (allowlist, país, cookies, rutas, reescritura de HTML/CSS/JS,
antibucle, cookies con Domain, desafío CF, POST, CORS) y end-to-end sobre HTTP real
(servidor de origen local, simulando el rewrite de `vercel.json`).
