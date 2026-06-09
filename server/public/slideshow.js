const params = new URLSearchParams(location.search);
const MOMENT = params.get('moment');
const DURATION_OVERRIDE = params.has('duration')
  ? Math.max(2000, Math.min(30000, (parseInt(params.get('duration'), 10) || 6) * 1000))
  : null;
const BOARD_DURATION_OVERRIDE = params.has('boardDuration')
  ? Math.max(4000, Math.min(40000, (parseInt(params.get('boardDuration'), 10) || 12) * 1000))
  : null;
const BOARD_EVERY = parseInt(params.get('boardEvery') ?? '5', 10) || 5;
const CROSSFADE_MS = 800;

function slideDurationMs(count) {
  if (DURATION_OVERRIDE) return DURATION_OVERRIDE;
  if (count < 15) return 8000;
  if (count < 40) return 6000;
  if (count < 80) return 4500;
  if (count < 150) return 3500;
  return 2800;
}
function boardDurationMs(noteCount) {
  if (BOARD_DURATION_OVERRIDE) return BOARD_DURATION_OVERRIDE;
  return Math.max(9000, Math.min(20000, 1400 * noteCount));
}
function boardSize() {
  const w = window.innerWidth;
  if (w < 700) return 5;
  if (w < 1200) return 8;
  return 10;
}
let currentDuration = slideDurationMs(0);

const stage = document.getElementById('stage');
const overlay = document.getElementById('overlay');
const overlayAuthor = document.getElementById('overlay-author');
const overlayWhen = document.getElementById('overlay-when');
const freshTag = document.getElementById('fresh');
const empty = document.getElementById('empty');
const fsBtn = document.getElementById('fs-btn');

const items = new Map();      // id -> item
let photoQueue = [];          // ids de fotos barajadas
let noteQueue = [];           // ids de notas en orden round-robin
const freshNotes = new Set(); // ids de notas marcadas como recién-llegadas
let photosSinceBoard = 0;
let current = null;           // { kind, el, noteIds? }
let paused = false;
let timer = null;
let running = false;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isPhoto(it) { return it && it.kind === 'image' && it.url; }
function isNote(it) { return it && it.kind === 'note'; }
function passesMoment(it) { return !MOMENT || it.moment === MOMENT; }

function rebuildPhotoQueue() {
  photoQueue = shuffle(
    [...items.values()].filter((it) => isPhoto(it) && passesMoment(it)).map((it) => it.id),
  );
}
function rebuildNoteQueue() {
  // round-robin: barajar al rellenar para variar el orden entre rondas
  noteQueue = shuffle(
    [...items.values()].filter((it) => isNote(it) && passesMoment(it)).map((it) => it.id),
  );
}

function hashTilt(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const angles = [-2.5, -1.6, -0.8, 0.8, 1.6, 2.5];
  return angles[h % angles.length];
}
function hashBg(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  const tones = ['#FBF7EF', '#F6EFDE', '#F2E9D2'];
  return tones[h % tones.length];
}

function relative(ts) {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (diff < 30) return 'hace un instante';
  if (diff < 90) return 'hace un minuto';
  if (diff < 3600) return `hace ${Math.round(diff / 60)} min`;
  if (diff < 7200) return 'hace una hora';
  if (diff < 86400) return `hace ${Math.round(diff / 3600)} h`;
  return '';
}

// ─── Builders ──────────────────────────────────────────────────────────────

function buildPhotoSlide(item) {
  const slide = document.createElement('div');
  slide.className = 'slide';
  slide.dataset.kind = 'photo';
  slide.dataset.id = item.id;
  const img = new Image();
  img.alt = '';
  img.src = item.url;
  img.style.animationDuration = (currentDuration + CROSSFADE_MS) + 'ms';
  slide.appendChild(img);
  img.onerror = () => { slide.dataset.broken = '1'; };
  return slide;
}

function buildSingleNoteSlide(item) {
  const slide = document.createElement('div');
  slide.className = 'slide note';
  slide.dataset.kind = 'note-single';
  slide.dataset.id = item.id;
  const card = document.createElement('div');
  card.className = 'note-card';
  const p = document.createElement('p');
  p.className = 'note-text';
  p.textContent = item.body ?? '';
  card.appendChild(p);
  if (item.author) {
    const sign = document.createElement('p');
    sign.className = 'note-sign';
    sign.textContent = `— ${item.author}`;
    card.appendChild(sign);
  }
  slide.appendChild(card);
  return slide;
}

function buildNoteCardSmall(item, indexForStagger) {
  const card = document.createElement('article');
  card.className = 'note-card-small';
  card.dataset.id = item.id;
  card.style.setProperty('--tilt', `${hashTilt(item.id)}deg`);
  card.style.setProperty('--note-bg', hashBg(item.id));
  card.style.setProperty('--delay', `${indexForStagger * 90}ms`);
  if (freshNotes.has(item.id)) card.classList.add('note--fresh');

  const text = document.createElement('p');
  text.className = 'note-text';
  text.textContent = item.body ?? '';
  card.appendChild(text);
  if (item.author) {
    const sign = document.createElement('p');
    sign.className = 'note-sign';
    sign.textContent = `— ${item.author}`;
    card.appendChild(sign);
  }
  return card;
}

function buildBoardSlide(noteIds) {
  const slide = document.createElement('div');
  slide.className = 'slide board';
  slide.dataset.kind = 'board';
  const board = document.createElement('div');
  board.className = 'notes-board';
  noteIds.forEach((id, idx) => {
    const it = items.get(id);
    if (!it) return;
    board.appendChild(buildNoteCardSmall(it, idx));
  });
  slide.appendChild(board);
  return slide;
}

// ─── Algoritmo de selección ────────────────────────────────────────────────

function takeBoardNotes() {
  const size = boardSize();
  const totalNotes = [...items.values()].filter((it) => isNote(it) && passesMoment(it)).length;
  if (totalNotes === 0) return [];
  if (totalNotes === 1) {
    // 1 sola nota → fallback al fullscreen single
    const only = [...items.values()].find((it) => isNote(it) && passesMoment(it));
    return only ? [only.id] : [];
  }
  const target = Math.min(size, totalNotes);

  // Notas frescas siempre primero
  const fresh = [...freshNotes].filter((id) => {
    const it = items.get(id);
    return it && isNote(it) && passesMoment(it);
  });
  const picked = [];
  const seen = new Set();
  for (const id of fresh) {
    if (picked.length >= target) break;
    if (!seen.has(id)) { picked.push(id); seen.add(id); }
  }

  // Después round-robin de noteQueue
  while (picked.length < target) {
    if (noteQueue.length === 0) rebuildNoteQueue();
    if (noteQueue.length === 0) break;
    const id = noteQueue.shift();
    if (!items.has(id)) continue;
    const it = items.get(id);
    if (!isNote(it) || !passesMoment(it)) continue;
    if (seen.has(id)) continue;
    picked.push(id);
    seen.add(id);
  }

  // Limpiar el flag fresh de los que efectivamente entraron
  picked.forEach((id) => freshNotes.delete(id));
  return picked;
}

function pickNextSlot() {
  const totalPhotos = [...items.values()].filter((it) => isPhoto(it) && passesMoment(it)).length;
  const totalNotes = [...items.values()].filter((it) => isNote(it) && passesMoment(it)).length;

  if (totalPhotos === 0 && totalNotes === 0) return null;

  // Solo notas → tablero (o fallback single si solo hay 1)
  if (totalPhotos === 0) {
    const noteIds = takeBoardNotes();
    if (noteIds.length === 1) return { kind: 'note-single', id: noteIds[0] };
    if (noteIds.length >= 2) return { kind: 'board', noteIds };
    return null;
  }

  // Hay fotos: decidir si toca tablero
  const dueForBoard = photosSinceBoard >= BOARD_EVERY && totalNotes >= 1;
  if (dueForBoard) {
    photosSinceBoard = 0;
    const noteIds = takeBoardNotes();
    if (noteIds.length === 1) return { kind: 'note-single', id: noteIds[0] };
    if (noteIds.length >= 2) return { kind: 'board', noteIds };
    // 0 notas pasó algo raro; cae a foto
  }

  // Foto
  if (photoQueue.length === 0) rebuildPhotoQueue();
  while (photoQueue.length) {
    const id = photoQueue.shift();
    const it = items.get(id);
    if (it && isPhoto(it) && passesMoment(it)) {
      photosSinceBoard += 1;
      return { kind: 'photo', id };
    }
  }
  // Fallback: no se encontró foto válida, intentar tablero
  if (totalNotes >= 1) {
    photosSinceBoard = 0;
    const noteIds = takeBoardNotes();
    if (noteIds.length === 1) return { kind: 'note-single', id: noteIds[0] };
    if (noteIds.length >= 2) return { kind: 'board', noteIds };
  }
  return null;
}

// ─── Render ────────────────────────────────────────────────────────────────

function setOverlay(item, fresh) {
  if (item && (item.author || item.created_at)) {
    overlay.style.display = 'flex';
    overlayAuthor.textContent = item.author ?? '';
    overlayWhen.textContent = item.created_at ? relative(item.created_at) : '';
  } else {
    overlay.style.display = 'none';
  }
  if (fresh) {
    freshTag.classList.add('is-on');
    setTimeout(() => freshTag.classList.remove('is-on'), 4000);
  } else {
    freshTag.classList.remove('is-on');
  }
}

function showNext() {
  if (paused) return;
  clearTimeout(timer);

  const slot = pickNextSlot();
  if (!slot) {
    empty.classList.remove('hidden');
    timer = setTimeout(showNext, 3000);
    return;
  }
  empty.classList.add('hidden');

  let slide;
  let duration;
  let overlayItem = null;
  let isFresh = false;

  if (slot.kind === 'photo') {
    const item = items.get(slot.id);
    slide = buildPhotoSlide(item);
    duration = currentDuration;
    overlayItem = item;
  } else if (slot.kind === 'note-single') {
    const item = items.get(slot.id);
    slide = buildSingleNoteSlide(item);
    duration = boardDurationMs(1);
    overlayItem = item;
  } else if (slot.kind === 'board') {
    slide = buildBoardSlide(slot.noteIds);
    duration = boardDurationMs(slot.noteIds.length);
    overlayItem = null; // el tablero no muestra overlay individual
    // marca fresh global si alguna del tablero estaba en freshNotes pre-take
  }

  stage.appendChild(slide);
  requestAnimationFrame(() => {
    slide.classList.add('is-on');
    setOverlay(overlayItem, isFresh);
  });

  const prev = current;
  current = { kind: slot.kind, el: slide, noteIds: slot.noteIds };
  if (prev) {
    prev.el.classList.remove('is-on');
    setTimeout(() => prev.el.remove(), CROSSFADE_MS + 50);
  }

  timer = setTimeout(showNext, duration);
}

function recomputeDuration() {
  const photoCount = [...items.values()].filter((it) => isPhoto(it) && passesMoment(it)).length;
  const next = slideDurationMs(photoCount);
  if (Math.abs(next - currentDuration) > 200) currentDuration = next;
}

// ─── Eventos SSE ───────────────────────────────────────────────────────────

function onNew(item) {
  const existed = items.has(item.id);
  items.set(item.id, item);
  if (!passesMoment(item)) return;
  if (isNote(item)) {
    if (!existed) {
      // entra al frente de la cola y se marca como fresca
      noteQueue = [item.id, ...noteQueue.filter((id) => id !== item.id)];
      freshNotes.add(item.id);
    }
  } else if (isPhoto(item)) {
    if (!existed && !photoQueue.includes(item.id)) photoQueue.push(item.id);
  }
  recomputeDuration();
}

function onHide(id) {
  const wasInCurrentBoard =
    current?.kind === 'board' && Array.isArray(current.noteIds) && current.noteIds.includes(id);

  items.delete(id);
  photoQueue = photoQueue.filter((x) => x !== id);
  noteQueue = noteQueue.filter((x) => x !== id);
  freshNotes.delete(id);

  if (wasInCurrentBoard) {
    // remover la card del tablero in-place
    const card = current.el.querySelector(`.note-card-small[data-id="${id}"]`);
    if (card) card.remove();
    current.noteIds = current.noteIds.filter((x) => x !== id);
    // si quedó vacío, saltar
    if (current.noteIds.length === 0) showNext();
    return;
  }

  // si la actual era una foto borrada o nota single, saltar
  if (current?.el?.dataset?.id === id) showNext();
}

// ─── Inicialización ────────────────────────────────────────────────────────

async function loadInitial() {
  const url = MOMENT ? `/api/feed?limit=200&moment=${encodeURIComponent(MOMENT)}` : '/api/feed?limit=200';
  const r = await fetch(url);
  const { items: rows } = await r.json();
  rows.forEach((it) => items.set(it.id, it));
  rebuildPhotoQueue();
  rebuildNoteQueue();
  recomputeDuration();
}

function connectStream() {
  let es;
  try { es = new EventSource('/api/stream'); }
  catch { return setTimeout(connectStream, 5000); }
  es.addEventListener('new', (e) => {
    try { onNew(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('hide', (e) => {
    try { onHide(JSON.parse(e.data).id); } catch {}
  });
  es.onerror = () => { es.close(); setTimeout(connectStream, 5000); };
}

async function start() {
  if (running) return;
  running = true;
  await loadInitial();
  connectStream();
  showNext();
}

let wakeLock = null;
async function enterFullscreen() {
  try { await document.documentElement.requestFullscreen(); } catch {}
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
fsBtn?.addEventListener('click', enterFullscreen);

let dimTimer = null;
function poke() {
  fsBtn?.classList.remove('is-dim');
  clearTimeout(dimTimer);
  dimTimer = setTimeout(() => fsBtn?.classList.add('is-dim'), 5000);
}
['mousemove', 'touchstart', 'keydown'].forEach((ev) =>
  window.addEventListener(ev, poke, { passive: true }),
);
poke();

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && document.fullscreenElement) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  }
});

start();

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') showNext();
  else if (e.key === ' ') {
    paused = !paused;
    if (!paused) showNext();
  } else if (e.key === 'f' || e.key === 'F') {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});
