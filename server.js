// Scripture Listener server: serves the control page, fetches verse text,
// and pushes verses to ProPresenter 7 through its network API (7.9+).
// No dependencies; needs Node 18+ (built-in fetch).
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup, search, detectQuotes, indexExists, buildIndex, LOCAL_TRANSLATIONS } from './lib/search.js';
import { findReferences } from './public/parser.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
// The desktop app keeps settings in the user's own folder (the app folder is read-only there).
const CONFIG_FILE = path.join(process.env.SCRIPTURE_CONFIG_DIR || ROOT, 'config.json');
const DATA_DIR = process.env.SCRIPTURE_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || '127.0.0.1';
const BIBLE_API = process.env.BIBLE_API_URL || 'https://bible-api.com';

const DEFAULT_CONFIG = {
  ppHost: '127.0.0.1', // machine running ProPresenter
  ppPort: 50001, // ProPresenter > Settings > Network > Port
  sendToMessage: true, // show on audience screens via a ProPresenter Message
  messageName: 'Scripture', // name of the Message you created in ProPresenter
  referenceToken: 'Reference', // text token in that Message for "John 3:16"
  textToken: 'Verse', // text token in that Message for the verse text
  sendToStage: false, // also put the verse on the stage display message
  translation: 'kjv', // bible-api.com translation id
  language: 'en-US', // speech recognition language
  autoSend: false, // send detected verses immediately (otherwise operator clicks)
  displayStyle: 'fullScreen', // 'fullScreen' or 'lowerThird'
  // Theme slide uuids used for each style. Pick slides with a single text box:
  // a Message only fills the first text box, so extra boxes show their placeholder.
  fullScreenSlide: '3FB9D028-2B10-4351-87B1-21C4C988EE34', // Black Box > Four Lines
  lowerThirdSlide: '1498A8E4-8CAB-443D-87A1-09316C611175', // Black > Lower 3rd Lyrics
  // 'whisper' (on this computer), 'cloud' (Whisper on the Cloudflare Worker, for slower PCs)
  // or 'browser' (Chrome's built-in; not available in the desktop app).
  speechEngine: 'whisper',
  micId: '', // audio input device id; '' = system default
  // Story detection (retold Bible stories) via the Cloudflare Worker in cloud/.
  storyDetection: true,
  aiUrl: '', // e.g. https://scripture-listener-ai.<you>.workers.dev
  aiToken: '', // must match the Worker's APP_TOKEN secret; never sent to the browser
};

let config = { ...DEFAULT_CONFIG };
// A packaged app can ship preset settings (e.g. the cloud address and key) in data/defaults.json;
// the user's own config.json still wins.
const PRESETS_FILE = path.join(DATA_DIR, 'defaults.json');
if (existsSync(PRESETS_FILE)) {
  try {
    config = { ...config, ...JSON.parse(await readFile(PRESETS_FILE, 'utf8')) };
  } catch (err) {
    console.warn(`Ignoring unreadable defaults.json: ${err.message}`);
  }
}
if (existsSync(CONFIG_FILE)) {
  try {
    config = { ...config, ...JSON.parse(await readFile(CONFIG_FILE, 'utf8')) };
  } catch (err) {
    console.warn(`Ignoring unreadable config.json: ${err.message}`);
  }
}

// The browser never sees the AI token; it only needs to know whether story detection is set up.
function publicConfig() {
  const { aiToken, ...rest } = config;
  const cloud = Boolean(config.aiUrl && aiToken);
  return { ...rest, storyDetectionAvailable: cloud, cloudSpeechAvailable: cloud, whisperReady, desktop: Boolean(process.versions.electron) };
}

// ---------- ProPresenter ----------

async function pp(pathname, { method = 'GET', body } = {}) {
  const url = `http://${config.ppHost}:${config.ppPort}${pathname}`;
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ProPresenter ${method} ${pathname} -> ${res.status} ${text}`.trim());
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

const messagePath = () => `/v1/message/${encodeURIComponent(config.messageName)}`;

// Fill the Message's text tokens, keeping whatever token structure ProPresenter reports.
async function buildTokens(values) {
  let tokens = [];
  try {
    const msg = await pp(messagePath());
    tokens = Array.isArray(msg?.tokens) ? msg.tokens : [];
  } catch {
    // fall through to a minimal token list
  }
  const byName = new Map(tokens.map((t) => [t.name, t]));
  for (const [name, text] of Object.entries(values)) {
    if (!name) continue;
    const token = byName.get(name) || { name };
    token.text = { ...(token.text || {}), text };
    byName.set(name, token);
  }
  return [...byName.values()];
}

async function showOnProPresenter({ reference, text }) {
  const results = {};
  if (config.sendToMessage) {
    const tokens = await buildTokens({
      [config.referenceToken]: reference,
      [config.textToken]: text,
    });
    await pp(`${messagePath()}/trigger`, { method: 'POST', body: tokens });
    results.message = 'shown';
  }
  if (config.sendToStage) {
    await pp('/v1/stage/message', { method: 'PUT', body: `${reference}\n${text}` });
    results.stage = 'shown';
  }
  return results;
}

// Every theme slide as {uuid, name, index, label}, flattening theme groups.
async function listThemeSlides() {
  const slides = [];
  const walk = (group, prefix) => {
    for (const theme of group.themes || []) {
      const themeName = prefix ? `${prefix} / ${theme.id.name}` : theme.id.name;
      for (const slide of theme.slides || []) {
        slides.push({ ...slide.id, label: `${themeName} — ${slide.id.name.trim() || 'Untitled'}` });
      }
    }
    for (const sub of group.groups || []) walk(sub, prefix ? `${prefix} / ${sub.id.name}` : sub.id.name);
  };
  walk((await pp('/v1/themes')) || {}, '');
  return slides;
}

// Point the Scripture Message at the theme slide for the chosen style.
async function applyStyle(style) {
  const uuid = style === 'lowerThird' ? config.lowerThirdSlide : config.fullScreenSlide;
  const slide = (await listThemeSlides()).find((s) => s.uuid === uuid);
  if (!slide) throw new Error(`Theme slide for ${style} not found in ProPresenter; pick one in Settings.`);
  const msg = await pp(messagePath());
  const { label, ...theme } = slide;
  await pp(`/v1/message/${encodeURIComponent(msg.id.uuid || config.messageName)}`, {
    method: 'PUT',
    body: { ...msg, theme },
  });
  // Re-trigger so a verse already on screen switches style immediately.
  if (current) await showOnProPresenter(current);
  return slide.label;
}

// ---------- ProPresenter setup (first-run wizard) ----------

// A Message only fills a slide's first text box, so the slide must have just one. The API doesn't
// list text boxes, so choose by name: ProPresenter's lyric/text slides have one box; "Scripture",
// "Title", "Name", "Quote"... slides have several.
const MULTI_BOX = /scripture|reference|title|name|quote|point|list|number|picture|dual|callout|setlist|subtitle/i;
const SLIDE_PREFERENCES = {
  fullScreen: [/^four lines$/i, /^two lines$/i, /general text/i, /^lyrics$/i, /statement/i, /text/i, /lines/i],
  lowerThird: [/lower.?(3rd|third).*lyric/i, /lower.?(3rd|third).*text/i, /lower.?(3rd|third)/i],
};

function pickSlide(slides, style) {
  for (const pattern of SLIDE_PREFERENCES[style]) {
    const found = slides.find((s) => {
      const name = s.name.trim();
      const isLower = /lower/i.test(name);
      return pattern.test(name) && !MULTI_BOX.test(name) && (style === 'lowerThird' ? isLower : !isLower);
    });
    if (found) return found;
  }
  return null;
}

const saveConfig = () => writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));

/** Creates or repairs the Scripture message and chooses slides. Returns what was done, step by step. */
async function setupProPresenter() {
  const steps = [];
  const slides = await listThemeSlides();
  for (const [key, style, label] of [
    ['fullScreenSlide', 'fullScreen', 'Full screen'],
    ['lowerThirdSlide', 'lowerThird', 'Lower third'],
  ]) {
    if (slides.some((s) => s.uuid === config[key])) continue; // keep the church's own choice
    const slide = pickSlide(slides, style);
    config[key] = slide?.uuid || '';
    steps.push(slide ? `${label} style uses: ${slide.label}` : `No suitable ${label.toLowerCase()} slide found; pick one in Settings`);
  }
  // ProPresenter won't create a message without a theme slide; fall back to any slide.
  const current =
    slides.find((s) => s.uuid === (config.displayStyle === 'lowerThird' ? config.lowerThirdSlide : config.fullScreenSlide)) ||
    slides.find((s) => s.uuid === config.fullScreenSlide) ||
    slides[0];
  if (!current) throw new Error('ProPresenter has no themes to show the verse with; add a theme in ProPresenter first.');
  const theme = { uuid: current.uuid, name: current.name, index: current.index };
  const text = `{${config.referenceToken}}\n{${config.textToken}}`;
  const tokens = [config.referenceToken, config.textToken].map((name) => ({ name, text: { text: '' } }));

  let msg = null;
  try {
    msg = await pp(messagePath());
  } catch {
    // not there yet
  }
  if (!msg) {
    await pp('/v1/messages', {
      method: 'POST',
      body: { id: { name: config.messageName }, message: text, tokens, theme, visible_on_network: true, is_active: false, clear_type: 'manual' },
    });
    steps.push(`Created the "${config.messageName}" message in ProPresenter`);
  } else {
    const names = (msg.tokens || []).map((t) => t.name);
    if (names.includes(config.referenceToken) && names.includes(config.textToken)) {
      steps.push(`The "${config.messageName}" message is ready`);
    } else {
      await pp(`/v1/message/${encodeURIComponent(msg.id?.uuid || config.messageName)}`, {
        method: 'PUT',
        body: { ...msg, message: text, tokens, theme: theme || msg.theme },
      });
      steps.push(`Added {${config.referenceToken}} and {${config.textToken}} to the "${config.messageName}" message`);
    }
  }
  await saveConfig();
  return steps;
}

// Finds ProPresenter on this computer: asks every program listening on a port whether it is
// ProPresenter (GET /version), so nobody has to look up the port number.
const execFileAsync = promisify(execFile);
async function listeningPorts() {
  const { stdout } = await execFileAsync('netstat', ['-an', '-p', process.platform === 'win32' ? 'TCP' : 'tcp'], {
    timeout: 5000,
    windowsHide: true,
  });
  const ports = new Set();
  for (const line of stdout.split('\n')) {
    if (!/LISTEN/i.test(line)) continue;
    // mac: "*.59180" / "127.0.0.1.59180"   Windows: "0.0.0.0:59180" / "[::]:59180"
    const m = line.match(/(?:\*|127\.0\.0\.1|0\.0\.0\.0|\[?::1?\]?)[.:](\d+)\s/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports].filter((p) => p !== listenPort && p !== whisperPort);
}

async function findProPresenter() {
  const ports = await listeningPorts();
  const found = await Promise.all(
    ports.map(async (port) => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/version`, { signal: AbortSignal.timeout(800) });
        const version = await res.json();
        return /propresenter/i.test(version.host_description || '') ? { port, version } : null;
      } catch {
        return null;
      }
    }),
  );
  return found.filter(Boolean);
}

// First free port at or after `preferred` (so another program using 4000/4001 doesn't stop us).
function freePort(preferred) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(freePort(preferred + 1)));
    probe.listen(preferred, '127.0.0.1', () => probe.close(() => resolve(preferred)));
  });
}

async function clearProPresenter() {
  const results = {};
  if (config.sendToMessage) {
    await pp(`${messagePath()}/clear`);
    results.message = 'cleared';
  }
  if (config.sendToStage) {
    await pp('/v1/stage/message', { method: 'DELETE' });
    results.stage = 'cleared';
  }
  return results;
}

// ---------- Bible text ----------
// KJV and BSB are stored locally (work offline); other translations come from bible-api.com.

const verseCache = new Map();
async function getVerse(reference, translation) {
  const local = lookup(reference, translation);
  if (local) return local;
  const key = `${translation}|${reference}`;
  if (verseCache.has(key)) return verseCache.get(key);
  const url = `${BIBLE_API}/${encodeURIComponent(reference)}?translation=${encodeURIComponent(translation)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Bible lookup failed for ${reference} (${res.status})`);
  const data = await res.json();
  const verses = (data.verses || []).map((v) => ({ verse: v.verse, text: v.text.replace(/\s+/g, ' ').trim() }));
  const result = {
    reference: data.reference || reference,
    translation: (data.translation_id || translation).toUpperCase(),
    verses,
    text: verses.length > 1 ? verses.map((v) => `${v.verse} ${v.text}`).join(' ') : verses[0]?.text || '',
  };
  verseCache.set(key, result);
  return result;
}

// ---------- Speech to text (Whisper on this Mac) ----------
// whisper.cpp's server (brew install whisper-cpp) with the large-v3-turbo model: accurate across
// accents, runs offline on Apple Silicon. Started and stopped with this server.

let whisperPort = 4001; // moved to a free port if taken
const WHISPER_DIR = path.join(DATA_DIR, 'whisper');
const WHISPER_MODEL = path.join(WHISPER_DIR, 'ggml-large-v3-turbo-q5_0.bin');
const VAD_MODEL = path.join(WHISPER_DIR, 'ggml-silero-v5.1.2.bin');
// Nudges Whisper towards Bible spellings ("Habakkuk", "1 Thessalonians 5:17").
const WHISPER_VOCAB =
  'Sermon with Bible readings, e.g. Genesis, Deuteronomy, Ecclesiastes, Isaiah, Jeremiah, Habakkuk, ' +
  'Zephaniah, Haggai, Zechariah, Malachi, Philippians, Colossians, 1 Thessalonians 5:17, Philemon, Hebrews.';
// Phrases Whisper sometimes invents from noise or music.
const HALLUCINATIONS = /^(thank you\.?|thanks for watching[.!]?|you|bye\.?|\[.*\]|\(.*\)|subtitles? by.*|\.+)$/i;

let whisperProc = null;
let whisperReady = false;
let shuttingDown = false;

// Bundled with the desktop app (SCRIPTURE_WHISPER_BIN), or installed with Homebrew.
const whisperBin = () =>
  [process.env.SCRIPTURE_WHISPER_BIN, '/opt/homebrew/bin/whisper-server', '/usr/local/bin/whisper-server'].find(
    (p) => p && existsSync(p),
  );

async function startWhisper() {
  const bin = whisperBin();
  if (!bin || !existsSync(WHISPER_MODEL)) {
    console.log('Whisper not installed; using Chrome speech recognition (see README to install).');
    return;
  }
  whisperPort = await freePort(4001);
  const args = ['-m', WHISPER_MODEL, '--host', '127.0.0.1', '--port', String(whisperPort), '-l', 'en', '-t', '4', '-sns'];
  if (existsSync(VAD_MODEL)) args.push('--vad', '-vm', VAD_MODEL);
  whisperProc = spawn(bin, args, { stdio: 'ignore' });
  whisperProc.on('exit', () => {
    whisperReady = false;
    whisperProc = null;
    if (!shuttingDown) setTimeout(() => startWhisper(), 3000);
  });
  const poll = setInterval(async () => {
    try {
      await fetch(`http://127.0.0.1:${whisperPort}/`, { signal: AbortSignal.timeout(1000) });
      whisperReady = true;
      clearInterval(poll);
      console.log('Whisper speech recognition ready.');
    } catch {
      if (!whisperProc) clearInterval(poll);
    }
  }, 500);
}

function stopWhisper() {
  shuttingDown = true;
  whisperProc?.kill();
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopWhisper();
    process.exit(0);
  });
}
process.on('exit', stopWhisper);

async function transcribe(wav, context, engine = config.speechEngine) {
  if (engine === 'cloud') return transcribeInCloud(wav, context);
  if (!whisperReady) throw new Error('Whisper is still starting');
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  // The vocabulary plus the last words heard, so sentences continue naturally.
  form.append('prompt', `${WHISPER_VOCAB} ${context}`.slice(-600));
  const res = await fetch(`http://127.0.0.1:${whisperPort}/inference`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Whisper failed (${res.status})`);
  const text = String((await res.json()).text || '').replace(/\s+/g, ' ').trim();
  return HALLUCINATIONS.test(text) ? '' : text;
}

// Same Whisper model, run on the Cloudflare Worker (cloud/) instead of this computer.
async function transcribeInCloud(wav, context) {
  if (!config.aiUrl || !config.aiToken) throw new Error('Cloud speech is not set up (aiUrl/aiToken)');
  const prompt = encodeURIComponent(`${WHISPER_VOCAB} ${context}`.slice(-600));
  const res = await fetch(`${config.aiUrl.replace(/\/$/, '')}/transcribe?prompt=${prompt}`, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', Authorization: `Bearer ${config.aiToken}` },
    body: wav,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Cloud speech failed (${res.status})`);
  const text = String((await res.json()).text || '').replace(/\s+/g, ' ').trim();
  return HALLUCINATIONS.test(text) ? '' : text;
}

async function readRaw(req, limit = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('audio too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ---------- Story detection (Cloudflare Worker) ----------

const STORY_MIN_CONFIDENCE = 0.75;
const STORY_MAX_VERSES = 8; // keep it screen-sized

async function detectStory(text) {
  if (!config.storyDetection || !config.aiUrl || !config.aiToken) return [];
  const res = await fetch(`${config.aiUrl.replace(/\/$/, '')}/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aiToken}` },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Story detection failed (${res.status})`);
  const { matches = [] } = await res.json();
  const found = [];
  for (const m of matches) {
    if (!(m.confidence >= STORY_MIN_CONFIDENCE)) continue;
    // Re-parse the model's reference so only real, well-formed passages get through.
    const ref = findReferences(String(m.reference)).references[0];
    if (!ref || !ref.verse) continue;
    if (ref.verseEnd && ref.verseEnd - ref.verse >= STORY_MAX_VERSES) {
      ref.verseEnd = ref.verse + STORY_MAX_VERSES - 1;
      ref.reference = `${ref.book} ${ref.chapter}:${ref.verse}-${ref.verseEnd}`;
    }
    if (!lookup(ref.reference, 'kjv')) continue;
    found.push({ ...ref, story: String(m.story || ''), score: m.confidence });
  }
  return found;
}

// ---------- Live display page (Server-Sent Events) ----------

const displayClients = new Set();
let current = null;
function broadcast(payload) {
  current = payload;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of displayClients) res.write(data);
}

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case 'GET /api/config':
      return send(res, 200, publicConfig());
    case 'POST /api/config': {
      const incoming = await readBody(req);
      for (const key of Object.keys(DEFAULT_CONFIG)) {
        if (key === 'aiToken') continue; // set in config.json only
        if (key in incoming) config[key] = typeof DEFAULT_CONFIG[key] === 'number' ? Number(incoming[key]) : incoming[key];
      }
      await saveConfig();
      return send(res, 200, publicConfig());
    }
    case 'GET /api/search': {
      const q = url.searchParams.get('q');
      if (!q) return send(res, 400, { error: 'q is required' });
      if (!searchReady) return send(res, 503, { error: 'Verse search is still being prepared; try again in a few minutes.' });
      return send(res, 200, await search(q, 8));
    }
    case 'POST /api/transcribe': {
      const wav = await readRaw(req);
      const engine = url.searchParams.get('engine') || undefined;
      return send(res, 200, { text: await transcribe(wav, url.searchParams.get('context') || '', engine) });
    }
    case 'POST /api/detect-story': {
      const { text } = await readBody(req);
      return send(res, 200, await detectStory(text || ''));
    }
    case 'POST /api/detect-quotes': {
      if (!searchReady) return send(res, 200, []);
      const { text } = await readBody(req);
      return send(res, 200, await detectQuotes(text || ''));
    }
    case 'GET /api/verse': {
      const ref = url.searchParams.get('ref');
      if (!ref) return send(res, 400, { error: 'ref is required' });
      return send(res, 200, await getVerse(ref, url.searchParams.get('translation') || config.translation));
    }
    case 'GET /api/pp/themes':
      return send(res, 200, await listThemeSlides());
    case 'POST /api/style': {
      const { style } = await readBody(req);
      if (style !== 'fullScreen' && style !== 'lowerThird') return send(res, 400, { error: 'unknown style' });
      const slide = await applyStyle(style);
      config.displayStyle = style;
      await saveConfig();
      return send(res, 200, { style, slide });
    }
    case 'POST /api/pp/find': {
      const found = await findProPresenter();
      if (found.length) {
        config.ppHost = '127.0.0.1';
        config.ppPort = found[0].port;
        await saveConfig();
      }
      return send(res, 200, { found, config: publicConfig() });
    }
    case 'POST /api/pp/setup':
      return send(res, 200, { steps: await setupProPresenter(), config: publicConfig() });
    case 'GET /api/pp/status': {
      const version = await pp('/version');
      let messages = [];
      try {
        messages = ((await pp('/v1/messages')) || []).map((m) => ({
          name: m.id?.name,
          tokens: (m.tokens || []).map((t) => t.name),
        }));
      } catch {
        // older builds may not list messages; version alone proves the connection
      }
      return send(res, 200, { connected: true, version, messages });
    }
    case 'POST /api/show': {
      const { reference, text, translation } = await readBody(req);
      broadcast({ reference, text, translation });
      return send(res, 200, { ok: true, propresenter: await showOnProPresenter({ reference, text }) });
    }
    case 'POST /api/clear': {
      broadcast(null);
      return send(res, 200, { ok: true, propresenter: await clearProPresenter() });
    }
    case 'GET /api/display-events': {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(current)}\n\n`);
      displayClients.add(res);
      req.on('close', () => displayClients.delete(res));
      return undefined;
    }
    default:
      return send(res, 404, { error: 'not found' });
  }
}

async function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return res.end(body);
  } catch {
    return send(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(res, url.pathname === '/display' ? '/display.html' : url.pathname);
  } catch (err) {
    send(res, 502, { error: err.message });
  }
});

// Verse search needs its index; build it in the background the first time (a few minutes).
let searchReady = indexExists();
if (!searchReady) {
  console.log('Preparing verse search for first use (a few minutes)...');
  (async () => {
    for (const t of LOCAL_TRANSLATIONS) await buildIndex(t);
    searchReady = true;
    console.log('Verse search ready.');
  })().catch((err) => console.error(`Verse search unavailable: ${err.message}`));
}

startWhisper();

/** Stops the server and Whisper (used by the desktop app before quitting). */
export function shutdown() {
  stopWhisper();
  for (const res of displayClients) res.end();
  const closed = new Promise((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  return closed;
}

// Listen on PORT (4000), or the next free port if another program has it (up to 20 tries).
// `ready` resolves with the port actually used.
let listenPort = PORT;
export const ready = new Promise((resolve, reject) => {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && listenPort < PORT + 20) {
      listenPort += 1;
      server.listen(listenPort, HOST);
    } else {
      reject(err);
    }
  });
  server.once('listening', () => resolve(listenPort));
});

server.listen(listenPort, HOST);
ready.then((port) => {
  console.log(`Scripture Listener running at http://localhost:${port}`);
  console.log(`ProPresenter target: http://${config.ppHost}:${config.ppPort} (change in the page's Settings)`);
  console.log(`Optional web display: http://localhost:${port}/display`);
});
