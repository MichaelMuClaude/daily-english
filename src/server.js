const path = require('path');
const express = require('express');
const { requireUser } = require('./auth');
const { perthDay } = require('./srs');

const MAX_ANSWER_LEN = 300;
const JUDGE_LIMIT_PER_HOUR = 40; // cost guard: each judged answer is one LLM call

function createApp({ repo, llm, news, now = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ---- today's sentences are written once per Perth day, on the first request of the day ----
  let generating = null;
  async function ensureToday(day) {
    let rows = await repo.sentencesForDay(day);
    if (rows.length === 3) return rows;
    if (!generating) {
      generating = (async () => {
        const headlines = await news.fetchHeadlines();
        const items = await llm.generateSentences(headlines);
        await repo.saveSentences(day, items);
      })().finally(() => { generating = null; });
    }
    await generating;
    rows = await repo.sentencesForDay(day);
    if (rows.length !== 3) throw new Error('Sentences were not saved');
    return rows;
  }

  // ---- per-user rate limit for LLM judging ----
  const judgeCalls = new Map(); // userId -> [timestamps]
  function allowJudge(userId) {
    const cutoff = now().getTime() - 3600_000;
    const recent = (judgeCalls.get(userId) || []).filter((t) => t > cutoff);
    if (recent.length >= JUDGE_LIMIT_PER_HOUR) { judgeCalls.set(userId, recent); return false; }
    recent.push(now().getTime());
    judgeCalls.set(userId, recent);
    return true;
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  const api = express.Router();
  api.use(requireUser);
  api.use((req, res, next) => {
    repo.upsertUser(req.user).then((id) => { req.userId = id; next(); }, next);
  });

  api.get('/me', (req, res) => res.json({ email: req.user.email }));

  api.get('/today', wrap(async (req, res) => {
    const day = perthDay(now());
    let rows;
    try {
      rows = await ensureToday(day);
    } catch (err) {
      console.error('generate failed:', err.message);
      return res.status(503).json({ error: "Today's sentences are not ready yet. Please try again in a minute." });
    }
    const learned = await repo.learnedIds(req.userId, rows.map((r) => r.id));
    res.json({
      day,
      sentences: rows.map((r) => ({ ...r, learned: learned.has(r.id) })),
    });
  }));

  api.post('/learn', wrap(async (req, res) => {
    const id = Number(req.body?.sentenceId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'sentenceId required' });
    const ok = await repo.markLearned(req.userId, id, perthDay(now()));
    if (!ok) return res.status(404).json({ error: 'Unknown sentence' });
    res.json({ ok: true });
  }));

  api.get('/review/next', wrap(async (req, res) => {
    const today = perthDay(now());
    const [item, due] = await Promise.all([repo.nextDue(req.userId, today), repo.dueCount(req.userId, today)]);
    res.json({ due, item });
  }));

  api.post('/review/answer', wrap(async (req, res) => {
    const id = Number(req.body?.sentenceId);
    const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'sentenceId required' });
    if (!answer || answer.length > MAX_ANSWER_LEN) {
      return res.status(400).json({ error: `Answer must be 1 to ${MAX_ANSWER_LEN} characters` });
    }
    const sentence = await repo.learnedSentence(req.userId, id);
    if (!sentence) return res.status(404).json({ error: 'You have not learned this sentence' });
    if (!allowJudge(req.userId)) {
      return res.status(429).json({ error: 'Too many answers this hour. Take a break and come back later.' });
    }
    let judgement;
    try {
      judgement = await llm.judgeAnswer({ chinese: sentence.chinese, english: sentence.english, answer });
    } catch (err) {
      console.error('judge failed:', err.message);
      if (err.code === 'content_filtered') {
        return res.status(400).json({ error: 'Your answer was blocked by the safety filter. Please type a normal English sentence.' });
      }
      return res.status(503).json({ error: 'The marker is not available right now. Please try again.' });
    }
    const state = await repo.recordReview(req.userId, sentence, answer, judgement, perthDay(now()));
    res.json({ ...judgement, original: sentence.english, nextReview: state.nextReview });
  }));

  api.get('/stats', wrap(async (req, res) => res.json(await repo.stats(req.userId))));

  app.use('/api', api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('request failed:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const repo = require('./repo');
  const llm = require('./llm');
  const news = require('./news');
  const port = Number(process.env.PORT) || 3000;
  createApp({ repo, llm, news }).listen(port, '0.0.0.0', () => console.log(`daily-english listening on ${port}`));
}
