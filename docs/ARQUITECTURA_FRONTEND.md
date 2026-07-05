# KARD Frontend — Documentación Técnica

**Proyecto:** KARD — plataforma SaaS multi-tenant B2B2C (inventario + punto de venta)
**Alcance de este doc:** solo el frontend. El backend (FastAPI + PostgreSQL/Neon + Redis) se documenta en el repo `Kard`.
**Última actualización:** 2026-07-05

---

## 1. Stack

| Qué | Con qué |
|---|---|
| Framework | Angular 22 (componentes standalone, sin NgModules) |
| Lenguaje | TypeScript ~6.0 |
| Estilos | SCSS por componente (sin framework CSS; diseño glassmorphism propio) |
| Estado | Signals de Angular (`signal`, `computed`) + un store singleton |
| HTTP | `HttpClient` (`provideHttpClient` en `app.config.ts`) |
| Async | RxJS solo donde aporta (debounce de búsquedas, streams HTTP) |
| Build/dev | Angular CLI — `npm start` = `ng serve --port 3000` |
| Backend | REST JSON contra FastAPI en `http://localhost:8000` |

---

## 2. Estructura de carpetas

```
kard-front/src/app/
├── app.config.ts        ← providers globales (router, http)
├── app.routes.ts        ← TODAS las rutas viven aquí (lazy loading)
├── app.ts               ← root: <router-outlet> + snackbar global
│
├── core/                ← todo lo compartido
│   ├── guards/auth.guard.ts       ← authGuard (B2B) y consumerGuard (B2C)
│   ├── models/auth.models.ts      ← tipos de requests/responses de auth
│   ├── store/product.store.ts     ← store singleton de productos (caché)
│   ├── components/snackbar/       ← notificaciones globales
│   └── services/                  ← un servicio por dominio del API
│       ├── auth.service.ts        ← login B2B + consumer, sesión, token
│       ├── image.service.ts       ← imágenes de productos (B2B)
│       ├── explore.service.ts     ← descubrimiento de tiendas (público)
│       ├── storefront.service.ts  ← tienda pública /s/{slug} (público)
│       ├── cart.service.ts        ← carrito Redis (requiere JWT consumer)
│       ├── order.service.ts       ← pedidos (requiere JWT consumer)
│       └── snackbar.service.ts    ← disparar toasts desde cualquier lado
│
├── auth/                ← login y registro (compartidos B2B/B2C)
│   ├── login/           ← UN solo formulario para ambos tipos de usuario
│   └── register/        ← registro de negocios (B2B)
│
├── dashboard/           ← MUNDO B2B (dueños/empleados del negocio)
│   ├── layout/          ← shell con sidebar + logout
│   ├── home/            ← inicio del dashboard
│   ├── products/        ← CRUD de productos finales (cards + drawer)
│   └── inventory/       ← CRUD de insumos con stock (tabla + drawer)
│
└── consumer/            ← MUNDO B2C (clientes)
    ├── explore/         ← marketplace: búsqueda + categorías + tiendas
    └── storefront/      ← tienda individual: catálogo + carrito + pedido
```

**Regla mental:** `dashboard/` = negocio, `consumer/` = cliente, `core/` = compartido. Nunca se cruzan directamente; solo comparten `core/`.

---

## 3. Los dos mundos (arquitectura B2B2C)

La plataforma tiene **dos identidades de usuario separadas**, con endpoints, tokens y vistas distintas:

| | B2B (negocio) | B2C (consumer) |
|---|---|---|
| Login | `POST /api/v1/auth/login` | `POST /api/v1/consumers/login` |
| JWT contiene | `user_id, tenant_id, role, business_type` | `consumer_id, type: "consumer"` |
| Vista tras login | `/dashboard` | `/explore` |
| Guard | `authGuard` | `consumerGuard` |

### Login dual — cómo funciona
`login.component.ts` intenta primero contra `/auth/login` (B2B); si responde 4xx, reintenta contra `/consumers/login`. El que funcione guarda la sesión con un discriminador `kind: 'b2b' | 'consumer'` y redirige a su mundo. **Si quieres cambiar este comportamiento, es en `auth/login/login.component.ts` (`onSubmit` / `tryConsumerLogin`).**

### Sesión
Vive en `localStorage`:
- `kard_token` → el JWT (se manda como `Authorization: Bearer`)
- `kard_user` → JSON de la sesión con `kind`

`AuthService.getSession()` devuelve solo sesiones B2B (null si es consumer); `getConsumerSession()` lo inverso. Así el dashboard nunca ve datos de un consumer y viceversa. **Todo lo de sesión se modifica en `core/services/auth.service.ts`.**

### Guards (anti manipulación de URL)
En `core/guards/auth.guard.ts`. Un consumer que teclea `/dashboard` rebota a `/explore` y un B2B que teclea `/explore` rebota a `/dashboard`. Sin token, ambos van a `/login`. *(La barrera real es el backend rechazando tokens cruzados; el guard es UX.)*

---

## 4. Rutas

Todas en `app.routes.ts`, todas lazy (`loadComponent`). **Para agregar una página: crear el componente y registrar la ruta ahí, con el guard del mundo que corresponda.**

| Ruta | Guard | Vista |
|---|---|---|
| `/login`, `/register` | — | auth |
| `/dashboard` (+ `products`, `inventory`) | `authGuard` | B2B |
| `/explore` | `consumerGuard` | marketplace |
| `/s/:slug` | `consumerGuard` | tienda + carrito (misma forma que la URL del backend) |

---

## 5. Patrones de diseño usados

### Store singleton con caché (productos B2B)
`core/store/product.store.ts` — `@Injectable({ providedIn: 'root' })`. Única fuente de verdad para productos del dashboard:
- Caché en memoria con **TTL de 5 min** y **validación de tenant** (si cambia el `tenant_id` de la sesión, el caché se considera viejo → evita ver datos de otro negocio al cambiar de cuenta).
- `load()` respeta caché, `reload()` fuerza, `clear()` se llama al hacer logout.
- Las mutaciones (create/update/remove/sell/restock) actualizan el signal local tras el OK del servidor — no se refetchea la lista.
- Products e Inventory **comparten este store**: products filtra `product_type === 'final'`, inventory filtra `'insumo'`.

**Si un dato de producto se ve viejo o fantasma, el problema casi seguro está aquí.**

### Servicios HTTP por dominio
Un servicio por área del API (auth, explore, storefront, cart, orders, images). Cada uno declara sus interfaces TypeScript del contrato JSON. **Para consumir un endpoint nuevo: agregar método al servicio del dominio (o crear uno nuevo en `core/services/`).**

> Nota: la URL base `http://localhost:8000` está repetida como constante en cada servicio. Para apuntar a otro backend hay que cambiarla en cada uno (mejora pendiente: moverla a un environment).

### Signals + computed (estado de UI)
Los componentes no usan `BehaviorSubject` ni zonas de estado externas: `signal()` para estado local, `computed()` para derivados (listas filtradas, contadores). Las búsquedas usan `Subject` + `debounceTime(300)` de RxJS.

### Drawer lateral (formularios)
Alta/edición en dashboard y el carrito en storefront usan el mismo patrón: overlay + panel deslizante derecho, controlado por un signal (`drawerOpen` / `cartOpen`). Los estilos se repiten por componente siguiendo la misma estructura.

### Metadata polimórfica por tipo de negocio
Los productos tienen `metadata: Record<string, any>` cuya forma depende del `business_type`:
- `restaurant` → `categoria, tiempo_preparacion_min, picante, alergenos[], ingredientes[]`
- `optician` → `esfera, cilindro, eje, material`

**Para agregar un tipo de negocio nuevo** hay que tocar: el form de `dashboard/products` y `dashboard/inventory` (secciones `@if (isRestaurant())`-style), `metaChips()` en `storefront.component.ts`, y los labels/iconos en `explore.component.ts/html`.

### Receta (ingredientes) de un platillo
Los productos finales guardan en `metadata.ingredientes` un array `{ insumo_id, nombre, cantidad }` que relaciona insumos del inventario. Se edita en el drawer de `dashboard/products`. Hoy es informativo; el descuento de stock al vender lo hará el backend.

### Theming del storefront (preparado, no activo)
La tienda del consumer pinta colores desde CSS variables `--sf-primary` / `--sf-accent`, definidas en `storefront.component.ts` (`DEFAULT_THEME` + `themeVars()`). El modelo `StorefrontInfo` ya acepta `logo_url`, `banner_url` y `theme` opcionales: **cuando el backend los envíe en `GET /s/{slug}`, se aplican solos.** Para cambiar el tema por defecto: `DEFAULT_THEME` en `storefront.component.ts`.

---

## 6. Comunicación con el backend

- **Formato:** JSON puro, sin sobre en éxitos; errores llegan como `{ "success": false, "error": "mensaje" }` (los 422 de Pydantic llegan como `{ "detail": [...] }`).
- **Auth:** header `Authorization: Bearer <token>`, agregado manualmente en cada servicio que lo necesita (no hay interceptor — mejora pendiente).
- **Paginación:** siempre `{ items, total, page, page_size }` con query params `?page=&page_size=`.
- **CORS:** el backend permite `http://localhost:3000` — por eso el front corre en el puerto 3000 (`npm start` ya lo fija).

### Mapa endpoint → servicio → vista

| Endpoint | Servicio | Lo usa |
|---|---|---|
| `POST /auth/login` | auth.service | login (B2B) |
| `POST /consumers/login` | auth.service | login (consumer) |
| `GET/POST/PUT/DELETE /products*` | product.store | dashboard products/inventory |
| `POST /products/{id}/sell\|restock` | product.store | inventory (consumo/reabasto) |
| `/products/{id}/images*` | image.service | drawers de imágenes |
| `GET /explore/categories`, `GET /explore` | explore.service | explore (etiquetas + tiendas) |
| `GET /s/{slug}`, `GET /s/{slug}/products*` | storefront.service | storefront (público) |
| `GET/POST/DELETE /cart/{slug}*` | cart.service | carrito en storefront |
| `POST/GET /orders*` | order.service | confirmar pedido |

### El carrito (cómo piensa)
El carrito **vive en el servidor** (Redis, un carrito por tienda por consumer, TTL 7 días). El front no guarda nada local: cada acción (`agregar`, `cambiar cantidad`, `quitar`) es un request y la respuesta es el carrito completo actualizado, que se asigna al signal `cart`. Las cantidades se mandan **absolutas** (`quantity: 0` elimina). Confirmar pedido (`POST /orders`) borra el carrito en el servidor; si falla por stock, el carrito queda intacto.

---

## 7. "¿Dónde modifico...?"

| Quiero... | Voy a... |
|---|---|
| Agregar una ruta/página | `app.routes.ts` + componente en `dashboard/` o `consumer/` |
| Cambiar a qué página redirige cada rol al entrar | `auth/login/login.component.ts` |
| Cambiar reglas de acceso por rol | `core/guards/auth.guard.ts` |
| Tocar sesión/token/logout | `core/services/auth.service.ts` |
| Cambiar el caché de productos (TTL, invalidación) | `core/store/product.store.ts` |
| Formulario de productos finales (campos, receta) | `dashboard/products/products.component.*` |
| Formulario/stock de insumos | `dashboard/inventory/inventory.component.*` |
| Landing del consumer (hero, búsqueda, categorías) | `consumer/explore/explore.component.*` |
| Catálogo de tienda, carrito, confirmar pedido | `consumer/storefront/storefront.component.*` |
| Tema por defecto de las tiendas | `DEFAULT_THEME` en `storefront.component.ts` |
| Iconos/labels de tipos de negocio | `explore.component.ts/html` (+ `storefront` para chips) |
| URL del backend | constante `API`/`BASE` en cada servicio de `core/services/` |
| Toasts/notificaciones | `core/services/snackbar.service.ts` |
| Puerto del dev server | `package.json` → script `start` |

---

## 8. Estado actual y pendientes conocidos

- ✅ Login dual + guards · CRUD products/insumos · explore · storefront · carrito completo
- ⏳ **Backend:** migración `003_orders_tables.sql` en Neon — sin ella `POST /orders` da 500 (el botón "Confirmar pedido" del front ya está listo)
- ⏳ **Backend:** `description` e `image_url` en `GET /explore` — el front ya los pinta si llegan
- ⏳ **Backend:** theming (`logo_url`, `banner_url`, `theme`) en `GET /s/{slug}` — el front ya lo aplica si llega
- 📋 Vista "Mis pedidos" del consumer (`order.service.list()` ya existe, falta la vista)
- 📋 Pago con Stripe (`POST /orders/{id}/pay`) cuando el backend lo tenga
- 📋 Mejoras técnicas: interceptor HTTP para el Bearer, mover URL base a environments
