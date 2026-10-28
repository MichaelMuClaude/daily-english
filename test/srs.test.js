const test = require('node:test');
const assert = require('node:assert/strict');
const { addDays, nextState, perthDay } = require('../src/srs');

test('addDays crosses month and year ends', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('correct answers climb the boxes and stop at the top', () => {
  assert.deepEqual(nextState(1, true, '2026-10-28'), { box: 2, nextReview: '2026-10-31' });
  assert.deepEqual(nextState(4, true, '2026-10-28'), { box: 5, nextReview: '2026-11-27' });
  assert.deepEqual(nextState(5, true, '2026-10-28'), { box: 5, nextReview: '2026-11-27' });
});

test('a wrong answer goes back to box 1, due tomorrow', () => {
  assert.deepEqual(nextState(4, false, '2026-10-28'), { box: 1, nextReview: '2026-10-29' });
});

test('perthDay uses Perth time, not UTC', () => {
  // 17:30 UTC on the 27th is 01:30 on the 28th in Perth (UTC+8)
  assert.equal(perthDay(new Date('2026-10-27T17:30:00Z')), '2026-10-28');
  assert.equal(perthDay(new Date('2026-10-27T15:59:00Z')), '2026-10-27');
});
