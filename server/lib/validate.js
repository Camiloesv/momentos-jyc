import { fileTypeFromBuffer } from 'file-type';

export const VALID_MOMENTS = new Set(['ceremonia', 'recepcion', 'general']);

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

export async function detectKind(buffer) {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return null;
  const { mime } = detected;
  if (IMAGE_MIMES.has(mime)) return { kind: 'image', mime, ext: EXT_BY_MIME[mime] };
  if (VIDEO_MIMES.has(mime)) return { kind: 'video', mime, ext: EXT_BY_MIME[mime] };
  return null;
}

export function enforceSize({ kind, size, maxImage, maxVideo }) {
  if (kind === 'image' && size > maxImage) return `Imagen excede ${(maxImage / 1048576).toFixed(0)} MB`;
  if (kind === 'video' && size > maxVideo) return `Video excede ${(maxVideo / 1048576).toFixed(0)} MB`;
  return null;
}
