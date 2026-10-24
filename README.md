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

### Limitaciones conocidas

- **No se reescribe el HTML**: los enlaces y recursos con URL **absoluta** al origen
  (por ejemplo `<img src="https://apt.inled.es/foto.png">`) se piden directamente al
  origen y **no pasan por el proxy**. Los relativos sí.
- Las cookies del origen se reenvían tal cual; si el origen emite
  `Domain=apt.inled.es`, el navegador las rechaza porque la respuesta viene de
  `proxy.inled.es` (funciona con `Domain=inled.es` o sin `Domain`).
- Las redirecciones del origen se devuelven al cliente con `Location` reescrito para
  que el siguiente salto vuelva a pasar por el proxy; si apunta fuera de `inled.es`, `403`.

## Estructura

```
api/proxy.js      # la función proxy (país, allowlist, cookies, landing)
lib/landing.js    # página HTML de uso (sin build)
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

> Nota: en producción Vercel sobreescribe `x-vercel-ip-country` con la IP real del
> cliente, así que esa cabecera solo se puede forzar en local (`vercel dev` o `npm test`).

## Tests

```bash
npm test
```

21 tests: unitarios (allowlist, país, cookies, rutas, POST, CORS) y end-to-end sobre
HTTP real (servidor de origen local, simulando el rewrite de `vercel.json`).
