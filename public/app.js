import { findReferences, formatReference } from './parser.js';
import { WhisperCapture } from './whisper-capture.js';

const $ = (id) => document.getElementById(id);
const DUPLICATE_WINDOW_MS = 30_000;
const STORY_DUPLICATE_WINDOW_MS = 10 * 60_000; // a story is often told over several minutes
const STORY_MIN_WORDS = 12;
const STORY_MIN_GAP_MS = 5_000;

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
  if (ref.kind === 'quote' || ref.kind === 'story') {
    const badge = document.createElement('span');
    badge.className = `badge ${ref.kind}`;
    badge.textContent = `${ref.kind} ${Math.round(ref.score * 100)}%`;
    badge.title =
      ref.kind === 'quote'
        ? 'The speaker quoted or paraphrased this verse without saying the reference'
        : 'The speaker is retelling this Bible story (identified by AI)';
    li.querySelector('.q-ref').append(badge);
  }
  li.querySelector('.q-spoken').textContent = ref.kind === 'story' ? `story: ${ref.story}` : `heard: “${ref.spoken}”`;
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

  // Quotes and stories are guesses, so they always wait for the operator;
  // spoken references can go straight up.
  if (config.autoSend && !ref.kind) show(ref).then((ok) => ok && li.classList.add('sent'));
  return li;
}

function queueOnce(ref) {
  const now = Date.now();
  const window = ref.kind === 'story' ? STORY_DUPLICATE_WINDOW_MS : DUPLICATE_WINDOW_MS;
  if (now - (recent.get(ref.reference) || 0) < window) return null;
  recent.set(ref.reference, now);
  return addToQueue(ref);
}

// The last ~80 words heard, so a story told across several sentences can be recognised.
let storyText = '';
let storyBusy = false;
let storyPending = false; // new speech arrived while a check was running or too soon after one
let lastStoryCheck = 0;
let storyItems = []; // [{ reference, li }] from the latest story check

async function checkStory() {
  if (!config.storyDetection || !config.storyDetectionAvailable) return;
  if (storyText.split(/\s+/).filter(Boolean).length < STORY_MIN_WORDS) return;
  const wait = STORY_MIN_GAP_MS - (Date.now() - lastStoryCheck);
  if (storyBusy || wait > 0) {
    // Check again once free, so the newest sentences (often the end of the story) are included.
    if (!storyPending) {
      storyPending = true;
      setTimeout(() => {
        storyPending = false;
        checkStory();
      }, Math.max(wait, 500));
    }
    return;
  }
  storyBusy = true;
  lastStoryCheck = Date.now();
  try {
    const stories = await api('/api/detect-story', { method: 'POST', body: { text: storyText } });
    if (stories.length) {
      // More of the story has been heard; drop earlier guesses it no longer supports
      // (unless the operator already showed them).
      const keep = new Set(stories.map((s) => s.reference));
      for (const { reference, li } of storyItems) {
        if (!keep.has(reference) && !li.classList.contains('sent')) {
          li.remove();
          recent.delete(reference);
        }
      }
      storyItems = storyItems.filter(({ li }) => li.isConnected);
      for (const s of stories) {
        const li = queueOnce({ ...s, kind: 'story' });
        if (li) storyItems.push({ reference: s.reference, li });
      }
    }
  } catch {
    // needs internet; spoken references and quotes keep working without it
  } finally {
    storyBusy = false;
  }
}

async function handleTranscript(text) {
  const result = findReferences(text, context);
  context = result.context;
  result.references.forEach(queueOnce);
  if (result.references.length) {
    storyText = ''; // the reference was said, no need to guess the story
    return;
  }
  storyText = `${storyText} ${text}`.split(/\s+/).slice(-80).join(' ');
  checkStory();

  // No reference said out loud: check whether a verse was quoted or paraphrased.
  try {
    const quotes = await api('/api/detect-quotes', { method: 'POST', body: { text } });
    for (const q of quotes) queueOnce({ ...q, kind: 'quote' });
  } catch {
    // quote detection is a bonus; spoken references keep working without it
  }
}

// ---------- search box ----------

function renderResults(results) {
  const list = $('search-results');
  list.replaceChildren();
  for (const r of results) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="r-body"><span class="r-ref"></span> <span class="r-text"></span></div><button class="primary">Show</button>';
    li.querySelector('.r-ref').textContent = r.reference;
    li.querySelector('.r-text').textContent = r.text;
    li.querySelector('button').addEventListener('click', async () => {
      if (await show({ ...r, verseEnd: null })) list.replaceChildren();
    });
    list.append(li);
  }
  if (!results.length) list.innerHTML = '<li class="muted">No matching verses.</li>';
}

async function searchVerses(text) {
  try {
    renderResults(await api(`/api/search?q=${encodeURIComponent(text)}`));
  } catch (err) {
    toast(err.message, true);
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
        addFinal(text);
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

function addFinal(text) {
  const clean = text.trim();
  if (!clean) return;
  const final = $('final');
  final.textContent = `${final.textContent} ${/[.!?]$/.test(clean) ? clean : `${clean}.`}`.slice(-3000);
  $('transcript').scrollTop = $('transcript').scrollHeight;
  handleTranscript(clean);
}

// ---------- Whisper engine ----------

let capture = null;
const phrases = []; // WAV blobs waiting to be transcribed, in order
let transcribing = false;

async function transcribeNext() {
  if (transcribing || !phrases.length) return;
  transcribing = true;
  $('interim').textContent = ' …';
  const wav = phrases.shift();
  try {
    // The last words heard help Whisper continue sentences correctly.
    const context = $('final').textContent.split(/\s+/).slice(-30).join(' ');
    const engine = config.speechEngine === 'cloud' || !config.whisperReady ? 'cloud' : 'whisper';
    const res = await fetch(`/api/transcribe?engine=${engine}&context=${encodeURIComponent(context)}`, {
      method: 'POST',
      body: wav,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'transcription failed');
    addFinal(data.text);
  } catch (err) {
    toast(`Whisper: ${err.message}`, true);
  } finally {
    transcribing = false;
    $('interim').textContent = phrases.length ? ' …' : '';
    transcribeNext();
  }
}

function showLevel(level, speaking) {
  $('level').firstElementChild.style.width = `${Math.round(level * 100)}%`;
  $('level').classList.toggle('speaking', speaking);
}

// Both Whisper engines record here and send phrases to the server; only "browser" uses Chrome's.
const useWhisper = () =>
  (config.speechEngine === 'whisper' && config.whisperReady) ||
  (config.speechEngine === 'cloud' && config.cloudSpeechAvailable) ||
  (config.desktop && config.cloudSpeechAvailable); // the desktop app has no Chrome engine to fall back to

async function startListening() {
  // Whisper starts a few seconds after the app; get its latest status.
  config.whisperReady = (await api('/api/config')).whisperReady;
  if (config.speechEngine === 'whisper' && !config.whisperReady) {
    if (config.cloudSpeechAvailable) {
      config.speechEngine = 'cloud';
      toast('Whisper on this computer is not ready yet; using cloud speech for now.');
    } else if (!config.desktop) {
      toast('Whisper is not ready yet; using Chrome speech recognition for now.', true);
    } else {
      throw new Error('Whisper is still starting; try again in a few seconds.');
    }
  }
  if (useWhisper()) {
    capture = new WhisperCapture({
      deviceId: config.micId,
      onPhrase: (wav) => {
        phrases.push(wav);
        transcribeNext();
      },
      onLevel: showLevel,
    });
    await capture.start();
    listMicrophones(); // device names are only visible after permission is granted
  } else {
    recognition.lang = config.language || 'en-US';
    recognition.start();
  }
}

function stopListening() {
  if (capture) {
    capture.stop();
    capture = null;
    showLevel(0, false);
  } else {
    recognition?.stop();
  }
}

async function listMicrophones() {
  const select = $('mic-select');
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId);
  select.replaceChildren(new Option('System default', ''), ...devices.map((d) => new Option(d.label || 'Microphone', d.deviceId)));
  select.value = config.micId || '';
}

function updateListenButton() {
  $('listen').textContent = listening ? '⏹ Stop listening' : '🎤 Start listening';
  $('listen').classList.toggle('listening', listening);
}

async function toggleListening() {
  listening = !listening;
  updateListenButton();
  if (listening) {
    try {
      await startListening();
    } catch (err) {
      listening = false;
      updateListenButton();
      toast(`Microphone: ${err.message}`, true);
    }
  } else {
    stopListening();
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

function showNdiStatus() {
  const el = $('ndi-status');
  const fieldset = el.closest('fieldset');
  for (const input of fieldset.querySelectorAll('input, select')) input.disabled = !config.desktop;
  if (!config.desktop) {
    el.textContent = 'NDI outputs are available in the Scripture Listener desktop app.';
  } else if (config.ndi && !config.ndi.available) {
    el.textContent = `NDI is not available on this computer (${config.ndi.error || 'unknown error'}).`;
  } else {
    const active = (config.ndi?.outputs || []).filter((o) => o.active).map((o) => o.name);
    el.textContent = active.length
      ? `Sending on the network: ${active.join(', ')}. In OBS/vMix add an NDI source and pick it by name.`
      : 'Tick a feed to send it on the network. It appears in OBS/vMix as an NDI source named below.';
  }
}

function fillSettings() {
  const form = $('settings-form');
  // The desktop app has no Chrome speech engine.
  if (config.desktop) form.elements.speechEngine.querySelector('option[value="browser"]')?.remove();
  for (const [key, value] of Object.entries(config)) {
    const input = form.elements[key];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value;
  }
  $('auto-send').checked = Boolean(config.autoSend);
  markStyle();
  showNdiStatus();
}

async function saveSettings(partial) {
  config = await api('/api/config', { method: 'POST', body: partial });
  fillSettings();
}

// ---------- ProPresenter connection & setup card ----------

let setupDismissed = false; // "Later" clicked: don't pop up again this session
let setupForced = false; // opened from Settings: stays until the operator is done

function showSetup(state) {
  const card = $('setup');
  if (!state || (setupDismissed && state !== 'forced')) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const notConnected = state === 'disconnected';
  $('find-pp').hidden = !notConnected && state !== 'forced';
  $('create-msg').hidden = notConnected;
  $('setup-text').innerHTML = notConnected
    ? 'Scripture Listener can’t reach ProPresenter. Open ProPresenter, go to <strong>Settings → Network</strong>, tick <strong>Enable Network</strong>, then click <strong>Find ProPresenter</strong>. (If ProPresenter is on another computer, enter its IP address and port under Settings below.)'
    : state === 'forced'
      ? 'Find ProPresenter on this computer, and create or repair the Scripture message.'
      : `Connected to ProPresenter. Click <strong>Create Scripture message</strong> to add the “${config.messageName}” message that shows the verses (nothing else in ProPresenter is changed).`;
}

function setupLog(lines) {
  $('setup-log').replaceChildren(...lines.map((l) => Object.assign(document.createElement('li'), { textContent: l })));
}

async function findProPresenter() {
  setupLog(['Looking for ProPresenter on this computer…']);
  try {
    const { found, config: fresh } = await api('/api/pp/find', { method: 'POST' });
    if (!found.length) {
      setupLog(['ProPresenter was not found. Is it open, with Settings → Network → Enable Network ticked?']);
      return;
    }
    config = fresh;
    fillSettings();
    setupLog([`Found ${found[0].version.host_description || 'ProPresenter'} on port ${found[0].port}.`]);
    await checkProPresenter();
  } catch (err) {
    setupLog([err.message]);
  }
}

async function createMessage() {
  try {
    const { steps, config: fresh } = await api('/api/pp/setup', { method: 'POST' });
    config = fresh;
    fillSettings();
    setupLog([...steps, 'All set — click Start listening.']);
    toast('ProPresenter is ready.');
    setupForced = false; // hides itself on the next check now that everything is ready
    setTimeout(() => checkProPresenter(), 4000);
  } catch (err) {
    setupLog([err.message]);
  }
}

async function checkProPresenter(verbose = false) {
  const pill = $('pp-status');
  try {
    const status = await api('/api/pp/status');
    const name = status.version?.name || status.version?.host_description || 'connected';
    pill.textContent = `ProPresenter: ${name}`;
    pill.className = 'pill ok';
    const msg = status.messages.find((m) => m.name === config.messageName);
    const ready = !config.sendToMessage || (msg && msg.tokens.includes(config.textToken) && msg.tokens.includes(config.referenceToken));
    if (!setupForced) showSetup(ready ? null : 'no-message');
    if (verbose) {
      toast(ready ? 'Connected to ProPresenter and the Message is ready.' : `Connected, but the “${config.messageName}” message is missing or incomplete.`, !ready);
    }
  } catch (err) {
    pill.textContent = 'ProPresenter: not connected';
    pill.className = 'pill bad';
    if (!setupForced) showSetup('disconnected');
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
$('find-pp').addEventListener('click', findProPresenter);
$('create-msg').addEventListener('click', createMessage);
$('setup-later').addEventListener('click', () => {
  setupDismissed = true;
  setupForced = false;
  showSetup(null);
});
$('rerun-setup').addEventListener('click', () => {
  setupDismissed = false;
  setupForced = true;
  showSetup('forced');
  $('create-msg').hidden = false;
  setupLog([]);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
for (const btn of document.querySelectorAll('#style-switch button')) {
  btn.addEventListener('click', () => setStyle(btn.dataset.style));
}
$('settings').addEventListener('toggle', (e) => e.target.open && (loadSlides(), loadVideoInputs()));

// ProPresenter video inputs (for the NDI feed on a second screen).
async function loadVideoInputs() {
  const select = $('video-input-select');
  try {
    const inputs = await api('/api/pp/video_inputs');
    select.replaceChildren(new Option('— none —', ''), ...inputs.map((v) => new Option(v.name, v.uuid)));
    if (!inputs.length) select.append(new Option('(none in ProPresenter’s Video Inputs playlist yet)', '', false, false));
  } catch {
    // not connected; keep what is there
  }
  select.value = config.ppVideoInput || '';
}

$('led-tv-look').addEventListener('click', async () => {
  const log = $('look-log');
  const lines = (list) => log.replaceChildren(...list.map((l) => Object.assign(document.createElement('li'), { textContent: l })));
  try {
    // Save the chosen video input first so the Look step can start it.
    await saveSettings({ ppVideoInput: $('video-input-select').value });
    lines((await api('/api/pp/led-tv-look', { method: 'POST' })).steps);
    toast('LED + TV Look is live in ProPresenter.');
  } catch (err) {
    lines([err.message]);
  }
});

$('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('manual-ref').value.trim();
  if (!text) return;
  // Typed "John 3" should work too, so treat bare numbers as a chapter.
  const parsed = findReferences(text).references[0] || findReferences(text.replace(/(\D)\s+(\d+)\s*$/, '$1 chapter $2')).references[0];
  if (parsed) {
    $('search-results').replaceChildren();
    show(parsed);
    $('manual-ref').value = '';
  } else {
    searchVerses(text); // words from a verse, e.g. "love is patient"
  }
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
  // NDI feeds start a moment after saving; refresh their status.
  setTimeout(async () => {
    config.ndi = (await api('/api/config')).ndi;
    showNdiStatus();
  }, 2500);
  if (recognition) recognition.lang = config.language;
  if (listening) {
    // Engine or microphone may have changed.
    stopListening();
    await startListening();
  }
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

navigator.serviceWorker?.register('/sw.js').catch(() => {});

config = await api('/api/config');
fillSettings();
setupRecognition();
checkProPresenter();
setInterval(checkProPresenter, 15_000);
