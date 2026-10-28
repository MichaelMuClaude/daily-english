// Fetch headlines from public RSS feeds. Only the headline, a short summary
// and the link are kept: the LLM writes its own sentences, article text is never stored.
const { XMLParser } = require('fast-xml-parser');

const FEEDS = [
  { name: 'WAtoday', url: 'https://www.watoday.com.au/rss/feed.xml' },
  { name: 'ABC News', url: 'https://www.abc.net.au/news/feed/51120/rss.xml' },
];

const parser = new XMLParser({ ignoreAttributes: true, processEntities: true });

function text(v) {
  if (v == null) return '';
  return String(typeof v === 'object' ? (v['#text'] ?? '') : v).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** Parse RSS 2.0 XML into [{title, summary, url}]. */
function parseRss(xml, source = '') {
  const doc = parser.parse(xml);
  let items = doc?.rss?.channel?.item ?? [];
  if (!Array.isArray(items)) items = [items];
  return items
    .map((it) => ({
      title: text(it.title),
      summary: text(it.description).slice(0, 300),
      url: text(it.link),
      source,
    }))
    .filter((it) => it.title && /^https?:\/\//.test(it.url));
}

async function fetchFeed(feed, fetchImpl = fetch) {
  const res = await fetchImpl(feed.url, {
    headers: { 'User-Agent': 'daily-english/0.1 (learning app; headlines only)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${feed.name}: HTTP ${res.status}`);
  return parseRss(await res.text(), feed.name);
}

/** Headlines from all feeds. A failing feed is skipped; throws only if none work. */
async function fetchHeadlines({ feeds = FEEDS, perFeed = 25, fetchImpl = fetch } = {}) {
  const results = await Promise.allSettled(feeds.map((f) => fetchFeed(f, fetchImpl)));
  const items = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value.slice(0, perFeed));
  if (!items.length) throw new Error('No news feed could be read');
  return items;
}

module.exports = { FEEDS, parseRss, fetchHeadlines };
