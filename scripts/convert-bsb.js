// One-off: turn scrollmapper's BSB JSON ({books:[{name, chapters:[{chapter, verses:[{verse,text}]}]}]})
// into data/bsb.json: [[bookName, chapter, verse, text], ...] using the app's book names.
// Source: https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/BSB.json (saved as data/bsb-raw.json)
// The Berean Standard Bible was dedicated to the public domain in 2023.
import { readFileSync, writeFileSync } from 'node:fs';
import { BOOKS } from '../public/books.js';

const src = JSON.parse(readFileSync(new URL('../data/bsb-raw.json', import.meta.url), 'utf8')).books;
if (src.length !== BOOKS.length) throw new Error(`expected ${BOOKS.length} books, got ${src.length}`);
const rows = [];
src.forEach((book, b) => {
  if (book.chapters.length !== BOOKS[b].chapters) throw new Error(`${BOOKS[b].name}: chapter count mismatch`);
  for (const ch of book.chapters) for (const v of ch.verses) rows.push([BOOKS[b].name, ch.chapter, v.verse, v.text.trim()]);
});
writeFileSync(new URL('../data/bsb.json', import.meta.url), JSON.stringify(rows));
console.log(`wrote ${rows.length} verses`);
