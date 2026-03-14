// ── RSS-Feed-Quellen (aktualisiert 2026-03-14) ──
const RSS_FEEDS = [
  // ── Tech allgemein ──
  {
    name: 'heise',
    url: 'https://www.heise.de/rss/heise-top-atom.xml',
    category: 'tech-de'
  },
  {
    name: 't3n',
    url: 'https://t3n.de/rss.xml',
    category: 'tech-de'
  },
  {
    name: 'Hacker News (Best)',
    url: 'https://hnrss.org/best?count=15',
    category: 'tech-en'
  },
  // ── SEO & Search ──
  {
    // ✅ FIX: War timeout – ersetzt durch zuverlässigeren Feed
    name: 'Search Engine Roundtable',
    url: 'https://www.seroundtable.com/feed',
    category: 'seo'
  },
  {
    // ✅ FIX: Alte URL (rss.xml) gibt 404 – Atom-Feed funktioniert
    name: 'Google Search Central',
    url: 'https://developers.google.com/search/blog/atom.xml',
    category: 'seo'
  },
  {
    // ✅ FIX: Alte URL (/rss/all-stories.xml) gibt 404 – Joomla-Feed-Format
    name: 'SEO Südwest',
    url: 'https://www.seo-suedwest.de/?format=feed&type=rss',
    category: 'seo-de'
  },
  // ── WordPress ──
  {
    name: 'WP Tavern',
    url: 'https://wptavern.com/feed',
    category: 'wordpress'
  },
  {
    name: 'WordPress News',
    url: 'https://wordpress.org/news/feed/',
    category: 'wordpress'
  }
];
