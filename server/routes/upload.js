import { queries } from '../lib/db.js';
import { detectKind, enforceSize, VALID_MOMENTS } from '../lib/validate.js';
import { saveBuffer } from '../lib/storage.js';
import { emitNew } from '../lib/events.js';

export default async function uploadRoute(fastify, opts) {
  const { uploadDir, maxImageBytes, maxVideoBytes } = opts;

  fastify.post('/api/upload', async (req, reply) => {
    const parts = req.parts();

    let moment = 'general';
    let author = null;
    let fileBuffer = null;
    let originalSize = 0;

    for await (const part of parts) {
      if (part.type === 'file') {
        if (fileBuffer) return reply.code(400).send({ error: 'Solo un archivo por subida' });
        const chunks = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
          originalSize += chunk.length;
          if (originalSize > maxVideoBytes) {
            return reply.code(413).send({ error: 'Archivo demasiado grande' });
          }
        }
        fileBuffer = Buffer.concat(chunks);
      } else if (part.fieldname === 'moment') {
        const v = String(part.value).toLowerCase();
        if (VALID_MOMENTS.has(v)) moment = v;
      } else if (part.fieldname === 'author') {
        author = String(part.value).slice(0, 60).trim() || null;
      }
    }

    if (!fileBuffer) return reply.code(400).send({ error: 'Falta el archivo' });

    const detected = await detectKind(fileBuffer);
    if (!detected) {
      return reply.code(415).send({ error: 'Tipo de archivo no permitido' });
    }

    const sizeError = enforceSize({
      kind: detected.kind,
      size: fileBuffer.length,
      maxImage: maxImageBytes,
      maxVideo: maxVideoBytes,
    });
    if (sizeError) return reply.code(413).send({ error: sizeError });

    const { id, filename } = await saveBuffer({
      uploadDir,
      buffer: fileBuffer,
      ext: detected.ext,
    });

    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? req.ip;
    const userAgent = req.headers['user-agent']?.toString().slice(0, 300) ?? null;

    const item = {
      id,
      moment,
      kind: detected.kind,
      filename,
      mime: detected.mime,
      size: fileBuffer.length,
      author,
      body: null,
      ip,
      user_agent: userAgent,
    };

    queries.insertItem().run(item);

    const publicItem = {
      id,
      moment,
      kind: detected.kind,
      url: `/uploads/${filename}`,
      author,
      body: null,
      created_at: Math.floor(Date.now() / 1000),
    };

    emitNew(publicItem);

    return reply.code(201).send(publicItem);
  });
}
