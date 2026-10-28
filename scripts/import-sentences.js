// One-off: bring sentences you already studied elsewhere into the app as "learned", so they
// come up for typed review on the date you choose.
// Usage: node --env-file=.env scripts/import-sentences.js <file.json> <email>           (preview only)
//        node --env-file=.env scripts/import-sentences.js <file.json> <email> --apply   (write)
// File: [{ day, idx, english, chinese, notes: [{phrase, zh}], tip, box, nextReview }, ...]
// Safe to run twice: a sentence already stored (same day + idx + text) is reused, and the
// learned row is only added if missing.
const fs = require('fs');
const sql = require('mssql');
const { getPool } = require('../src/db');
const { serializeExplain } = require('../src/explain');

const [file, email, flag] = process.argv.slice(2);
if (!file || !email) { console.error('usage: import-sentences.js <file.json> <email> [--apply]'); process.exit(2); }
const apply = flag === '--apply';
const items = JSON.parse(fs.readFileSync(file, 'utf8'));

(async () => {
  const pool = await getPool();
  const users = (await pool.request().input('e', sql.NVarChar(320), email)
    .query("SELECT id, idp_id FROM dbo.users WHERE email = @e AND idp_id NOT LIKE 'dev:%'")).recordset;
  if (users.length !== 1) throw new Error(`expected exactly one real (non-dev) user for ${email}, found ${users.length}`);
  const userId = users[0].id;
  console.log(`${apply ? 'APPLYING' : 'PREVIEW'} for user ${userId} (${users[0].idp_id})`);

  for (const it of items) {
    const found = (await pool.request().input('d', sql.Date, it.day).input('i', sql.TinyInt, it.idx)
      .query('SELECT id, english FROM dbo.sentences WHERE day = @d AND idx = @i')).recordset[0];
    if (found && found.english !== it.english) throw new Error(`day ${it.day} idx ${it.idx} is already taken by a different sentence`);
    let id = found && found.id;
    if (!apply) { console.log(`  ${found ? 'exists' : 'new   '}  ${it.day} #${it.idx}  box ${it.box}  due ${it.nextReview}  ${it.english}`); continue; }
    if (!id) {
      id = (await pool.request()
        .input('d', sql.Date, it.day).input('i', sql.TinyInt, it.idx)
        .input('en', sql.NVarChar(400), it.english).input('zh', sql.NVarChar(400), it.chinese)
        .input('t', sql.NVarChar(60), 'Imported')
        .input('x', sql.NVarChar(sql.MAX), serializeExplain({ notes: it.notes, tip: it.tip }))
        .query(`INSERT dbo.sentences (day, idx, english, chinese, topic, explain)
                OUTPUT INSERTED.id VALUES (@d, @i, @en, @zh, @t, @x)`)).recordset[0].id;
    }
    await pool.request().input('u', sql.Int, userId).input('s', sql.Int, id)
      .input('b', sql.TinyInt, it.box).input('n', sql.Date, it.nextReview)
      .query(`IF NOT EXISTS (SELECT 1 FROM dbo.user_sentences WHERE user_id = @u AND sentence_id = @s)
                INSERT dbo.user_sentences (user_id, sentence_id, box, next_review) VALUES (@u, @s, @b, @n)`);
    console.log(`  done  id ${id}  ${it.english}`);
  }
  const n = (await pool.request().input('u', sql.Int, userId)
    .query('SELECT COUNT(*) AS n FROM dbo.user_sentences WHERE user_id = @u')).recordset[0].n;
  console.log(`learned count for this user is now ${n}`);
  await pool.close();
})().catch((e) => { console.error('import failed:', e.message); process.exit(1); });
