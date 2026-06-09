const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readUploaderId(req) {
  const raw = req.headers['x-uploader-id'];
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return UUID_RE.test(v) ? v : null;
}
