// Verse search and quote detection. Needs the search index (npm run build-index); skipped without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexExists, search, detectQuotes, lookup } from '../lib/search.js';

const skip = !indexExists() && 'search index not built (npm run build-index)';
const firstRef = async (q) => (await search(q, 1))[0].reference;
const quotes = async (text) => (await detectQuotes(text)).map((r) => r.reference);

test('local verse lookup', () => {
  assert.equal(lookup('John 3:16', 'kjv').text.slice(0, 22), 'For God so loved the w');
  assert.equal(lookup('Psalms 23:1-2', 'bsb').verses.length, 2);
  assert.equal(lookup('Jude 1', 'kjv').verses.length, 25); // whole chapter
  assert.equal(lookup('John 3:16', 'web'), null); // not stored locally
  assert.equal(lookup('not a reference', 'kjv'), null);
});

test('search finds quotes in KJV and modern wording', { skip }, async () => {
  const cases = {
    'God so loved the world that he gave his only son': 'John 3:16',
    'love is patient love is kind': '1 Corinthians 13:4',
    'for I know the plans I have for you says the Lord plans to prosper you': 'Jeremiah 29:11',
    'come to me all you who are weary and burdened and I will give you rest': 'Matthew 11:28',
    'weeping may endure for a night but joy comes in the morning': 'Psalms 30:5',
    'greater is he that is in you than he that is in the world': '1 John 4:4',
  };
  for (const [q, want] of Object.entries(cases)) assert.equal(await firstRef(q), want, q);
});

test('detects quotes inside longer speech', { skip }, async () => {
  assert.deepEqual(await quotes('church I want you to know that God so loved the world that he gave his only son'), ['John 3:16']);
  assert.deepEqual(await quotes('church remember that all things work together for good for those who love God amen'), ['Romans 8:28']);
  assert.deepEqual(await quotes('I tell you the joy of the Lord is your strength so lift up your head'), ['Nehemiah 8:10']);
  assert.deepEqual(await quotes('as the Bible says be still and know that I am God in the middle of your storm'), ['Psalms 46:10']);
});

test('ignores ordinary church talk and stock phrases', { skip }, async () => {
  for (const text of [
    'good morning church it is so good to see everyone here today please take your seats',
    'let us bow our heads and pray together God is good all the time',
    'your breakthrough is coming this week in Jesus name God will provide for all your needs this year',
    'there is power in the name of Jesus and every chain will break today',
    'bring your tithes and offerings to the front as the ushers come forward',
    'we pray all this in the name of the Lord Jesus Christ amen',
    'grace and peace to you from God our father',
    'the word of the Lord came to me this morning while I was praying',
  ]) {
    assert.deepEqual(await quotes(text), [], text);
  }
});
