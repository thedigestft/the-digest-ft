// api/headlines.js
// Pulls from multiple quality news sources, deduplicates by story, returns the best version of each

const FEEDS = [
  {
    url:      'https://www.ft.com/rss/home/uk',
    source:   'FT',
    priority: 1,  // highest — prefer FT when stories clash
  },
  {
    url:      'https://feeds.bbci.co.uk/news/business/rss.xml',
    source:   'BBC',
    priority: 2,
  },
  {
    url:      'https://www.theguardian.com/uk/business/rss',
    source:   'Guardian',
    priority: 3,
  },
  {
    url:      'https://feeds.skynews.com/feeds/rss/business.xml',
    source:   'Sky News',
    priority: 4,
  },
];

// ── RSS parsing ────────────────────────────────────────────────────────────
function extractTag(xml, source) {
  // Try to get a meaningful category from the RSS item
  const cat = (
    xml.match(/<category><!\[CDATA\[(.*?)\]\]><\/category>/)?.[1] ||
    xml.match(/<category[^>]*>(.*?)<\/category>/)?.[1] ||
    ''
  ).trim();

  if (cat) return cap(cat.split('/').pop().split('|')[0].trim());

  // Fall back to source-based defaults
  return source === 'FT' ? 'FT News' : source + ' Business';
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function guessTopic(title) {
  const t = title.toLowerCase();
  if (/\b(bank|rate|interest|inflation|boe|federal reserve|ecb|chancellor|budget|gdp|recession|economy|growth|unemployment|jobs|wages)\b/.test(t)) return 'Economics';
  if (/\b(stock|market|ftse|dow|nasdaq|s&p|share|equit|fund|invest|bond|yield|trade war|tariff)\b/.test(t)) return 'Markets';
  if (/\b(oil|gas|energy|opec|renewab|solar|wind|climate|carbon|coal|electric)\b/.test(t)) return 'Energy';
  if (/\b(tech|ai|artificial intelligence|apple|google|microsoft|amazon|meta|openai|chip|cyber|software)\b/.test(t)) return 'Technology';
  if (/\b(property|housing|house|mortgage|rent|landlord)\b/.test(t)) return 'Property';
  if (/\b(retail|consumer|spend|high street|amazon|ebay|shop)\b/.test(t)) return 'Retail';
  return 'Business';
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TheDigest/1.0)' },
      signal:  AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const xml   = await res.text();
    const items = [];

    for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const item  = match[1];
      const title = (
        item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
        item.match(/<title[^>]*>(.*?)<\/title>/)?.[1]
      )?.trim();

      // Skip obviously bad titles
      if (!title || title.length < 15) continue;

      const url = (
        item.match(/<link>(.*?)<\/link>/)?.[1] ||
        item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]
      )?.trim();

      if (!url || !url.startsWith('http')) continue;

      const tag   = extractTag(item, feed.source);
      const topic = guessTopic(title);

      items.push({
        tag,
        title,
        url,
        topic,
        source:   feed.source,
        priority: feed.priority,
      });

      if (items.length >= 15) break; // cap per source
    }

    return items;
  } catch {
    return []; // silently skip broken feeds
  }
}

// ── Deduplication ─────────────────────────────────────────────────────────
const STOP = new Set([
  'the','a','an','in','on','at','to','for','of','and','or','but',
  'is','are','was','were','has','have','had','with','from','by',
  'as','it','its','be','this','that','will','would','could','should',
  'may','might','can','not','no','more','new','said','says','over',
  'after','before','amid','into','about','than','up','down','out',
]);

function keywords(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w));
}

function sameStory(a, b) {
  const ka = new Set(keywords(a));
  const kb = keywords(b);
  const overlap = kb.filter(w => ka.has(w)).length;
  // 3+ shared keywords = same story
  return overlap >= 3;
}

function deduplicate(stories) {
  // Sort by priority (FT first) so we keep the best source's version
  stories.sort((a, b) => a.priority - b.priority);

  const kept = [];
  for (const story of stories) {
    if (!kept.some(k => sameStory(k.title, story.title))) {
      kept.push(story);
    }
  }
  return kept;
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch all feeds in parallel
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const all     = results.flat();

    if (all.length === 0) {
      return res.status(500).json({ error: 'All news feeds failed to load' });
    }

    const stories = deduplicate(all).slice(0, 20); // max 20 unique stories

    // Strip internal priority field before returning
    const clean = stories.map(({ priority, ...rest }) => rest);

    return res.status(200).json({ stories: clean });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
