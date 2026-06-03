import { randomUUID } from 'node:crypto';
import { queries } from '../lib/db.js';
import { emitNew } from '../lib/events.js';

const MAX_BODY_CHARS = 280;
// rechaza caracteres de control salvo \n (0x0A) y \t (0x09)
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B-\x1F\x7F]/;

export default async function notesRoute(fastify) {
  fastify.post('/api/notes', async (req, reply) => {
    const ct = req.headers['content-type'] ?? '';
    if (!ct.toLowerCase().includes('application/json')) {
      return reply.code(415).send({ error: 'Content-Type debe ser application/json' });
    }

    const payload = req.body ?? {};
    const rawBody = typeof payload.body === 'string' ? payload.body : '';
    const body = rawBody.replace(/\r\n/g, '\n').trim();

    if (!body) return reply.code(400).send({ error: 'La nota está vacía' });
    if (body.length > MAX_BODY_CHARS) {
      return reply.code(400).send({ error: `Máximo ${MAX_BODY_CHARS} caracteres` });
    }
    if (CONTROL_CHARS.test(body)) {
      return reply.code(400).send({ error: 'Caracteres no permitidos' });
    }

    const author = typeof payload.author === 'string'
      ? payload.author.slice(0, 60).trim() || null
      : null;

    const id = randomUUID();
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? req.ip;
    const userAgent = req.headers['user-agent']?.toString().slice(0, 300) ?? null;

    queries.insertItem().run({
      id,
      moment: 'general',
      kind: 'note',
      filename: '',
      mime: 'text/plain',
      size: Buffer.byteLength(body, 'utf8'),
      author,
      body,
      ip,
      user_agent: userAgent,
    });

    const publicItem = {
      id,
      moment: 'general',
      kind: 'note',
      url: null,
      author,
      body,
      created_at: Math.floor(Date.now() / 1000),
    };

    emitNew(publicItem);
    return reply.code(201).send(publicItem);
  });
}
