// Azure SQL connection using Microsoft Entra authentication only: no password anywhere.
// In Azure the token comes from the app's managed identity; on a developer machine
// DefaultAzureCredential falls back to `az login`.
const sql = require('mssql');
const { DefaultAzureCredential } = require('@azure/identity');
const { withRetry } = require('./retry');

const credential = new DefaultAzureCredential({
  managedIdentityClientId: process.env.AZURE_CLIENT_ID || undefined,
});

let poolPromise = null;
let poolExpiresAt = 0;

async function createPool() {
  const token = await credential.getToken('https://database.windows.net/.default');
  const pool = new sql.ConnectionPool({
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DB,
    options: { encrypt: true },
    // The free serverless database can take a while to resume after auto-pause.
    connectionTimeout: 90000,
    requestTimeout: 30000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token: token.token },
    },
  });
  await pool.connect();
  poolExpiresAt = token.expiresOnTimestamp - 5 * 60 * 1000;
  return pool;
}

/** Close a pool later, not now: other requests may still be using it. */
function closeLater(promise) {
  promise.then((p) => { setTimeout(() => p.close().catch(() => {}), 30000).unref(); }).catch(() => {});
}

/** Shared pool; rebuilt shortly before its access token expires. */
async function getPool() {
  if (!poolPromise || Date.now() > poolExpiresAt) {
    const old = poolPromise;
    poolPromise = createPool().catch((err) => {
      poolPromise = null;
      throw err;
    });
    if (old) closeLater(old);
  }
  return poolPromise;
}

/**
 * Forget a pool that holds a dead connection, but only if it is still the shared one:
 * if another request already replaced it, leave the new pool alone.
 */
function dropPool(used) {
  if (!used || poolPromise !== used) return;
  poolPromise = null;
  closeLater(used);
}

/**
 * Run a query with named parameters: query('SELECT ... @id', { id: [sql.Int, 5] }).
 * Retries while the paused free-tier database wakes up.
 */
async function query(text, params = {}) {
  let used = null;
  return withRetry(async () => {
    used = getPool();
    const pool = await used;
    const req = pool.request();
    for (const [name, [type, value]] of Object.entries(params)) req.input(name, type, value);
    return req.query(text);
  }, { onRetry: (err) => { console.warn('database not ready, retrying:', err.message.slice(0, 120)); dropPool(used); } });
}

module.exports = { sql, getPool, query };
