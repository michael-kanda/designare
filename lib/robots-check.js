// api/lib/robots-check.js
// Prüft robots.txt gegen bekannte KI-Crawler und checkt llms.txt-Existenz.
// Das ist einer der WICHTIGSTEN KI-Sichtbarkeits-Faktoren: Wenn ein Crawler
// via robots.txt geblockt ist, kann die KI den Inhalt niemals lernen.

import { safeFetch } from './ssrf-guard.js';

// Relevante KI-Bots (Training + Live-Browsing)
export const AI_CRAWLERS = [
  { name: 'GPTBot',              vendor: 'OpenAI',     purpose: 'training' },
  { name: 'OAI-SearchBot',       vendor: 'OpenAI',     purpose: 'search'   },
  { name: 'ChatGPT-User',        vendor: 'OpenAI',     purpose: 'browsing' },
  { name: 'Google-Extended',     vendor: 'Google',     purpose: 'training' },
  { name: 'Googlebot',           vendor: 'Google',     purpose: 'search'   },
  { name: 'ClaudeBot',           vendor: 'Anthropic',  purpose: 'training' },
  { name: 'Claude-Web',          vendor: 'Anthropic',  purpose: 'browsing' },
  { name: 'PerplexityBot',       vendor: 'Perplexity', purpose: 'search'   },
  { name: 'Perplexity-User',     vendor: 'Perplexity', purpose: 'browsing' },
  { name: 'Applebot-Extended',   vendor: 'Apple',      purpose: 'training' },
  { name: 'CCBot',               vendor: 'CommonCrawl',purpose: 'training' },
  { name: 'Bytespider',          vendor: 'ByteDance',  purpose: 'training' },
  { name: 'meta-externalagent',  vendor: 'Meta',       purpose: 'training' },
];

// ────────────────────────────────────────────────────────────
// robots.txt Parser
// Liefert pro User-Agent die anwendbaren Allow/Disallow-Regeln.
// Wir prüfen auf "Disallow: /" als Total-Block.
// ────────────────────────────────────────────────────────────
function parseRobotsTxt(text) {
  const groups = [];
  let current = null;

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    // Kommentare und Whitespace entfernen
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const match = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!match) continue;

    const field = match[1].toLowerCase();
    const value = match[2].trim();

    if (field === 'user-agent') {
      // Neue Gruppe starten (bei mehreren consecutive User-Agents → gleiche Gruppe)
      if (current && current.rules.length > 0) {
        groups.push(current);
        current = null;
      }
      if (!current) current = { userAgents: [], rules: [] };
      current.userAgents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.rules.push({ type: field, path: value });
    }
  }
  if (current) groups.push(current);
  return groups;
}

// Prüft: Ist dieser spezifische User-Agent durch irgendeine Gruppe von "/" blockiert?
function isBlockedFromRoot(botName, groups) {
  const botLower = botName.toLowerCase();
  let wildcardBlocked = false;
  let specificExplicit = null; // true = blocked, false = allowed, null = no specific rule

  for (const group of groups) {
    const appliesSpecific = group.userAgents.includes(botLower);
    const appliesWildcard = group.userAgents.includes('*');
    if (!appliesSpecific && !appliesWildcard) continue;

    // "Disallow: /" → Total-Block
    const blocksRoot = group.rules.some(r => r.type === 'disallow' && r.path === '/');
    // "Disallow:" (leer) oder "Allow: /" → explizit erlaubt
    const allowsAll = group.rules.some(r =>
      (r.type === 'disallow' && r.path === '') ||
      (r.type === 'allow' && r.path === '/')
    );

    if (appliesSpecific) {
      // Spezifische Regel übersteuert Wildcard
      if (blocksRoot) specificExplicit = true;
      else if (allowsAll) specificExplicit = false;
      else specificExplicit = specificExplicit ?? false; // Andere Regeln → nicht Total-Block
    } else if (appliesWildcard) {
      if (blocksRoot) wildcardBlocked = true;
    }
  }

  // Spezifische Regel hat Vorrang
  if (specificExplicit !== null) return specificExplicit;
  return wildcardBlocked;
}

// ────────────────────────────────────────────────────────────
// Haupt-Check
// ────────────────────────────────────────────────────────────
export async function checkAICrawlerAccess(domain, { timeoutMs = 5000 } = {}) {
  const result = {
    robotsTxtFound: false,
    llmsTxtFound: false,
    blockedCrawlers: [],   // [{ name, vendor, purpose }]
    allowedCrawlers: [],
    unclearCrawlers: [],   // bei Fetch-Fehlern etc.
    error: null,
  };

  // robots.txt
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await safeFetch(`https://${domain}/robots.txt`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIVisibilityCheck/2.0; +https://designare.at/ki-sichtbarkeit)' },
    });
    clearTimeout(t);

    if (res.ok) {
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      // robots.txt sollte text/plain sein, manche Server senden text/html bei 404-Fallback
      if (contentType.includes('text/plain') || contentType.includes('text/') || contentType === '') {
        const text = await res.text();
        // Heuristik: Echte robots.txt enthält mindestens 'user-agent' oder 'disallow'
        if (/^\s*user-agent\s*:/im.test(text) || /^\s*disallow\s*:/im.test(text)) {
          result.robotsTxtFound = true;
          const groups = parseRobotsTxt(text);

          for (const bot of AI_CRAWLERS) {
            if (isBlockedFromRoot(bot.name, groups)) {
              result.blockedCrawlers.push(bot);
            } else {
              result.allowedCrawlers.push(bot);
            }
          }
        }
      }
    }
  } catch (e) {
    result.error = `robots.txt: ${e.message}`;
    // Bei Fehler: alle Bots als "unklar" markieren
    result.unclearCrawlers = [...AI_CRAWLERS];
  }

  // ── llms.txt (Bonus-Check) ─────────────────────────────────
  // Versuche zuerst die übergebene Domain, dann die www/apex-Variante.
  // Behandelt typische Fehlfälle: Catch-all-HTML mit 200, www-Redirect-Probleme,
  // sehr knappe llms.txt-Dateien.
  const llms = await probeLlmsTxt(domain, timeoutMs);
  result.llmsTxtFound = llms.found;
  if (llms.found) {
    console.log(`   llms.txt: gefunden (${llms.host})`);
  } else {
    console.log(`   llms.txt: nicht gefunden — ${llms.reason}`);
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// llms.txt-Probe mit www/apex-Fallback und sauberer Content-Sanity
// ────────────────────────────────────────────────────────────
async function probeLlmsTxt(host, timeoutMs) {
  // Reihenfolge: zuerst übergebene Variante, dann die jeweils andere
  const candidates = [host];
  if (host.startsWith('www.')) {
    candidates.push(host.slice(4));            // www.x.tld → x.tld
  } else {
    candidates.push('www.' + host);            // x.tld → www.x.tld
  }

  const reasons = [];
  for (const h of candidates) {
    const r = await fetchLlmsTxtOnce(h, timeoutMs);
    if (r.found) return { found: true, host: h, reason: null };
    reasons.push(`${h}: ${r.reason}`);
  }
  return { found: false, host: null, reason: reasons.join(' | ') };
}

async function fetchLlmsTxtOnce(host, timeoutMs) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await safeFetch(`https://${host}/llms.txt`, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIVisibilityCheck/2.0; +https://designare.at/ki-sichtbarkeit)',
        'Accept': 'text/markdown, text/plain, text/*;q=0.9, */*;q=0.5',
      },
    });
    clearTimeout(t);

    if (!res.ok) return { found: false, reason: `HTTP ${res.status}` };

    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    // Server liefert HTML zurück → fast immer Catch-all/SPA-Fallback, KEINE echte llms.txt
    if (ctype.includes('text/html') || ctype.includes('application/xhtml')) {
      return { found: false, reason: `HTML statt Markdown (${ctype})` };
    }

    const raw = await res.text();
    const txt = raw.slice(0, 4000).trim();

    if (txt.length < 5) return { found: false, reason: 'Body leer' };

    // Body sieht trotz fehlendem/falschem Content-Type wie HTML aus → ablehnen
    if (/^<!doctype\s+html\b|^<html\b|^<\?xml\b[\s\S]*?<html\b/i.test(txt)) {
      return { found: false, reason: 'HTML-Body trotz non-HTML Content-Type' };
    }

    return { found: true, reason: null };
  } catch (e) {
    return { found: false, reason: e.message || 'fetch error' };
  }
}
