// api/ai-visibility-check.js - KI-Sichtbarkeits-Check (Modular)
// Version 15: Aufgeteilt in Module unter lib/
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as cheerio from 'cheerio';
import { checkRateLimit, incrementRateLimit, getClientIP } from './rate-limiter.js';
import { trackVisibilityCheckStats } from './evita-track.js';
import { Redis } from '@upstash/redis';

// Eigene Module
import { chatGPTQuery, detectIndustryFromResponse } from './lib/ai-clients.js';
import { isDomainMentioned, isSubstantialBusinessResponse, validateAndCleanDomain, sanitizeIndustry } from './lib/domain-detection.js';
import { escapeHTML, stripHTML, formatResponseText } from './lib/text-formatting.js';
import { analyzeSentiment } from './lib/sentiment.js';
import { trackVisibilityCheck, sendCheckNotification } from './lib/notifications.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const redis = Redis.fromEnv();

const DAILY_LIMIT = 3;

// =================================================================
// MAIN HANDLER
// =================================================================
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
      remaining: 0
    });
  }

  try {
    const { domain, industry } = req.body;
    
    const domainValidation = validateAndCleanDomain(domain);
    if (!domainValidation.valid) {
      return res.status(400).json({ success: false, message: domainValidation.error });
    }

    const cleanDomain = domainValidation.domain;
    const cleanIndustry = sanitizeIndustry(industry);
    
    // =================================================================
    // REDIS CACHING
    // =================================================================
    const cacheKey = `visibility_cache:${cleanDomain}`;
    try {
      const cachedResult = await redis.get(cacheKey);
      if (cachedResult) {
        console.log(`⚡ CACHE HIT: Lade Ergebnisse für ${cleanDomain} aus Redis.`);
        await incrementRateLimit(clientIP, 'visibility'); 
        cachedResult.meta.remainingChecks = (await checkRateLimit(clientIP, 'visibility', DAILY_LIMIT)).remaining;
        cachedResult.cached = true;
        return res.status(200).json(cachedResult);
      }
    } catch (e) {
      console.warn(`⚠️ Cache Error: Konnte Redis nicht lesen (${e.message})`);
    }

    console.log(`🔍 AI Visibility Check: ${cleanDomain} (Branche: ${cleanIndustry || 'auto'})`);
    await incrementRateLimit(clientIP, 'visibility');

    const modelWithSearch = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: { temperature: 0.2, maxOutputTokens: 1500 }
    });

    // =================================================================
    // PHASE 1: Domain-Analyse (Crawling)
    // =================================================================
    let domainAnalysis = {
      hasSchema: false,
      schemaTypes: [],
      hasAboutPage: false,
      hasContactPage: false,
      hasAuthorInfo: false,
      title: '',
      description: '',
      crawlError: null
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(`https://${cleanDomain}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIVisibilityBot/1.0)' }
      });
      clearTimeout(timeout);
      
      const MAX_HTML_SIZE = 5 * 1024 * 1024;
      
      const contentLength = parseInt(response.headers.get('content-length') || '0');
      if (contentLength > MAX_HTML_SIZE) {
        throw new Error(`Seite zu groß (${Math.round(contentLength / 1024 / 1024)} MB). Max: 5 MB.`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let html = '';
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
        
        html += decoder.decode(value, { stream: true });
      }
      
      html += decoder.decode();
      
      const $ = cheerio.load(html);
      
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const parsed = JSON.parse($(el).html());
          domainAnalysis.hasSchema = true;
          const extractTypes = (obj) => {
            if (obj['@type']) {
              const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
              domainAnalysis.schemaTypes.push(...types);
            }
            if (obj['@graph']) obj['@graph'].forEach(extractTypes);
          };
          extractTypes(parsed);
        } catch (e) {}
      });
      
      const schemaTypesLower = domainAnalysis.schemaTypes.map(t => t.toLowerCase());
      
      const allHrefs = [];
      $('a[href]').each((_, el) => allHrefs.push($(el).attr('href').toLowerCase()));
      
      $('script, style, noscript').remove();
      const visibleText = $('body').text().replace(/\s+/g, ' ').toLowerCase();
      
      const aboutKeywords = ['about', 'über-uns', 'ueber-uns', 'about-us', 'who-we-are', 'unser-team', 'das-sind-wir', '/team', '#about', '#über-uns', '#ueber-uns', '#team', '#michael', '#founder', '#gruender'];
      const hasAboutLink = allHrefs.some(href => aboutKeywords.some(kw => href.includes(kw)));
      const hasAboutSchema = schemaTypesLower.includes('aboutpage');
      const hasAboutText = /über uns|about us|unser team|über michael|über den gründer|about the founder/.test(visibleText);
      const hasAboutSection = $('[id]').toArray().some(el => 
        /^(about|ueber-uns|über-uns|team|michael|founder|gruender)$/i.test($(el).attr('id'))
      );
      domainAnalysis.hasAboutPage = hasAboutLink || hasAboutSection || (hasAboutSchema && hasAboutText);
      
      const contactKeywords = ['kontakt', 'contact', 'impressum', 'imprint', 'legal-notice', 'contact-us'];
      const hasContactLink = allHrefs.some(href => contactKeywords.some(kw => href.includes(kw)));
      const hasContactSchema = schemaTypesLower.includes('contactpage');
      const hasContactInfo = $('a[href^="tel:"], a[href^="mailto:"]').length > 0;
      const hasImpressumText = /impressum|kontakt|contact/.test(visibleText);
      domainAnalysis.hasContactPage = hasContactLink || hasContactSchema || (hasContactInfo && hasImpressumText);
      
      const hasAuthorSchema = ['person', 'author', 'profilepage'].some(t => schemaTypesLower.includes(t));
      
      let hasAuthorInSchema = false;
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html());
          const checkPerson = (obj) => {
            if (!obj) return;
            const type = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type'] || ''];
            if (type.some(t => t.toLowerCase() === 'person') && (obj.jobTitle || obj.name || obj.familyName)) {
              hasAuthorInSchema = true;
            }
            if (obj.author && typeof obj.author === 'object') hasAuthorInSchema = true;
            if (obj.creator && typeof obj.creator === 'object') hasAuthorInSchema = true;
            if (obj['@graph']) obj['@graph'].forEach(checkPerson);
          };
          checkPerson(data);
        } catch (e) {}
      });
      
      const hasAuthorText = /\b(?:geschäftsführer|inhaber|gründer|founder|ceo|geschäftsleitung|managing director)\b/.test(visibleText);
      const hasMetaAuthor = $('meta[name="author"]').attr('content')?.trim().length > 0;
      const hasByline = $('[class*="author"], [class*="byline"], [class*="writer"]').length > 0;
      
      domainAnalysis.hasAuthorInfo = hasAuthorInSchema || hasMetaAuthor || hasAuthorText || (hasAuthorSchema && hasByline);
      
      console.log(`   E-E-A-T Signals (Cheerio):`);
      console.log(`     About: link=${hasAboutLink}, section=${hasAboutSection}, schema=${hasAboutSchema}, text=${hasAboutText} → ${domainAnalysis.hasAboutPage}`);
      console.log(`     Contact: link=${hasContactLink}, schema=${hasContactSchema}, tel/mailto=${hasContactInfo}, text=${hasImpressumText} → ${domainAnalysis.hasContactPage}`);
      console.log(`     Author: schema=${hasAuthorSchema}, schemaData=${hasAuthorInSchema}, meta=${hasMetaAuthor}, text=${hasAuthorText}, byline=${hasByline} → ${domainAnalysis.hasAuthorInfo}`);

      const $full = cheerio.load(html);
      domainAnalysis.title = $full('title').first().text().trim();
      domainAnalysis.description = $full('meta[name="description"]').attr('content')?.trim() || '';
      
    } catch (error) {
      domainAnalysis.crawlError = error.message;
    }

    // =================================================================
    // PHASE 2: Gemini Tests (Sequentiell für Branchenerkennung)
    // =================================================================
    
    const testResults = [];
    let detectedIndustry = cleanIndustry;
    
    const genericIndustries = [
      'online shop', 'onlineshop', 'webshop', 'shop', 'e-commerce', 'ecommerce',
      'webseite', 'website', 'homepage', 'firma', 'unternehmen', 'dienstleistung',
      'dienstleister', 'handel', 'geschäft', 'gewerbe', 'betrieb'
    ];
    const isGenericIndustry = cleanIndustry && genericIndustries.includes(cleanIndustry.toLowerCase().trim());

    // ==================== TEST 1: BEKANNTHEIT ====================
    console.log(`🧪 Test 1: Bekanntheit im Web...`);
    
    let knowledgeResponse = '';
    try {
      const knowledgePrompt = `Suche nach **${cleanDomain}** und beschreibe kurz:
- Was bietet dieses Unternehmen an? (Produkte/Dienstleistungen)
- In welcher Branche ist es tätig?
- Wo ist der Standort?

Antworte in 3-5 Sätzen. Schreibe Firmennamen **fett**. 
Falls nichts gefunden: "Zu **${cleanDomain}** wurden keine Informationen gefunden."

WICHTIG: Beginne DIREKT mit dem Inhalt, keine Einleitung.`;

      const result = await modelWithSearch.generateContent({
        contents: [{ role: "user", parts: [{ text: knowledgePrompt }] }],
        tools: [{ googleSearch: {} }]
      });
      
      knowledgeResponse = result.response.text();
      const formattedKnowledge = formatResponseText(knowledgeResponse);
      
      const plainKnowledge = stripHTML(formattedKnowledge);
      let mentioned = isDomainMentioned(plainKnowledge, cleanDomain);
      
      // Content-Fallback
      if (!mentioned) {
        mentioned = isSubstantialBusinessResponse(plainKnowledge, cleanDomain, 'knowledge');
        if (mentioned) console.log(`   → Content-Fallback: Substanzielle Antwort erkannt trotz fehlendem Domain-Match`);
      }
      
      const sentiment = await analyzeSentiment(formattedKnowledge, 'knowledge', mentioned);
      
      testResults.push({
        id: 'knowledge',
        description: 'Bekanntheit im Web',
        mentioned,
        sentiment,
        competitors: [],
        response: formattedKnowledge,
        groundingUsed: true,
        engine: 'gemini'
      });
      
      console.log(`   → ${mentioned ? '✅ Erwähnt' : '❌ Nicht erwähnt'} | Sentiment: ${sentiment}`);
      
      if ((!cleanIndustry || isGenericIndustry) && mentioned) {
        const autoDetected = await detectIndustryFromResponse(modelWithSearch, knowledgeResponse, cleanDomain);
        if (autoDetected) {
          detectedIndustry = autoDetected;
          console.log(`   → Branche erkannt: ${detectedIndustry} (${isGenericIndustry ? 'generische Eingabe überschrieben' : 'auto-detected'})`);
        }
      }
      
    } catch (error) {
      testResults.push({
        id: 'knowledge',
        description: 'Bekanntheit im Web',
        mentioned: false,
        sentiment: 'fehler',
        competitors: [],
        response: '❌ Test fehlgeschlagen: ' + escapeHTML(error.message),
        groundingUsed: true,
        engine: 'gemini'
      });
    }
    
    await new Promise(resolve => setTimeout(resolve, 800));

    // ==================== TEST 2: BEWERTUNGEN ====================
    console.log(`🧪 Test 2: Online-Reputation...`);
    
    try {
      const reviewsPrompt = `Suche nach Bewertungen und Rezensionen zu **${cleanDomain}**.

Prüfe: Google Reviews, Trustpilot, ProvenExpert, Kununu und ähnliche Plattformen.

Fasse zusammen:
- Bewertung (Sterne/Score)
- Was sagen Kunden?
- Wie viele Bewertungen gibt es?

Falls keine Bewertungen gefunden: "Zu **${cleanDomain}** wurden keine Online-Bewertungen gefunden."

WICHTIG: Beginne DIREKT mit dem Inhalt, keine Einleitung wie "Okay" oder "Ich werde".`;

      const result = await modelWithSearch.generateContent({
        contents: [{ role: "user", parts: [{ text: reviewsPrompt }] }],
        tools: [{ googleSearch: {} }]
      });
      
      let text = formatResponseText(result.response.text());
      
      let mentioned = isDomainMentioned(stripHTML(text), cleanDomain);
      
      if (!mentioned) {
        mentioned = isSubstantialBusinessResponse(stripHTML(text), cleanDomain, 'reviews');
        if (mentioned) console.log(`   → Content-Fallback (Reviews): Substanzielle Antwort erkannt`);
      }
      
      const sentiment = await analyzeSentiment(text, 'reviews', mentioned);
      
      testResults.push({
        id: 'reviews',
        description: 'Online-Reputation',
        mentioned,
        sentiment,
        competitors: [],
        response: text,
        groundingUsed: true,
        engine: 'gemini'
      });
      
      console.log(`   → ${mentioned ? '✅ Erwähnt' : '❌ Nicht erwähnt'} | Sentiment: ${sentiment}`);
      
    } catch (error) {
      testResults.push({
        id: 'reviews',
        description: 'Online-Reputation',
        mentioned: false,
        sentiment: 'fehler',
        competitors: [],
        response: '❌ Test fehlgeschlagen: ' + escapeHTML(error.message),
        groundingUsed: true,
        engine: 'gemini'
      });
    }
    
    await new Promise(resolve => setTimeout(resolve, 800));

    // ==================== TEST 3: EXTERNE ERWÄHNUNGEN ====================
    console.log(`🧪 Test 3: Externe Erwähnungen...`);
    
    try {
      const mentionsPrompt = `Suche nach EXTERNEN Erwähnungen von **${cleanDomain}** auf ANDEREN Websites.

WICHTIG: 
- NUR Erwähnungen auf FREMDEN Domains zählen!
- Unterseiten, Blogbeiträge oder Artikel AUF ${cleanDomain} selbst sind KEINE externen Erwähnungen und dürfen NICHT aufgelistet werden.
- Auch Subdomains von ${cleanDomain} (z.B. blog.${cleanDomain}) zählen NICHT.

Prüfe:
- Branchenverzeichnisse (Herold, WKO, Gelbe Seiten, etc.)
- Artikel und Blogs auf ANDEREN Websites
- Social Media Profile (LinkedIn, XING, Facebook, etc.)
- Andere Websites, die auf ${cleanDomain} verlinken

Liste nur die gefundenen EXTERNEN Erwähnungen auf. Schreibe Quellennamen **fett**.

Falls nichts auf fremden Websites gefunden: "Zu **${cleanDomain}** wurden keine externen Erwähnungen auf anderen Websites gefunden."

WICHTIG: Beginne DIREKT mit dem Inhalt, keine Einleitung.`;

      const result = await modelWithSearch.generateContent({
        contents: [{ role: "user", parts: [{ text: mentionsPrompt }] }],
        tools: [{ googleSearch: {} }]
      });
      
      let text = formatResponseText(result.response.text());
      
      let mentioned = isDomainMentioned(stripHTML(text), cleanDomain);
      
      if (!mentioned) {
        mentioned = isSubstantialBusinessResponse(stripHTML(text), cleanDomain, 'mentions');
        if (mentioned) console.log(`   → Content-Fallback (Mentions): Substanzielle Antwort erkannt`);
      }
      
      const sentiment = await analyzeSentiment(text, 'mentions', mentioned);
      
      const domainBase = cleanDomain.replace(/\.[^.]+$/, '');
      const domainRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/gi;
      const matches = text.match(domainRegex) || [];
      const mentionedDomains = [...new Set(matches)]
        .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase())
        .filter(c => !c.includes(domainBase) && !c.includes('google') && !c.includes('schema.org'))
        .slice(0, 8);
      
      testResults.push({
        id: 'mentions',
        description: 'Externe Erwähnungen',
        mentioned,
        sentiment,
        competitors: mentionedDomains,
        response: text,
        groundingUsed: true,
        engine: 'gemini'
      });
      
      console.log(`   → ${mentioned ? '✅ Erwähnt' : '❌ Nicht erwähnt'} | Sentiment: ${sentiment}`);
      
    } catch (error) {
      testResults.push({
        id: 'mentions',
        description: 'Externe Erwähnungen',
        mentioned: false,
        sentiment: 'fehler',
        competitors: [],
        response: '❌ Test fehlgeschlagen: ' + escapeHTML(error.message),
        groundingUsed: true,
        engine: 'gemini'
      });
    }

    // =================================================================
    // PHASE 2b: ChatGPT Cross-Check
    // =================================================================
    const chatGptResults = [];
    
    if (process.env.OPENAI_API_KEY) {
      console.log(`🤖 ChatGPT Cross-Check startet...`);
      
      const chatGptTests = [
        {
          id: 'chatgpt_knowledge',
          description: 'Bekanntheit (ChatGPT)',
          prompt: `Was weißt du über die Website ${cleanDomain}? Beschreibe kurz:
- Was bietet dieses Unternehmen an?
- In welcher Branche ist es tätig?
- Wo ist der Standort?

Antworte in 3-5 Sätzen auf Deutsch. Schreibe Firmennamen **fett**.
Falls du nichts weißt: "Zu **${cleanDomain}** habe ich keine Informationen."

WICHTIG: Beginne DIREKT mit dem Inhalt.`
        }
      ];
      
      const chatGptPromises = chatGptTests.map(async (test) => {
        try {
          console.log(`🤖 ChatGPT Test: ${test.description}...`);
          
          const rawText = await chatGPTQuery(test.prompt);
          const text = formatResponseText(rawText);
          
          let mentioned = isDomainMentioned(stripHTML(text), cleanDomain);
          
          // Content-Fallback auch für ChatGPT
          if (!mentioned) {
            mentioned = isSubstantialBusinessResponse(stripHTML(text), cleanDomain, 'knowledge');
            if (mentioned) console.log(`   → Content-Fallback (ChatGPT): Substanzielle Antwort erkannt`);
          }
          
          const sentiment = await analyzeSentiment(text, 'knowledge', mentioned);
          
          const domainBase = cleanDomain.replace(/\.[^.]+$/, '');
          const domainRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/gi;
          const matches = text.match(domainRegex) || [];
          const competitors = [...new Set(matches)]
            .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase())
            .filter(c => !c.includes(domainBase) && !c.includes('google') && !c.includes('openai') && !c.includes('schema.org'))
            .slice(0, 8);
          
          console.log(`   → ${mentioned ? '✅ Erwähnt' : '❌ Nicht erwähnt'} | Sentiment: ${sentiment}`);
          
          return {
            id: test.id,
            description: test.description,
            mentioned,
            sentiment,
            competitors,
            response: text.length > 1200 ? text.substring(0, 1200) + '...' : text,
            engine: 'chatgpt'
          };
          
        } catch (error) {
          console.error(`   → ❌ ChatGPT Test fehlgeschlagen:`, error.message);
          return {
            id: test.id,
            description: test.description,
            mentioned: false,
            sentiment: 'fehler',
            competitors: [],
            response: '❌ ChatGPT-Test fehlgeschlagen: ' + escapeHTML(error.message),
            engine: 'chatgpt'
          };
        }
      });
      
      const results = await Promise.all(chatGptPromises);
      chatGptResults.push(...results);
      
      testResults.push(...chatGptResults);
      
      console.log(`✅ ChatGPT Cross-Check abgeschlossen (${chatGptResults.length} Tests)`);
    } else {
      console.log('⚠️ OPENAI_API_KEY nicht gesetzt, ChatGPT Cross-Check übersprungen');
    }

    // =================================================================
    // PHASE 3: Score-Berechnung
    // =================================================================
    let score = 0;
    const scoreBreakdown = [];
    
    const geminiTests = testResults.filter(t => !t.engine || t.engine === 'gemini');
    const chatgptTests = testResults.filter(t => t.engine === 'chatgpt');
    const allTests = testResults.filter(t => t.sentiment !== 'fehler');
    
    const geminiMentions = geminiTests.filter(t => t.mentioned).length;
    const geminiMentionScore = geminiTests.length > 0 
      ? Math.round((geminiMentions / geminiTests.length) * 35) 
      : 0;
    score += geminiMentionScore;
    scoreBreakdown.push({
      category: 'Gemini Sichtbarkeit',
      points: geminiMentionScore,
      maxPoints: 35,
      detail: `${geminiMentions} von ${geminiTests.length} Gemini-Suchen finden die Domain`
    });
    
    if (chatgptTests.length > 0) {
      const chatgptMentions = chatgptTests.filter(t => t.mentioned).length;
      const chatgptScore = Math.round((chatgptMentions / chatgptTests.length) * 15);
      score += chatgptScore;
      scoreBreakdown.push({
        category: 'ChatGPT Sichtbarkeit',
        points: chatgptScore,
        maxPoints: 15,
        detail: `${chatgptMentions} von ${chatgptTests.length} ChatGPT-Tests finden die Domain`
      });
    }
    
    let techScore = 0;
    if (domainAnalysis.hasSchema) techScore += 10;
    if (domainAnalysis.schemaTypes.length >= 3) techScore += 6;
    if (domainAnalysis.hasAboutPage) techScore += 5;
    if (domainAnalysis.hasContactPage) techScore += 5;
    if (domainAnalysis.hasAuthorInfo) techScore += 5;
    techScore = Math.min(techScore, 30);
    score += techScore;
    scoreBreakdown.push({
      category: 'Technische Authority',
      points: techScore,
      maxPoints: 30,
      detail: `Schema: ${domainAnalysis.hasSchema ? '✓' : '✗'}, E-E-A-T: ${[domainAnalysis.hasAboutPage, domainAnalysis.hasContactPage, domainAnalysis.hasAuthorInfo].filter(Boolean).length}/3`
    });
    
    const mentionedTests = allTests.filter(t => t.mentioned);
    const positiveCount = mentionedTests.filter(t => t.sentiment === 'positiv').length;
    const neutralCount = mentionedTests.filter(t => t.sentiment === 'neutral').length;
    const negativeCount = mentionedTests.filter(t => t.sentiment === 'negativ').length;
    
    const maxRepPoints = 20;
    const sentimentScore = allTests.length > 0
      ? Math.round((positiveCount * maxRepPoints + neutralCount * maxRepPoints * 0.6 + negativeCount * maxRepPoints * 0.2) / allTests.length)
      : 0;
    score += sentimentScore;
    scoreBreakdown.push({
      category: 'Online-Reputation',
      points: sentimentScore,
      maxPoints: maxRepPoints,
      detail: `${positiveCount} positiv, ${neutralCount} neutral, ${negativeCount} negativ`
    });

    let scoreCategory = 'niedrig', scoreCategoryLabel = 'Kaum sichtbar', scoreCategoryColor = '#ef4444';
    if (score >= 65) { 
      scoreCategory = 'hoch'; 
      scoreCategoryLabel = 'Gut sichtbar'; 
      scoreCategoryColor = '#22c55e'; 
    } else if (score >= 35) { 
      scoreCategory = 'mittel'; 
      scoreCategoryLabel = 'Ausbaufähig'; 
      scoreCategoryColor = '#f59e0b'; 
    }

    // =================================================================
    // PHASE 4: Empfehlungen generieren
    // =================================================================
    const mentionCount = testResults.filter(t => t.mentioned).length;
    const recommendations = [];
    
    if (mentionCount === 0) {
      recommendations.push({ 
        priority: 'hoch', 
        title: 'Online-Präsenz aufbauen', 
        description: 'Deine Domain wird kaum gefunden. Fokussiere auf Google Business Profile und Branchenverzeichnisse.', 
        link: '/geo-seo' 
      });
    }
    
    if (!domainAnalysis.hasSchema) {
      recommendations.push({ 
        priority: 'hoch', 
        title: 'Schema.org Markup hinzufügen', 
        description: 'Strukturierte Daten helfen KI deine Inhalte zu verstehen.', 
        link: '/schema-org-meta-description' 
      });
    }
    
    if (negativeCount >= 2) {
      recommendations.push({ 
        priority: 'hoch', 
        title: 'Online-Reputation verbessern', 
        description: 'Mehrere Tests zeigen negative Signale. Aktiv Bewertungen sammeln und auf Kritik reagieren.', 
        link: null 
      });
    }
    
    if (positiveCount === 0 && mentionCount > 0) {
      recommendations.push({ 
        priority: 'hoch', 
        title: 'Bewertungen sammeln', 
        description: 'Du wirst gefunden, aber es fehlen positive Signale. Bitte zufriedene Kunden um Reviews.', 
        link: null 
      });
    }
    
    const missingEEAT = [];
    if (!domainAnalysis.hasAboutPage) missingEEAT.push('"Über uns" Seite');
    if (!domainAnalysis.hasContactPage) missingEEAT.push('Kontakt/Impressum Seite');
    if (!domainAnalysis.hasAuthorInfo) missingEEAT.push('Autoren-Info (Geschäftsführer, Team, Qualifikationen)');
    
    if (missingEEAT.length > 0) {
      recommendations.push({ 
        priority: missingEEAT.length >= 2 ? 'hoch' : 'mittel', 
        title: 'E-E-A-T Signale stärken', 
        description: `Fehlend: ${missingEEAT.join(', ')}. Diese Informationen helfen KI-Systemen, dein Unternehmen als vertrauenswürdig einzustufen.`, 
        link: null 
      });
    }
    
    const chatgptMentionCount = chatGptResults.filter(t => t.mentioned).length;
    const geminiMentionCount = geminiTests.filter(t => t.mentioned).length;
    
    if (chatGptResults.length > 0 && chatgptMentionCount === 0 && geminiMentionCount > 0) {
      recommendations.push({ 
        priority: 'mittel', 
        title: 'ChatGPT-Sichtbarkeit verbessern', 
        description: 'Gemini kennt dich, aber ChatGPT nicht. Mehr externe Erwähnungen, Wikipedia-Einträge und strukturierte Daten helfen.', 
        link: null 
      });
    }
    
    if (chatGptResults.length > 0 && chatgptMentionCount > 0 && geminiMentionCount === 0) {
      recommendations.push({ 
        priority: 'mittel', 
        title: 'Google/Gemini-Sichtbarkeit verbessern', 
        description: 'ChatGPT kennt dich, aber Gemini nicht. Google Business Profile und Schema.org Markup sind entscheidend.', 
        link: '/schema-org-meta-description'
      });
    }

    const allCompetitors = [...new Set(testResults.flatMap(t => t.competitors))].slice(0, 12);

    await trackVisibilityCheck({
      domain: cleanDomain,
      industry: detectedIndustry || cleanIndustry,
      score,
      scoreLabel: scoreCategoryLabel,
      mentionCount,
      totalTests: testResults.length,
      hasSchema: domainAnalysis.hasSchema,
      country: req.headers['cf-ipcountry'] || null
    });

    await trackVisibilityCheckStats({
      domain: cleanDomain,
      score,
      scoreLabel: scoreCategoryLabel,
      mentionCount,
      totalTests: testResults.length,
      hasSchema: domainAnalysis.hasSchema,
      industry: detectedIndustry || cleanIndustry
    });

    await sendCheckNotification({
      domain: cleanDomain,
      industry: detectedIndustry || cleanIndustry,
      score,
      scoreLabel: scoreCategoryLabel,
      scoreColor: scoreCategoryColor,
      mentionCount,
      totalTests: testResults.length,
      testResults,
      domainAnalysis,
      competitors: allCompetitors,
      recommendations
    });

    console.log(`\n📊 Ergebnis für ${cleanDomain}: Score ${score}/100 (${scoreCategoryLabel})`);

    const finalResponse = {
      success: true,
      domain: cleanDomain,
      industry: detectedIndustry || cleanIndustry || null,
      timestamp: new Date().toISOString(),
      score: { 
        total: score, 
        category: scoreCategory, 
        label: scoreCategoryLabel, 
        color: scoreCategoryColor, 
        breakdown: scoreBreakdown 
      },
      domainAnalysis: {
        title: domainAnalysis.title,
        description: domainAnalysis.description,
        schema: { found: domainAnalysis.hasSchema, types: [...new Set(domainAnalysis.schemaTypes)] },
        eeat: { 
          aboutPage: domainAnalysis.hasAboutPage, 
          contactPage: domainAnalysis.hasContactPage, 
          authorInfo: domainAnalysis.hasAuthorInfo 
        },
        crawlError: domainAnalysis.crawlError
      },
      aiTests: testResults,
      competitors: allCompetitors,
      recommendations,
      meta: { 
        geminiTests: geminiTests.length,
        chatgptTests: chatgptTests.length,
        totalTests: testResults.length, 
        remainingChecks: (await checkRateLimit(clientIP, 'visibility', DAILY_LIMIT)).remaining 
      }
    };

    // Redis Cache speichern (24h)
    try {
      await redis.set(cacheKey, finalResponse, { ex: 86400 });
      console.log(`💾 CACHE SET: Ergebnisse für ${cleanDomain} in Redis gespeichert.`);
    } catch (e) {
      console.warn(`⚠️ Cache Error: Konnte Ergebnis nicht speichern (${e.message})`);
    }

    return res.status(200).json(finalResponse);

  } catch (error) {
    console.error("❌ Error:", error);
    return res.status(500).json({ success: false, message: 'Fehler: ' + error.message });
  }
}
