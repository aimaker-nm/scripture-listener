// One-off: turn the source KJV JSON (66 books in canonical order, chapters of verse strings)
// Source: https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json (saved as data/kjv-raw.json)
// into data/kjv.json: [[bookName, chapter, verse, text], ...] using the app's book names.
import { readFileSync, writeFileSync } from 'node:fs';
import { BOOKS } from '../public/books.js';

const src = JSON.parse(readFileSync(new URL('../data/kjv-raw.json', import.meta.url), 'utf8').replace(/^﻿/, ''));
if (src.length !== BOOKS.length) throw new Error(`expected ${BOOKS.length} books, got ${src.length}`);
const rows = [];
src.forEach((book, b) => {
  if (book.chapters.length !== BOOKS[b].chapters) throw new Error(`${BOOKS[b].name}: chapter count mismatch`);
  book.chapters.forEach((verses, c) => verses.forEach((text, v) => rows.push([BOOKS[b].name, c + 1, v + 1, text.trim()])));
});
writeFileSync(new URL('../data/kjv.json', import.meta.url), JSON.stringify(rows));
console.log(`wrote ${rows.length} verses`);
