import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';

import { initDb } from './lib/db.js';
import uploadRoute from './routes/upload.js';
import feedRoute from './routes/feed.js';
import streamRoute from './routes/stream.js';
import adminRoute from './routes/admin.js';
import notesRoute from './routes/notes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const UPLOAD_DIR = path.resolve(PROJECT_ROOT, process.env.UPLOAD_DIR ?? 'uploads');
const DB_PATH = path.resolve(PROJECT_ROOT, process.env.DB_PATH ?? 'items.db');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-token-change-me';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;
const MAX_IMAGE_BYTES = parseInt(process.env.MAX_IMAGE_BYTES ?? `${15 * 1024 * 1024}`, 10);
const MAX_VIDEO_BYTES = parseInt(process.env.MAX_VIDEO_BYTES ?? `${120 * 1024 * 1024}`, 10);

await fs.mkdir(UPLOAD_DIR, { recursive: true });
await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
initDb(DB_PATH);

const fastify = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: true,
  bodyLimit: MAX_VIDEO_BYTES + 1024 * 1024,
});

await fastify.register(rateLimit, {
  max: 30,
  timeWindow: '10 minutes',
  allowList: (req) => req.url.startsWith('/api/stream') || req.url.startsWith('/api/feed'),
});

await fastify.register(multipart, {
  limits: {
    fileSize: MAX_VIDEO_BYTES,
    files: 1,
  },
});

await fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
  cacheControl: true,
  maxAge: '5m',
});

// Servir uploads localmente cuando Caddy no está delante (dev / fallback).
await fastify.register(fastifyStatic, {
  root: UPLOAD_DIR,
  prefix: '/uploads/',
  decorateReply: false,
  cacheControl: true,
  maxAge: '365d',
  immutable: true,
});

await fastify.register(uploadRoute, {
  uploadDir: UPLOAD_DIR,
  maxImageBytes: MAX_IMAGE_BYTES,
  maxVideoBytes: MAX_VIDEO_BYTES,
});
await fastify.register(feedRoute);
await fastify.register(notesRoute);
await fastify.register(streamRoute);
await fastify.register(adminRoute, { adminToken: ADMIN_TOKEN });

fastify.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }));

const shutdown = async (signal) => {
  fastify.log.info({ signal }, 'shutting down');
  try {
    await fastify.close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await fastify.listen({ port: PORT, host: HOST });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
