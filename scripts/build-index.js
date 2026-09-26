// Builds data/<translation>-index.bin (the verse-meaning indexes used by search).
// Takes a few minutes once; the AI model (~35 MB) is downloaded on first run.
import { buildIndex, LOCAL_TRANSLATIONS } from '../lib/search.js';

for (const translation of LOCAL_TRANSLATIONS) {
  const start = Date.now();
  let last = 0;
  await buildIndex(translation, (done, total) => {
    if (done - last >= 2000 || done === total) {
      last = done;
      process.stdout.write(`\r  ${translation.toUpperCase()}: ${done} / ${total} verses (${Math.round((Date.now() - start) / 1000)}s)`);
    }
  });
  console.log();
}
console.log('Search index built.');
