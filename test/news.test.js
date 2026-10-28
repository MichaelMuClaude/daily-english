const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRss, fetchHeadlines, extractArticleText, fetchArticleText, loadStories } = require('../src/news');

const XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
<item><title>Bus fares rise in Perth</title><link>https://example.com/a</link><description><![CDATA[<p>Fares go up <b>next month</b>.</p>]]></description></item>
<item><title>No link here</title><description>x</description></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

test('parseRss keeps valid items, strips tags, drops items without an http(s) link', () => {
  const items = parseRss(XML, 'Test');
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { title: 'Bus fares rise in Perth', summary: 'Fares go up next month.', url: 'https://example.com/a', source: 'Test' });
});

test('parseRss handles a feed with a single item', () => {
  const one = '<rss><channel><item><title>T</title><link>https://e.com/x</link></item></channel></rss>';
  assert.equal(parseRss(one).length, 1);
});

test('fetchHeadlines skips a failing feed but throws when all fail', async () => {
  const feeds = [{ name: 'good', url: 'https://good' }, { name: 'bad', url: 'https://bad' }];
  const fetchImpl = async (url) => (url === 'https://good'
    ? { ok: true, text: async () => XML }
    : { ok: false, status: 500 });
  assert.equal((await fetchHeadlines({ feeds, fetchImpl })).length, 1);
  await assert.rejects(fetchHeadlines({ feeds: [feeds[1]], fetchImpl }), /No news feed/);
});

const PARA = 'Western Australia is set to become the first state to lift the ban on plug-in solar panels and batteries for renters.';
const PAGE = (extra = '') => `<html><head><script>var x = "<p>${PARA}</p>";</script></head><body>
<nav><p>More from ABC Close menu ABC News ABC iview ABC listen Kids and Students</p></nav>
<article><h1>Title</h1><figure><figcaption><p>${PARA} (Supplied: Someone)</p></figcaption></figure>
<p>Advertisement${PARA}</p><p>Renters &amp; apartment dwellers could save hundreds of dollars on their power bills each year, the minister said.</p>
<p>Short.</p><p>Read more about the energy rollout across the whole country this year and what it means.</p>${extra}</article>
<footer><p>Copyright notice and terms of use that nobody wants to read at the bottom of the page.</p></footer></body></html>`;

test('extractArticleText keeps real paragraphs and drops scripts, nav, captions, footers, ads, short lines', () => {
  const t = extractArticleText(PAGE());
  assert.match(t, /^Western Australia is set to become/); // "Advertisement" prefix removed
  assert.match(t, /Renters & apartment dwellers/);        // entities decoded
  assert.doesNotMatch(t, /Close menu|Copyright notice|Supplied|Short\.|Read more about/);
  assert.equal(t.split('\n').length, 2);
});

test('extractArticleText caps the length', () => {
  const long = Array.from({ length: 100 }, (_, i) => `<p>${PARA} Number ${i}.</p>`).join('');
  assert.ok(extractArticleText(`<article>${long}</article>`).length <= 6000);
});

const okFetch = (html, url = 'https://www.abc.net.au/news/a') => async () => ({ ok: true, url, text: async () => html });
const bigPage = PAGE(`<p>${'More detail about the story that goes on for a while. '.repeat(10)}</p>`);

test('fetchArticleText returns text for an allowed host', async () => {
  const t = await fetchArticleText('https://www.abc.net.au/news/a', { fetchImpl: okFetch(bigPage) });
  assert.match(t, /plug-in solar/);
});

test('fetchArticleText refuses other hosts, plain http, bad URLs and never even fetches them', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, url: 'x', text: async () => bigPage }; };
  for (const u of ['https://evil.example.com/a', 'http://www.abc.net.au/a', 'https://abc.net.au.evil.com/a', 'not a url', 'file:///etc/passwd']) {
    assert.equal(await fetchArticleText(u, { fetchImpl }), null, u);
  }
  assert.equal(calls, 0);
});

test('fetchArticleText refuses a redirect to another host, short pages, HTTP errors and exceptions', async () => {
  assert.equal(await fetchArticleText('https://www.abc.net.au/a', { fetchImpl: okFetch(bigPage, 'https://evil.example.com/x') }), null);
  assert.equal(await fetchArticleText('https://www.abc.net.au/a', { fetchImpl: okFetch('<article><p>Subscribe to keep reading this story.</p></article>') }), null);
  assert.equal(await fetchArticleText('https://www.abc.net.au/a', { fetchImpl: async () => ({ ok: false, status: 403 }) }), null);
  assert.equal(await fetchArticleText('https://www.abc.net.au/a', { fetchImpl: async () => { throw new Error('boom'); } }), null);
});

test('loadStories attaches text and puts stories with text first', async () => {
  const fetchImpl = async (url) => (url.includes('/ok')
    ? { ok: true, url, text: async () => bigPage }
    : { ok: false, status: 500 });
  const out = await loadStories([
    { title: 'blocked', url: 'https://www.abc.net.au/blocked', summary: 's1' },
    { title: 'fine', url: 'https://www.abc.net.au/ok', summary: 's2' },
  ], { fetchImpl });
  assert.deepEqual(out.map((o) => o.title), ['fine', 'blocked']);
  assert.ok(out[0].text.length > 300);
  assert.equal(out[1].text, '');
});
