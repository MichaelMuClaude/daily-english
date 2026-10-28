const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRss, fetchHeadlines } = require('../src/news');

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
