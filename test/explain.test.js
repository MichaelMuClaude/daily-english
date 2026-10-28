const test = require('node:test');
const assert = require('node:assert/strict');
const { serializeExplain, parseExplain } = require('../src/explain');

test('explain round-trips notes and tip', () => {
  const x = { notes: [{ phrase: 'cut back', zh: '减少' }], tip: '聊天时用' };
  assert.deepEqual(parseExplain(serializeExplain(x)), x);
});

test('parseExplain never throws and drops broken notes', () => {
  assert.deepEqual(parseExplain(null), { notes: [], tip: '' });
  assert.deepEqual(parseExplain('not json'), { notes: [], tip: '' });
  assert.deepEqual(parseExplain('{"notes":"oops","tip":5}'), { notes: [], tip: '' });
  assert.deepEqual(parseExplain('{"notes":[{"phrase":"a"},{"phrase":"b","zh":"乙"},null]}').notes, [{ phrase: 'b', zh: '乙' }]);
});
