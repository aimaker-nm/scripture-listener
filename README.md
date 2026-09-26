# Scripture Listener

Scripture Listener listens to the sermon and puts Bible verses on your **ProPresenter** screens
as the preacher mentions them: spoken references ("turn with me to John chapter three verse
sixteen"), verses quoted without a reference ("all things work together for good…"), and even
Bible stories retold in the preacher's own words. It understands any English accent.

## ⬇️ Download

**[Download Scripture Listener](https://scripture-listener-ai.holarwhaley2.workers.dev/)**

| Computer | File |
|---|---|
| **Mac** with Apple Silicon (M1 or newer), macOS 12+ | [ScriptureListener-1.1.0-mac-arm64.dmg](https://scripture-listener-ai.holarwhaley2.workers.dev/download/ScriptureListener-1.1.0-mac-arm64.dmg) |
| **Mac** with Intel processor (2015 or newer), macOS 12+ | [ScriptureListener-1.1.0-mac-x64.dmg](https://scripture-listener-ai.holarwhaley2.workers.dev/download/ScriptureListener-1.1.0-mac-x64.dmg) |
| **Windows** 10 or 11, 64-bit | [ScriptureListener-1.1.0-win-x64-setup.exe](https://scripture-listener-ai.holarwhaley2.workers.dev/download/ScriptureListener-1.1.0-win-x64-setup.exe) |

Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple Silicon,
"Processor: Intel" means Intel. Each installer is about 700–800 MB.

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
2. Open Scripture Listener. A **Set up ProPresenter** card appears:
   - click **Find ProPresenter** (it finds ProPresenter on this computer by itself), then
   - click **Create Scripture message**. It creates a Message named `Scripture` and picks
     suitable slides from your own themes. Nothing else in ProPresenter is changed.
3. Make sure the audience screen's **Look** includes the **Messages** layer.

That's it. If ProPresenter runs on **another computer**, enter its IP address and port under
Settings instead of using *Find*, then click **Create Scripture message**.

<details>
<summary>Creating the Message by hand instead</summary>

1. Note the **Port** shown in ProPresenter → Settings → Network, and enter it in Scripture Listener's Settings.
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

</details>

## First launch

1. After the setup above, the pill at the top says **ProPresenter: …** in green.
2. Open **Settings** at the bottom and choose your **Microphone** (the sound-desk input if you have one).
3. Click **🎤 Start listening**. The level meter beside it turns green when it hears speech, and
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

### Different styles on different screens (NDI)

A ProPresenter Message looks the same on every screen. For screens that need their own look,
the desktop app can also send the verse as **NDI video feeds** on your network, at the same moment
as the Message:

| Feed (NDI source name) | Looks like | Use it for |
|---|---|---|
| **Scripture - Lower Third** | verse in a band at the bottom, **transparent** background | livestream / recording: add it in OBS or vMix over the camera |
| **Scripture - Full Screen** | large centred verse on a solid background | side screens, overflow room, lobby TV |

Turn them on in **Settings → NDI video outputs**, where you can also set the full-screen
background colour, the highlight colour and the text size. Long passages shrink to fit automatically.

- **OBS:** install the free *DistroAV* (NDI) plugin, then *Sources → + → NDI Source* and pick
  "Scripture - Lower Third".
- **vMix:** *Add Input → NDI / Desktop Capture* and pick the feed.
- **Mac:** allow Scripture Listener to find devices on your local network when macOS asks,
  otherwise other computers can't see the feeds.

#### Two ProPresenter screens with different styles (e.g. LED wall + TV)

ProPresenter shows a Message the same way on every screen, but its **Looks** can choose which layers
each screen shows. Scripture Listener uses that to send the verse **both** ways at once:

- **Screen 1 (LED):** the ProPresenter **Message**, styled by the Message's theme.
- **Screen 2 (TV):** a ProPresenter **video input** carrying the *Scripture - Full Screen* (or
  *Lower Third*) NDI feed, styled in Scripture Listener. The feed is fully transparent while no
  verse is showing, so lyrics and everything else on the TV stay visible.

Setup (once):

1. In ProPresenter, add the TV as a second **audience screen** (Screens).
2. ProPresenter → Settings → **Inputs**: add the NDI source *Scripture - Full Screen*, then add that
   input to the Media Bin's **Video Inputs** playlist.
3. In Scripture Listener → Settings → NDI video outputs: choose that **ProPresenter video input**,
   then click **Create LED + TV Look**. It creates and activates the Look
   *Scripture Listener - LED + TV* (screen 1: Message on, video input off; screen 2: Message off,
   video input on; every other layer copied from your current Look).

On each Show, Scripture Listener restarts the video input if someone cleared it in ProPresenter.
If screen 1 also uses a live camera on the video input layer, that camera won't show on screen 1
in this Look.

NDI® is a registered trademark of Vizrt NDI AB.

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
- **"Find ProPresenter" finds nothing**: check ProPresenter is open with Network enabled. If it is
  on another computer, enter its IP address and port in Settings.
- **Transcript is slow on an Intel Mac**: use Settings → Speech engine → *Whisper in the cloud*.

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
2. Build the installers: push a tag (`git tag v1.2.0 && git push origin v1.2.0`) or GitHub →
   **Actions → Desktop installers → Run workflow**. On Windows, Apple Silicon and Intel Mac machines
   it builds Whisper from source and the search index, runs the tests, and produces
   `ScriptureListener-<version>-{mac-arm64,mac-x64}.dmg` and `…-win-x64-setup.exe` as run artifacts. The repository secrets `AI_URL` and `AI_TOKEN`
   preset the cloud features.
3. Download the artifacts (`gh run download <run-id>`), then upload them to the download page:
   ```bash
   node scripts/upload-installers.mjs path/to/*.dmg path/to/*.exe
   ```
   The page shows the newest upload for each platform automatically. Update the file names in
   the Download table above.

To build the Mac app locally, put a self-contained `whisper-server` in `build/whisper/darwin-arm64/`
(see the workflow) and run `npx electron-builder --mac` from a folder that isn't synced to iCloud.
To just update the app on this Mac (about 20 seconds, no installer or GitHub): `npm run install-local`.

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
| `ndiLowerThird` / `ndiFullScreen` | `false` | Send the NDI feeds (desktop app only) |
| `ndiFullScreenBg` / `ndiAccent` / `ndiTextScale` | `#0d1b33` / `#f5c451` / `1` | NDI feed background, highlight colour, text size |
| `ndiFullScreenBackdrop` | `solid` | `solid` or `transparent` background behind the full-screen verse |
| `ppVideoInput` | `''` | ProPresenter video input (uuid) carrying an NDI feed; re-triggered on Show |
| `aiUrl` / `aiToken` | — | Cloudflare Worker URL and key (never sent to the page) |

The desktop app can ship presets in `data/defaults.json`. The user's own settings still take priority.

### Bible text

KJV (public domain) and the Berean Standard Bible (dedicated to the public domain in 2023) are
bundled; see `scripts/convert-kjv.js` and `scripts/convert-bsb.js` for their sources. Other
translations come from [bible-api.com](https://bible-api.com). Copyrighted translations (NIV,
NKJV, ESV…) are not included for licensing reasons.
