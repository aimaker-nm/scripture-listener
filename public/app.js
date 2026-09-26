import { findReferences, formatReference } from './parser.js';

const $ = (id) => document.getElementById(id);
const DUPLICATE_WINDOW_MS = 30_000;

let config = {};
let recognition = null;
let listening = false;
let context = null; // last reference heard, for "verse 18" / "next verse"
let live = null; // reference object currently on screen
const recent = new Map(); // reference -> time last detected

// ---------- helpers ----------

function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = isError ? 'error' : '';
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 4000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const fetchVerse = (reference) =>
  api(`/api/verse?ref=${encodeURIComponent(reference)}&translation=${encodeURIComponent(config.translation)}`);

// ---------- showing verses ----------

async function show(ref) {
  const reference = typeof ref === 'string' ? ref : ref.reference;
  try {
    const verse = await fetchVerse(reference);
    const label = `${verse.reference} (${verse.translation})`;
    live = typeof ref === 'string' ? { reference } : ref;
    context = live.book ? live : context;
    $('live-ref').textContent = label;
    $('live-text').textContent = verse.text;
    $('live-text').classList.remove('muted');
    await api('/api/show', { method: 'POST', body: { reference: label, text: verse.text, translation: verse.translation } });
    toast(`Showing ${label}`);
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

async function clearScreen() {
  live = null;
  $('live-ref').textContent = '—';
  $('live-text').textContent = 'Nothing showing.';
  $('live-text').classList.add('muted');
  try {
    await api('/api/clear', { method: 'POST' });
  } catch (err) {
    toast(err.message, true);
  }
}

function step(delta) {
  if (!live?.book) return toast('Use Prev/Next after showing a detected or typed reference.', true);
  const next = { book: live.book, chapter: live.chapter, verse: null, verseEnd: null };
  if (live.verse) {
    next.verse = delta > 0 ? (live.verseEnd || live.verse) + 1 : live.verse - 1;
    if (next.verse < 1) return undefined;
  } else {
    next.chapter = live.chapter + delta;
    if (next.chapter < 1) return undefined;
  }
  next.reference = formatReference(next);
  return show(next);
}

// ---------- detected queue ----------

function addToQueue(ref) {
  const queue = $('queue');
  queue.querySelector('.empty')?.remove();

  const li = document.createElement('li');
  li.innerHTML = `
    <div class="q-ref"></div>
    <div class="q-spoken"></div>
    <div class="q-text">Loading…</div>
    <div class="row">
      <button class="primary" data-act="show">Show</button>
      <button data-act="dismiss">Dismiss</button>
    </div>`;
  li.querySelector('.q-ref').textContent = ref.reference;
  li.querySelector('.q-spoken').textContent = `heard: “${ref.spoken}”`;
  queue.prepend(li);
  while (queue.children.length > 30) queue.lastElementChild.remove();

  fetchVerse(ref.reference)
    .then((v) => (li.querySelector('.q-text').textContent = v.text))
    .catch((err) => (li.querySelector('.q-text').textContent = err.message));

  li.addEventListener('click', async (e) => {
    const act = e.target.dataset.act;
    if (act === 'show' && (await show(ref))) li.classList.add('sent');
    if (act === 'dismiss') li.remove();
  });

  if (config.autoSend) show(ref).then((ok) => ok && li.classList.add('sent'));
}

function handleTranscript(text) {
  const result = findReferences(text, context);
  context = result.context;
  const now = Date.now();
  for (const ref of result.references) {
    if (now - (recent.get(ref.reference) || 0) < DUPLICATE_WINDOW_MS) continue;
    recent.set(ref.reference, now);
    addToQueue(ref);
  }
}

// ---------- speech recognition ----------

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $('listen').disabled = true;
    $('listen').textContent = 'Speech not supported — use Chrome or Edge';
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const res = event.results[i];
      const text = res[0].transcript;
      if (res.isFinal) {
        const final = $('final');
        final.textContent = `${final.textContent} ${text.trim()}.`.slice(-3000);
        handleTranscript(text);
      } else {
        interim += text;
      }
    }
    $('interim').textContent = interim ? ` ${interim}` : '';
    $('transcript').scrollTop = $('transcript').scrollHeight;
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      listening = false;
      updateListenButton();
    }
    toast(`Speech recognition: ${event.error}`, true);
  };

  // Chrome stops after silence or ~60 seconds; keep it running while the operator wants it.
  recognition.onend = () => {
    if (listening) setTimeout(() => listening && recognition.start(), 250);
  };
}

function updateListenButton() {
  $('listen').textContent = listening ? '⏹ Stop listening' : '🎤 Start listening';
  $('listen').classList.toggle('listening', listening);
}

function toggleListening() {
  listening = !listening;
  updateListenButton();
  if (listening) {
    recognition.lang = config.language || 'en-US';
    recognition.start();
  } else {
    recognition.stop();
  }
}

// ---------- display style ----------

function markStyle() {
  for (const btn of document.querySelectorAll('#style-switch button')) {
    btn.classList.toggle('active', btn.dataset.style === config.displayStyle);
  }
}

async function setStyle(style) {
  try {
    const result = await api('/api/style', { method: 'POST', body: { style } });
    config.displayStyle = result.style;
    markStyle();
    toast(`Style: ${result.slide}`);
  } catch (err) {
    toast(err.message, true);
  }
}

// Fill the slide pickers with ProPresenter's theme slides.
async function loadSlides() {
  let slides = [];
  try {
    slides = await api('/api/pp/themes');
  } catch {
    // not connected yet; pickers keep whatever they had
    return;
  }
  for (const select of document.querySelectorAll('.slide-select')) {
    select.replaceChildren(
      ...slides.map((s) => {
        const opt = document.createElement('option');
        opt.value = s.uuid;
        opt.textContent = s.label;
        return opt;
      }),
    );
    select.value = config[select.name] || '';
  }
}

// ---------- settings & status ----------

function fillSettings() {
  const form = $('settings-form');
  for (const [key, value] of Object.entries(config)) {
    const input = form.elements[key];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value;
  }
  $('auto-send').checked = Boolean(config.autoSend);
  markStyle();
}

async function saveSettings(partial) {
  config = await api('/api/config', { method: 'POST', body: partial });
  fillSettings();
}

async function checkProPresenter(verbose = false) {
  const pill = $('pp-status');
  try {
    const status = await api('/api/pp/status');
    const name = status.version?.name || status.version?.host_description || 'connected';
    pill.textContent = `ProPresenter: ${name}`;
    pill.className = 'pill ok';
    if (verbose) {
      const msg = status.messages.find((m) => m.name === config.messageName);
      if (!config.sendToMessage) toast('Connected to ProPresenter.');
      else if (!msg && status.messages.length) {
        toast(`Connected, but no Message named “${config.messageName}”. Found: ${status.messages.map((m) => m.name).join(', ')}`, true);
      } else if (msg && !msg.tokens.includes(config.textToken)) {
        toast(`Message “${config.messageName}” has no “${config.textToken}” token. Tokens: ${msg.tokens.join(', ') || 'none'}`, true);
      } else toast('Connected to ProPresenter and the Message is ready.');
    }
  } catch (err) {
    pill.textContent = 'ProPresenter: not connected';
    pill.className = 'pill bad';
    if (verbose) toast(err.message, true);
  }
}

// ---------- wire up ----------

$('listen').addEventListener('click', toggleListening);
$('clear').addEventListener('click', clearScreen);
$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('auto-send').addEventListener('change', (e) => saveSettings({ autoSend: e.target.checked }));
$('test-pp').addEventListener('click', () => checkProPresenter(true));
for (const btn of document.querySelectorAll('#style-switch button')) {
  btn.addEventListener('click', () => setStyle(btn.dataset.style));
}
$('settings').addEventListener('toggle', (e) => e.target.open && loadSlides());

$('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('manual-ref').value.trim();
  if (!text) return;
  // Typed "John 3" should work too, so treat bare numbers as a chapter.
  const parsed = findReferences(text).references[0] || findReferences(text.replace(/(\D)\s+(\d+)\s*$/, '$1 chapter $2')).references[0];
  show(parsed || text);
  $('manual-ref').value = '';
});

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const values = {};
  for (const el of form.elements) {
    if (!el.name || (el.tagName === 'SELECT' && !el.value)) continue;
    values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  await saveSettings(values);
  if (recognition) recognition.lang = config.language;
  if (values.fullScreenSlide || values.lowerThirdSlide) await setStyle(config.displayStyle);
  toast('Settings saved.');
  checkProPresenter(true);
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'ArrowRight') step(1);
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'Escape') clearScreen();
});

config = await api('/api/config');
fillSettings();
setupRecognition();
checkProPresenter();
setInterval(checkProPresenter, 15_000);
