// Local Bible text and verse search by meaning, run entirely on this computer.
// Each verse of the KJV and the BSB (a modern public-domain translation, so NIV-style
// wording also matches) is turned into a 384-number "meaning" vector by a small AI model
// (bge-small, ~35 MB, downloaded once). A query is embedded the same way and compared
// against every verse. Vectors are stored as int8 in data/ so startup is instant.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pipeline, env } from '@huggingface/transformers';
import { BOOKS } from '../public/books.js';

const DATA = new URL('../data/', import.meta.url);
const MODEL = 'Xenova/bge-small-en-v1.5';
const DIMS = 384;
export const LOCAL_TRANSLATIONS = ['kjv', 'bsb'];

env.cacheDir = new URL('models/', DATA).pathname;

const bibles = {}; // translation -> [{ book, chapter, verse, text, reference }]
const indexes = {}; // translation -> Int8Array(verses * DIMS)
const byReference = {}; // translation -> Map("John 3:16" -> verse)
let embedder = null;

export function loadBible(translation) {
  if (!bibles[translation]) {
    const rows = JSON.parse(readFileSync(new URL(`${translation}.json`, DATA), 'utf8'));
    bibles[translation] = rows.map(([book, chapter, verse, text]) => ({
      book, chapter, verse, text, reference: `${book} ${chapter}:${verse}`,
    }));
    byReference[translation] = new Map(bibles[translation].map((v) => [v.reference, v]));
  }
  return bibles[translation];
}

// ---------- verse lookup ----------

const BOOK_NAMES = new Set(BOOKS.map((b) => b.name));

/** Look up "John 3:16", "John 3:16-18" or "Psalms 23" in a local translation; null if unparseable. */
export function lookup(reference, translation) {
  const m = /^(.+?) (\d+)(?::(\d+)(?:-(\d+))?)?$/.exec(reference.trim());
  if (!m || !BOOK_NAMES.has(m[1]) || !LOCAL_TRANSLATIONS.includes(translation)) return null;
  loadBible(translation);
  const [, book, ch] = m;
  const map = byReference[translation];
  const verses = [];
  if (m[3]) {
    const end = Number(m[4] || m[3]);
    for (let v = Number(m[3]); v <= end; v += 1) {
      const found = map.get(`${book} ${ch}:${v}`);
      if (found) verses.push(found);
    }
  } else {
    for (let v = 1; map.has(`${book} ${ch}:${v}`); v += 1) verses.push(map.get(`${book} ${ch}:${v}`));
  }
  const withText = verses.filter((v) => v.text);
  if (!withText.length) return null;
  return {
    reference,
    translation: translation.toUpperCase(),
    verses: withText.map((v) => ({ verse: v.verse, text: v.text })),
    text: withText.length > 1 ? withText.map((v) => `${v.verse} ${v.text}`).join(' ') : withText[0].text,
  };
}

// ---------- embeddings ----------

async function embed(texts) {
  embedder ||= await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  return (await embedder(texts, { pooling: 'cls', normalize: true })).tolist();
}

const quantize = (vec, into, offset) => {
  for (let i = 0; i < DIMS; i += 1) into[offset + i] = Math.max(-127, Math.min(127, Math.round(vec[i] * 127)));
};

const indexFile = (translation) => new URL(`${translation}-index.bin`, DATA);
export const indexExists = () => LOCAL_TRANSLATIONS.every((t) => existsSync(indexFile(t)));

export async function buildIndex(translation, onProgress = () => {}) {
  const all = loadBible(translation);
  const out = new Int8Array(all.length * DIMS);
  const BATCH = 64;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    // Empty verses (omitted in modern translations) get a zero vector and never match.
    const texts = batch.map((v) => v.text || '.');
    const embedded = await embed(texts);
    embedded.forEach((vec, j) => batch[j].text && quantize(vec, out, (i + j) * DIMS));
    onProgress(Math.min(i + BATCH, all.length), all.length);
  }
  writeFileSync(indexFile(translation), out);
  indexes[translation] = out;
}

function loadIndex(translation) {
  if (!indexes[translation]) {
    const buf = readFileSync(indexFile(translation));
    const vectors = new Int8Array(buf.buffer, buf.byteOffset, buf.length);
    if (vectors.length !== loadBible(translation).length * DIMS) {
      throw new Error(`Search index for ${translation} is out of date; run npm run build-index`);
    }
    indexes[translation] = vectors;
  }
  return indexes[translation];
}

// ---------- word overlap ----------

// Common words that say nothing about which verse was meant.
const STOP = new Set(`a an and are as at be but by for from he her him his i if in into is it its me my
  of on or our shall she so that the thee their them then there they this thou thy to unto up us was we
  were what when which who will with ye you your yours hath have has had do did not no all out am`.split(/\s+/));

const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Rough stem so KJV "believeth"/"loved" meet modern "believes"/"love".
const stem = (w) => w.replace(/(eth|est|ing|ed|es|s)$/, '') || w;
const contentStems = (s) => words(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem);

/**
 * How much the query and verse share words (0..1): the larger of "share of the query's
 * meaningful words found in the verse" and "share of the verse's found in the query",
 * so both a partial quote of a long verse and a full quote inside longer speech score high.
 */
export function wordOverlap(query, verseText) {
  const q = new Set(contentStems(query));
  const v = new Set(contentStems(verseText));
  if (!q.size || !v.size) return 0;
  const shared = [...q].filter((w) => v.has(w)).length;
  return Math.max(shared / q.size, shared / v.size);
}

/**
 * The longest run of words the query and verse share in order, as
 * { content: meaningful words in it, words: total words in it },
 * e.g. "all things work together for good" -> { content: 4, words: 6 }.
 */
export function sharedRun(query, verseText) {
  const aWords = words(query).split(' ');
  const a = aWords.map(stem);
  const b = words(verseText).split(' ').map(stem);
  let best = 0;
  let bestWords = 0;
  let prev = new Array(b.length + 1).fill(0); // content words in the run ending at a[i-1], b[j-1]
  let prevLen = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array(b.length + 1).fill(0);
    const curLen = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curLen[j] = prevLen[j - 1] + 1;
        // Check the word before stemming: "was" -> "wa" must still count as a common word.
        cur[j] = prev[j - 1] + (STOP.has(aWords[i - 1]) ? 0 : 1);
        if (cur[j] > best || (cur[j] === best && curLen[j] > bestWords)) {
          best = cur[j];
          bestWords = curLen[j];
        }
      }
    }
    prev = cur;
    prevLen = curLen;
  }
  return { content: best, words: bestWords };
}

// ---------- search ----------

function topK(qi, translation, k) {
  const all = loadBible(translation);
  const index = loadIndex(translation);
  const top = [];
  for (let v = 0, off = 0; v < all.length; v += 1, off += DIMS) {
    let dot = 0;
    for (let i = 0; i < DIMS; i += 1) dot += qi[i] * index[off + i];
    if (top.length < k || dot > top[top.length - 1][1]) {
      top.push([v, dot]);
      top.sort((a, b) => b[1] - a[1]);
      if (top.length > k) top.pop();
    }
  }
  return top.map(([v, dot]) => ({ ...all[v], matchedIn: translation, score: dot / (127 * 127) }));
}

/**
 * Find the verses closest in meaning to `query`, across the local translations.
 * @returns {{reference, book, chapter, verse, text, matchedIn, score, overlap}[]}
 *   score: cosine similarity (0..1); overlap: share of query words found in the verse.
 */
export async function search(query, k = 5) {
  const [q] = await embed([query]);
  return searchEmbedded(query, q, k);
}

function searchEmbedded(query, q, k) {
  const qi = new Int8Array(DIMS);
  quantize(q, qi, 0);

  const best = new Map();
  for (const t of LOCAL_TRANSLATIONS) {
    for (const r of topK(qi, t, k)) {
      r.overlap = wordOverlap(query, r.text);
      const prev = best.get(r.reference);
      if (!prev || r.score > prev.score) best.set(r.reference, r);
    }
  }
  let results = [...best.values()].sort((a, b) => b.score - a.score);

  // A verse containing the typed words exactly should always come first.
  const phrase = words(query);
  if (phrase.split(' ').length >= 3) {
    for (const t of LOCAL_TRANSLATIONS) {
      const exact = loadBible(t).find((v) => v.text && words(v.text).includes(phrase));
      if (exact) {
        results = [{ ...exact, matchedIn: t, score: 1, overlap: 1 }, ...results.filter((r) => r.reference !== exact.reference)];
        break;
      }
    }
  }
  return results.slice(0, k);
}

// ---------- quote detection in live speech ----------

// Overlapping windows, so a quote is found even when surrounded by other talk.
// (Shorter windows match short verses on a couple of common words, so stop at 12.)
const WINDOWS = [12, 16];
const STRIDE = 4;
const MIN_WORDS = 3;

// Index of three consecutive key words -> verses, e.g. "joy lord strength" -> Nehemiah 8:10.
let trigrams = null;
const trigramKeys = (text) => {
  const w = contentStems(text);
  const keys = [];
  for (let i = 0; i + 2 < w.length; i += 1) keys.push(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return keys;
};
function trigramIndex() {
  if (!trigrams) {
    trigrams = new Map();
    for (const t of LOCAL_TRANSLATIONS) {
      loadBible(t).forEach((v, idx) => {
        for (const key of new Set(trigramKeys(v.text))) {
          if (!trigrams.has(key)) trigrams.set(key, []);
          trigrams.get(key).push([t, idx]);
        }
      });
    }
  }
  return trigrams;
}

// Key-word phrases found in more verses than this are stock phrases ("word lord came").
const COMMON = 20;
const hasStockPhrase = (spoken) => trigramKeys(spoken).some((key) => trigramIndex().get(key)?.length > COMMON);

// Verses sharing at least 3 key words in order with the spoken text, scored like search results.
function wordMatches(spoken, q) {
  const index = trigramIndex();
  const hits = new Map();
  for (const key of trigramKeys(spoken)) {
    const list = index.get(key);
    if (!list || list.length > COMMON) continue; // phrase too common to point at one verse
    for (const [t, idx] of list) hits.set(`${t}:${idx}`, [t, idx]);
  }
  const qi = new Int8Array(DIMS);
  quantize(q, qi, 0);
  return [...hits.values()].map(([t, idx]) => {
    const v = loadBible(t)[idx];
    const vec = loadIndex(t);
    let dot = 0;
    for (let i = 0, off = idx * DIMS; i < DIMS; i += 1) dot += qi[i] * vec[off + i];
    return { ...v, matchedIn: t, score: dot / (127 * 127), overlap: wordOverlap(spoken, v.text), run: sharedRun(spoken, v.text) };
  });
}

// Tuned on sermon-style sentences: real quotes and paraphrases pass, ordinary talk
// ("let us bow our heads and pray", "in the name of Jesus") does not.
const isQuote = (r) =>
  r.score >= 0.97 || // near-exact
  (r.score >= 0.83 && r.overlap >= 0.6) || // close paraphrase using the verse's words
  (r.score >= 0.75 && r.run >= 3) || // part of the verse word for word, amid other talk
  (r.score >= 0.6 && r.run >= 4) || // a longer word-for-word line from a long verse
  (r.run >= 3 && r.runWords >= 6); // e.g. "the joy of the LORD is your strength"

/**
 * Find verses the speaker quoted or paraphrased in a stretch of transcript.
 * @returns {{reference, text, score, overlap, spoken}[]} best match per verse
 */
export async function detectQuotes(transcript) {
  const all = words(transcript).split(' ').filter(Boolean);
  if (all.length < MIN_WORDS) return [];
  const windows = new Set();
  for (const size of WINDOWS) {
    if (all.length <= size) {
      windows.add(all.join(' '));
      continue;
    }
    // Full-size windows only; the last one is aligned to the end so no words are skipped.
    for (let i = 0; i + size <= all.length; i += STRIDE) windows.add(all.slice(i, i + size).join(' '));
    windows.add(all.slice(-size).join(' '));
  }
  const texts = [...windows];
  const vectors = await embed(texts);
  const stock = hasStockPhrase(all.join(' '));

  const found = new Map();
  texts.forEach((spoken, i) => {
    // Candidates: closest in meaning, plus verses sharing key words in order (catches a
    // famous line from a long verse, e.g. "the joy of the Lord is your strength").
    const candidates = [...searchEmbedded(spoken, vectors[i], 3), ...wordMatches(spoken, vectors[i])];
    const passing = new Map();
    for (const r of candidates) {
      r.run ??= sharedRun(spoken, r.text);
      [r.run, r.runWords] = typeof r.run === 'object' ? [r.run.content, r.run.words] : [r.run, r.runWords];
      // With a stock phrase in the speech, sharing 3 or fewer key words proves nothing.
      if (stock && r.run <= 3 && r.score < 0.97) continue;
      if (isQuote(r) && !(passing.get(r.reference)?.score >= r.score)) passing.set(r.reference, r);
    }
    // Wording shared by many verses ("in the name of the Lord Jesus Christ",
    // "the word of the LORD came to me") is a stock phrase, not a specific quote.
    if (passing.size > 2) return;
    for (const r of passing.values()) {
      const prev = found.get(r.reference);
      if (!prev || r.score > prev.score) found.set(r.reference, { ...r, spoken });
    }
  });
  return [...found.values()].sort((a, b) => b.score - a.score);
}
