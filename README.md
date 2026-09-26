# Scripture Listener for ProPresenter

Listens to the preacher, picks out Bible references as they are spoken
("turn with me to John chapter three verse sixteen") **and verses they quote or
paraphrase without a reference** ("all things work together for good…"), looks up
the verse, and shows it on the audience screens through ProPresenter.

```
 microphone ─► Whisper speech-to-text ─► reference / quote / story detection ─► verse ─► ProPresenter ─► screens
               (on this Mac, any accent)
```

### Speech recognition

By default the app uses **Whisper** (OpenAI's large-v3-turbo model via whisper.cpp) running on
this Mac. It copes with accents far better than Chrome's built-in recognition (Nigerian, Ghanaian,
Kenyan, South African, Indian, British… English), works offline, and costs nothing. On an Apple
Silicon Mac each phrase is transcribed in under a second after the speaker pauses.

Misheard book names are also corrected when followed by numbers ("Habakook 2 3", "Tesalonians",
"Filipians", "Malakai" → the right book), while everyday words ("number 3", "house 3 4") are left alone.

Tips: pick the sound-desk feed under **Settings → Microphone** if you have one (much cleaner than a
room mic), and watch the level meter next to *Start listening* — it turns green while it hears speech.
Chrome's built-in engine is still available under **Settings → Speech engine**.

## What it understands

| Spoken / transcribed                         | Shows                    |
|----------------------------------------------|--------------------------|
| "John chapter three verse sixteen"           | John 3:16                |
| "First Corinthians thirteen four to seven"   | 1 Corinthians 13:4-7     |
| "Second Timothy 3 verses 16 and 17"          | 2 Timothy 3:16-17        |
| "Psalm one hundred and nineteen verse 105"   | Psalms 119:105           |
| "Psalm twenty three"                         | Psalms 23                |
| "Revelation chapter 21"                      | Revelation 21            |
| "John 316" (speech engine glued the numbers) | John 3:16                |
| "…and verse seventeen" / "next verse"        | follows the last verse   |

Ordinary speech like "John and Mark went…" or "I'll mark 3 things" is ignored:
a book name must be followed by chapter **and** verse, or by the word "chapter".

### Quotes and paraphrases (no reference said)

When the preacher quotes a verse without naming it, the app suggests it in the
Detected list with a yellow **quote** badge, e.g.

- "remember that all things work together for good for those who love God" → Romans 8:28
- "love is patient, love is kind" (modern wording) → 1 Corinthians 13:4
- "the joy of the Lord is your strength" (a line from a long verse) → Nehemiah 8:10

Quotes are always suggestions: they never go on screen without a click, even with Auto-send on.
Common church phrases ("in the name of the Lord Jesus Christ", "let us bow our heads and pray")
are ignored.

### Retold Bible stories (AI)

When the preacher tells a Bible story in their own words, without names or a reference, the app
asks an AI model which passage it is and suggests it with a blue **story** badge, e.g.

- "God sent his prophet to tell the man he was going to die… then sent him back to say he would
  not die" → 2 Kings 20:1-6 (Hezekiah's illness and recovery)
- "the little boy killed the giant with a stone and a sling" → 1 Samuel 17:48-51
- "the woman who had been bleeding for twelve years touched the hem of his garment" → Matthew 9:20-22

It checks the last ~80 words every few seconds while listening, and updates its guess as more of
the story is told. Like quotes, stories never go on screen without a click. It needs internet;
everything else keeps working without it. Turn it off in Settings.

This uses a small Cloudflare Worker (`cloud/`) running Llama 3.3 70B on Workers AI, within
Cloudflare's free daily allowance for normal use. To set it up in your own Cloudflare account:

```bash
cd cloud
npx wrangler deploy                 # prints the Worker URL
npx wrangler secret put APP_TOKEN   # paste a long random password
```

Then add to `config.json`: `"aiUrl": "<Worker URL>"` and `"aiToken": "<that password>"`, and restart.

### Search by words

Type words from a verse in the box under **On screen now** (e.g. `love is patient`) and press
Enter to get the closest verses. Typing a reference (`Romans 8:28-30`) shows it directly.

Search runs on this computer with a small AI model (no internet or account needed). It matches
by meaning across the KJV and the modern-English Berean Standard Bible, so KJV and NIV-style
wording both work.

## Requirements

- **ProPresenter 7.9 or newer** (it has the network API).
- **Node.js 18+** on the computer that runs this app.
- **Google Chrome or Microsoft Edge** (their built-in speech recognition is used; it needs internet).
- A microphone or an audio feed from the sound desk into the computer.

## 1. Set up ProPresenter (one time)

1. **Enable the API:** ProPresenter → Settings → **Network** → tick **Enable Network**.
   Note the **IP address** and **Port** shown there.
2. **Create the Message that displays the verse:**
   - Open the **Messages** panel (Show → Messages) and click **+** to create a message.
   - Name it exactly `Scripture`.
   - In the message text, type two text tokens, for example:
     ```
     {Reference}
     {Verse}
     ```
     ProPresenter turns `{Verse}` and `{Reference}` into text tokens.
   - Pick a theme slide with a **single text box**, e.g. Black Box → **Four Lines**.
     Avoid the built-in *Scripture* slides: their separate "Reference" box can't be filled
     by a Message, so it shows the placeholder word "Reference".
     Make the text box big enough and turn on text auto-shrink so long passages fit.
3. Make sure your audience screen's **Look** shows the **Messages** layer.

You can use different names — just enter them in the app's Settings.

## 2. Install and run the app

First time only:

```bash
cd scripture-listener
npm install
npm run build-index   # prepares verse search: downloads a ~35 MB model, then ~4 minutes
npm run setup-whisper # speech recognition for any accent: installs whisper.cpp + ~550 MB model
npm run make-app      # optional: puts "Scripture Listener" in ~/Applications
```

**Scripture Listener** opens in its own app window (no browser tabs or address bar) with its own
Dock icon. Then either double-click **Scripture Listener** (in your user's Applications folder; drag it
to the Dock), or run `npm start`. The app starts the server and opens the control page in
Chrome; quit it from the Dock to stop everything. On first launch macOS may ask to let it
access the folder the project is in — click **Allow**.

Open **http://localhost:4000** in Chrome **on the same computer** (Chrome only
allows the microphone on `localhost` or HTTPS pages).

1. Open **Settings**, enter ProPresenter's IP and port, click **Save**, then **Test connection**.
   It tells you if the `Scripture` message or its tokens are missing.
2. Click **Start listening** and allow the microphone.
3. As references are spoken they appear under **Detected references** with a preview.
   Click **Show** to put one on screen.
   - Turn on **Auto-send** to put verses on screen immediately with no operator.
4. **Full screen / Lower third** (top bar) switches how verses look; a verse already on screen
   changes immediately. Choose which ProPresenter theme slide each style uses in **Settings**
   (defaults: Black Box → Four Lines, and Black → Lower 3rd Lyrics).
5. **Prev / Next verse** (or ← / → keys) steps through the passage; **Clear screen** (or Esc) hides it.
6. Type a reference in the box (e.g. `Romans 8:28-30`) to show something manually.

ProPresenter can be on a different computer — just enter its IP address.

### Other outputs

- **Stage display:** tick "Also send to stage display" to show the verse to the preacher/band too.
- **Web display:** `http://localhost:4000/display` is a transparent lower-third page that
  follows whatever is shown. Use it as a Browser Source in OBS/vMix, or as Web content in ProPresenter.
  To view it from another computer, start the app with `HOST=0.0.0.0 npm start`.

## Bible translations

KJV and BSB (Berean Standard Bible, a modern translation released to the public domain in 2023)
are stored in `data/` and work offline. WEB, ASV, BBE, Darby and YLT come from
[bible-api.com](https://bible-api.com) and need internet. Copyrighted translations (NIV, NKJV, ESV…)
are not available through it for licensing reasons.

## Settings

Settings are saved to `config.json` in this folder (ignored by git).

| Setting          | Default     | Meaning                                              |
|------------------|-------------|------------------------------------------------------|
| `ppHost`         | `127.0.0.1` | ProPresenter computer's IP                           |
| `ppPort`         | `50001`     | ProPresenter Network port                            |
| `messageName`    | `Scripture` | ProPresenter Message to trigger                      |
| `referenceToken` | `Reference` | Token that receives "John 3:16 (KJV)"                |
| `textToken`      | `Verse`     | Token that receives the verse text                   |
| `sendToMessage`  | `true`      | Show on the audience screen                          |
| `sendToStage`    | `false`     | Also send to the stage display message               |
| `translation`    | `kjv`       | Bible translation (`kjv`, `bsb`, `web`, …)           |
| `language`       | `en-US`     | Speech recognition accent (en-GB, en-NG, en-GH, …)   |
| `autoSend`       | `false`     | Show detected verses without clicking                |
| `speechEngine`   | `whisper`   | `whisper` (this Mac) or `browser` (Chrome built-in)  |
| `micId`          | `''`        | Microphone device (`''` = system default)            |
| `storyDetection` | `true`      | Suggest retold Bible stories (needs `aiUrl`/`aiToken`) |
| `aiUrl`          | —           | URL of the story-detection Worker                    |
| `aiToken`        | —           | Worker password (config.json only, never shown in the page) |
| `displayStyle`   | `fullScreen`| `fullScreen` or `lowerThird`                         |
| `fullScreenSlide`| Four Lines  | Theme slide uuid used for full screen                |
| `lowerThirdSlide`| Lower 3rd Lyrics | Theme slide uuid used for lower third           |

## Troubleshooting

- **"ProPresenter: not connected"** – check Network is enabled, the IP/port match, and a firewall isn't blocking the port.
- **Verse doesn't appear on screen** – make sure the Message is named exactly as in Settings,
  its tokens are `{Verse}` and `{Reference}`, and the audience Look includes the Messages layer.
- **References not detected** – check the Transcript panel to see what the speech engine heard,
  try the closest speech language/accent, and use a clean feed from the sound desk rather than a room mic.
- **Start listening is greyed out** – use Chrome or Edge.
- **"Whisper is not ready"** – run `npm run setup-whisper`, then restart the app. Whisper takes a few
  seconds to load after the app starts.
- **Level meter never moves** – choose the right input under Settings → Microphone, and check
  System Settings → Privacy & Security → Microphone allows Chrome.

## Tests

```bash
npm test
```
