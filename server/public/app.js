const MAX_VIDEO_SECONDS = 65;
const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];

const UPLOADER_KEY = 'momentos:uploaderId';
function uuid4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
}
function getUploaderId() {
  let id = null;
  try { id = localStorage.getItem(UPLOADER_KEY); } catch {}
  if (!id) {
    id = uuid4();
    try { localStorage.setItem(UPLOADER_KEY, id); } catch {}
  }
  return id;
}
const UPLOADER_ID = getUploaderId();

// ─── Admin session ───────────────────────────────────────────────────────────
const ADMIN_KEY = 'momentos:adminToken';
function getAdminToken() {
  try { return sessionStorage.getItem(ADMIN_KEY); } catch { return null; }
}
function setAdminToken(tok) {
  try {
    if (tok) sessionStorage.setItem(ADMIN_KEY, tok);
    else sessionStorage.removeItem(ADMIN_KEY);
  } catch {}
  document.body.classList.toggle('is-admin', !!tok);
}
function adminHeaders(extra = {}) {
  const tok = getAdminToken();
  return tok ? { ...extra, 'X-Admin-Token': tok } : extra;
}
function isAdmin() { return !!getAdminToken(); }

const state = {
  uploading: false,
  feed: new Map(),
  showHidden: false,
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
    xhr.setRequestHeader('X-Uploader-Id', UPLOADER_ID);
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

  const ownsIt = item.uploader_id && item.uploader_id === UPLOADER_ID;
  if (ownsIt || isAdmin()) {
    const del = document.createElement('span');
    del.className = 'tile-del';
    del.setAttribute('role', 'button');
    del.setAttribute('aria-label', isAdmin() ? 'Ocultar este momento' : 'Borrar mi momento');
    del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDelete(item);
    });
    tile.appendChild(del);
  }

  if (isAdmin() && item.hidden) {
    tile.classList.add('is-hidden');
    const restore = document.createElement('span');
    restore.className = 'tile-restore';
    restore.setAttribute('role', 'button');
    restore.setAttribute('aria-label', 'Restaurar este momento');
    restore.textContent = '↺';
    restore.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const r = await fetch(`/api/admin/items/${encodeURIComponent(item.id)}/restore`, {
          method: 'POST',
          headers: adminHeaders(),
        });
        if (!r.ok) throw new Error(String(r.status));
        item.hidden = false;
        tile.classList.remove('is-hidden');
        restore.remove();
        setStatus('Momento restaurado');
      } catch {
        setStatus('No se pudo restaurar', true);
      }
    });
    tile.appendChild(restore);
  }

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
      headers: { 'Content-Type': 'application/json', 'X-Uploader-Id': UPLOADER_ID },
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

// ─── Borrar propio / Ocultar admin ───────────────────────────────────────────
const confirmEl = $('#confirm-delete');
const confirmTitle = $('#confirm-title');
const confirmHint = $('#confirm-hint');
const confirmThumb = $('#confirm-thumb');
const confirmCancel = $('#confirm-cancel');
const confirmOk = $('#confirm-ok');
const toastEl = $('#toast');
const toastMsg = $('#toast-msg');
const toastUndo = $('#toast-undo');

let pendingDelete = null;
let toastTimer = null;

function confirmDelete(item) {
  pendingDelete = item;
  confirmThumb.innerHTML = '';
  if (item.kind === 'image' && item.url) {
    const img = document.createElement('img');
    img.src = item.url;
    confirmThumb.appendChild(img);
  } else if (item.kind === 'video' && item.url) {
    const v = document.createElement('video');
    v.src = item.url + '#t=0.5';
    v.muted = true;
    v.playsInline = true;
    confirmThumb.appendChild(v);
  } else if (item.kind === 'note') {
    const p = document.createElement('p');
    p.className = 'confirm-note';
    p.textContent = item.body ?? '';
    confirmThumb.appendChild(p);
  }
  // Cambiar textos según sea admin o el dueño
  if (isAdmin()) {
    confirmTitle.textContent = 'Ocultar este momento';
    confirmHint.textContent = 'Lo podés restaurar desde "Ver ocultos" en la barra admin.';
    confirmOk.textContent = 'Ocultar';
  } else {
    confirmTitle.textContent = 'Borrar tu momento';
    confirmHint.textContent = 'Solo vos lo podés deshacer durante 10 segundos.';
    confirmOk.textContent = 'Borrar';
  }
  confirmEl.classList.remove('hidden');
}

function closeConfirm() {
  pendingDelete = null;
  confirmEl.classList.add('hidden');
  confirmThumb.innerHTML = '';
}

confirmCancel.addEventListener('click', closeConfirm);
confirmEl.addEventListener('click', (e) => {
  if (e.target === confirmEl) closeConfirm();
});
confirmOk.addEventListener('click', async () => {
  if (!pendingDelete) return;
  const item = pendingDelete;
  confirmOk.disabled = true;
  const adminMode = isAdmin();
  const url = adminMode
    ? `/api/admin/items/${encodeURIComponent(item.id)}`
    : `/api/items/${encodeURIComponent(item.id)}`;
  const headers = adminMode ? adminHeaders() : { 'X-Uploader-Id': UPLOADER_ID };
  try {
    const r = await fetch(url, { method: 'DELETE', headers });
    if (!r.ok) {
      if (r.status === 401 && adminMode) {
        setAdminToken(null);
        setStatus('Sesión admin expirada', true);
      } else {
        const msg = (await r.json().catch(() => ({}))).error ?? 'No se pudo borrar';
        setStatus(msg, true);
      }
    } else {
      if (adminMode && state.showHidden) {
        // re-render del tile como oculto
        item.hidden = true;
        const old = feedEl.querySelector(`[data-id="${item.id}"]`);
        if (old) old.replaceWith(renderTile(item));
      } else {
        removeTile(item.id);
      }
      if (!adminMode) showUndoToast(item);
    }
  } catch {
    setStatus('Error de red al borrar', true);
  } finally {
    confirmOk.disabled = false;
    closeConfirm();
  }
});

function showUndoToast(item) {
  clearTimeout(toastTimer);
  toastMsg.textContent = 'Foto borrada';
  toastEl.classList.remove('hidden');
  const onUndo = async () => {
    toastUndo.removeEventListener('click', onUndo);
    toastEl.classList.add('hidden');
    clearTimeout(toastTimer);
    try {
      const r = await fetch(`/api/items/${encodeURIComponent(item.id)}/restore`, {
        method: 'POST',
        headers: { 'X-Uploader-Id': UPLOADER_ID },
      });
      if (r.ok) {
        prependTile(item);
        setStatus('Foto restaurada');
      } else {
        setStatus('No se pudo restaurar', true);
      }
    } catch {
      setStatus('Error de red al restaurar', true);
    }
  };
  toastUndo.addEventListener('click', onUndo);
  toastTimer = setTimeout(() => {
    toastUndo.removeEventListener('click', onUndo);
    toastEl.classList.add('hidden');
  }, 10000);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !confirmEl.classList.contains('hidden')) closeConfirm();
});

// ─── Admin UI ────────────────────────────────────────────────────────────────
const adminDot = $('#admin-dot');
const adminModal = $('#admin-modal');
const adminInput = $('#admin-input');
const adminError = $('#admin-error');
const adminCancel = $('#admin-cancel');
const adminOk = $('#admin-ok');
const adminBar = $('#admin-bar');
const adminToggleHidden = $('#admin-toggle-hidden');
const adminLogout = $('#admin-logout');

function refreshAdminBar() {
  if (isAdmin()) {
    adminBar?.classList.remove('hidden');
    document.body.classList.add('is-admin');
  } else {
    adminBar?.classList.add('hidden');
    document.body.classList.remove('is-admin');
    state.showHidden = false;
    if (adminToggleHidden) adminToggleHidden.textContent = 'Ver ocultos';
  }
}

adminDot?.addEventListener('click', () => {
  adminInput.value = '';
  adminError.textContent = '';
  adminModal.classList.remove('hidden');
  setTimeout(() => adminInput.focus(), 50);
});
adminCancel?.addEventListener('click', () => adminModal.classList.add('hidden'));
adminModal?.addEventListener('click', (e) => {
  if (e.target === adminModal) adminModal.classList.add('hidden');
});
adminOk?.addEventListener('click', tryAdminLogin);
adminInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryAdminLogin();
});

async function tryAdminLogin() {
  const token = adminInput.value.trim();
  if (!token) return;
  adminOk.disabled = true;
  try {
    const r = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!r.ok) {
      adminError.textContent = 'Código incorrecto';
      return;
    }
    setAdminToken(token);
    adminModal.classList.add('hidden');
    refreshAdminBar();
    await reloadFeed();
    setStatus('Modo admin activado');
  } catch {
    adminError.textContent = 'Error de red';
  } finally {
    adminOk.disabled = false;
  }
}

adminLogout?.addEventListener('click', async () => {
  setAdminToken(null);
  refreshAdminBar();
  await reloadFeed();
  setStatus('Sesión admin cerrada');
});

adminToggleHidden?.addEventListener('click', async () => {
  state.showHidden = !state.showHidden;
  adminToggleHidden.textContent = state.showHidden ? 'Ocultar ocultos' : 'Ver ocultos';
  await reloadFeed();
});

async function reloadFeed() {
  state.feed.clear();
  feedEl.innerHTML = '';
  if (isAdmin() && state.showHidden) {
    try {
      const r = await fetch('/api/admin/feed?limit=200', { headers: adminHeaders() });
      if (r.status === 401) {
        setAdminToken(null);
        refreshAdminBar();
        return loadInitial();
      }
      const { items } = await r.json();
      items.forEach((it) => {
        state.feed.set(it.id, it);
        feedEl.appendChild(renderTile(it));
      });
      updateFeedStatus();
    } catch {
      feedStatus.textContent = 'No se pudo cargar la galería admin.';
    }
  } else {
    await loadInitial();
  }
}

refreshAdminBar();
loadInitial().then(connectStream);
