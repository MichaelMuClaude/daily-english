// All SQL lives here. Every query is parameterised.
const { sql, query } = require('./db');
const { serializeExplain } = require('./explain');
const { nextState, addDays } = require('./srs');

async function upsertUser({ idpId, email }) {
  const r = await query(
    `MERGE dbo.users AS t
     USING (SELECT @idp AS idp_id) AS s ON t.idp_id = s.idp_id
     WHEN MATCHED AND ISNULL(t.email, '') <> ISNULL(@email, '') THEN UPDATE SET email = @email
     WHEN NOT MATCHED THEN INSERT (idp_id, email) VALUES (@idp, @email)
     OUTPUT inserted.id;`,
    { idp: [sql.NVarChar(200), idpId], email: [sql.NVarChar(320), email] },
  );
  if (r.recordset[0]) return r.recordset[0].id;
  const again = await query('SELECT id FROM dbo.users WHERE idp_id = @idp', { idp: [sql.NVarChar(200), idpId] });
  return again.recordset[0].id;
}

async function sentencesForDay(day) {
  const r = await query(
    `SELECT id, idx, english, chinese, topic, explain
     FROM dbo.sentences WHERE day = @day ORDER BY idx`,
    { day: [sql.Date, day] },
  );
  return r.recordset;
}

/** Insert the day's sentences. A concurrent insert of the same day is not an error. */
async function saveSentences(day, items) {
  for (let i = 0; i < items.length; i++) {
    const s = items[i];
    try {
      await query(
        `INSERT dbo.sentences (day, idx, english, chinese, topic, source_title, source_url, explain)
         VALUES (@day, @idx, @en, @zh, @topic, @title, @url, @explain)`,
        {
          day: [sql.Date, day],
          idx: [sql.TinyInt, i + 1],
          en: [sql.NVarChar(400), s.english],
          zh: [sql.NVarChar(400), s.chinese],
          topic: [sql.NVarChar(60), s.topic],
          title: [sql.NVarChar(400), s.sourceTitle],
          url: [sql.NVarChar(1000), s.sourceUrl],
          explain: [sql.NVarChar(sql.MAX), serializeExplain(s)],
        },
      );
    } catch (err) {
      if (err.number !== 2627 && err.number !== 2601) throw err; // duplicate key = someone else got there first
    }
  }
}

async function learnedIds(userId, sentenceIds) {
  if (!sentenceIds.length) return new Set();
  const r = await query(
    `SELECT sentence_id FROM dbo.user_sentences WHERE user_id = @u AND sentence_id IN (${sentenceIds.map(Number).join(',')})`,
    { u: [sql.Int, userId] },
  );
  return new Set(r.recordset.map((x) => x.sentence_id));
}

/** Mark a sentence as learned: first review is tomorrow. Returns false if the sentence does not exist. */
async function markLearned(userId, sentenceId, today) {
  const exists = await query('SELECT 1 AS ok FROM dbo.sentences WHERE id = @s', { s: [sql.Int, sentenceId] });
  if (!exists.recordset.length) return false;
  await query(
    `IF NOT EXISTS (SELECT 1 FROM dbo.user_sentences WHERE user_id = @u AND sentence_id = @s)
       INSERT dbo.user_sentences (user_id, sentence_id, box, next_review) VALUES (@u, @s, 1, @next)`,
    { u: [sql.Int, userId], s: [sql.Int, sentenceId], next: [sql.Date, addDays(today, 1)] },
  );
  return true;
}

async function dueCount(userId, today) {
  const r = await query(
    'SELECT COUNT(*) AS n FROM dbo.user_sentences WHERE user_id = @u AND next_review <= @today',
    { u: [sql.Int, userId], today: [sql.Date, today] },
  );
  return r.recordset[0].n;
}

/** The most overdue sentence for this user, Chinese side only (the answer is never sent). */
async function nextDue(userId, today) {
  const r = await query(
    `SELECT TOP 1 s.id, s.chinese
     FROM dbo.user_sentences us JOIN dbo.sentences s ON s.id = us.sentence_id
     WHERE us.user_id = @u AND us.next_review <= @today
     ORDER BY us.next_review, us.learned_at`,
    { u: [sql.Int, userId], today: [sql.Date, today] },
  );
  return r.recordset[0] || null;
}

/** A sentence the user has learned (needed to judge an answer). null if not learned. */
async function learnedSentence(userId, sentenceId) {
  const r = await query(
    `SELECT s.id, s.english, s.chinese, s.explain, us.box
     FROM dbo.user_sentences us JOIN dbo.sentences s ON s.id = us.sentence_id
     WHERE us.user_id = @u AND us.sentence_id = @s`,
    { u: [sql.Int, userId], s: [sql.Int, sentenceId] },
  );
  return r.recordset[0] || null;
}

async function recordReview(userId, sentence, answer, judgement, today) {
  const { box, nextReview } = nextState(sentence.box, judgement.correct, today);
  await query(
    `INSERT dbo.reviews (user_id, sentence_id, answer, score, correct, feedback)
     VALUES (@u, @s, @answer, @score, @correct, @feedback);
     UPDATE dbo.user_sentences SET box = @box, next_review = @next WHERE user_id = @u AND sentence_id = @s;`,
    {
      u: [sql.Int, userId],
      s: [sql.Int, sentence.id],
      answer: [sql.NVarChar(400), answer],
      score: [sql.TinyInt, judgement.score],
      correct: [sql.Bit, judgement.correct],
      feedback: [sql.NVarChar(1000), judgement.feedback],
      box: [sql.TinyInt, box],
      next: [sql.Date, nextReview],
    },
  );
  return { box, nextReview };
}

async function stats(userId) {
  const r = await query(
    `SELECT (SELECT COUNT(*) FROM dbo.user_sentences WHERE user_id = @u) AS learned,
            (SELECT COUNT(*) FROM dbo.reviews WHERE user_id = @u) AS reviews,
            (SELECT COUNT(*) FROM dbo.reviews WHERE user_id = @u AND correct = 1) AS correct`,
    { u: [sql.Int, userId] },
  );
  return r.recordset[0];
}

module.exports = {
  upsertUser, sentencesForDay, saveSentences, learnedIds, markLearned,
  dueCount, nextDue, learnedSentence, recordReview, stats,
};
