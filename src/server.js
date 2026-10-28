const path = require('path');
const express = require('express');
const { requireUser } = require('./auth');
const { perthDay } = require('./srs');
const { parseExplain } = require('./explain');

const MAX_ANSWER_LEN = 300;
const JUDGE_LIMIT_PER_HOUR = 40; // cost guard: each judged answer is one LLM call
const DAILY_REVIEW_CAP = 10; // most reviews shown per Perth day, most overdue first; the rest wait for tomorrow
const SPEAK_LIMIT_PER_HOUR = 30; // cost guard: each NEW voice recording is one Speech call (replays come from the database)

function createApp({ repo, llm, news, speech, now = () => new Date(), reviewCap = DAILY_REVIEW_CAP }) {
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
        const picks = await llm.pickStories(headlines);
        const stories = await news.loadStories(picks.map((i) => headlines[i]));
        const items = await llm.generateSentences(stories);
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

  const speakCalls = new Map(); // userId -> [timestamps of new syntheses]
  function allowSynthesis(userId) {
    const cutoff = now().getTime() - 3600_000;
    const recent = (speakCalls.get(userId) || []).filter((t) => t > cutoff);
    if (recent.length >= SPEAK_LIMIT_PER_HOUR) { speakCalls.set(userId, recent); return false; }
    recent.push(now().getTime());
    speakCalls.set(userId, recent);
    return true;
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  const api = express.Router();
  api.use(requireUser);
  api.use((req, res, next) => {
    repo.upsertUser(req.user).then((id) => { req.userId = id; next(); }, next);
  });

  api.get('/me', (req, res) => res.json({ email: req.user.email }));

  const shape = (r) => ({ id: r.id, english: r.english, chinese: r.chinese, ...parseExplain(r.explain) });

  // One endpoint drives the whole session: the next new sentence, then the next review, then "done".
  api.get('/next', wrap(async (req, res) => {
    const today = perthDay(now());
    let rows = [];
    try {
      rows = await ensureToday(today);
    } catch (err) {
      // Reviews must still work if today's sentences could not be written.
      console.error('generate failed:', err.message);
    }
    const learned = await repo.learnedIds(req.userId, rows.map((r) => r.id));
    const learnedTotal = await repo.learnedCount(req.userId);
    const fresh = rows.filter((r) => !learned.has(r.id));
    if (fresh.length) {
      return res.json({
        kind: 'learn',
        learnedTotal,
        step: { n: rows.length - fresh.length + 1, of: rows.length },
        sentence: shape(fresh[0]),
      });
    }
    const [item, due, doneToday] = await Promise.all([
      repo.nextDue(req.userId, today), repo.dueCount(req.userId, today), repo.reviewedToday(req.userId, today),
    ]);
    const room = Math.max(0, reviewCap - doneToday);
    if (item && room > 0) {
      return res.json({ kind: 'review', learnedTotal, left: Math.min(due, room), item: { id: item.id, chinese: item.chinese } });
    }
    if (!rows.length && !item) {
      return res.status(503).json({ error: "Today's sentences are not ready yet. Please try again in a minute." });
    }
    res.json({ kind: 'done', learnedTotal, ...(due > 0 ? { waiting: due } : {}) });
  }));

  // The sentence read aloud by the cloud neural voice. Generated once, then served from the database.
  api.get('/speak/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad sentence id' });
    const row = await repo.sentenceForAudio(req.userId, id, perthDay(now()));
    if (!row) return res.status(404).json({ error: 'Unknown sentence' });
    let audio = row.audio;
    if (!audio || !audio.length) {
      if (!allowSynthesis(req.userId)) return res.status(429).json({ error: 'Too many new recordings this hour.' });
      try {
        audio = await speech.synthesize(row.english);
      } catch (err) {
        console.error('speech failed:', err.message);
        return res.status(503).json({ error: 'The voice is not available right now.' });
      }
      await repo.saveAudio(row.id, audio);
    }
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'private, max-age=86400' });
    res.send(audio);
  }));

  api.post('/learn', wrap(async (req, res) => {
    const id = Number(req.body?.sentenceId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'sentenceId required' });
    const ok = await repo.markLearned(req.userId, id, perthDay(now()));
    if (!ok) return res.status(404).json({ error: 'Unknown sentence' });
    res.json({ ok: true });
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
    res.json({
      ...judgement,
      original: sentence.english,
      nextReview: state.nextReview,
      ...parseExplain(sentence.explain),
    });
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
  const speech = require('./speech');
  createApp({ repo, llm, news, speech }).listen(port, '0.0.0.0', () => console.log(`daily-english listening on ${port}`));
}
