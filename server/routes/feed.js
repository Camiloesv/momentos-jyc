import { queries } from '../lib/db.js';
import { VALID_MOMENTS } from '../lib/validate.js';

export default async function feedRoute(fastify) {
  fastify.get('/api/feed', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit ?? '60', 10) || 60, 200);
    const moment = req.query.moment ? String(req.query.moment).toLowerCase() : null;

    const rows = moment && VALID_MOMENTS.has(moment)
      ? queries.listByMoment().all(moment, limit)
      : queries.listRecent().all(limit);

    const items = rows.map((r) => ({
      id: r.id,
      moment: r.moment,
      kind: r.kind,
      url: r.filename ? `/uploads/${r.filename}` : null,
      author: r.author,
      body: r.body ?? null,
      created_at: r.created_at,
    }));

    reply.header('Cache-Control', 'no-store');
    return { items };
  });
}
