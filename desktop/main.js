// Scripture Listener desktop app (Mac and Windows). Runs the local server inside the app,
// shows the control page in its own window, and stops everything (including Whisper) on quit.
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || '4000';
const APP_URL = `http://localhost:${PORT}`;

if (!app.requestSingleInstanceLock()) app.quit();

// Packaged: data and the Whisper program sit next to the app code (resources/).
// From source (npm run desktop): use the project's own data/ and Homebrew's Whisper.
const resources = app.isPackaged ? process.resourcesPath : path.join(here, '..');
process.env.SCRIPTURE_CONFIG_DIR = app.getPath('userData');
process.env.SCRIPTURE_DATA_DIR = path.join(resources, 'data');
if (app.isPackaged) {
  const exe = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
  process.env.SCRIPTURE_WHISPER_BIN = path.join(resources, 'whisper', exe);
}

let server = null;
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    title: 'Scripture Listener',
    backgroundColor: '#111418',
    icon: path.join(here, '..', 'public', 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
  });
  win.loadURL(APP_URL);
  // Our own pages (e.g. /display) open in app windows; anything else in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    win = null;
  });
}

app.on('second-instance', () => {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  return win.focus();
});

app.whenReady().then(async () => {
  // The control page needs the microphone; nothing else is granted.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  try {
    server = await import('../server.js');
    await server.ready;
  } catch (err) {
    dialog.showErrorBox(
      'Scripture Listener could not start',
      err.code === 'EADDRINUSE'
        ? `Port ${PORT} is already in use. Close any other copy of Scripture Listener and try again.`
        : String(err.stack || err),
    );
    app.exit(1);
    return;
  }
  createWindow();
  // Mac: clicking the Dock icon with no window open brings the window back.
  app.on('activate', () => !win && createWindow());
});

// Closing the window quits the app (on Mac too): the service is over.
app.on('window-all-closed', () => app.quit());

let stopping = false;
app.on('before-quit', (event) => {
  if (stopping || !server) return;
  stopping = true;
  event.preventDefault();
  server.shutdown().finally(() => app.quit());
});
