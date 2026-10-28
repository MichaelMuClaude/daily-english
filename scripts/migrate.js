// Apply schema.sql to the configured database. Safe to run repeatedly.
// Usage: node --env-file=.env scripts/migrate.js
const fs = require('fs');
const path = require('path');
const { getPool } = require('../src/db');

(async () => {
  const sqlText = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const pool = await getPool();
  await pool.request().batch(sqlText);
  const r = await pool.request().query(
    "SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo') ORDER BY name",
  );
  console.log('tables:', r.recordset.map((t) => t.name).join(', '));
  await pool.close();
})().catch((e) => { console.error('migrate failed:', e.message); process.exit(1); });
