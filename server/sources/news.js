// Headlines via Google News RSS — no API key. One feed URL covers every
// scope by varying the query: national top stories, local (city name), or a
// custom topic. Returns the top 3 titles.

const config = require('../config');

function feedUrl() {
  const { mode, query } = config.get().news;
  if (mode === 'national') {
    return 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';
  }
  const q = mode === 'local' ? config.get().weather.city : query;
  const search = encodeURIComponent((q || '').trim() || 'top stories');
  return `https://news.google.com/rss/search?q=${search}&hl=en-US&gl=US&ceid=US:en`;
}

function decodeEntities(str) {
  return str
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// Google News titles end with " - Publisher"; drop it for a cleaner headline
function stripSource(title) {
  return title.replace(/\s+-\s+[^-]+$/, '').trim();
}

function parseTitles(xml) {
  const items = xml.split('<item>').slice(1);
  const titles = [];
  for (const item of items) {
    const m = item.match(/<title>([\s\S]*?)<\/title>/);
    if (m) {
      const title = stripSource(decodeEntities(m[1]));
      if (title) titles.push({ title });
    }
    if (titles.length >= 3) break;
  }
  return titles;
}

module.exports = {
  key: 'news',
  intervalMs: 15 * 60 * 1000,
  async fetch() {
    const res = await globalThis.fetch(feedUrl(), {
      headers: { 'User-Agent': 'MirrorOS/1.0' },
    });
    if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
    const xml = await res.text();
    const titles = parseTitles(xml);
    if (titles.length === 0) throw new Error('no headlines parsed');
    return titles;
  },
};
