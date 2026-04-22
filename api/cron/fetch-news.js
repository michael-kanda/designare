import { redis } from '../../lib/redis.js';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── RSS-Feed-Quellen (aktualisiert 2026-03-15) ──
const RSS_FEEDS = [
  // ── Tech allgemein ──
  {
    name: 'heise',
    url: 'https://www.heise.de/rss/heise-top-atom.xml',
    category: 'tech-de',
  },
  {
    name: 't3n',
    url: 'https://t3n.de/rss.xml',
    category: 'tech-de',
  },
  {
    name: 'Hacker News (Frontpage)',
    url: 'https://hnrss.org/frontpage?points=100&count=15',
    category: 'tech-en',
  },
  // ── SEO & Search ──
  {
    name: 'Search Engine Roundtable',
    url: 'https://www.seroundtable.com/index.xml',
    category: 'seo-geo',
  },
  {
    name: 'Search Engine Land',
    url: 'https://searchengineland.com/feed',
    category: 'seo-geo',
  },
  {
    name: 'SEO Südwest',
    url: 'https://www.seo-suedwest.de/?format=feed&type=rss',
    category: 'seo-de-geo',
  },
  // ── WordPress ──
  {
    name: 'WP Tavern',
    url: 'https://wptavern.com/feed',
    category: 'wordpress',
  },
  {
    name: 'WordPress News',
    url: 'https://wordpress.org/news/feed/',
    category: 'wordpress',
  },
];

// ── Konfig ──
const KV_KEY = 'news:latest';          // Haupt-Key für aktuelle News
const KV_KEY_HISTORY = 'news:history';  // Archiv (optional)
const KV_KEY_BRIEFING = 'news:daily-briefing'; // Zusammenfassung für Chatbot
const MAX_ITEMS_PER_FEED = 10;          // Max. Artikel pro Feed
const FETCH_TIMEOUT_MS = 8000;          // Timeout pro Feed (ms)

// ── Hilfsfunktionen ──

/**
 * Einzelnen Feed abrufen und parsen – mit Timeout & Fehlerbehandlung
 */
async function fetchSingleFeed(feed, parser) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NewsBot/1.0 (Vercel Cron)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const parsed = await parser.parseString(xml);

    const items = (parsed.items || []).slice(0, MAX_ITEMS_PER_FEED).map((item) => ({
      title: item.title || '',
      link: item.link || '',
      date: item.isoDate || item.pubDate || null,
      snippet: (item.contentSnippet || item.content || '').slice(0, 300),
      source: feed.name,
      category: feed.category,
    }));

    return { feed: feed.name, ok: true, count: items.length, items };
  } catch (err) {
    console.error(`[fetch-news] Fehler bei "${feed.name}":`, err.message);
    return { feed: feed.name, ok: false, error: err.message, items: [] };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Duplikate anhand der URL entfernen
 */
function deduplicateItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.link || seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

/**
 * Generiert ein News-Briefing per Gemini und speichert es für den Chatbot.
 * Schreibt nach news:daily-briefing (Format das news-service.js erwartet).
 */
async function generateAndSaveBriefing(items, feedSummary) {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[fetch-news] Kein GEMINI_API_KEY – Briefing übersprungen');
    return null;
  }

  try {
    // Top-Artikel für Zusammenfassung vorbereiten (max. 30 für Token-Limit)
    const topItems = items.slice(0, 30);
    const articleList = topItems.map((item, i) =>
      `${i + 1}. [${item.source}] ${item.title}${item.snippet ? ` – ${item.snippet.slice(0, 150)}` : ''}`
    ).join('\n');

    const sources = [...new Set(items.map((item) => item.source))];

    const prompt = `Du bist ein Tech-News-Redakteur. Erstelle ein kompaktes deutsches News-Briefing aus diesen Artikeln.

REGELN:
- Maximal 600 Zeichen
- Gruppiere nach Themen (SEO/Local-SEO, Tech, WordPress)
- Nenne die wichtigsten 3-5 Neuigkeiten in Stichpunkten
- Keine Einleitung, direkt die News
- Wenn SEO, Google-News oder lokale Suchthemen (GEO) dabei sind, priorisiere diese

ARTIKEL:
${articleList}`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const summary = result.response.text();

    // Im Format speichern, das news-service.js erwartet
    const briefingData = {
      summary,
      sources,
      fetchedAt: new Date().toISOString(),
    };

    // TTL: 28 Stunden (Puffer für 12h-Intervall)
    await redis.set(KV_KEY_BRIEFING, JSON.stringify(briefingData), { ex: 100800 });

    console.log(`[fetch-news] Briefing generiert (${summary.length} Zeichen, ${sources.length} Quellen)`);
    return briefingData;
  } catch (err) {
    console.error('[fetch-news] Briefing-Generierung fehlgeschlagen:', err.message);
    return null;
  }
}

// ── Handler (Vercel Serverless Function) ──
export default async function handler(req, res) {
  // Nur Cron / autorisierte Aufrufe zulassen (Header ODER Query-Parameter)
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization === `Bearer ${cronSecret}`;
  const authQuery = req.query?.secret === cronSecret;
  if (cronSecret && !authHeader && !authQuery) {
    return res.status(401).json({ error: 'Nicht autorisiert' });
  }

  console.log(`[fetch-news] Start – ${new Date().toISOString()}`);

  const parser = new Parser({
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': 'NewsBot/1.0 (Vercel Cron)' },
  });

  // Alle Feeds parallel abrufen
  const results = await Promise.allSettled(
    RSS_FEEDS.map((feed) => fetchSingleFeed(feed, parser))
  );

  // Ergebnisse zusammenführen
  const allItems = [];
  const summary = [];

  for (const result of results) {
    const data = result.status === 'fulfilled' ? result.value : { feed: '?', ok: false, error: result.reason?.message, items: [] };
    summary.push({ feed: data.feed, ok: data.ok, count: data.items?.length ?? 0, error: data.error });
    if (data.items) allItems.push(...data.items);
  }

  // Duplikate entfernen & nach Datum sortieren (neueste zuerst)
  const uniqueItems = deduplicateItems(allItems);
  uniqueItems.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });

  // In Vercel KV speichern
  const payload = {
    fetchedAt: new Date().toISOString(),
    totalItems: uniqueItems.length,
    feeds: summary,
    items: uniqueItems,
  };

  try {
    await redis.set(KV_KEY, JSON.stringify(payload));

    // Optional: Historischen Eintrag mit TTL (7 Tage)
    const historyKey = `${KV_KEY_HISTORY}:${new Date().toISOString().slice(0, 10)}`;
    await redis.set(historyKey, JSON.stringify(payload), { ex: 60 * 60 * 24 * 7 });

    console.log(`[fetch-news] Fertig – ${uniqueItems.length} Artikel gespeichert`);
  } catch (kvError) {
    console.error('[fetch-news] Redis-Schreibfehler:', kvError.message);
    return res.status(500).json({ error: 'Redis-Schreibfehler', detail: kvError.message });
  }

  // ── Briefing für Chatbot generieren (news:daily-briefing) ──
  const briefing = await generateAndSaveBriefing(uniqueItems, summary);

  return res.status(200).json({
    ok: true,
    fetchedAt: payload.fetchedAt,
    totalItems: uniqueItems.length,
    feeds: summary,
    briefing: briefing ? { generated: true, chars: briefing.summary.length, sources: briefing.sources.length } : { generated: false },
  });
}
