export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const response = await fetch('https://www.ft.com/rss/home/uk', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TheDigest/1.0)'
      }
    });

    if (!response.ok) {
      throw new Error('FT feed returned ' + response.status);
    }

    const xml = await response.text();
    const items = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const match of itemMatches) {
      const item = match[1];
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1]?.trim();
      const url = (item.match(/<link>(.*?)<\/link>/) || item.match(/<guid>(.*?)<\/guid>/))?.[1]?.trim();
      const category = (item.match(/<category><!\[CDATA\[(.*?)\]\]><\/category>/) || item.match(/<category>(.*?)<\/category>/))?.[1]?.trim();

      if (title && url) {
        items.push({
          tag: category || 'FT News',
          title: title,
          url: url,
          topic: category || 'General'
        });
      }

      if (items.length >= 10) break;
    }

    return res.status(200).json({ stories: items });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
