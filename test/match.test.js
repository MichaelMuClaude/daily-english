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
  assert.ok(r.score < 65);
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

test('contractions match their long forms either way round', () => {
  assert.equal(compare("I'm sure it's fine and we don't mind", 'I am sure it is fine and we do not mind').score, 100);
  assert.equal(compare('I am sure it is fine', "I'm sure it's fine").score, 100);
  const r = compare("I'm happy", 'happy');
  assert.deepEqual(r.words.map((w) => w.ok), [false, true]); // half of "I'm" was missing
});

test('a small spelling slip from the recogniser is forgiven, a different word is not', () => {
  assert.equal(compare('The markets stay open late', 'The market stays open late').score, 100);
  assert.equal(compare('Over there, mate', 'Over their mate').score, 100); // sound-alikes
  assert.ok(compare('I like this one', 'I like that one').score < 100); // different word
  assert.ok(compare('Pay 25 dollars', 'Pay 35 dollars').score < 100); // numbers must be exact
});

test('the pass mark is forgiving: about two thirds of the words is enough', () => {
  assert.equal(compare('one two three four five six', 'one two three four').passed, true); // 67
  assert.equal(compare('one two three four five six', 'one two three').passed, false); // 50
});

test('notes say what was missing, what was swapped and what was extra, in order', () => {
  const r = compare('Did you hear about the big markets today', 'Did you hear the huge markets today and tomorrow');
  assert.deepEqual(r.notes, [
    { type: 'missing', expected: 'about' },
    { type: 'wrong', expected: 'big', said: 'huge' },
    { type: 'extra', said: 'and tomorrow' },
  ]);
  assert.deepEqual(compare('a perfect match', 'a perfect match').notes, []);
  assert.deepEqual(compare('say this', '').notes, [{ type: 'missing', expected: 'say this' }]);
});
