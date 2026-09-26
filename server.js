// Scripture Listener server: serves the control page, fetches verse text,
// and pushes verses to ProPresenter 7 through its network API (7.9+).
// No dependencies; needs Node 18+ (built-in fetch).
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup, search, detectQuotes, indexExists, buildIndex, LOCAL_TRANSLATIONS } from './lib/search.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(ROOT, 'config.json');
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
};

let config = { ...DEFAULT_CONFIG };
if (existsSync(CONFIG_FILE)) {
  try {
    config = { ...config, ...JSON.parse(await readFile(CONFIG_FILE, 'utf8')) };
  } catch (err) {
    console.warn(`Ignoring unreadable config.json: ${err.message}`);
  }
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

// ---------- Live display page (Server-Sent Events) ----------

const displayClients = new Set();
let current = null;
function broadcast(payload) {
  current = payload;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of displayClients) res.write(data);
}

// ---------- HTTP ----------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

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
      return send(res, 200, config);
    case 'POST /api/config': {
      const incoming = await readBody(req);
      for (const key of Object.keys(DEFAULT_CONFIG)) {
        if (key in incoming) config[key] = typeof DEFAULT_CONFIG[key] === 'number' ? Number(incoming[key]) : incoming[key];
      }
      await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
      return send(res, 200, config);
    }
    case 'GET /api/search': {
      const q = url.searchParams.get('q');
      if (!q) return send(res, 400, { error: 'q is required' });
      if (!searchReady) return send(res, 503, { error: 'Verse search is still being prepared; try again in a few minutes.' });
      return send(res, 200, await search(q, 8));
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
      await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
      return send(res, 200, { style, slide });
    }
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

server.listen(PORT, HOST, () => {
  console.log(`Scripture Listener running at http://localhost:${PORT}`);
  console.log(`ProPresenter target: http://${config.ppHost}:${config.ppPort} (change in the page's Settings)`);
  console.log(`Optional web display: http://localhost:${PORT}/display`);
});
