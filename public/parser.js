// Detects Bible references in speech-to-text transcripts.
// Works in the browser and in Node (plain ES module, no dependencies).
import { BOOKS } from './books.js';

const UNITS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const PREFIXES = {
  1: ['1', '1st', 'first', 'i'],
  2: ['2', '2nd', 'second', 'ii'],
  3: ['3', '3rd', 'third', 'iii'],
};
const MAX_VERSE = 176; // Psalm 119

// alias text -> book, plus one regex matching any alias (longest first)
const ALIASES = new Map();
for (const book of BOOKS) {
  for (const alias of book.aliases) {
    if (book.number) {
      for (const p of PREFIXES[book.number]) {
        ALIASES.set(`${p} ${alias}`, book);
        ALIASES.set(`${p}${alias}`, book);
      }
    } else {
      ALIASES.set(alias, book);
    }
  }
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BOOK_ALT = [...ALIASES.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|');

const RANGE = String.raw`(?:\s*(?:-|to|through|thru|till|until|and)\s*(?:verses?\s+)?(\d+))?`;
const REF_RE = new RegExp(
  String.raw`\b(${BOOK_ALT})\s+(chapter\s+)?(\d+)` +
    String.raw`(?:(?:\s*:\s*|\s+(?:and\s+)?(?:from\s+)?(?:verses?|vs)\s+|\s+)(\d+)${RANGE})?\b`,
  'g',
);
const FOLLOW_RE = new RegExp(String.raw`\b(?:verses?|vs)\s+(\d+)${RANGE}\b|\bnext verse\b`, 'g');

// Turn spoken numbers into digits: "one hundred and nineteen" -> "119",
// "twenty one" -> "21". Adjacent separate numbers stay separate: "three sixteen" -> "3 16".
export function wordsToDigits(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const out = [];
  let i = 0;
  const small = (j) => {
    // parses tens [+ unit] or a unit/teen at j; returns [value, nextIndex] or null
    if (TENS[tokens[j]] !== undefined) {
      let v = TENS[tokens[j]];
      if (UNITS[tokens[j + 1]] !== undefined && UNITS[tokens[j + 1]] > 0 && UNITS[tokens[j + 1]] < 10) {
        return [v + UNITS[tokens[j + 1]], j + 2];
      }
      return [v, j + 1];
    }
    if (UNITS[tokens[j]] !== undefined) return [UNITS[tokens[j]], j + 1];
    return null;
  };
  while (i < tokens.length) {
    let start = i;
    if (tokens[i] === 'a' && tokens[i + 1] === 'hundred') start = i + 1;
    const first = tokens[start] === 'hundred' ? [1, start] : small(start);
    if (!first) {
      out.push(tokens[i]);
      i += 1;
      continue;
    }
    let [value, next] = first;
    if (tokens[next] === 'hundred' && value < 10) {
      value = (value || 1) * 100;
      next += 1;
      let j = next;
      if (tokens[j] === 'and' && small(j + 1)) j += 1;
      const rest = small(j);
      if (rest) [value, next] = [value + rest[0], rest[1]];
    }
    out.push(String(value));
    i = next;
  }
  return out.join(' ');
}

export function normalize(text) {
  let t = text.toLowerCase().replace(/[’']/g, '');
  t = t.replace(/(\d)\s*[-–—]\s*(\d)/g, '$1 - $2'); // keep numeric ranges
  t = t.replace(/(\d)\s*:\s*(\d)/g, '$1 : $2'); // keep chapter:verse
  t = t.replace(/[^a-z0-9:\- ]+/g, ' ').replace(/(?<![\d ])-|-(?![ \d])/g, ' ');
  return wordsToDigits(t).replace(/\s+/g, ' ').trim();
}

// ---------- misheard book names ----------
// Accents and speech engines garble the rarer book names ("Zethaniyar" for Zephaniah,
// "Habakook", "Tesalonians"). A word that is close to a book name AND followed by a number
// is corrected. Everyday words that sit near a book name are never touched.
const NOT_BOOKS = new Set(['number', 'numbered', 'chapter', 'chapters', 'verse', 'verses', 'page', 'pages',
  'hymn', 'point', 'points', 'step', 'steps', 'level', 'room', 'line', 'lines', 'part', 'parts', 'games',
  'jobs', 'marks', 'marked', 'market', 'lukes', 'acting', 'action', 'actions', 'rooms', 'judge', 'judged',
  'number', 'minutes', 'hours', 'years', 'times', 'people', 'things', 'places', 'names', 'romance',
  'genius', 'james', 'johns', 'johnson', 'daniels', 'kings', 'king', 'peter', 'titles', 'revolution',
  'house', 'houses', 'these', 'those', 'either', 'easter', 'ether', 'denial', 'relation', 'relations',
  'regulation', 'regulations', 'remains', 'roman', 'crown', 'pester', 'potter', 'putter', 'patter',
  'malice', 'mulch', 'matte', 'jeremy', 'jonas', 'mathes', 'lamentation']);
// Words that are part of a multi-word book name ("solomon", "songs", "apostles").
const ALIAS_WORDS = new Set(BOOKS.flatMap((b) => b.aliases).flatMap((a) => a.split(' ')));
// Compare against full book names only (not abbreviations like "thess", which sit near "these").
const FUZZY_TARGETS = [...new Set(BOOKS.map((b) => b.aliases[0]).filter((a) => a.length >= 5 && !a.includes(' ')))];

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = next;
    }
  }
  return row[b.length];
}

// Rough sound-alike form: "ph"->"f", "ch"/"c"->"k", doubled letters collapsed, vowels and h/y/w dropped after the first letter.
const skeleton = (w) => w.replace(/ph/g, 'f').replace(/ch|c/g, 'k').replace(/(.)\1+/g, '$1').replace(/(?!^)[aeiouyhw]/g, '');

// First sound, so "Filipians"/"Philippians" and "Kolosians"/"Colossians" still line up.
const firstSound = (w) => w.replace(/^ph/, 'f').replace(/^k/, 'c')[0];

function closestBook(word) {
  if (word.length < 5 || NOT_BOOKS.has(word) || ALIASES.has(word) || ALIAS_WORDS.has(word)) return null;
  let best = null;
  for (const alias of FUZZY_TARGETS) {
    if (Math.abs(alias.length - word.length) > 3) continue;
    const d = editDistance(word, alias);
    const sk = editDistance(skeleton(word), skeleton(alias));
    // Same first letter, and about 1 edit per 4 letters; long names may also match by sound skeleton.
    const ok =
      firstSound(word) === firstSound(alias) &&
      (d <= Math.floor(alias.length / 4) || (alias.length >= 7 && sk === 0 && d <= Math.ceil(alias.length / 3)));
    if (ok && (!best || d < best.d)) best = { alias, d };
  }
  return best?.alias ?? null;
}

export { closestBook };

export function fixBookNames(t) {
  return t.replace(/\b([a-z]{5,})(?= (?:chapter )?\d)/g, (w) => closestBook(w) || w);
}

export function formatReference({ book, chapter, verse, verseEnd }) {
  let s = `${book} ${chapter}`;
  if (verse) s += `:${verse}`;
  if (verseEnd) s += `-${verseEnd}`;
  return s;
}

function makeRef(book, chapter, verse, verseEnd, spoken) {
  const v = verse && verse >= 1 && verse <= MAX_VERSE ? verse : null;
  const end = v && verseEnd && verseEnd > v && verseEnd <= MAX_VERSE ? verseEnd : null;
  const ref = { book: book.name, chapter, verse: v, verseEnd: end, spoken };
  ref.reference = formatReference(ref);
  return ref;
}

// Speech engines often glue chapter and verse together ("John 316").
// If the number is not a valid chapter, try splitting it.
function splitGlued(book, n) {
  const s = String(n);
  for (const cut of [s.length - 2, s.length - 1]) {
    if (cut < 1) continue;
    const ch = Number(s.slice(0, cut));
    const v = Number(s.slice(cut));
    if (ch >= 1 && ch <= book.chapters && v >= 1 && s[cut] !== '0') return [ch, v];
  }
  return null;
}

/**
 * Find Bible references in a transcript.
 * @param {string} text  raw transcript text
 * @param {object} [context]  last reference ({book, chapter, verse, verseEnd}) for
 *   follow-ups like "verse 18" or "next verse"
 * @returns {{references: object[], context: object|null}}
 */
export function findReferences(text, context = null) {
  const t = fixBookNames(normalize(text));
  const found = [];
  const spans = [];
  let ctx = context;

  for (const m of t.matchAll(REF_RE)) {
    const book = ALIASES.get(m[1].replace(/\s+/g, ' ')) || ALIASES.get(m[1]);
    if (!book) continue;
    const saidChapter = Boolean(m[2]);
    let chapter = Number(m[3]);
    let verse = m[4] ? Number(m[4]) : null;
    let verseEnd = m[5] ? Number(m[5]) : null;

    // Single-chapter books: "Jude 3" means verse 3.
    if (book.chapters === 1 && !verse && !saidChapter && chapter > 1) {
      verse = chapter;
      chapter = 1;
    }
    if (chapter > book.chapters && !verse && chapter >= 100) {
      const split = splitGlued(book, chapter);
      if (!split) continue;
      [chapter, verse] = split;
    }
    if (chapter < 1 || chapter > book.chapters) continue;
    // A bare "John 3" is too ambiguous in normal speech; require "chapter" (Psalms excepted).
    if (!verse && !saidChapter && book.name !== 'Psalms') continue;

    const ref = makeRef(book, chapter, verse, verseEnd, m[0]);
    found.push({ ...ref, index: m.index });
    spans.push([m.index, m.index + m[0].length]);
    ctx = ref;
  }

  for (const m of t.matchAll(FOLLOW_RE)) {
    if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const prior = [...found].reverse().find((r) => r.index < m.index) || context;
    if (!prior) continue;
    const book = BOOKS.find((b) => b.name === prior.book);
    let verse;
    let verseEnd = null;
    if (m[0] === 'next verse') {
      verse = (prior.verseEnd || prior.verse || 0) + 1;
    } else {
      verse = Number(m[1]);
      verseEnd = m[2] ? Number(m[2]) : null;
    }
    const ref = makeRef(book, prior.chapter, verse, verseEnd, m[0]);
    if (!ref.verse) continue;
    found.push({ ...ref, index: m.index });
  }

  found.sort((a, b) => a.index - b.index);
  if (found.length) ctx = found[found.length - 1];
  return { references: found.map(({ index, ...r }) => r), context: ctx };
}
