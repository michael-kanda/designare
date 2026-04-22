// api/ai-visibility-check.js - KI-Sichtbarkeits-Check
//
// ── CHANGELOG v3 ─────────────────────────────────────────────
// SECURITY:
//   + SSRF-Schutz gehärtet (IPv6, Port-Whitelist, Protokoll-Whitelist,
//     DNS-Rebinding-Mitigation) — ausgelagert nach ./lib/ssrf-guard.js
//   + Content-Type-Check beim HTML-Fetch (keine PDF-Parser-Versuche)
//   + User-Agent mit Kontakt-URL (transparenter, weniger WAF-Blocks)
// METHODIK:
//   + robots.txt-Check für KI-Crawler (GPTBot, Google-Extended, ClaudeBot, etc.)
//     → oft wichtigster Block gegen KI-Sichtbarkeit, war bisher unerkannt
//   + llms.txt-Existenz-Check als Bonus
//   + Schema-Typen-Bonus für FAQPage/HowTo/Article/Review/Product
//   + Gemini Tests 2+3 parallel (statt sequentiell) → ~5s schneller
//   + Sentiment-Analyse gebündelt in 1 LLM-Call statt 6 → günstiger + schneller
//   + Competitor-Extraktion: Grounding-Metadaten bevorzugt vor Regex
// LOGIC:
//   + Score-Gewichte schalten auf "withoutChatGPT" wenn ChatGPT-Tests fehlschlagen
//     (vorher: User bekam niedrigeren Score ohne Eigenverschulden)
//   + Null-safe Zugriff auf cachedResult.meta
// REPORT:
//   + Signed Report Token (HMAC) im Response
//   + Separater Report-Cache (7 Tage) damit E-Mail-Versand auch nach Cache-Expiry
//     des Primär-Caches funktioniert

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as cheerio from 'cheerio';
import { Redis } from '@upstash/redis';

import { checkRateLimit, incrementRateLimit, getClientIP } from './rate-limiter.js';
import { trackVisibilityCheckStats } from './evita-track.js';

import { chatGPTQuery, detectIndustryFromResponse } from './vis-ai-clients.js';
import {
  isDomainMentioned,
  isSubstantialBusinessResponse,
  validateAndCleanDomain,
  sanitizeIndustry,
  extractCompanyName,
} from './vis-domain-detection.js';
import { escapeHTML, stripHTML, formatResponseText } from './vis-text-formatting.js';
import { analyzeSentiment } from './vis-sentiment.js'; // Legacy-Fallback
import { trackVisibilityCheck, sendCheckNotification } from './vis-notifications.js';
import { CACHE_VERSION, SCORE_WEIGHTS } from './vis-constants.js';

// ── NEU: Module ──
import { safeFetch } from './ssrf-guard.js';
import { checkAICrawlerAccess } from './robots-check.js';
import { runTestsAndBuildResponse } from './vis-tests-runner.js';
import {
  CRAWL_USER_AGENT,
  VALUABLE_SCHEMA_TYPES,
  safeSignToken,
} from './vis-helpers.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const redis = Redis.fromEnv();

const DAILY_LIMIT = 3;

// ────────────────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const clientIP = getClientIP(req);
  const rateCheck = await checkRateLimit(clientIP, 'visibility', DAILY_LIMIT);

  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      message: 'Tageslimit erreicht (3 Checks pro Tag). Bitte morgen wieder versuchen.',
      remaining: 0,
    });
  }

  try {
    const { domain, industry, brandName, standort } = req.body || {};

    // sanitizeIndustry macht: trim + 100-char cap + gefährliche Zeichen raus.
    // Dasselbe wenden wir auf brandName und standort an, damit unvalidierter
    // User-Input nicht in LLM-Prompts oder Logs landet.
    const cleanBrand    = sanitizeIndustry(brandName);
    const cleanStandort = sanitizeIndustry(standort);
    const locationHint  = cleanStandort ? ` Standort/Region: ${cleanStandort}.` : '';

    let cleanDomain = null;
    if (domain?.trim()) {
      const v = validateAndCleanDomain(domain);
      if (!v.valid) return res.status(400).json({ success: false, message: v.error });
      cleanDomain = v.domain;
    }
    if (!cleanDomain && !cleanBrand) {
      return res.status(400).json({ success: false, message: 'Bitte gib eine Domain oder einen Firmennamen ein.' });
    }

    const searchLabel = cleanDomain || cleanBrand;
    const hasDomain = !!cleanDomain;
    const cleanIndustry = sanitizeIndustry(industry);

    // ── Cache-Key ──
    const brandSuffix    = cleanBrand    ? `:${cleanBrand.toLowerCase().replace(/\s+/g, '-')}` : '';
    const locationSuffix = cleanStandort ? `:${cleanStandort.toLowerCase().replace(/\s+/g, '-')}` : '';
    const industrySuffix = cleanIndustry ? `:${cleanIndustry.toLowerCase().replace(/\s+/g, '-')}` : '';
    const cacheKey = `visibility_${CACHE_VERSION}:${cleanDomain || 'brand'}${brandSuffix}${locationSuffix}${industrySuffix}`;

    // Cache-Hit?
    try {
      const cachedResult = await redis.get(cacheKey);
      if (cachedResult) {
        console.log(`⚡ CACHE HIT (${CACHE_VERSION}): ${searchLabel}`);
        // Null-safe meta update
        cachedResult.meta = cachedResult.meta || {};
        cachedResult.meta.remainingChecks = rateCheck.remaining;
        cachedResult.cached = true;
        // Neuen Token erzeugen (Token ist zeitgebunden)
        cachedResult.reportToken = safeSignToken(cacheKey);
        return res.status(200).json(cachedResult);
      }
    } catch (e) {
      console.warn(`⚠️ Cache Error: ${e.message}`);
    }

    console.log(`🔍 AI Visibility Check: ${searchLabel} (Branche: ${cleanIndustry || 'auto'})`);
    await incrementRateLimit(clientIP, 'visibility');

    const modelWithSearch = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { temperature: 0.2, maxOutputTokens: 1500 },
    });
    const modelLight = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
    });

    // ──────────────────────────────────────────────────────
    // PHASE 1: Domain-Analyse (Crawl + robots.txt + Schema)
    // ──────────────────────────────────────────────────────
    let domainAnalysis = {
      hasSchema: false,
      schemaTypes: [],
      valuableSchemaCount: 0,
      hasAboutPage: false,
      hasContactPage: false,
      hasAuthorInfo: false,
      title: '',
      description: '',
      crawlError: null,
    };
    let crawlerAccess = null;

    if (hasDomain) {
      // robots.txt parallel zum HTML-Crawl
      const crawlerCheckPromise = checkAICrawlerAccess(cleanDomain, { timeoutMs: 5000 })
        .catch(e => ({ error: e.message, robotsTxtFound: false, llmsTxtFound: false, blockedCrawlers: [], allowedCrawlers: [], unclearCrawlers: [] }));

      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 10_000);

        const response = await safeFetch(`https://${cleanDomain}`, {
          signal: ctrl.signal,
          headers: { 'User-Agent': CRAWL_USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
        });

        clearTimeout(timeout);

        // ── Content-Type check ──
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          throw new Error(`Unerwarteter Content-Type: ${contentType || 'unknown'} (erwartet: text/html)`);
        }

        // ── Size-Limit ──
        const MAX_HTML_SIZE = 5 * 1024 * 1024;
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > MAX_HTML_SIZE) {
          throw new Error(`Seite zu groß (${Math.round(contentLength / 1024 / 1024)} MB). Max: 5 MB.`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        const chunks = [];
        let totalBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.length;
          if (totalBytes > MAX_HTML_SIZE) {
            reader.cancel();
            console.log(`⚠️ HTML abgeschnitten bei ${Math.round(totalBytes / 1024)} KB`);
            break;
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
        const html = chunks.join('');

        const $ = cheerio.load(html);

        // Schema-Typen extrahieren
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const parsed = JSON.parse($(el).html());
            domainAnalysis.hasSchema = true;
            const extractTypes = (obj) => {
              if (!obj) return;
              if (obj['@type']) {
                const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
                domainAnalysis.schemaTypes.push(...types);
              }
              if (obj['@graph']) obj['@graph'].forEach(extractTypes);
            };
            extractTypes(parsed);
          } catch {}
        });

        // Hochwertige Schema-Typen zählen
        const schemaLower = domainAnalysis.schemaTypes.map(t => String(t).toLowerCase());
        domainAnalysis.valuableSchemaCount = [...new Set(schemaLower)]
          .filter(t => VALUABLE_SCHEMA_TYPES.has(t)).length;

        const allHrefs = [];
        $('a[href]').each((_, el) => allHrefs.push($(el).attr('href').toLowerCase()));

        $('script, style, noscript').remove();
        const visibleText = $('body').text().replace(/\s+/g, ' ').toLowerCase();

        // About
        const aboutKeywords = ['about', 'über-uns', 'ueber-uns', 'about-us', 'who-we-are', 'unser-team', 'das-sind-wir', '/team', '#about', '#über-uns', '#ueber-uns', '#team'];
        const hasAboutLink = allHrefs.some(href => aboutKeywords.some(kw => href.includes(kw)));
        const hasAboutSchema = schemaLower.includes('aboutpage');
        const hasAboutText = /über uns|about us|unser team|über (michael|den gründer)|about the founder/.test(visibleText);
        const hasAboutSection = $('[id]').toArray().some(el =>
          /^(about|ueber-uns|über-uns|team|founder|gruender)$/i.test($(el).attr('id'))
        );
        domainAnalysis.hasAboutPage = hasAboutLink || hasAboutSection || (hasAboutSchema && hasAboutText);

        // Contact
        const contactKeywords = ['kontakt', 'contact', 'impressum', 'imprint', 'legal-notice', 'contact-us'];
        const hasContactLink = allHrefs.some(href => contactKeywords.some(kw => href.includes(kw)));
        const hasContactSchema = schemaLower.includes('contactpage');
        const hasContactInfo = $('a[href^="tel:"], a[href^="mailto:"]').length > 0;
        const hasImpressumText = /impressum|kontakt|contact/.test(visibleText);
        domainAnalysis.hasContactPage = hasContactLink || hasContactSchema || (hasContactInfo && hasImpressumText);

        // Author
        const hasAuthorSchema = ['person', 'author', 'profilepage'].some(t => schemaLower.includes(t));
        let hasAuthorInSchema = false;
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const data = JSON.parse($(el).html());
            const checkPerson = (obj) => {
              if (!obj) return;
              const type = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type'] || ''];
              if (type.some(t => String(t).toLowerCase() === 'person') && (obj.jobTitle || obj.name || obj.familyName)) {
                hasAuthorInSchema = true;
              }
              if (obj.author && typeof obj.author === 'object') hasAuthorInSchema = true;
              if (obj.creator && typeof obj.creator === 'object') hasAuthorInSchema = true;
              if (obj['@graph']) obj['@graph'].forEach(checkPerson);
            };
            checkPerson(data);
          } catch {}
        });
        const hasAuthorText = /\b(?:geschäftsführer|inhaber|gründer|founder|ceo|geschäftsleitung|managing director)\b/.test(visibleText);
        const hasMetaAuthor = $('meta[name="author"]').attr('content')?.trim().length > 0;
        const hasByline = $('[class*="author"], [class*="byline"], [class*="writer"]').length > 0;
        domainAnalysis.hasAuthorInfo = hasAuthorInSchema || hasMetaAuthor || hasAuthorText || (hasAuthorSchema && hasByline);

        domainAnalysis.title = $('title').first().text().trim();
        domainAnalysis.description = $('meta[name="description"]').attr('content')?.trim() || '';

        console.log(`   E-E-A-T: About=${domainAnalysis.hasAboutPage} Contact=${domainAnalysis.hasContactPage} Author=${domainAnalysis.hasAuthorInfo}`);
        console.log(`   Schema: ${domainAnalysis.hasSchema ? 'ja' : 'nein'}, wertvolle Typen: ${domainAnalysis.valuableSchemaCount}`);

      } catch (error) {
        domainAnalysis.crawlError = error.message;
        console.log(`   ⚠️ Crawl-Fehler: ${error.message}`);
      }

      crawlerAccess = await crawlerCheckPromise;
      console.log(`   Crawler-Zugriff: ${crawlerAccess.robotsTxtFound ? `robots.txt gefunden, ${crawlerAccess.blockedCrawlers?.length || 0} Bots geblockt` : 'keine robots.txt'}`);

    } else {
      domainAnalysis.crawlError = 'Kein Domain angegeben – nur Namenssuche';
    }

    // ──────────────────────────────────────────────────────
    // Den Rest (Tests, Scoring, Empfehlungen) bauen wir in Teil 2 auf
    // ──────────────────────────────────────────────────────
    return await runTestsAndBuildResponse({
      req, res, cacheKey, clientIP, rateCheck,
      modelWithSearch, modelLight,
      searchLabel, hasDomain, cleanDomain, cleanBrand,
      cleanIndustry, locationHint, domainAnalysis, crawlerAccess,
    });

  } catch (error) {
    console.error("❌ Error:", error);
    return res.status(500).json({ success: false, message: 'Analyse fehlgeschlagen. Bitte versuche es später erneut.' });
  }
}

// ────────────────────────────────────────────────────────────
// Test-Durchführung und Response-Aufbau sind in vis-tests-runner.js ausgelagert
// ────────────────────────────────────────────────────────────
