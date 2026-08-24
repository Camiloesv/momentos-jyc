# Despliegue — Momentos JyC

Referencia de infraestructura para mantener o duplicar el deploy real de este proyecto.

## Contexto: dos proyectos, un dominio raíz

- **Sitio principal de la boda** — `jesycami.bond`, en Netlify (estático). No se toca desde este repo.
- **Este repo (mini-álbum de invitados)** — `momentos.jesycami.bond`, subdominio del anterior, en un VPS aparte.

Ambos comparten dominio raíz registrado en Namecheap, pero viven en infraestructuras separadas: el mini-álbum es **stateful** (recibe uploads, los guarda en disco y los indexa en SQLite), por lo que necesita un servidor con almacenamiento persistente — no encaja en Netlify.

## Infraestructura

| Recurso | Valor |
|---|---|
| VPS | Hostinger, plan KVM 4 (4 vCPU, 16 GB RAM, 200 GB SSD) |
| Nombre de host | `srv1623383.hstgr.cloud` |
| OS | Ubuntu 24.04 con **EasyPanel** preinstalado |
| Ubicación | United States — Boston 2 |
| Acceso SSH | `ssh root@<IP del VPS>` |
| DNS | Namecheap (`jesycami.bond`), nameservers por defecto |

**⚠️ Otros servicios en el mismo VPS:** n8n y OpenClaw corren en la misma máquina. No reinstalar el sistema operativo ni tocar esos servicios — se perderían.

## Build y arranque: Nixpacks

EasyPanel detecta y builda la app automáticamente vía Nixpacks, usando `nixpacks.toml` en la raíz del repo:

```toml
providers = ["node"]

[phases.setup]
nixPkgs = ["nodejs_20", "npm-9_x", "python3", "gcc", "gnumake"]

[phases.install]
cmds = ["npm ci --build-from-source"]

[start]
cmd = "node server/index.js"
```

- `nodejs_20` pinnea Node 20 (requerido por `better-sqlite3`, que compila un binario nativo).
- `python3`/`gcc`/`gnumake` son las build tools que necesita esa compilación.
- No hay Dockerfile, ni Caddyfile, ni PM2/`ecosystem.config.cjs` en uso — EasyPanel maneja el reverse proxy (TLS automático vía Let's Encrypt) y la supervisión del proceso.

## Pasos para desplegar/duplicar

### 1. DNS (Namecheap)

Domain List → `jesycami.bond` → Manage → Advanced DNS → Add New Record:

| Type | Host | Value | TTL |
|---|---|---|---|
| A Record | `momentos` | `<IP del VPS>` | Automatic |

Verificar propagación: `nslookup momentos.jesycami.bond`.

### 2. Crear la app en EasyPanel

1. Entrar a EasyPanel desde el hPanel del VPS ("Gestionar panel").
2. Nueva app → tipo **App**, build con Nixpacks, fuente: este repo de GitHub.
3. Variables de entorno (ver `.env.example` para la lista completa):
   ```
   PORT=3001
   HOST=0.0.0.0
   UPLOAD_DIR=/data/uploads
   DB_PATH=/data/items.db
   ADMIN_TOKEN=<generar aleatorio ≥32 chars>
   PUBLIC_BASE_URL=https://momentos.jesycami.bond
   MAX_IMAGE_BYTES=15728640
   MAX_VIDEO_BYTES=125829120
   SUPABASE_URL=<opcional, para sync de RSVPs>
   SUPABASE_SERVICE_ROLE_KEY=<opcional>
   RSVP_SYNC_UNTIL=<fecha límite del sync automático>
   LOG_LEVEL=info
   ```
4. **Volumen persistente montado en `/data`** — crítico: sin esto, uploads y la DB se borran en cada redeploy.
5. Domains → agregar `momentos.jesycami.bond`. EasyPanel pide el certificado SSL automáticamente cuando el DNS ya resuelve.
6. Deploy.

### 3. Verificación

```bash
curl -I https://momentos.jesycami.bond           # 200 + cert válido
curl https://momentos.jesycami.bond/api/health    # {ok:true,...}
```

Desde un celular real (4G, fuera de wifi local):
1. Abrir la URL.
2. Subir una foto en alguno de los "momentos".
3. Confirmar que aparece en la galería en vivo (SSE) desde otro dispositivo.

### 4. Backups

EasyPanel suele ofrecer snapshots del volumen. Alternativa por cron en el host:

```bash
0 3 * * * tar -czf /root/backup-momentos-$(date +\%F).tar.gz /var/lib/docker/volumes/<volumen>/_data && \
          find /root -name 'backup-momentos-*.tar.gz' -mtime +14 -delete
```

(El path exacto del volumen se confirma al crear la app en EasyPanel.)

## Operación

- **Logs y reinicio:** desde el dashboard de EasyPanel (la app tiene su propia sección de logs y el botón de restart) — no hay `pm2`.
- **Ocultar un item rápido durante el evento:**
  ```bash
  curl -X DELETE -H "X-Admin-Token: $ADMIN_TOKEN" \
    https://momentos.jesycami.bond/api/admin/items/<id>
  ```
- **Exportar todo el álbum:**
  ```bash
  curl -o momentos.zip "https://momentos.jesycami.bond/api/admin/export?token=$ADMIN_TOKEN"
  ```
- **Espacio en disco:** revisar el volumen `/data` desde EasyPanel o `df -h` por SSH.

## Cota de recursos esperada

~200 invitados × ~10 archivos × ~30 MB promedio ≈ 60 GB pico. El plan KVM 4 (200 GB) lo absorbe sin problema. RAM esperada (Node + SQLite): < 500 MB.

## Git

Repo: `github.com/Camiloesv/momentos-jyc`, rama `main`.
