const test = require('node:test');
const assert = require('node:assert/strict');
const { userFromRequest } = require('../src/auth');

const req = (headers) => ({ get: (n) => headers[n.toLowerCase()] });

test('easyauth mode reads the platform identity headers and namespaces the id by provider', () => {
  const u = userFromRequest(req({ 'x-ms-client-principal-id': 'abc', 'x-ms-client-principal-idp': 'aad', 'x-ms-client-principal-name': 'a@b.com' }), { AUTH_MODE: 'easyauth' });
  assert.deepEqual(u, { idpId: 'aad:abc', email: 'a@b.com' });
});

test('easyauth mode with no headers means not signed in', () => {
  assert.equal(userFromRequest(req({}), { AUTH_MODE: 'easyauth' }), null);
});

test('dev mode ignores request headers completely', () => {
  const u = userFromRequest(req({ 'x-ms-client-principal-id': 'attacker' }), { AUTH_MODE: 'dev', DEV_USER: 'me@x.com' });
  assert.deepEqual(u, { idpId: 'dev:me@x.com', email: 'me@x.com' });
});
