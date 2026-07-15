# Spec Backend — Contenido de la tienda (eslogan, descripción, contacto)

**Para:** el chat del backend (FastAPI + PostgreSQL/Neon)
**Origen:** frontend KARD-Client
**Contexto:** el storefront del cliente se rediseña como **landing tradicional**: hero a pantalla completa (nombre + eslogan), sección de descripción, y footer con datos de contacto. El catálogo pasa a su propia página (`/s/{slug}/productos`).
**Precedente:** este spec sigue **exactamente el mismo patrón** que `API_Branding.md` (ya implementado): se guarda en `Tenant.config`, se edita con endpoints B2B, y se sirve en `GET /s/{slug}`.

---

## 0. Resumen — qué se pide

| # | Cosa | Estado |
|---|---|---|
| 1 | Guardar el contenido en `Tenant.config["profile"]` (JSONB, **sin migración**) | nuevo |
| 2 | `GET /api/v1/settings/profile` (B2B) | nuevo |
| 3 | `PUT /api/v1/settings/profile` (B2B) | nuevo |
| 4 | Extender `GET /s/{slug}` con `tagline`, `description`, `contact` | nuevo |
| 5 | *(Recomendado)* incluir `tagline` en items de `GET /api/v1/explore` | deseable |

**Alcance:** solo texto y URLs. **No** hay subida de archivos.

**Por qué una clave nueva (`profile`) y no meterlo en `branding`:** `branding` es lo visual (logo, banner, colores) y ya está cerrado y funcionando. `profile` es contenido editorial. Separarlos evita tocar lo que ya sirve y mantiene contratos chicos. Si prefieren un solo endpoint, avisen y el front se adapta.

---

## 1. Contrato de campos (tipos exactos)

```typescript
type HourEntry = {
  days:  string;   // "Lunes a Viernes", "Sábado", "Lun–Dom"
  hours: string;   // "9:00 – 18:00", "Cerrado", "24 h"
};

type Social = {
  facebook:  string | null;
  instagram: string | null;
  tiktok:    string | null;
  x:         string | null;
  youtube:   string | null;
};

type Contact = {
  address:  string | null;
  phone:    string | null;
  email:    string | null;
  whatsapp: string | null;   // número o link wa.me
  maps_url: string | null;   // link a Google Maps
  hours:    HourEntry[];     // [] si no hay
  social:   Social;          // siempre presente (con nulls)
};

type Profile = {
  tagline:     string | null;   // eslogan del hero
  description: string | null;   // "Sobre nosotros"
  contact:     Contact;         // siempre presente (con nulls)
};
```

**Reglas de forma (igual que `branding`):**
- Un tenant sin configurar devuelve **todo en `null`**, `hours` en `[]`, y los objetos `contact` / `social` **siempre presentes** (nunca ausentes).
- Así el front puede leer `store.contact.phone` sin miedo a `undefined`.

> **Decisión de diseño — `hours` como texto libre:** se eligió `{ days, hours }` en strings (en vez de `open`/`close` estructurados) porque los horarios reales son muy variados ("Lun–Vie 9–18, Sáb medio día, Dom cerrado") y así el negocio los escribe como quiera, sin validación de tiempos. **Contra:** no permite calcular "¿está abierto ahora?". Si eso se quiere a futuro, habría que migrar a horas estructuradas.

---

## 2. B2B — El dueño edita el contenido

Requieren 🔒 **JWT de negocio**:
```
Authorization: Bearer <token_de_negocio>
```
El tenant sale del token (`tenant_id`) — **nunca** por parámetro (aislamiento multi-tenant).

---

### 2.1 `GET /api/v1/settings/profile`

**Response `200`:**
```json
{
  "tagline": "Cocina mexicana de siempre",
  "description": "Somos un restaurante familiar con más de 20 años preparando recetas de casa.",
  "contact": {
    "address": "Av. Reforma 123, Col. Centro, CDMX",
    "phone": "+52 55 1234 5678",
    "email": "hola@tiarosa.com",
    "whatsapp": "+52 55 1234 5678",
    "maps_url": "https://maps.google.com/?q=19.4326,-99.1332",
    "hours": [
      { "days": "Lunes a Viernes", "hours": "9:00 – 18:00" },
      { "days": "Sábado", "hours": "10:00 – 14:00" },
      { "days": "Domingo", "hours": "Cerrado" }
    ],
    "social": {
      "facebook": "https://facebook.com/tiarosa",
      "instagram": "https://instagram.com/tiarosa",
      "tiktok": null,
      "x": null,
      "youtube": null
    }
  }
}
```

**Sin configurar (tenant nuevo):**
```json
{
  "tagline": null,
  "description": null,
  "contact": {
    "address": null, "phone": null, "email": null,
    "whatsapp": null, "maps_url": null,
    "hours": [],
    "social": { "facebook": null, "instagram": null, "tiktok": null, "x": null, "youtube": null }
  }
}
```

---

### 2.2 `PUT /api/v1/settings/profile`

**Reemplazo total** (misma semántica que `PUT /settings/branding`): lo que se omite se guarda como `null` / `[]`.

**Request:** mismo shape que el `GET`.

**Response `200`:** el objeto ya guardado (idéntico al `GET`).

**Ejemplos válidos:**
```json
// Solo eslogan
{ "tagline": "Cocina mexicana de siempre" }

// Limpiar todo
{}
```

**Validaciones:**

| Campo | Regla | Si falla |
|---|---|---|
| `tagline` | máx **120** chars, o `null` | `422` |
| `description` | máx **2000** chars, o `null` | `422` |
| `contact.address` | máx **300** chars, o `null` | `422` |
| `contact.phone` | máx **30** chars, o `null` | `422` |
| `contact.email` | formato email válido, o `null` | `422` |
| `contact.whatsapp` | máx **40** chars (número o link `wa.me`), o `null` | `422` |
| `contact.maps_url` | URL `http(s)`, máx 2048, o `null` | `422` |
| `contact.hours` | array, máx **10** entradas; `days` máx 60, `hours` máx 60 | `422` |
| `contact.social.*` | URL `http(s)`, máx 2048, o `null` | `422` |

**Comportamiento interno esperado (igual que branding):**
- **Merge** sobre `config`: tocar solo la clave `profile`, preservar `branding` y lo demás.
- **Invalidar la caché** del storefront de ese slug, para que el cliente vea el cambio sin esperar el TTL.

**Errores:**
| Status | Cuándo |
|---|---|
| `401` | Sin token / inválido / expirado |
| `422` | Validación (largo, email, URL) |

---

## 3. Público — Servir el contenido al cliente

### 3.1 `GET /s/{slug}` (extendido)

Sin token. **Agregar** `tagline`, `description` y `contact` junto a lo que ya devuelve (branding incluido).

**Response `200` (nuevo shape completo):**
```json
{
  "slug": "nombre-del-restaurante",
  "business_name": "Tia rosa",
  "business_type": "restaurant",

  "logo_url": "https://cdn.tunegocio.com/logo.png",
  "banner_url": null,
  "theme": { "primary": "#e11d48", "accent": "#881337" },

  "tagline": "Cocina mexicana de siempre",
  "description": "Somos un restaurante familiar con más de 20 años…",
  "contact": {
    "address": "Av. Reforma 123, Col. Centro, CDMX",
    "phone": "+52 55 1234 5678",
    "email": "hola@tiarosa.com",
    "whatsapp": "+52 55 1234 5678",
    "maps_url": "https://maps.google.com/?q=...",
    "hours": [
      { "days": "Lunes a Viernes", "hours": "9:00 – 18:00" }
    ],
    "social": {
      "facebook": "https://facebook.com/tiarosa",
      "instagram": null, "tiktok": null, "x": null, "youtube": null
    }
  }
}
```

- Si no hay nada configurado → `tagline` y `description` en `null`, `contact` con todo en `null`, `hours: []`, `social` con todo en `null`.
- El front tiene **fallbacks**: sin eslogan muestra solo el nombre; sin contacto, el footer se reduce a lo mínimo. **Nada se rompe si viene null.**

**Errores:** `404` si el slug no existe o no es pública (igual que hoy).

---

### 3.2 `GET /api/v1/explore` (recomendado)

Agregar **`tagline`** a cada item — es la línea corta ideal para el subtítulo de la card del marketplace (hoy el front usa un texto genérico por tipo de negocio).

```json
{
  "items": [
    {
      "slug": "nombre-del-restaurante",
      "business_name": "Tia rosa",
      "business_type": "restaurant",
      "logo_url": "https://cdn.tunegocio.com/logo.png",
      "tagline": "Cocina mexicana de siempre"
    }
  ],
  "total": 1, "page": 1, "page_size": 20
}
```
> Solo `tagline` (no `description` ni `contact` — la card no los necesita).

---

## 4. Resumen de tareas para el back

1. **Helper** para leer/escribir `Tenant.config["profile"]` (merge, sin pisar `branding` ni el resto de `config`).
2. **`GET /api/v1/settings/profile`** — contenido del tenant del token.
3. **`PUT /api/v1/settings/profile`** — validar, guardar, **invalidar caché** del storefront de ese slug.
4. **Extender `GET /s/{slug}`** con `tagline`, `description`, `contact`.
5. *(Recomendado)* Agregar `tagline` a los items de `GET /api/v1/explore`.

**No-goals:** subida de archivos; horarios estructurados con lógica de "abierto ahora"; multi-idioma.

---

## 5. Notas para no desincronizar

- Nombres de campo **fijos**: `tagline`, `description`, `contact.{address,phone,email,whatsapp,maps_url,hours,social}`, `social.{facebook,instagram,tiktok,x,youtube}`.
- `contact` y `contact.social` **siempre presentes** (con nulls), `hours` siempre array. Mismo criterio que `theme` en branding.
- Si el back necesita cambiar algún nombre o anidar distinto, avisar para ajustar el front.
