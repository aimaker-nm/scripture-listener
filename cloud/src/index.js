// Scripture Listener cloud services.
// Public: GET / (download page) and GET /download/<file> (installers stored in R2).
// Admin ("Authorization: Bearer <ADMIN_TOKEN>"): /upload/* to upload installers in parts.
// App ("Authorization: Bearer <APP_TOKEN>"):
// - POST /identify {"text": "...transcript..."} -> {"matches":[{reference, confidence, story}]}
//   (which Bible story is the preacher retelling)
// - POST /transcribe?prompt=... with a WAV body -> {"text": "..."}
//   (speech to text for computers too slow to run Whisper themselves)
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const WHISPER = '@cf/openai/whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~60 s of 16 kHz mono WAV; phrases are ~1-12 s

// Workers AI takes the audio as base64.
function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function transcribe(request, env, url) {
  const audio = new Uint8Array(await request.arrayBuffer());
  if (!audio.length) return json({ error: 'audio is required' }, 400);
  if (audio.length > MAX_AUDIO_BYTES) return json({ error: 'audio too long' }, 413);
  try {
    const result = await env.AI.run(WHISPER, {
      audio: toBase64(audio),
      language: 'en',
      vad_filter: true,
      initial_prompt: (url.searchParams.get('prompt') || '').slice(-600) || undefined,
    });
    return json({ text: String(result?.text || '').trim() });
  } catch (err) {
    console.error('transcribe failed', err);
    return json({ error: 'transcription failed' }, 502);
  }
}

const SYSTEM = `You help a church media team. You receive a few sentences of a live sermon transcript
(from speech recognition, so expect misheard words). Decide whether the preacher is retelling,
summarising or alluding to a SPECIFIC Bible story or passage without saying the reference.

Rules:
- Only answer when the speech clearly describes a particular story or event (people, actions, outcome),
  e.g. "the prophet told the king he would die, he prayed, and God gave him fifteen more years"
  -> 2 Kings 20:1-6.
- General preaching, prayer, encouragement, announcements, or themes found in many places
  ("God is faithful", "Jesus loves you", "we must pray") -> return no matches.
- Give the few verses (at most 6) that capture the moment the preacher describes, as
  "Book Chapter:Verse-Verse" with full book names like "2 Kings", "Psalms", "Song of Solomon" -
  e.g. David killing Goliath -> 1 Samuel 17:48-50, not the whole chapter. They go on a screen.
  Add a parallel account only if it is equally central.
- confidence is 0 to 1: how sure you are this exact story is being told. Do not guess.
- story is a short name for the story, e.g. "Hezekiah's illness and recovery".`;

const SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          reference: { type: 'string' },
          confidence: { type: 'number' },
          story: { type: 'string' },
        },
        required: ['reference', 'confidence', 'story'],
      },
    },
  },
  required: ['matches'],
};

// ---------- downloads ----------

const INSTALLERS = [
  { key: 'mac', label: 'Download for Mac', note: 'Apple Silicon (M1 or newer), macOS 12+' },
  { key: 'win', label: 'Download for Windows', note: 'Windows 10 or 11, 64-bit' },
];

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function downloadPage(env) {
  // The newest file for each platform, by upload time.
  const { objects } = await env.DOWNLOADS.list();
  const latest = {};
  for (const o of objects) {
    const platform = o.key.includes('-mac-') ? 'mac' : o.key.includes('-win-') ? 'win' : null;
    if (platform && (!latest[platform] || o.uploaded > latest[platform].uploaded)) latest[platform] = o;
  }
  const buttons = INSTALLERS.map(({ key, label, note }) => {
    const o = latest[key];
    if (!o) return `<div class="dl off"><strong>${label}</strong><span>Coming soon</span></div>`;
    const mb = Math.round(o.size / 1048576);
    return `<a class="dl" href="/download/${encodeURIComponent(o.key)}"><strong>${label}</strong><span>${escapeHtml(note)} · ${mb} MB</span></a>`;
  }).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scripture Listener</title><style>
:root{--bg:#111418;--panel:#1a1f26;--border:#2b323c;--text:#e8ecf1;--muted:#8a95a3;--accent:#3d8bfd}
@media (prefers-color-scheme: light){:root{--bg:#f6f7f9;--panel:#fff;--border:#dde1e6;--text:#14181d;--muted:#5d6773;--accent:#2563eb}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px}h1{margin:0 0 8px;font-size:30px}p{color:var(--muted);line-height:1.55}
.dls{display:grid;gap:12px;margin:28px 0}.dl{display:grid;gap:4px;padding:16px 18px;border-radius:12px;background:var(--accent);color:#fff;text-decoration:none}
.dl span{opacity:.85;font-size:14px}.dl.off{background:var(--panel);border:1px solid var(--border);color:var(--muted)}
h2{font-size:16px;margin:28px 0 6px}ol{color:var(--muted);line-height:1.6;padding-left:20px}
</style></head><body><main>
<h1>Scripture Listener</h1>
<p>Listens to the sermon and puts the Bible verses on your ProPresenter screens — spoken references,
quoted verses and retold Bible stories, in any accent.</p>
<div class="dls">${buttons}</div>
<h2>First launch</h2>
<ol><li><strong>Mac:</strong> open the .dmg, drag Scripture Listener to Applications, then right-click it → <em>Open</em> → <em>Open</em> (needed once).</li>
<li><strong>Windows:</strong> run the installer; if “Windows protected your PC” appears, click <em>More info</em> → <em>Run anyway</em>.</li></ol>
<h2>You also need</h2>
<ol><li>ProPresenter 7.9 or newer with Settings → Network → <em>Enable Network</em> turned on.</li>
<li>A Message in ProPresenter named <em>Scripture</em> containing <em>{Reference}</em> and <em>{Verse}</em>.</li></ol>
</main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function download(request, env, key) {
  // Supports resuming (Range requests) for these large files.
  const object = await env.DOWNLOADS.get(key, { range: request.headers, onlyIf: request.headers });
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Disposition', `attachment; filename="${key.replace(/"/g, '')}"`);
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(object.size));
    return new Response(null, { headers });
  }
  if (object.range && request.headers.has('range')) {
    const { offset = 0, length = object.size - offset } = object.range;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

// Multipart upload, so installers larger than a single request can be stored.
async function upload(request, env, url) {
  const key = url.searchParams.get('key');
  if (!key || !/^[\w.-]+$/.test(key)) return json({ error: 'bad key' }, 400);
  if (url.pathname === '/upload/create') {
    const type = url.searchParams.get('type') || 'application/octet-stream';
    const mpu = await env.DOWNLOADS.createMultipartUpload(key, { httpMetadata: { contentType: type } });
    return json({ uploadId: mpu.uploadId });
  }
  const mpu = env.DOWNLOADS.resumeMultipartUpload(key, url.searchParams.get('uploadId') || '');
  if (url.pathname === '/upload/part') {
    const part = await mpu.uploadPart(Number(url.searchParams.get('part')), request.body);
    return json(part);
  }
  if (url.pathname === '/upload/complete') {
    const object = await mpu.complete((await request.json()).parts);
    return json({ key: object.key, size: object.size });
  }
  if (url.pathname === '/upload/abort') {
    await mpu.abort();
    return json({ aborted: true });
  }
  return json({ error: 'not found' }, 404);
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/') {
      const page = await downloadPage(env);
      return request.method === 'HEAD' ? new Response(null, { headers: page.headers }) : page;
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/download/')) {
      return download(request, env, decodeURIComponent(url.pathname.slice('/download/'.length)));
    }
    if (url.pathname.startsWith('/upload/')) {
      if (!env.ADMIN_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) {
        return json({ error: 'unauthorized' }, 401);
      }
      return upload(request, env, url);
    }
    if (request.method !== 'POST' || !['/identify', '/transcribe'].includes(url.pathname)) {
      return json({ error: 'not found' }, 404);
    }
    if (!env.APP_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.APP_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (url.pathname === '/transcribe') return transcribe(request, env, url);

    let text;
    try {
      ({ text } = await request.json());
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    if (typeof text !== 'string' || !text.trim()) return json({ error: 'text is required' }, 400);
    text = text.slice(-2000); // the last few sentences are what matter; keeps cost bounded

    try {
      const result = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Transcript:\n"""${text}"""` },
        ],
        response_format: { type: 'json_schema', json_schema: SCHEMA },
        max_tokens: 300,
        temperature: 0,
      });
      const parsed = typeof result.response === 'string' ? JSON.parse(result.response) : result.response;
      const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
      return json({ matches });
    } catch (err) {
      console.error('identify failed', err);
      return json({ error: 'model call failed' }, 502);
    }
  },
};
