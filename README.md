# Scripture Listener

Scripture Listener listens to the sermon and puts Bible verses on your **ProPresenter** screens
as the preacher mentions them: spoken references ("turn with me to John chapter three verse
sixteen"), verses quoted without a reference ("all things work together for good…"), and even
Bible stories retold in the preacher's own words. It understands any English accent.

## ⬇️ Download

**[Download Scripture Listener](https://scripture-listener-ai.holarwhaley2.workers.dev/)**

| Computer | File | Size |
|---|---|---|
| **Mac** with Apple Silicon (M1 or newer), macOS 12+ | [ScriptureListener-1.0.0-mac-arm64.dmg](https://scripture-listener-ai.holarwhaley2.workers.dev/download/ScriptureListener-1.0.0-mac-arm64.dmg) | 752 MB |
| **Windows** 10 or 11, 64-bit | [ScriptureListener-1.0.0-win-x64-setup.exe](https://scripture-listener-ai.holarwhaley2.workers.dev/download/ScriptureListener-1.0.0-win-x64-setup.exe) | 707 MB |

The download page always has the newest version. Everything is included: the Bibles, verse search,
and the speech recognition model. There is nothing else to install.

You also need **ProPresenter 7.9 or newer** (on the same computer or the same network) and a
microphone, ideally a feed from the sound desk.

## Install

### Mac

1. Open the downloaded `.dmg` and drag **Scripture Listener** into **Applications**.
2. The first time only: in Applications, **right-click** Scripture Listener → **Open** → **Open**.
   (macOS shows a warning because the app isn't signed with a paid Apple developer certificate.
   If there is no *Open* button, go to System Settings → Privacy & Security and click **Open Anyway**.)
3. Allow the **microphone** when asked.

### Windows

1. Run the downloaded `setup.exe`.
2. If **"Windows protected your PC"** appears, click **More info** → **Run anyway**
   (the installer isn't signed with a paid Microsoft certificate yet).
3. Follow the installer. It adds a desktop shortcut.
4. Allow the **microphone** if Windows asks.

## Set up ProPresenter (one time)

1. **Turn on the network API:** ProPresenter → Settings → **Network** → tick **Enable Network**.
   Note the **Port** number shown there (and the IP address, if ProPresenter is on another computer).
2. **Create the Message that shows the verse:**
   - Open the **Messages** panel (Show → Messages) and click **+**.
   - Name it exactly `Scripture`.
   - As the message text, type:
     ```
     {Reference}
     {Verse}
     ```
     ProPresenter turns `{Reference}` and `{Verse}` into fields the app fills in.
   - Pick a theme slide with **one text box**, e.g. *Black Box → Four Lines*. Avoid ProPresenter's
     built-in *Scripture* slides: their second "Reference" box can't be filled by a Message and
     shows the word "Reference". Turn on text shrink-to-fit so long passages fit.
3. Make sure the audience screen's **Look** includes the **Messages** layer.

## First launch

1. Open **Scripture Listener** and click **Settings** at the bottom.
2. Enter ProPresenter's **port** (and IP address if it's on another computer), click **Save**,
   then **Test connection**. The pill at the top turns green, and it warns you if the `Scripture`
   message or its fields are missing.
3. Choose your **Microphone** (the sound-desk input if you have one).
4. Click **🎤 Start listening**. The level meter beside it turns green when it hears speech, and
   the words appear in the **Transcript** panel.

## Using it during a service

- **Detected references:** everything the app picks up appears on the right with a preview.
  Click **Show** to put it on screen, or **Dismiss**.
  - No badge: the preacher said the reference.
  - Yellow **quote** badge: they quoted or paraphrased a verse without naming it.
  - Blue **story** badge: they retold a Bible story (identified by AI).
- **Auto-send:** puts spoken references on screen immediately, with no click. Quotes and stories
  always wait for a click, because they are suggestions.
- **Prev / Next verse** (or ← / → keys) steps through the passage. **Clear screen** (or Esc) hides it.
- **Full screen / Lower third** (top bar) switches the look, even while a verse is showing.
  Choose which ProPresenter slide each style uses in Settings.
- **Search box:** type a reference (`Romans 8:28-30`) or words from a verse (`love is patient`)
  and press Enter.
- **Translation:** KJV or BSB (a modern translation) work offline. WEB, ASV, BBE, Darby and YLT need internet.
- **Stage display:** tick *Also send to stage display* in Settings to show the verse to the preacher and band too.

### What it understands

| The preacher says | Shows |
|---|---|
| "John chapter three verse sixteen" | John 3:16 |
| "First Corinthians thirteen four to seven" | 1 Corinthians 13:4-7 |
| "Psalm one hundred and nineteen verse 105" | Psalms 119:105 |
| "Revelation chapter 21" | Revelation 21 |
| "…and verse seventeen" / "next verse" | continues from the last verse |
| "remember, all things work together for good for those who love God" | Romans 8:28 (quote) |
| "love is patient, love is kind" | 1 Corinthians 13:4 (quote, modern wording) |
| "God sent his prophet to tell the man he would die… then sent him back to say he would live" | 2 Kings 20:1-6 (story) |

Everyday talk ("John and Mark went…", "number 3", "let us bow our heads and pray") is ignored.
Misheard book names followed by numbers are corrected ("Habakook 2 3" → Habakkuk 2:3).

## Speech recognition

Scripture Listener uses **Whisper**, OpenAI's speech recognition model. It handles accents far
better than a browser (Nigerian, Ghanaian, Kenyan, South African, Indian, British… English).
Choose the engine in **Settings → Speech engine**:

- **Whisper on this computer** (default): free, works offline. Fast on Apple Silicon Macs and
  on Windows PCs with a modern processor.
- **Whisper in the cloud**: the same accuracy for slower computers. Needs internet.

Tip: a clean feed from the sound desk makes the biggest difference to accuracy.

## Internet and privacy

- **Works offline:** speech recognition (on this computer), spoken references, quotes, verse
  search, and KJV/BSB text.
- **Uses the internet:** story detection (the last ~80 words of transcript are sent to a
  Cloudflare Worker), cloud speech (audio is sent when that engine is chosen), and the online
  translations. Nothing is stored in the cloud.

## Troubleshooting

- **"ProPresenter: not connected"**: check Network is enabled in ProPresenter, the port in Settings
  matches, and a firewall isn't blocking it.
- **Verse doesn't appear on screen**: the Message must be named exactly `Scripture`, contain
  `{Reference}` and `{Verse}`, and the audience Look must include the Messages layer.
- **Word "Reference" shows on screen**: the Message uses a slide with a second text box. Pick a
  single-text-box slide (see *Set up ProPresenter*).
- **Level meter never moves**: pick the right input under Settings → Microphone. On Mac, check
  System Settings → Privacy & Security → Microphone allows Scripture Listener.
- **Transcript is slow on Windows**: switch Settings → Speech engine to *Whisper in the cloud*.
- **References not detected**: look at the Transcript panel to see what was heard. Better audio
  (a sound-desk feed) fixes most problems.
- **"Port 4000 is already in use"**: another copy of Scripture Listener is running. Close it first.

---

## For developers

```
 microphone ─► Whisper ─► reference / quote / story detection ─► verse lookup ─► ProPresenter API ─► screens
```

| Path | What it is |
|---|---|
| `server.js` | Local HTTP server: control page, ProPresenter API, verse lookup, Whisper process, cloud calls |
| `public/` | Control page (`app.js`), reference parser (`parser.js`), mic capture (`whisper-capture.js`) |
| `lib/search.js` | Local verse search by meaning (bge-small embeddings) and quote detection |
| `data/` | KJV and BSB text (`kjv.json`, `bsb.json`); generated indexes and models are git-ignored |
| `desktop/main.js` | Electron app (Mac and Windows) |
| `cloud/` | Cloudflare Worker: story detection, cloud speech, download page |
| `mac/` | Older macOS launcher for running from source (`npm run make-app`) |
| `.github/workflows/desktop.yml` | Builds the installers |

### Run from source

Needs Node.js 20+ (and on Mac, Homebrew for Whisper).

```bash
npm install
npm run build-index     # verse search index (~35 MB model download, a few minutes)
npm run setup-whisper   # Mac: whisper.cpp + large-v3-turbo model (~550 MB)
npm run desktop         # the desktop app, or: npm start  (then open http://localhost:4000 in Chrome)
npm test
```

When run from source, settings are saved in `config.json` in the project folder. In the desktop
app they are saved in the user's app-data folder (Mac: `~/Library/Application Support/Scripture Listener/`,
Windows: `%APPDATA%\Scripture Listener\`).

### Cloudflare Worker (`cloud/`)

It provides `POST /identify` (story detection, Llama 3.3 70B), `POST /transcribe` (Whisper large-v3-turbo),
the public download page `GET /`, and `/download/<file>` from the R2 bucket `scripture-listener-downloads`.

```bash
cd cloud
npx wrangler r2 bucket create scripture-listener-downloads
npx wrangler deploy
npx wrangler secret put APP_TOKEN     # key used by the app (/identify, /transcribe)
npx wrangler secret put ADMIN_TOKEN   # a different key, only for uploading installers
```

Put the Worker URL and `APP_TOKEN` in `config.json` as `aiUrl` and `aiToken`. Keep `ADMIN_TOKEN`
in `cloud/.admin-token` (git-ignored).

### Releasing a new version

1. Bump `version` in `package.json`, then commit and push.
2. Build the installers: GitHub → **Actions → Desktop installers → Run workflow** (or push a `v*`
   tag). It builds Whisper from source, the search index, runs the tests, and produces the Mac
   `.dmg` and Windows `setup.exe` as run artifacts. The repository secrets `AI_URL` and `AI_TOKEN`
   preset the cloud features.
3. Download the artifacts (`gh run download <run-id>`), then upload them to the download page:
   ```bash
   node scripts/upload-installers.mjs path/to/*.dmg path/to/*.exe
   ```
   The page shows the newest upload for each platform automatically. Update the file names in
   the Download table above.

To build the Mac app locally, put a self-contained `whisper-server` in `build/whisper/darwin-arm64/`
(see the workflow) and run `npx electron-builder --mac` from a folder that isn't synced to iCloud.

### Settings (`config.json`)

| Setting | Default | Meaning |
|---|---|---|
| `ppHost` | `127.0.0.1` | ProPresenter computer's IP |
| `ppPort` | `50001` | ProPresenter Network port |
| `messageName` | `Scripture` | ProPresenter Message to trigger |
| `referenceToken` / `textToken` | `Reference` / `Verse` | Message fields for the reference and verse text |
| `sendToMessage` / `sendToStage` | `true` / `false` | Audience screen / stage display |
| `translation` | `kjv` | `kjv`, `bsb` (offline) or `web`, `asv`, `bbe`, `darby`, `ylt` (online) |
| `autoSend` | `false` | Show spoken references without clicking |
| `speechEngine` | `whisper` | `whisper` (this computer), `cloud`, or `browser` (Chrome; source only) |
| `micId` | `''` | Microphone device (`''` = system default) |
| `language` | `en-US` | Accent for the Chrome engine only |
| `displayStyle` | `fullScreen` | `fullScreen` or `lowerThird` |
| `fullScreenSlide` / `lowerThirdSlide` | Four Lines / Lower 3rd Lyrics | ProPresenter theme slide uuids |
| `storyDetection` | `true` | Suggest retold Bible stories |
| `aiUrl` / `aiToken` | — | Cloudflare Worker URL and key (never sent to the page) |

The desktop app can ship presets in `data/defaults.json`. The user's own settings still take priority.

### Bible text

KJV (public domain) and the Berean Standard Bible (dedicated to the public domain in 2023) are
bundled; see `scripts/convert-kjv.js` and `scripts/convert-bsb.js` for their sources. Other
translations come from [bible-api.com](https://bible-api.com). Copyrighted translations (NIV,
NKJV, ESV…) are not included for licensing reasons.
