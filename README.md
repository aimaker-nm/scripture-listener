# Scripture Listener for ProPresenter

Listens to the preacher, picks out Bible references as they are spoken
("turn with me to John chapter three verse sixteen"), looks up the verse, and
shows it on the audience screens through ProPresenter.

```
 microphone ─► Chrome speech-to-text ─► reference detector ─► verse lookup ─► ProPresenter API ─► screens
                    (control page)          (parser.js)        (bible-api.com)   (Message layer)
```

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
     {Verse}
     {Reference}
     ```
     ProPresenter turns `{Verse}` and `{Reference}` into text tokens.
   - Pick a theme/slide for it (lower third or full screen, your choice).
     Make the text box big enough and turn on text auto-shrink so long passages fit.
3. Make sure your audience screen's **Look** shows the **Messages** layer.

You can use different names — just enter them in the app's Settings.

## 2. Run the app

```bash
cd scripture-listener
npm start
```

Open **http://localhost:4000** in Chrome **on the same computer** (Chrome only
allows the microphone on `localhost` or HTTPS pages).

1. Open **Settings**, enter ProPresenter's IP and port, click **Save**, then **Test connection**.
   It tells you if the `Scripture` message or its tokens are missing.
2. Click **Start listening** and allow the microphone.
3. As references are spoken they appear under **Detected references** with a preview.
   Click **Show** to put one on screen.
   - Turn on **Auto-send** to put verses on screen immediately with no operator.
4. **Prev / Next verse** (or ← / → keys) steps through the passage; **Clear screen** (or Esc) hides it.
5. Type a reference in the box (e.g. `Romans 8:28-30`) to show something manually.

ProPresenter can be on a different computer — just enter its IP address.

### Other outputs

- **Stage display:** tick "Also send to stage display" to show the verse to the preacher/band too.
- **Web display:** `http://localhost:4000/display` is a transparent lower-third page that
  follows whatever is shown. Use it as a Browser Source in OBS/vMix, or as Web content in ProPresenter.
  To view it from another computer, start the app with `HOST=0.0.0.0 npm start`.

## Bible translations

Verse text comes from [bible-api.com](https://bible-api.com), which serves public-domain
translations: KJV, WEB, ASV, BBE, Darby and YLT. Copyrighted translations (NIV, NKJV, ESV…)
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
| `translation`    | `kjv`       | Bible translation                                    |
| `language`       | `en-US`     | Speech recognition accent (en-GB, en-NG, en-GH, …)   |
| `autoSend`       | `false`     | Show detected verses without clicking                |

## Troubleshooting

- **"ProPresenter: not connected"** – check Network is enabled, the IP/port match, and a firewall isn't blocking the port.
- **Verse doesn't appear on screen** – make sure the Message is named exactly as in Settings,
  its tokens are `{Verse}` and `{Reference}`, and the audience Look includes the Messages layer.
- **References not detected** – check the Transcript panel to see what the speech engine heard,
  try the closest speech language/accent, and use a clean feed from the sound desk rather than a room mic.
- **Start listening is greyed out** – use Chrome or Edge.

## Tests

```bash
npm test
```
