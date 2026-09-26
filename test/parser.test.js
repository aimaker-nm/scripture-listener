import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findReferences, wordsToDigits } from '../public/parser.js';

const refs = (text, ctx) => findReferences(text, ctx).references.map((r) => r.reference);

test('number words', () => {
  assert.equal(wordsToDigits('psalm one hundred and nineteen verse one hundred five'), 'psalm 119 verse 105');
  assert.equal(wordsToDigits('john three sixteen'), 'john 3 16');
  assert.equal(wordsToDigits('chapter twenty one verse a hundred'), 'chapter 21 verse 100');
});

test('spoken references', () => {
  assert.deepEqual(refs('turn with me to John chapter three verse sixteen'), ['John 3:16']);
  assert.deepEqual(refs('first Corinthians thirteen verse four to seven'), ['1 Corinthians 13:4-7']);
  assert.deepEqual(refs('Second Timothy chapter 3 verses 16 and 17'), ['2 Timothy 3:16-17']);
  assert.deepEqual(refs('Romans 8:28'), ['Romans 8:28']);
  assert.deepEqual(refs('read Romans 12 1-2 please'), ['Romans 12:1-2']);
  assert.deepEqual(refs('psalm twenty three'), ['Psalms 23']);
  assert.deepEqual(refs('Psalm 119 verse 105'), ['Psalms 119:105']);
  assert.deepEqual(refs('the book of Revelation chapter twenty one'), ['Revelation 21']);
  assert.deepEqual(refs('Song of Solomon 2:4'), ['Song of Solomon 2:4']);
  assert.deepEqual(refs('1 John 1 9 says'), ['1 John 1:9']);
  assert.deepEqual(refs('Jude 24'), ['Jude 1:24']);
  assert.deepEqual(refs('Isaiah 40:31 and Philippians 4 13'), ['Isaiah 40:31', 'Philippians 4:13']);
});

test('glued chapter and verse from speech engine', () => {
  assert.deepEqual(refs('John 316'), ['John 3:16']);
  assert.deepEqual(refs('Jeremiah 2911'), ['Jeremiah 29:11']);
});

test('ignores ordinary speech', () => {
  assert.deepEqual(refs('John and Mark went to the shop'), []);
  assert.deepEqual(refs('I will mark 3 things today'), []);
  assert.deepEqual(refs('the acts of kindness we do'), []);
  assert.deepEqual(refs('John 45'), []); // no such chapter, not a valid split
});

test('follow-up verses use context', () => {
  const { context } = findReferences('John 3:16');
  assert.deepEqual(refs('and verse seventeen says', context), ['John 3:17']);
  assert.deepEqual(refs('next verse', context), ['John 3:17']);
  assert.deepEqual(refs('Acts 2 verse 38 then verse 41'), ['Acts 2:38', 'Acts 2:41']);
  assert.deepEqual(refs('verse 3'), []); // no context
});
