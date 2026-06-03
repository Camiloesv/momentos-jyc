import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function dateShard() {
  return new Date().toISOString().slice(0, 10);
}

export async function saveBuffer({ uploadDir, buffer, ext }) {
  const shard = dateShard();
  const dir = path.join(uploadDir, shard);
  await fs.mkdir(dir, { recursive: true });

  const id = randomUUID();
  const filename = `${shard}/${id}.${ext}`;
  const fullPath = path.join(uploadDir, filename);
  await fs.writeFile(fullPath, buffer);

  return { id, filename };
}

export async function removeFile({ uploadDir, filename }) {
  const fullPath = path.join(uploadDir, filename);
  try {
    await fs.unlink(fullPath);
  } catch {}
}
