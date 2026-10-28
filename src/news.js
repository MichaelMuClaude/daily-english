// Fetch headlines from public RSS feeds. Only the headline, a short summary
// and the link are kept: the LLM writes its own sentences, article text is never stored.
const { XMLParser } = require('fast-xml-parser');

const FEEDS = [
  { name: 'ABC WA', url: 'https://www.abc.net.au/news/feed/13891526/rss.xml' }, // the ABC Perth page's "WA News" collection
  { name: 'WAtoday', url: 'https://www.watoday.com.au/rss/feed.xml' },
  { name: 'ABC National', url: 'https://www.abc.net.au/news/feed/51120/rss.xml' },
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

// ---------- full article text ----------
// The text is read only to let the LLM write its own sentences. It is never stored or logged.
const ARTICLE_HOSTS = /(^|\.)(abc\.net\.au|watoday\.com\.au)$/i;
const MAX_ARTICLE_CHARS = 6000;
const MIN_ARTICLE_CHARS = 400; // shorter than this = paywall stub, video page or error page

function decodeEntities(t) {
  return t
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Pull the readable paragraphs out of an article page. Returns '' when nothing usable is found. */
function extractArticleText(html) {
  let h = String(html)
    .replace(/<(script|style|nav|header|footer|aside|noscript|figure|figcaption|form|button)\b[\s\S]*?<\/\1>/gi, ' ');
  const article = h.match(/<article\b[\s\S]*?<\/article>/i);
  if (article) h = article[0];
  const paras = [...h.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .map((p) => p.replace(/^Advertisement\s*/i, ''))
    .filter((p) => p.length >= 40
      && !/^(More from|Read more|Related|Sign up|Subscribe|Follow )/i.test(p)
      && !p.includes('{"@')
      && !/\((Supplied|ABC News|Reuters|AAP|Getty)[^)]*\)$/i.test(p));
  let out = '';
  for (const p of paras) {
    if (out.length + p.length > MAX_ARTICLE_CHARS) break;
    out += (out ? '\n' : '') + p;
  }
  return out;
}

/** Fetch one article's text; null if the host is not allowed, the page is blocked or too short. */
async function fetchArticleText(url, { fetchImpl = fetch } = {}) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !ARTICLE_HOSTS.test(u.hostname)) return null;
  try {
    const res = await fetchImpl(u.href, {
      headers: { 'User-Agent': 'daily-english/0.1 (learning app; reads a story to write its own sentences)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    if (res.url && !ARTICLE_HOSTS.test(new URL(res.url).hostname)) return null; // redirected somewhere else
    const text = extractArticleText((await res.text()).slice(0, 3_000_000));
    return text.length >= MIN_ARTICLE_CHARS ? text : null;
  } catch {
    return null;
  }
}

/** Add `text` (full article, or '' when unavailable) to each story. Stories with text come first. */
async function loadStories(stories, { fetchImpl = fetch } = {}) {
  const withText = await Promise.all(
    stories.map(async (st) => ({ ...st, text: (await fetchArticleText(st.url, { fetchImpl })) || '' })),
  );
  return [...withText.filter((x) => x.text), ...withText.filter((x) => !x.text)];
}

module.exports = { FEEDS, parseRss, fetchHeadlines, extractArticleText, fetchArticleText, loadStories };
