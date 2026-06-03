import { queries } from '../lib/db.js';
import { emitHide } from '../lib/events.js';

export default async function adminRoute(fastify, opts) {
  const { adminToken } = opts;

  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/admin')) return;
    const token = req.headers['x-admin-token'];
    if (!token || token !== adminToken) {
      return reply.code(401).send({ error: 'No autorizado' });
    }
  });

  fastify.delete('/api/admin/items/:id', async (req, reply) => {
    const { id } = req.params;
    const result = queries.hideItem().run(id);
    if (result.changes === 0) return reply.code(404).send({ error: 'No existe' });
    emitHide(id);
    return { ok: true, id };
  });
}
