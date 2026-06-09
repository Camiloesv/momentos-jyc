import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import archiver from 'archiver';
import { queries } from '../lib/db.js';
import { emitHide, emitNew } from '../lib/events.js';

function tokenOk(provided, expected) {
  if (typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function adminRoute(fastify, opts) {
  const { adminToken, uploadDir, runRsvpSync } = opts;

  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/admin')) return;
    // Para POST /api/admin/verify, el token viene en el body.
    if (req.url.startsWith('/api/admin/verify')) return;
    const headerTok = req.headers['x-admin-token'];
    const queryTok = req.query?.token;
    if (!tokenOk(headerTok, adminToken) && !tokenOk(queryTok, adminToken)) {
      return reply.code(401).send({ error: 'No autorizado' });
    }
  });

  fastify.post('/api/admin/verify', async (req, reply) => {
    const body = req.body ?? {};
    const provided = typeof body.token === 'string' ? body.token : null;
    if (!tokenOk(provided, adminToken)) {
      return reply.code(401).send({ error: 'Código incorrecto' });
    }
    return { ok: true };
  });

  fastify.get('/api/admin/feed', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit ?? '200', 10) || 200, 500);
    const rows = queries.listAdmin().all(limit);
    const items = rows.map((r) => ({
      id: r.id,
      moment: r.moment,
      kind: r.kind,
      url: r.filename ? `/uploads/${r.filename}` : null,
      author: r.author,
      body: r.body ?? null,
      uploader_id: r.uploader_id ?? null,
      source: r.source ?? 'app',
      hidden: r.hidden === 1,
      created_at: r.created_at,
    }));
    reply.header('Cache-Control', 'no-store');
    return { items };
  });

  fastify.delete('/api/admin/items/:id', async (req, reply) => {
    const { id } = req.params;
    const result = queries.hideItem().run(id);
    if (result.changes === 0) return reply.code(404).send({ error: 'No existe' });
    emitHide(id);
    return { ok: true, id };
  });

  fastify.post('/api/admin/items/:id/restore', async (req, reply) => {
    const { id } = req.params;
    const result = queries.restoreItem().run(id);
    if (result.changes === 0) return reply.code(404).send({ error: 'No existe' });
    const row = queries.getItemPublic().get(id);
    if (row) {
      emitNew({
        id: row.id,
        moment: row.moment,
        kind: row.kind,
        url: row.filename ? `/uploads/${row.filename}` : null,
        author: row.author,
        body: row.body ?? null,
        uploader_id: row.uploader_id ?? null,
        source: row.source ?? 'app',
        created_at: row.created_at,
      });
    }
    return { ok: true, id };
  });

  fastify.get('/api/admin/rsvp/sync', async (req) => {
    if (typeof runRsvpSync !== 'function') return { ok: false, reason: 'sync_not_configured' };
    const result = await runRsvpSync({ trigger: 'manual', log: req.log });
    return { ok: true, ...result };
  });

  fastify.get('/api/admin/export', async (req, reply) => {
    const rows = queries.listAllForExport().all();
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `momentos-jyc-${stamp}.zip`;

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Cache-Control', 'no-store');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => req.log.warn({ err }, 'archiver warning'));
    archive.on('error', (err) => {
      req.log.error({ err }, 'archiver error');
      reply.raw.destroy(err);
    });

    const manifest = {
      generated_at: new Date().toISOString(),
      total: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        moment: r.moment,
        kind: r.kind,
        filename: r.filename || null,
        author: r.author,
        body: r.body ?? null,
        uploader_id: r.uploader_id ?? null,
        hidden: r.hidden === 1,
        created_at: r.created_at,
      })),
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    const seen = new Set();
    for (const r of rows) {
      if (!r.filename) continue;
      if (seen.has(r.filename)) continue;
      seen.add(r.filename);
      const full = path.join(uploadDir, r.filename);
      if (!existsSync(full)) continue;
      archive.append(createReadStream(full), { name: `uploads/${r.filename}` });
    }

    archive.pipe(reply.raw);
    archive.finalize();
    return reply;
  });
}
