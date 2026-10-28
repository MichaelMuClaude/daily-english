// Run the real pipeline (feeds, article pages, model) and print the result WITHOUT saving it.
// Usage: node --env-file=.env scripts/preview.js
const news = require('../src/news');
const llm = require('../src/llm');

(async () => {
  const headlines = await news.fetchHeadlines();
  console.log(`headlines: ${headlines.length}`);
  const picks = await llm.pickStories(headlines);
  console.log('picked:', picks.map((i) => headlines[i].title).join('\n        '));
  const stories = await news.loadStories(picks.map((i) => headlines[i]));
  console.log('article text found:', stories.map((s) => `${s.text.length || 'none'}`).join(', '));
  const items = await llm.generateSentences(stories);
  for (const it of items) {
    console.log(`\n${it.english}\n${it.chinese}\n  [${it.topic}] ${it.sourceTitle}`);
  }
})().catch((e) => { console.error('preview failed:', e.message); process.exit(1); });
