const test = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('../src/match');

const target = "Did you hear that the Fremantle markets are staying open late this summer?";

test('an exact repeat scores 100 and every word is marked ok', () => {
  const r = compare(target, target);
  assert.equal(r.score, 100);
  assert.equal(r.passed, true);
  assert.ok(r.words.every((w) => w.ok));
});

test('case, punctuation and number words do not matter', () => {
  assert.equal(compare('There are 3 cats, mate.', 'there are three cats mate').score, 100);
  assert.equal(compare("It's late.", "it's late").score, 100);
  assert.equal(compare("It’s late.", "It's late").score, 100); // curly apostrophe
});

test('one missing word in a long sentence still passes, and the missing word is marked', () => {
  const r = compare(target, 'Did you hear that the Fremantle markets are staying open late summer');
  assert.equal(r.passed, true);
  assert.deepEqual(r.words.filter((w) => !w.ok).map((w) => w.word), ['this']);
});

test('too many missing or wrong words fails', () => {
  const r = compare(target, 'Did you hear about the markets');
  assert.equal(r.passed, false);
  assert.ok(r.score < 80);
});

test('extra words cost points too, so rambling cannot pass', () => {
  const r = compare('Looks like rain today.', 'Looks like rain today and tomorrow and also the day after that');
  assert.equal(r.passed, false);
});

test('word order matters: the same words in a scrambled order fail', () => {
  assert.equal(compare('I left my keys at home', 'home at keys my left I').passed, false);
});

test('nothing heard scores 0', () => {
  assert.deepEqual(compare(target, '').score, 0);
  assert.equal(compare(target, '   ').passed, false);
});

test('an unrelated sentence fails', () => {
  assert.equal(compare(target, 'The quick brown fox jumps over the lazy dog').passed, false);
});
