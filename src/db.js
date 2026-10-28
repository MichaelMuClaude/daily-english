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

/** Shared pool; rebuilt shortly before its access token expires. */
async function getPool() {
  if (!poolPromise || Date.now() > poolExpiresAt) {
    const old = poolPromise;
    poolPromise = createPool().catch((err) => {
      poolPromise = null;
      throw err;
    });
    if (old) old.then((p) => p.close()).catch(() => {});
  }
  return poolPromise;
}

/** Forget the shared pool (it holds a dead connection); the next call builds a fresh one. */
function dropPool() {
  const old = poolPromise;
  poolPromise = null;
  if (old) old.then((p) => p.close()).catch(() => {});
}

/**
 * Run a query with named parameters: query('SELECT ... @id', { id: [sql.Int, 5] }).
 * Retries while the paused free-tier database wakes up.
 */
async function query(text, params = {}) {
  return withRetry(async () => {
    const pool = await getPool();
    const req = pool.request();
    for (const [name, [type, value]] of Object.entries(params)) req.input(name, type, value);
    return req.query(text);
  }, { onRetry: (err) => { console.warn('database not ready, retrying:', err.message.slice(0, 120)); dropPool(); } });
}

module.exports = { sql, getPool, query };
