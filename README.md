# Momentos JyC

Mini-álbum de fotos y videos cortos para los invitados de la boda de Jesyka & Camilo.
Sirve `https://momentos.jesycami.bond` desde un VPS Hostinger con EasyPanel, separado del sitio principal en Netlify.

## Stack

- **Node 20 + Fastify** — API de upload, feed, notas y SSE
- **better-sqlite3** (WAL) — índice de archivos y notas
- **@fastify/multipart** — uploads streaming
- **file-type** — validación por magic bytes
- **@supabase/supabase-js** — sync opcional de mensajes de RSVP hacia el feed
- **archiver** — export de todo el álbum a `.zip`
- **EasyPanel** (Nixpacks) — build, reverse proxy y supervisión del proceso; no hay Caddy ni PM2 en el deploy actual (ver `DEPLOY.md`)
- HTML/CSS/JS vanilla en `server/public/` — sin bundler

## Estructura

```
momentos-jyc/
├── server/
│   ├── index.js            # bootstrap: plugins, rutas, health, shutdown
│   ├── routes/              # upload, feed, notes, items, stream, admin
│   ├── lib/                  # db, validate, storage, events, uploader,
│   │                          # ratelimit (self-delete), rsvpSync
│   └── public/               # index.html + app.js (guest UI + admin mode)
│                              # slideshow.html + slideshow.js (wall/TV)
├── nixpacks.toml            # build real usado por EasyPanel
├── DEPLOY.md                 # infraestructura y pasos de despliegue/duplicado
└── .env.example
```

## Features

- **Subida de fotos/video** (`POST /api/upload`) — un archivo por request, validado por magic bytes (no por extensión), con tope de tamaño configurable. Se guarda en `UPLOAD_DIR/<YYYY-MM-DD>/<uuid>.<ext>` y aparece al instante en la galería de todos vía SSE.
- **Feed en vivo** — `GET /api/feed` para carga inicial y `GET /api/stream` (Server-Sent Events, con fallback a polling en el cliente) para actualizaciones en tiempo real.
- **Guestbook de notas** (`POST /api/notes`) — mensajes de texto cortos (máx. 280 caracteres) sin adjuntar archivo.
- **Borrado/restauración self-service** — cada invitado tiene un `X-Uploader-Id` (UUID generado y guardado en `localStorage`) que le permite ocultar o restaurar **sus propios** items (`DELETE`/`POST /api/items/:id/restore`), con un rate limit propio (5/min, 30/hora) en `server/lib/ratelimit.js`.
- **Modo admin** — botón discreto ("♡") en `index.html` que pide el `ADMIN_TOKEN`; desbloquea ver items ocultos y ocultar/restaurar cualquier item de cualquier invitado.
- **Export a zip** (`GET /api/admin/export?token=...`) — descarga un `.zip` con `manifest.json` (metadata de todos los items, incluidos los ocultos) + todos los archivos en `uploads/`.
- **Sync de RSVPs** (`server/lib/rsvpSync.js`) — si `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` están configurados, importa automáticamente (al boot y cada 24h, hasta `RSVP_SYNC_UNTIL`) los mensajes de confirmación de asistencia como notas del feed, deduplicados. Requiere el transporte `ws` explícito para Node 20 (no tiene WebSocket nativo como Node 22+).
- **Slideshow / wall-of-love** (`server/public/slideshow.html`) — pantalla pensada para TV/proyector: crossfade automático de fotos y, cada tanto, un tablero con notas del guestbook. Parámetros por query string (`moment`, `duration`, `boardDuration`, `boardEvery`).

## Rutas HTTP

| Método | Ruta | Auth | Qué hace |
|---|---|---|---|
| `POST` | `/api/upload` | — | Sube una foto/video (multipart), valida y publica en el feed |
| `GET` | `/api/feed` | — | Lista items recientes no ocultos (`?moment=`, `?limit=`, máx. 200) |
| `GET` | `/api/stream` | — | SSE con eventos `new`/`hide` + heartbeat cada 25s |
| `POST` | `/api/notes` | — | Publica una nota de texto (guestbook) |
| `DELETE` | `/api/items/:id` | `X-Uploader-Id` (dueño) | Oculta un item propio |
| `POST` | `/api/items/:id/restore` | `X-Uploader-Id` (dueño) | Restaura un item propio |
| `POST` | `/api/admin/verify` | token en body | Valida el `ADMIN_TOKEN` (login del modo admin) |
| `GET` | `/api/admin/feed` | `X-Admin-Token` o `?token=` | Lista todos los items, incl. ocultos (máx. 500) |
| `DELETE` | `/api/admin/items/:id` | admin | Oculta cualquier item |
| `POST` | `/api/admin/items/:id/restore` | admin | Restaura cualquier item |
| `GET` | `/api/admin/rsvp/sync` | admin | Dispara el sync de RSVPs manualmente |
| `GET` | `/api/admin/export` | admin | Descarga `.zip` con todo (manifest + archivos) |
| `GET` | `/api/health` | — | Health check |

## Desarrollo local

```bash
cp .env.example .env       # ajusta UPLOAD_DIR y DB_PATH a rutas locales
npm install
npm run dev
```

Abre `http://localhost:3001` desde el celular en la misma red:
`http://<ip-de-tu-pc>:3001` (cambia `HOST=0.0.0.0` en `.env`).

## Smoke tests

```bash
# upload
curl -F "moment=brindis" -F "file=@foto.jpg" http://localhost:3001/api/upload
# feed
curl http://localhost:3001/api/feed
# stream
curl -N http://localhost:3001/api/stream
# nota de texto
curl -X POST -H "Content-Type: application/json" \
  -d '{"body":"Felicidades!"}' http://localhost:3001/api/notes
# admin: ocultar un item
curl -X DELETE -H "X-Admin-Token: $ADMIN_TOKEN" \
  http://localhost:3001/api/admin/items/<id>
# admin: exportar todo
curl -o momentos.zip "http://localhost:3001/api/admin/export?token=$ADMIN_TOKEN"
```

## Despliegue

Deploy real: VPS Hostinger con **EasyPanel**, build automático con **Nixpacks** (ver `nixpacks.toml`), volumen persistente montado en `/data` para `uploads/` y `items.db`. No hay Caddy ni PM2 en producción — EasyPanel maneja el reverse proxy (TLS/dominio) y la supervisión del proceso.

Guía completa (specs del VPS, DNS, configuración de la app en EasyPanel, backups) en **[DEPLOY.md](DEPLOY.md)**.

## Variables de entorno

| Var | Default | Notas |
|---|---|---|
| `PORT` | `3001` | Puerto interno |
| `HOST` | `127.0.0.1` | `0.0.0.0` en dev y en EasyPanel |
| `UPLOAD_DIR` | `./uploads` | Producción (EasyPanel): `/data/uploads` |
| `DB_PATH` | `./items.db` | Producción (EasyPanel): `/data/items.db` |
| `ADMIN_TOKEN` | `930822` (hardcodeado en `server/index.js` si falta la env var) | **Cambiar siempre en producción** por uno aleatorio de 32+ caracteres |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | `https://momentos.jesycami.bond` en prod |
| `MAX_IMAGE_BYTES` | `15728640` | 15 MB |
| `MAX_VIDEO_BYTES` | `125829120` | 120 MB |
| `SUPABASE_URL` | `''` (deshabilita el sync) | URL del proyecto Supabase para el sync de RSVPs |
| `SUPABASE_SERVICE_ROLE_KEY` | `''` (deshabilita el sync) | Service role key de Supabase |
| `RSVP_SYNC_UNTIL` | `2026-06-20` | Fecha límite del sync automático (el disparo manual por admin la ignora) |
| `LOG_LEVEL` | `info` | Nivel del logger de Fastify (pino) |

## Notas de diseño

- Acceso público vía link/QR; no requiere token de invitación para subir.
- Sin moderación previa; modo admin permite ocultar/restaurar reactivamente.
- Galería en vivo por SSE con fallback a polling.
- SQLite en modo WAL para escrituras concurrentes ligeras.
- No instalamos ffmpeg; el tope de duración de video (65s) es client-side, el servidor solo enforce tamaño.
