# Spec Backend — Personalización de marca del negocio (logo, banner, tema)

**Para:** el chat del backend (FastAPI + PostgreSQL/Neon)
**Origen:** frontend KARD-Client (la vista de personalización ya está diseñada; el storefront ya consume estos campos)
**Objetivo:** que cada negocio (tenant) pueda definir su **logo, banner y 2 colores de tema**, y que esos datos se sirvan tanto al dueño (para editarlos) como a la tienda pública (para pintarlos).

---

## 0. Resumen — qué falta

| # | Cosa | Estado |
|---|---|---|
| 1 | Almacenar la marca en `Tenant.config` (JSONB, ya existe) | falta usarlo |
| 2 | `GET`/`PUT` de la marca propia (B2B, autenticado) | **falta** |
| 3 | Incluir `logo_url` / `banner_url` / `theme` en `GET /s/{slug}` (público) | **falta** |
| 4 | *(Opcional)* incluir `logo_url` en items de `GET /api/v1/explore` | deseable |

**No hace falta migración**: `Tenant.config` ya es un JSONB. Guardamos la marca ahí bajo la clave `branding`.

**Alcance MVP:** el logo y el banner son **URLs** (strings), igual que las imágenes de productos hoy. **No** se implementa subida de archivos todavía — el negocio pega un link. (Se puede migrar a upload real después sin romper este contrato.)

---

## 1. Modelo de datos — dónde vive

Dentro de `Tenant.config` (JSONB existente), namespaced bajo `branding`:

```json
{
  "branding": {
    "logo_url":   "https://cdn.ejemplo.com/logo.png",
    "banner_url": "https://cdn.ejemplo.com/banner.jpg",
    "theme": {
      "primary": "#5b6ef5",
      "accent":  "#1e3a8a"
    }
  }
}
```

- Todos los campos son **opcionales**. Un tenant recién creado no tiene `branding` → se responde con los campos en `null` (o se omiten). El frontend ya aplica defaults de KARD cuando faltan.
- No pisar el resto de `config` al escribir: hacer **merge** sobre la clave `branding`, no reemplazar todo `config`.

---

## 2. Endpoints B2B — el dueño edita su marca

Requieren 🔒 **JWT de negocio** (rol `business_admin` / staff según su modelo). El tenant sale del token (`tenant_id`) — **nunca** de un parámetro (aislamiento multi-tenant).

Ruta sugerida: `/api/v1/settings/branding` (o la que prefieran; el frontend se adapta al path final).

### `GET /api/v1/settings/branding`
Devuelve la marca actual del tenant autenticado.

**Response `200`:**
```json
{
  "logo_url":   "https://cdn.ejemplo.com/logo.png",
  "banner_url": null,
  "theme": {
    "primary": "#5b6ef5",
    "accent":  "#1e3a8a"
  }
}
```
> Si el tenant no tiene nada configurado, devolver los campos en `null` y `theme` en `null` (o `theme` con ambos en `null`). El front rellena con defaults.

### `PUT /api/v1/settings/branding`
Actualiza (upsert) la marca. Acepta actualización **parcial** (los campos ausentes no se tocan) — o total, como prefieran; especificar cuál. Recomendado: **reemplazo total del objeto `branding`** enviado, más simple de razonar.

**Request:**
```json
{
  "logo_url":   "https://cdn.ejemplo.com/logo.png",
  "banner_url": "https://cdn.ejemplo.com/banner.jpg",
  "theme": {
    "primary": "#5b6ef5",
    "accent":  "#1e3a8a"
  }
}
```

**Response `200`:** el mismo objeto ya guardado (igual que el `GET`).

**Validaciones:**
| Campo | Regla |
|---|---|
| `logo_url`, `banner_url` | URL válida (`http`/`https`), o `null`. Longitud máx. ~2048. |
| `theme.primary`, `theme.accent` | Hex de color `#RRGGBB` (regex `^#([0-9a-fA-F]{6})$`), o `null`. |

**Errores:**
| Status | Causa |
|---|---|
| `401` | Sin token / token inválido |
| `403` | Rol sin permiso para editar el negocio (si aplica) |
| `422` | Hex mal formado, URL inválida |

---

## 3. Storefront público — servir la marca al cliente

Extender el response de **`GET /s/{slug}`** (hoy solo devuelve `slug`, `business_name`, `business_type`) para incluir la marca:

**Response `200` (nuevo):**
```json
{
  "slug": "buena-vista",
  "business_name": "Buena vista",
  "business_type": "optician",
  "logo_url":   "https://cdn.ejemplo.com/logo.png",
  "banner_url": "https://cdn.ejemplo.com/banner.jpg",
  "theme": {
    "primary": "#5b6ef5",
    "accent":  "#1e3a8a"
  }
}
```

- **Sigue siendo público** (sin token), igual que hoy.
- Si el tenant no configuró marca → `logo_url`, `banner_url` y `theme` en `null` (o `theme` con ambos `null`). El front aplica los defaults de KARD.
- **Importante para caché:** si `GET /s/{slug}` (o `/s/{slug}/products`) tiene caché en Redis, **invalidarla** cuando el negocio hace `PUT` de su marca, para que el cliente vea el cambio sin esperar el TTL.

> **Contrato exacto que el frontend ya espera** (no cambiar los nombres):
> `logo_url: string|null`, `banner_url: string|null`, `theme: { primary: string|null, accent: string|null } | null`.

---

## 4. (Opcional pero recomendado) — logo en el marketplace

Incluir `logo_url` en cada item de **`GET /api/v1/explore`**:

```json
{
  "items": [
    {
      "slug": "buena-vista",
      "business_name": "Buena vista",
      "business_type": "optician",
      "logo_url": "https://cdn.ejemplo.com/logo.png"
    }
  ],
  "total": 1, "page": 1, "page_size": 20
}
```

El frontend ya tiene hueco para `image_url`/`logo_url` en las cards de explore: si llega, muestra el logo del negocio en vez del placeholder. (Si de paso agregan `description` del negocio, también se aprovecha.)

---

## 5. Resumen de tareas para el back

1. **Helper** para leer/escribir `Tenant.config["branding"]` (merge, no overwrite del resto de `config`).
2. **`GET /api/v1/settings/branding`** — marca del tenant del token.
3. **`PUT /api/v1/settings/branding`** — validar hex + URL, guardar, invalidar caché del storefront de ese slug.
4. **Extender `GET /s/{slug}`** con `logo_url`, `banner_url`, `theme`.
5. *(Opcional)* Extender items de `GET /api/v1/explore` con `logo_url` (y `description`).

**No-goals de esta fase:** subida de archivos (solo URLs), más tokens de tema (fuentes, radios, dark mode) — se puede ampliar después sin romper el contrato.

---

## 6. Nota de contrato (para no desincronizar)

Los nombres de campo (`logo_url`, `banner_url`, `theme.primary`, `theme.accent`) **ya están cableados en el frontend** (`StorefrontInfo` y el storefront los consume vía CSS variables `--sf-primary` / `--sf-accent`). Si el backend cambia algún nombre, avisar para ajustar el front. Lo ideal es respetar este contrato tal cual.
