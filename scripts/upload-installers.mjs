// Uploads installers to the download page (Cloudflare R2 via the Worker), in 8 MB parts.
// Usage: node scripts/upload-installers.mjs <file> [<file> ...]
// Needs the admin key in cloud/.admin-token (or ADMIN_TOKEN) and aiUrl in config.json (or WORKER_URL).
import { readFileSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url);
const token = process.env.ADMIN_TOKEN || readFileSync(new URL('cloud/.admin-token', root), 'utf8').trim();
const base = (
  process.env.WORKER_URL || JSON.parse(readFileSync(new URL('config.json', root), 'utf8')).aiUrl
).replace(/\/$/, '');
const PART = 8 * 1024 * 1024; // R2 parts must be >= 5 MB (except the last); some networks cut larger requests
const version = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version;

async function call(pathname, params, init = {}) {
  const url = `${base}${pathname}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
      if (res.ok) return res.json();
      throw new Error(`${pathname} failed: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt === 5) throw err;
      await new Promise((r) => setTimeout(r, attempt * 2000)); // network hiccup: wait and retry
    }
  }
}

for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  const isMac = file.endsWith('.dmg');
  // Installers are named ScriptureListener-<version>-<mac|win>-<arch>...; keep that name on the site.
  const key = /^ScriptureListener-[\d.]+-(mac|win)-(arm64|x64)(-setup)?\.(dmg|exe)$/.test(path.basename(file))
    ? path.basename(file)
    : isMac
      ? `ScriptureListener-${version}-mac-${file.includes('x64') ? 'x64' : 'arm64'}.dmg`
      : `ScriptureListener-${version}-win-x64-setup.exe`;
  const type = isMac ? 'application/x-apple-diskimage' : 'application/vnd.microsoft.portable-executable';
  const size = statSync(file).size;
  const { uploadId } = await call('/upload/create', { key, type }, { method: 'POST' });
  const parts = [];
  const fd = openSync(file, 'r');
  try {
    for (let n = 1, offset = 0; offset < size; n += 1, offset += PART) {
      const buf = Buffer.alloc(Math.min(PART, size - offset));
      readSync(fd, buf, 0, buf.length, offset);
      parts.push(await call('/upload/part', { key, uploadId, part: n }, { method: 'PUT', body: buf }));
      process.stdout.write(`\r${path.basename(file)}: ${Math.round(((offset + buf.length) / size) * 100)}%   `);
    }
  } catch (err) {
    await call('/upload/abort', { key, uploadId }, { method: 'POST' }).catch(() => {});
    throw err;
  } finally {
    closeSync(fd);
  }
  const done = await call('/upload/complete', { key, uploadId }, { method: 'POST', body: JSON.stringify({ parts }) });
  console.log(`\n  -> ${base}/download/${done.key} (${Math.round(done.size / 1048576)} MB)`);
}
