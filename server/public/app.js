const MAX_VIDEO_SECONDS = 65;
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];

const state = {
  uploading: false,
  feed: new Map(),
};

const $ = (sel) => document.querySelector(sel);
const feedEl = $('#feed');
const feedStatus = $('#feed-status');
const statusEl = $('#status');
const previewEl = $('#preview');
const progressEl = $('#progress');
const progressBar = progressEl.querySelector('.bar');
const progressLabel = progressEl.querySelector('.label');
const authorEl = $('#author');
const lightboxEl = $('#lightbox');
const lightboxContent = lightboxEl.querySelector('.lightbox-content');

$('#pick-photo').addEventListener('change', (e) => handlePick(e.target, 'image'));
$('#pick-video').addEventListener('change', (e) => handlePick(e.target, 'video'));

async function handlePick(input, kind) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  const allowed = kind === 'image' ? ALLOWED_IMAGE_MIMES : ALLOWED_VIDEO_MIMES;
  if (!file.type || (!allowed.includes(file.type) && !file.type.startsWith(kind + '/'))) {
    return setStatus('Formato no soportado', true);
  }

  if (kind === 'video') {
    try {
      const duration = await readVideoDuration(file);
      if (duration > MAX_VIDEO_SECONDS) {
        return setStatus(`El video dura ${Math.round(duration)}s. Máximo 60s.`, true);
      }
    } catch {
      // si no se puede leer, dejamos que el servidor decida por tamaño
    }
  }

  showPreview(file, kind);
}

function readVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('metadata error'));
    };
    v.src = url;
  });
}

function showPreview(file, kind) {
  const url = URL.createObjectURL(file);
  previewEl.innerHTML = '';
  const node =
    kind === 'image'
      ? Object.assign(document.createElement('img'), { src: url, alt: 'Vista previa' })
      : Object.assign(document.createElement('video'), { src: url, controls: true, playsInline: true });
  previewEl.appendChild(node);

  const row = document.createElement('div');
  row.className = 'row';
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'btn-primary';
  send.textContent = 'Subir';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn-outline';
  cancel.textContent = 'Cancelar';
  row.append(cancel, send);
  previewEl.appendChild(row);
  previewEl.classList.remove('hidden');

  cancel.addEventListener('click', () => {
    URL.revokeObjectURL(url);
    previewEl.innerHTML = '';
    previewEl.classList.add('hidden');
  });

  send.addEventListener('click', async () => {
    send.disabled = true;
    cancel.disabled = true;
    await upload(file).finally(() => {
      URL.revokeObjectURL(url);
      previewEl.innerHTML = '';
      previewEl.classList.add('hidden');
    });
  });
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

function upload(file) {
  if (state.uploading) return Promise.resolve();
  state.uploading = true;
  setStatus('Subiendo…');
  progressEl.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressLabel.textContent = '0%';

  const form = new FormData();
  if (authorEl.value.trim()) form.append('author', authorEl.value.trim());
  form.append('file', file);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = pct + '%';
        progressLabel.textContent = pct + '%';
      }
    };
    xhr.onload = () => {
      progressEl.classList.add('hidden');
      state.uploading = false;
      if (xhr.status >= 200 && xhr.status < 300) {
        setStatus('¡Listo! Tu momento ya está en la galería.');
        try {
          const item = JSON.parse(xhr.responseText);
          prependTile(item);
        } catch {}
      } else {
        let msg = 'Error al subir';
        try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch {}
        setStatus(msg, true);
      }
      resolve();
    };
    xhr.onerror = () => {
      progressEl.classList.add('hidden');
      state.uploading = false;
      setStatus('Error de red. Intenta de nuevo.', true);
      resolve();
    };
    xhr.send(form);
  });
}

function prependTile(item) {
  if (state.feed.has(item.id)) return;
  state.feed.set(item.id, item);
  const tile = renderTile(item);
  feedEl.prepend(tile);
  updateFeedStatus();
}

function hashTilt(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const angles = [-2.4, -1.6, -0.8, 0.8, 1.6, 2.4];
  return angles[h % angles.length];
}

function renderTile(item) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'tile';
  tile.dataset.id = item.id;

  if (item.kind === 'image') {
    const img = document.createElement('img');
    img.src = item.url;
    img.loading = 'lazy';
    img.alt = item.author ? `Foto de ${item.author}` : 'Foto';
    tile.appendChild(img);
  } else if (item.kind === 'video') {
    const v = document.createElement('video');
    v.src = item.url + '#t=0.5';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    tile.appendChild(v);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Video';
    tile.appendChild(badge);
  } else if (item.kind === 'note') {
    tile.classList.add('tile--note');
    tile.style.setProperty('--tilt', `${hashTilt(item.id)}deg`);
    const tape = document.createElement('span');
    tape.className = 'tape';
    tile.appendChild(tape);
    const text = document.createElement('p');
    text.className = 'text';
    text.textContent = item.body ?? '';
    tile.appendChild(text);
    if (item.author) {
      const sign = document.createElement('p');
      sign.className = 'sign';
      sign.textContent = `— ${item.author}`;
      tile.appendChild(sign);
    }
  }

  tile.addEventListener('click', () => openLightbox(item));
  return tile;
}

function openLightbox(item) {
  lightboxContent.innerHTML = '';
  if (item.kind === 'image') {
    lightboxContent.appendChild(Object.assign(document.createElement('img'), { src: item.url, alt: '' }));
  } else if (item.kind === 'video') {
    lightboxContent.appendChild(
      Object.assign(document.createElement('video'), { src: item.url, controls: true, autoplay: true, playsInline: true }),
    );
  } else if (item.kind === 'note') {
    const card = document.createElement('div');
    card.className = 'tile--note lightbox-note';
    card.style.setProperty('--tilt', `${hashTilt(item.id)}deg`);
    const tape = document.createElement('span');
    tape.className = 'tape';
    card.appendChild(tape);
    const text = document.createElement('p');
    text.className = 'text';
    text.textContent = item.body ?? '';
    card.appendChild(text);
    if (item.author) {
      const sign = document.createElement('p');
      sign.className = 'sign';
      sign.textContent = `— ${item.author}`;
      card.appendChild(sign);
    }
    lightboxContent.appendChild(card);
  }
  lightboxEl.classList.remove('hidden');
}

lightboxEl.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
lightboxEl.addEventListener('click', (e) => {
  if (e.target === lightboxEl) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});
function closeLightbox() {
  lightboxContent.innerHTML = '';
  lightboxEl.classList.add('hidden');
}

function updateFeedStatus() {
  const n = state.feed.size;
  feedStatus.textContent = n === 0 ? 'Aún no hay momentos. Sé el primero.' : `${n} momento${n === 1 ? '' : 's'} en vivo.`;
}

function removeTile(id) {
  state.feed.delete(id);
  feedEl.querySelector(`[data-id="${id}"]`)?.remove();
  updateFeedStatus();
}

async function loadInitial() {
  try {
    const r = await fetch('/api/feed?limit=60');
    if (!r.ok) throw new Error('feed http ' + r.status);
    const { items } = await r.json();
    items.forEach((it) => {
      if (!state.feed.has(it.id)) {
        state.feed.set(it.id, it);
        feedEl.appendChild(renderTile(it));
      }
    });
    updateFeedStatus();
  } catch {
    feedStatus.textContent = 'No se pudo cargar la galería.';
  }
}

function connectStream() {
  let es;
  try {
    es = new EventSource('/api/stream');
  } catch {
    return setInterval(loadInitial, 8000);
  }
  es.addEventListener('new', (e) => {
    try {
      const item = JSON.parse(e.data);
      prependTile(item);
    } catch {}
  });
  es.addEventListener('hide', (e) => {
    try {
      const { id } = JSON.parse(e.data);
      removeTile(id);
    } catch {}
  });
  es.onerror = () => {
    es.close();
    setTimeout(connectStream, 5000);
  };
}

// ─── Notas ───────────────────────────────────────────────────────────────────
const noteSheet = $('#note-sheet');
const noteBody = $('#note-body');
const noteCounter = $('#note-counter');
const openNoteBtn = $('#open-note');
const cancelNoteBtn = $('#cancel-note');
const sendNoteBtn = $('#send-note');

function openNoteSheet() {
  noteBody.value = '';
  noteCounter.textContent = '0 / 280';
  noteSheet.classList.remove('hidden');
  setTimeout(() => noteBody.focus(), 50);
}
function closeNoteSheet() {
  noteSheet.classList.add('hidden');
}

openNoteBtn.addEventListener('click', openNoteSheet);
cancelNoteBtn.addEventListener('click', closeNoteSheet);
noteBody.addEventListener('input', () => {
  noteCounter.textContent = `${noteBody.value.length} / 280`;
});
sendNoteBtn.addEventListener('click', submitNote);

async function submitNote() {
  const body = noteBody.value.trim();
  if (!body) return setStatus('La nota está vacía', true);
  sendNoteBtn.disabled = true;
  cancelNoteBtn.disabled = true;
  setStatus('Pegando tu nota…');

  try {
    const author = authorEl.value.trim() || undefined;
    const r = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, author }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setStatus(data.error ?? 'Error al enviar', true);
    } else {
      setStatus('¡Listo! Tu nota quedó pegada.');
      prependTile(data);
      closeNoteSheet();
    }
  } catch {
    setStatus('Error de red. Intenta de nuevo.', true);
  } finally {
    sendNoteBtn.disabled = false;
    cancelNoteBtn.disabled = false;
  }
}

loadInitial().then(connectStream);
