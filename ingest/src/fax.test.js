import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFaxFeed } from './fax.js';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title><![CDATA[Fax Sports]]></title>
    <item>
      <title><![CDATA[New York Mest Acquire USA Soccer]]></title>
      <description><![CDATA[QUEENS, NY — Just hours after...]]></description>
      <link>https://www.mlbonfax.com/post/new-york-mest</link>
      <guid isPermaLink="false">6a4ef7345889</guid>
      <pubDate>Thu, 09 Jul 2026 01:28:54 GMT</pubDate>
    </item>
    <item>
      <title><![CDATA[Second Headline]]></title>
      <description><![CDATA[Excerpt two.]]></description>
      <link>https://www.mlbonfax.com/post/second</link>
      <guid>abc123</guid>
      <pubDate>Fri, 10 Jul 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

test('parseFaxFeed extracts items with CDATA stripped', () => {
  const posts = parseFaxFeed(SAMPLE_RSS);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].title, 'New York Mest Acquire USA Soccer');
  assert.equal(posts[0].excerpt, 'QUEENS, NY — Just hours after...');
  assert.equal(posts[0].link, 'https://www.mlbonfax.com/post/new-york-mest');
  assert.equal(posts[0].guid, '6a4ef7345889');
  assert.equal(posts[0].pubDate, 'Thu, 09 Jul 2026 01:28:54 GMT');
});

test('parseFaxFeed handles plain (non-CDATA) text', () => {
  const xml = `<rss><channel>
    <item><title>Plain Title</title><link>https://x/y</link></item>
  </channel></rss>`;
  const posts = parseFaxFeed(xml);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Plain Title');
  assert.equal(posts[0].link, 'https://x/y');
  assert.equal(posts[0].excerpt, '');
  assert.equal(posts[0].guid, '');
});

test('parseFaxFeed returns empty array for feed with no items', () => {
  const posts = parseFaxFeed('<rss><channel></channel></rss>');
  assert.deepEqual(posts, []);
});

test('parseFaxFeed returns empty array for malformed/non-xml input', () => {
  assert.deepEqual(parseFaxFeed('not xml at all'), []);
  assert.deepEqual(parseFaxFeed(''), []);
});
