import { queries } from '../lib/db.js';
import { emitHide, emitNew, feedBus } from '../lib/events.js';
import { readUploaderId } from '../lib/uploader.js';
import { checkAndRecord, DELETE_LIMITS } from '../lib/ratelimit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function emitRestore(item) {
  // Reusamos el canal 'new' para que galería + slideshow lo reincorporen sin
  // duplicar lógica: si ya estaba en estado local lo ignoran, si no lo añaden.
  feedBus.emit('new', item);
}

export default async function itemsRoute(fastify) {
  fastify.delete('/api/items/:id', async (req, reply) => {
    const uploaderId = readUploaderId(req);
    if (!uploaderId) {
      return reply.code(400).send({ error: 'Falta identidad del subidor' });
    }
    const { id } = req.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'ID inválido' });

    const limited = checkAndRecord(`del:${uploaderId}`, DELETE_LIMITS);
    if (limited) {
      reply.header('Retry-After', String(limited.retryAfterSec));
      return reply
        .code(429)
        .send({ error: 'Demasiados borrados seguidos. Probá en unos segundos.' });
    }

    const result = queries.hideOwnItem().run(id, uploaderId);
    if (result.changes === 0) {
      return reply.code(403).send({ error: 'No podés borrar esta foto' });
    }
    emitHide(id);
    return { ok: true, id };
  });

  fastify.post('/api/items/:id/restore', async (req, reply) => {
    const uploaderId = readUploaderId(req);
    if (!uploaderId) {
      return reply.code(400).send({ error: 'Falta identidad del subidor' });
    }
    const { id } = req.params;
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'ID inválido' });

    const result = queries.restoreOwnItem().run(id, uploaderId);
    if (result.changes === 0) {
      return reply.code(403).send({ error: 'No se puede restaurar' });
    }

    const row = queries.getItemPublic().get(id);
    if (row) {
      emitRestore({
        id: row.id,
        moment: row.moment,
        kind: row.kind,
        url: row.filename ? `/uploads/${row.filename}` : null,
        author: row.author,
        body: row.body ?? null,
        uploader_id: row.uploader_id ?? null,
        created_at: row.created_at,
      });
    }
    return { ok: true, id };
  });
}
