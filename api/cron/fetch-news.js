// api/cron/fetch-news.js - Täglicher News-Cron für Evita
// Läuft morgens via Vercel Cron, fetcht RSS-Feeds, lässt Gemini zusammenfassen
import { GoogleGenerativeAI } from '@google/generative-ai';
import { saveNewsBriefing } from '../../lib/news-service.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── RSS-Feed-Quellen ──
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
    name: 'Search Engine Journal',
    url: 'https://www.searchenginejournal.com/feed/',
    category: 'seo'
  },
  {
    name: 'Google Search Central',
    url: 'https://developers.google.com/search/blog/rss.xml',
    category: 'seo'
  },
  {
    name: 'SEO Südwest',
    url: 'https://www.seo-suedwest.de/rss/all-stories.xml',
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

const MAX_ITEMS_PER_FEED = 10;

/**
 * Einfacher RSS/Atom-Parser (kein xml2js nötig).
 * Extrahiert Titel + Link aus <item> oder <entry> Elementen.
 */
function parseRSS(xml) {
  const items = [];

  // RSS 2.0: <item><title>...</title><link>...</link></item>
  const rssMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g);
  for (const match of rssMatches) {
    const titleMatch = match[1].match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
    const linkMatch = match[1].match(/<link[^>]*>(.*?)<\/link>/);
    if (titleMatch) {
      items.push({
        title: titleMatch[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'),
        link: linkMatch ? linkMatch[1].trim() : ''
      });
    }
  }

  // Atom: <entry><title>...</title><link href="..."/></entry>
  if (items.length === 0) {
    const atomMatches = xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/g);
    for (const match of atomMatches) {
      const titleMatch = match[1].match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
      const linkMatch = match[1].match(/<link[^>]*href=["']([^"']+)["']/);
      if (titleMatch) {
        items.push({
          title: titleMatch[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
          link: linkMatch ? linkMatch[1].trim() : ''
        });
      }
    }
  }

  return items.slice(0, MAX_ITEMS_PER_FEED);
}

/**
 * Fetcht alle RSS-Feeds parallel.
 */
async function fetchAllFeeds() {
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      try {
        const response = await fetch(feed.url, {
          headers: { 'User-Agent': 'Evita-NewsBot/1.0 (designare.at)' },
          signal: AbortSignal.timeout(8000) // 8s Timeout
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const xml = await response.text();
        const items = parseRSS(xml);
        console.log(`📰 ${feed.name}: ${items.length} Items`);
        return { feed: feed.name, category: feed.category, items };
      } catch (err) {
        console.warn(`⚠️ Feed ${feed.name} fehlgeschlagen: ${err.message}`);
        return { feed: feed.name, category: feed.category, items: [] };
      }
    })
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(r => r.items.length > 0);
}

/**
 * Lässt Gemini die Headlines zu einem kompakten Briefing zusammenfassen.
 */
async function generateBriefing(feedResults) {
  const allHeadlines = feedResults.flatMap(f =>
    f.items.map(item => `[${f.feed}] ${item.title}`)
  );

  if (allHeadlines.length === 0) {
    return { summary: '', sources: [] };
  }

  const prompt = `Du bist ein Tech-News-Kurator für eine Webentwicklungs-Agentur. Hier sind die heutigen Headlines aus verschiedenen Quellen:

${allHeadlines.join('\n')}

Erstelle ein KURZES Briefing (max. 6-8 Sätze, deutsch) mit den 4-6 relevantesten Themen/Trends des Tages. Decke dabei DREI Bereiche ab, sofern es relevante News gibt:
1. **Tech/KI** – Allgemeine Tech-Trends, KI/AI-Entwicklungen
2. **SEO/Search** – Google-Updates, Ranking-Änderungen, Search Console, Core Web Vitals
3. **WordPress** – Plugin-Updates, Core-Releases, Gutenberg, Sicherheitslücken

Formuliere es so, dass eine Chat-Assistentin ("Evita") das Wissen beiläufig in Gespräche einfließen lassen kann – NICHT als Nachrichtensendung, sondern als "was heute in der Tech-Welt los ist". Keine Links, keine Quellenangaben, keine Aufzählungen. Natürlicher Fließtext.`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    console.log(`📰 Briefing generiert: ${text.length} Zeichen`);
    return {
      summary: text,
      sources: feedResults.map(f => f.feed)
    };
  } catch (err) {
    console.error('❌ Gemini Briefing-Fehler:', err.message);
    // Fallback: Einfache Headline-Liste
    const fallback = allHeadlines.slice(0, 5).map(h => h.replace(/^\[.*?\]\s*/, '')).join('; ');
    return {
      summary: `Heutige Tech-Headlines: ${fallback}`,
      sources: feedResults.map(f => f.feed)
    };
  }
}

// ── Vercel Serverless Handler ──
export default async function handler(req, res) {
  console.log('📰 News-Cron gestartet');

  try {
    // Vercel Cron Auth prüfen
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      // Fallback: auch CRON_SECRET als Query erlauben (Vercel-Style)
      if (req.headers['x-vercel-cron'] !== '1' && !process.env.VERCEL) {
        console.warn('⚠️ Unauthorized Cron-Aufruf');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const feedResults = await fetchAllFeeds();

    if (feedResults.length === 0) {
      console.log('📰 Keine Feeds verfügbar, überspringe Briefing');
      return res.status(200).json({ message: 'No feeds available', skipped: true });
    }

    const { summary, sources } = await generateBriefing(feedResults);

    if (summary) {
      await saveNewsBriefing(summary, sources);
    }

    return res.status(200).json({
      message: 'News-Briefing aktualisiert',
      sources,
      summaryLength: summary.length
    });

  } catch (error) {
    console.error('❌ News-Cron Fehler:', error);
    return res.status(500).json({ error: error.message });
  }
}
