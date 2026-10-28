const test = require('node:test');
const assert = require('node:assert/strict');
const { isTransient, withRetry } = require('../src/retry');

test('isTransient recognises a waking database and ordinary network drops, but not SQL mistakes', () => {
  assert.ok(isTransient(Object.assign(new Error('Connection is closed.'), { code: 'ECONNCLOSED' })));
  assert.ok(isTransient(new Error("Database 'db' on server 's' is not currently available.")));
  assert.ok(isTransient(Object.assign(new Error('x'), { number: 40613 })));
  assert.ok(isTransient(Object.assign(new Error('x'), { code: 'ELOGIN' })));
  assert.ok(!isTransient(Object.assign(new Error('Violation of UNIQUE KEY'), { number: 2627 })));
  assert.ok(!isTransient(new Error('Incorrect syntax near x')));
  assert.ok(!isTransient(null));
});

test('withRetry retries a transient error, drops the pool each time, then succeeds', async () => {
  let calls = 0; const waits = []; let dropped = 0;
  const out = await withRetry(async () => {
    if (++calls < 3) throw new Error('Connection is closed.');
    return 'ok';
  }, { delays: [10, 20, 30], sleep: async (ms) => waits.push(ms), onRetry: () => { dropped++; } });
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);
  assert.equal(dropped, 2);
});

test('withRetry throws a non-transient error at once and gives up after the last delay', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw Object.assign(new Error('dup'), { number: 2627 }); }, { sleep: async () => {} }), /dup/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error('Connection is closed.'); }, { delays: [1, 1], sleep: async () => {} }), /Connection is closed/);
  assert.equal(calls, 3); // first try + 2 retries
});
