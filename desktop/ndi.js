// NDI video outputs: each feed is public/ndi.html drawn off-screen at 1920x1080 and sent as an
// NDI source that OBS, vMix, ProPresenter or NDI hardware can pick up on the local network.
// Alpha is kept, so the lower third can sit straight over a camera shot.
import { BrowserWindow } from 'electron';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const KEEPALIVE_MS = 500; // repaint at least this often when nothing changes, so receivers stay locked on

export const FEEDS = [
  { id: 'lowerThird', name: 'Scripture - Lower Third', setting: 'ndiLowerThird' },
  { id: 'fullScreen', name: 'Scripture - Full Screen', setting: 'ndiFullScreen' },
];

let ndi = null; // the grandiose module, loaded on first use
let loadError = null;
const running = new Map(); // feed id -> { sender, win, timer, lastFrame, url }

async function loadNdi() {
  if (ndi || loadError) return ndi;
  try {
    const mod = await import('@stagetimerio/grandiose');
    ndi = mod.default || mod;
    if (!ndi.isSupportedCPU()) throw new Error('this processor is not supported by NDI');
  } catch (err) {
    loadError = err;
    ndi = null;
    console.error(`NDI unavailable: ${err.message}`);
  }
  return ndi;
}

function feedUrl(appUrl, feed, config) {
  const params = new URLSearchParams({ style: feed.id, scale: String(config.ndiTextScale || 1) });
  params.set('bg', config.ndiFullScreenBackdrop === 'transparent' ? 'transparent' : config.ndiFullScreenBg || '#0d1b33');
  if (config.ndiAccent) params.set('accent', config.ndiAccent);
  return `${appUrl}/ndi.html?${params}`;
}

async function startFeed(appUrl, feed, config) {
  const sender = await ndi.send({ name: feed.name, clockVideo: false, clockAudio: false });
  const win = new BrowserWindow({
    show: false,
    width: WIDTH,
    height: HEIGHT,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(FPS);
  const state = { sender, win, lastFrame: null, url: feedUrl(appUrl, feed, config), timer: null, frames: 0, error: null };

  const sendFrame = (bitmap, size) => {
    state.lastFrame = { bitmap, size };
    state.frames += 1;
    sender
      .video({
        xres: size.width,
        yres: size.height,
        frameRateN: FPS,
        frameRateD: 1,
        fourCC: ndi.FOURCC_BGRA,
        pictureAspectRatio: size.width / size.height,
        frameFormatType: ndi.FORMAT_TYPE_PROGRESSIVE,
        lineStrideBytes: size.width * 4,
        data: bitmap,
      })
      .catch((err) => {
        state.error = err.message;
      });
  };

  // Electron gives BGRA pixels on Mac and Windows, which is what NDI's BGRA format expects.
  win.webContents.on('paint', (_event, _dirty, image) => sendFrame(image.toBitmap(), image.getSize()));
  // Keep receivers locked on, and make sure the frame they hold is current: Chromium skips
  // repainting when nothing visibly changes (e.g. right after a fade-out), so force a fresh
  // paint instead of repeating a stale frame.
  state.timer = setInterval(() => {
    if (!win.isDestroyed()) win.webContents.invalidate();
  }, KEEPALIVE_MS);
  await win.loadURL(state.url);
  running.set(feed.id, state);
  console.log(`NDI output started: ${feed.name}`);
}

function stopFeed(id) {
  const state = running.get(id);
  if (!state) return;
  clearInterval(state.timer);
  if (!state.win.isDestroyed()) state.win.destroy();
  state.sender.destroy?.();
  running.delete(id);
}

/** Starts/stops/restyles feeds to match the settings. Safe to call whenever settings change. */
export async function syncNdi(appUrl, config) {
  const wanted = FEEDS.filter((f) => config[f.setting]);
  if (wanted.length && !(await loadNdi())) return status();
  for (const feed of FEEDS) {
    const state = running.get(feed.id);
    if (!config[feed.setting]) {
      stopFeed(feed.id);
    } else if (!state) {
      await startFeed(appUrl, feed, config).catch((err) => console.error(`NDI ${feed.name}: ${err.message}`));
    } else if (state.url !== feedUrl(appUrl, feed, config)) {
      state.url = feedUrl(appUrl, feed, config); // look changed: reload the page
      state.win.loadURL(state.url);
    }
  }
  return status();
}

export function status() {
  return {
    available: !loadError,
    error: loadError?.message,
    outputs: FEEDS.map((f) => ({
      name: f.name,
      setting: f.setting,
      active: running.has(f.id),
      frames: running.get(f.id)?.frames ?? 0,
      error: running.get(f.id)?.error ?? null,
    })),
  };
}

export function stopAllNdi() {
  for (const id of [...running.keys()]) stopFeed(id);
}
