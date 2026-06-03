# Contexto de despliegue — Momentos JyC

> Documento de traspaso para continuar el despliegue en una conversación nueva.
> Generado tras la sesión inicial de diagnóstico de infraestructura.

---

## 1. Contexto general de los dos proyectos

### Proyecto A — Sitio principal de boda
- **Dominio:** `jesycami.bond`
- **Hosting:** Netlify (ya desplegado, funcionando)
- **DNS:** Namecheap (nameservers `dns1/dns2.registrar-servers.com`)
- **Estado:** No se toca. Se queda como está.

### Proyecto B — Mini-álbum para invitados (ESTE REPO)
- **Dominio destino:** `momentos.jesycami.bond` (subdominio del anterior)
- **Carpeta local:** `C:\Users\camil\Documents\Github\momentos-jyc`
- **Hosting destino:** VPS Hostinger con EasyPanel
- **Estado:** Código listo localmente, sin desplegar todavía, sin repo Git inicializado.

### Cómo se relacionan
- Comparten el mismo **dominio raíz** registrado en Namecheap (`jesycami.bond`).
- Viven en **infraestructuras separadas**:
  - `jesycami.bond` → Netlify (estático)
  - `momentos.jesycami.bond` → VPS Hostinger (Node + SQLite + uploads persistentes)
- La separación es intencional: el mini-álbum es **stateful** (recibe uploads de invitados, los guarda en disco y los indexa en SQLite), por lo que necesita servidor con almacenamiento persistente — no encaja en Netlify.
- DNS: ambos viven bajo los mismos nameservers en Namecheap. Para apuntar `momentos.*` al VPS se añade un A record en el panel de DNS de Namecheap; no se modifica nada del registro raíz `jesycami.bond` que apunta a Netlify.

---

## 2. Estado de la infraestructura (verificado en sesión)

### VPS Hostinger
- **Nombre:** `srv1623383.hstgr.cloud`
- **Plan:** KVM 4 (4 vCPU, 16 GB RAM, 200 GB SSD)
- **Sistema operativo:** **Ubuntu 24.04 con EasyPanel preinstalado**
- **IP pública:** `177.7.37.75`
- **Ubicación:** United States — Boston 2
- **Acceso SSH:** `ssh root@177.7.37.75`
- **Expiración del plan:** 2028-04-27 (renovación automática activa)
- **Otros servicios corriendo en el mismo VPS:** n8n, OpenClaw (NO TOCAR — reinstalar el OS los borraría).

### DNS — Namecheap
- Registrar: Namecheap
- Nameservers activos: `dns1.registrar-servers.com`, `dns2.registrar-servers.com`
- Privacidad WHOIS activa (Withheld for Privacy)
- Vigencia: hasta 2027-06-02

---

## 3. Conflicto detectado con el README del repo

El `README.md` actual asume despliegue en **Ubuntu 22.04 "Pure OS"** sin panel, instalando Caddy + PM2 a mano. **Esa guía NO aplica a esta infraestructura** porque:

1. El VPS ya tiene **EasyPanel** instalado (gestiona Nginx/Traefik en los puertos 80/443).
2. Hay **n8n y OpenClaw** corriendo en el mismo VPS — reinstalar borraría todo.
3. Instalar Caddy manual entraría en conflicto con el reverse proxy de EasyPanel.

**Decisión:** Adaptar el despliegue a EasyPanel en lugar de seguir el README al pie de la letra. El README debe actualizarse después del despliegue.

---

## 4. Plan de despliegue adaptado a EasyPanel

### Fase 1 — Git + GitHub (local, sin tocar VPS)
1. `git init` en `C:\Users\camil\Documents\Github\momentos-jyc`
2. Verificar que `.gitignore` excluye correctamente (ya confirmado: ignora `node_modules`, `.env`, `*.db*`, `uploads/`, `logs/`).
3. Primer commit.
4. Crear repo en GitHub (privado recomendado).
5. Push inicial.

**Decisión pendiente del usuario:** nombre del repo, usuario GitHub, público vs privado, si usar `gh` CLI o crear repo a mano.

### Fase 2 — DNS en Namecheap
1. Entrar a Namecheap → Domain List → `jesycami.bond` → Manage → Advanced DNS.
2. Añadir nuevo registro:
   | Tipo | Host | Value | TTL |
   |------|------|-------|-----|
   | A Record | `momentos` | `177.7.37.75` | Automatic |
3. Verificar propagación: `nslookup momentos.jesycami.bond` (puede tardar 5–30 min).

### Fase 3 — App en EasyPanel
1. Acceder a EasyPanel desde hPanel del VPS (botón "Gestionar panel" en la vista general).
2. Crear nueva app:
   - Tipo: **App** (build automático con Nixpacks — detecta Node 20 desde `package.json`).
   - Fuente: repo de GitHub creado en Fase 1.
3. Configurar variables de entorno (ver `.env.example`):
   - `PORT=3001`
   - `HOST=0.0.0.0`
   - `UPLOAD_DIR=/data/uploads`
   - `DB_PATH=/data/items.db`
   - `ADMIN_TOKEN=<generar aleatorio ≥32 chars>`
   - `PUBLIC_BASE_URL=https://momentos.jesycami.bond`
   - `MAX_IMAGE_BYTES=15728640`
   - `MAX_VIDEO_BYTES=125829120`
4. **Volumen persistente** montado en `/data` (crítico — sin esto los uploads y la DB se borran en cada redeploy).
5. Dominio: añadir `momentos.jesycami.bond` en la sección Domains de la app — EasyPanel pide cert SSL Let's Encrypt automáticamente cuando el DNS ya está apuntando.
6. Deploy.

### Fase 4 — Verificación
- `curl -I https://momentos.jesycami.bond` → 200 + cert válido
- `curl https://momentos.jesycami.bond/api/health` → `{ok:true,...}`
- Test desde celular real (4G, fuera de wifi local):
  1. Abrir URL.
  2. Subir foto en alguno de los "momentos".
  3. Confirmar que aparece en la galería en vivo (SSE).

### Fase 5 — Backups
EasyPanel suele ofrecer snapshots del volumen. Alternativa con cron en el host:
```bash
0 3 * * * tar -czf /root/backup-momentos-$(date +\%F).tar.gz /var/lib/docker/volumes/<volumen>/_data && \
          find /root -name 'backup-momentos-*.tar.gz' -mtime +14 -delete
```
(Path exacto del volumen se confirma al crear la app en EasyPanel.)

---

## 5. Inventario del código local (verificado)

### Archivos clave
- `package.json` — Node 20, Fastify, better-sqlite3, multipart, rate-limit, file-type
- `server/index.js` — entrypoint
- `server/routes/` — upload, feed, stream (SSE), admin
- `server/lib/` — db, validate, storage, events
- `server/public/` — frontend vanilla HTML+CSS+JS
- `.env.example` — plantilla de variables
- `Caddyfile` — **no se usará** (EasyPanel maneja el reverse proxy)
- `ecosystem.config.cjs` — PM2, **no se usará** (EasyPanel maneja el proceso)
- `.gitignore` — correcto

### Archivos locales NO subir a Git (ya en `.gitignore`)
- `.env` — contiene secretos
- `node_modules/`
- `uploads/` — fotos/videos de pruebas locales
- `items.db`, `items.db-shm`, `items.db-wal` — DB de pruebas locales

### Estado Git
- **No es repo Git** (no existe carpeta `.git`).
- Sin remotes configurados.

---

## 6. Stack técnico (resumen)

- **Backend:** Node 20 + Fastify
- **DB:** SQLite con WAL (better-sqlite3) — solo índice de archivos
- **Storage:** filesystem local (`uploads/`) — Caddy servía estáticos directo en el plan original; en EasyPanel Node servirá vía `@fastify/static`
- **Real-time:** Server-Sent Events (SSE) para galería en vivo, con fallback a polling
- **Validación:** magic bytes vía `file-type`
- **Rate limiting:** 30 uploads / 10 min por IP
- **Frontend:** vanilla HTML/CSS/JS, sin bundler
- **Sin ffmpeg:** límite de duración de video es client-side, el server solo enforce tamaño

### Recursos esperados (cota alta)
- ~200 invitados × ~10 archivos × ~30 MB promedio = ~60 GB pico.
- El plan KVM 4 (200 GB) lo absorbe sin problema.
- RAM: Node + SQLite ligeros, < 500 MB esperado.

---

## 7. Próximos pasos para la conversación nueva

Cuando abras una nueva conversación desde esta carpeta:

1. **Lee este archivo primero** (`CONTEXTO-DESPLIEGUE.md`).
2. Decide nombre de repo GitHub y si público/privado.
3. Decide si quieres que el agente ejecute Fase 1 (git init + push) automáticamente o paso a paso.
4. Confirma que el agente NO debe seguir el README.md viejo — debe adaptarse a EasyPanel.
5. Para Fase 2 (DNS Namecheap) y Fase 3 (EasyPanel UI), el agente necesita un navegador con tu sesión activa (Chrome con extensión "Claude in Chrome" o equivalente, ya usado en esta sesión).

### Datos clave a tener a mano
- IP del VPS: `177.7.37.75`
- Subdominio: `momentos.jesycami.bond`
- Carpeta local: `C:\Users\camil\Documents\Github\momentos-jyc`
- Email Hostinger/registro: babuchisgerencia@gmail.com

### Acciones que requieren confirmación explícita del usuario
- Cualquier commit/push a GitHub (especialmente público).
- Restablecer password root del VPS.
- Reiniciar el VPS.
- Cualquier cambio a registros DNS existentes (solo se AÑADE el A record `momentos`, no se modifica nada más).
- Cualquier cosa que toque n8n u OpenClaw en el VPS.

---

## 8. Historial de la sesión actual (resumen)

1. Usuario pidió ayuda con guía paso a paso de Hostinger asumiendo VPS limpio.
2. Se aclaró que la IA no puede operar la cuenta Hostinger sin autorización + browser tool.
3. Usuario autorizó uso del navegador (extensión Claude in Chrome).
4. Verificación: hPanel → VPS muestra 1 VPS activo (KVM 4, ya con EasyPanel + Ubuntu 24.04, no vacío).
5. Decisión: **no reinstalar** OS porque borraría n8n + OpenClaw.
6. Verificación carpeta local: app Node/Fastify lista, sin git inicializado, README desactualizado para EasyPanel.
7. Verificación DNS: Namecheap como registrador con sus nameservers default.
8. Plan adaptado a EasyPanel documentado en este archivo.
9. **Pendiente de ejecutar:** Fases 1–4.
