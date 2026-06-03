# Momentos JyC

Mini-álbum de fotos y videos cortos para los invitados de la boda de Jesyka & Camilo.
Sirve `https://momentos.jesycami.bond` desde un VPS Hostinger, separado del sitio principal en Netlify.

## Stack

- **Node 20 + Fastify** — API de upload, feed y SSE
- **better-sqlite3** — índice de archivos
- **@fastify/multipart** — uploads streaming
- **@fastify/rate-limit** — 30 uploads / 10 min por IP
- **file-type** — validación por magic bytes
- **Caddy 2** — TLS automático + sirve `/uploads/*` desde disco
- **PM2** — supervisión del proceso
- HTML/CSS/JS vanilla en `server/public/` — sin bundler

## Estructura

```
momentos-jyc/
├── server/
│   ├── index.js            # bootstrap
│   ├── routes/             # upload, feed, stream, admin
│   ├── lib/                # db, validate, storage, events
│   └── public/             # mini-app (HTML+CSS+JS)
├── Caddyfile
├── ecosystem.config.cjs    # PM2
└── .env.example
```

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
# admin delete (oculta de la galería)
curl -X DELETE -H "X-Admin-Token: $ADMIN_TOKEN" \
  http://localhost:3001/api/admin/items/<id>
```

## Despliegue en VPS

### 1. DNS (Namecheap)

Domain List → `jesycami.bond` → Manage → Advanced DNS → Add New Record:

| Type     | Host     | Value          | TTL       |
|----------|----------|----------------|-----------|
| A Record | momentos | `<IP del VPS>` | Automatic |

Verifica: `nslookup momentos.jesycami.bond`.

### 2. VPS Hostinger (Ubuntu 22.04 LTS)

```bash
# Hardening
ssh root@<IP>
passwd
adduser camilo && usermod -aG sudo camilo

# Firewall
apt update && apt upgrade -y
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

# Caddy
apt install -y debian-keyring debian-keyring-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy.list
apt update && apt install -y caddy

# Node 20 + git
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git build-essential

# Código
mkdir -p /opt && cd /opt
git clone <repo-url> momentos-jyc
cd momentos-jyc
npm ci --production

# Directorios y permisos
mkdir -p /var/www/momentos/uploads /var/log/momentos /var/log/caddy
chown -R camilo:camilo /var/www/momentos /opt/momentos-jyc /var/log/momentos
cp .env.example .env
# editar .env: ADMIN_TOKEN aleatorio, rutas absolutas, PUBLIC_BASE_URL=https://momentos.jesycami.bond
nano .env

# Caddyfile
cp Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy

# PM2
npm i -g pm2
sudo -u camilo pm2 start ecosystem.config.cjs
sudo -u camilo pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u camilo --hp /home/camilo
```

### 3. Backup diario

```bash
crontab -e
# añadir:
0 3 * * * tar -czf /root/backup-$(date +\%F).tar.gz /var/www/momentos && \
          find /root -name 'backup-*.tar.gz' -mtime +14 -delete
```

### 4. Verificación

```bash
curl -I https://momentos.jesycami.bond                # 200 + cert válido
curl https://momentos.jesycami.bond/api/health        # {ok:true,...}
```

Desde celular real (4G, no wifi):
1. Escanea QR de `https://momentos.jesycami.bond`.
2. Elige momento, toma foto y verifica que sube.
3. Abre la URL en otro celular y confirma que el item aparece por SSE.

## Operación durante el evento

- **Ocultar un item** (moderación rápida):
  ```bash
  curl -X DELETE -H "X-Admin-Token: $TOKEN" \
    https://momentos.jesycami.bond/api/admin/items/<id>
  ```
- **Logs en vivo:** `pm2 logs momentos-jyc`
- **Reinicio:** `pm2 restart momentos-jyc`
- **Espacio en disco:** `df -h /var/www/momentos`

## Variables de entorno

| Var | Default | Notas |
|---|---|---|
| `PORT` | `3001` | Puerto interno; Caddy hace reverse_proxy |
| `HOST` | `127.0.0.1` | `0.0.0.0` solo en dev |
| `UPLOAD_DIR` | `./uploads` | Producción: `/var/www/momentos/uploads` |
| `DB_PATH` | `./items.db` | Producción: `/var/www/momentos/items.db` |
| `ADMIN_TOKEN` | `dev-token-change-me` | Aleatorio, ≥32 chars en prod |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | `https://momentos.jesycami.bond` en prod |
| `MAX_IMAGE_BYTES` | `15728640` | 15 MB |
| `MAX_VIDEO_BYTES` | `125829120` | 120 MB |

## Notas de diseño

- Acceso público vía link/QR; no requiere token de invitación.
- Sin moderación previa; endpoint admin permite ocultar reactivamente.
- Galería en vivo por SSE con fallback de polling.
- Caddy sirve `/uploads/*` directamente desde disco (no pasa por Node).
- SQLite WAL para escrituras concurrentes ligeras.
- No instalamos ffmpeg; tope de 60s en video es client-side, el servidor solo enforce tamaño.
