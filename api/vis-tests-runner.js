// api/vis-tests-runner.js
// Führt die KI-Tests aus (Gemini + ChatGPT), baut Score, Empfehlungen und Response.
// Ausgelagert aus ai-visibility-check.js für Lesbarkeit.
//
// Neu gegenüber V2:
// - Gemini Tests 2+3 parallel statt sequentiell
// - Sentiment-Analyse gebündelt (1 Call statt 6)
// - Competitor-Extraktion nutzt Grounding-Metadaten
// - Score-Gewichte schalten dynamisch wenn ChatGPT-Tests fehlschlagen
// - Report-Token + 7d-Report-Cache

import { Redis } from '@upstash/redis';

import { chatGPTQuery, detectIndustryFromResponse } from './vis-ai-clients.js';
import {
  isDomainMentioned,
  isSubstantialBusinessResponse,
  extractCompanyName,
} from './vis-domain-detection.js';
import { escapeHTML, stripHTML, formatResponseText } from './vis-text-formatting.js';
import { analyzeSentiment as analyzeSentimentLegacy } from './vis-sentiment.js';
import { trackVisibilityCheck, sendCheckNotification } from './vis-notifications.js';
import { trackVisibilityCheckStats } from './evita-track.js';
import { checkRateLimit } from './rate-limiter.js';
import { CACHE_VERSION, SCORE_WEIGHTS } from './vis-constants.js';
import { analyzeSentimentsBundled } from './bundled-sentiment.js';
import {
  safeSignToken,
  extractCompetitors,
  isNegativeResponse,
  REPORT_CACHE_TTL,
  PRIMARY_CACHE_TTL,
} from './vis-helpers.js';

const redis = Redis.fromEnv();
const DAILY_LIMIT = 3;

export async function runTestsAndBuildResponse(ctx) {
  const {
    req, res, cacheKey, clientIP, rateCheck,
    modelWithSearch, modelLight,
    searchLabel, hasDomain, cleanDomain, cleanBrand,
    cleanIndustry, locationHint, domainAnalysis, crawlerAccess,
  } = ctx;

  let detectedIndustry = cleanIndustry;
  let companyName = cleanBrand;

  const genericIndustries = [
    'online shop', 'onlineshop', 'webshop', 'shop', 'e-commerce', 'ecommerce',
    'webseite', 'website', 'homepage', 'firma', 'unternehmen', 'dienstleistung',
    'dienstleister', 'handel', 'geschäft', 'gewerbe', 'betrieb',
  ];
  const isGenericIndustry = cleanIndustry && genericIndustries.includes(cleanIndustry.toLowerCase().trim());

  const testResults = [];

  // ══════════════════════════════════════════════════════════
  // TEST 1 Gemini — Bekanntheit (sequentiell, weil wir hier die Industry ableiten)
  // ══════════════════════════════════════════════════════════
  console.log(`🧪 Gemini Test 1: Bekanntheit`);
  const knowledgeTest = await runGeminiKnowledge({
    modelWithSearch, modelLight,
    searchLabel, hasDomain, cleanDomain, companyName, locationHint,
    cleanIndustry, isGenericIndustry,
  });
  testResults.push(knowledgeTest.result);
  if (knowledgeTest.detectedIndustry) detectedIndustry = knowledgeTest.detectedIndustry;
  if (knowledgeTest.companyName && !companyName) companyName = knowledgeTest.companyName;

  // ══════════════════════════════════════════════════════════
  // ChatGPT-Tests parallel starten (laufen parallel zu Gemini Tests 2+3)
  // ══════════════════════════════════════════════════════════
  const hasChatGPT = !!process.env.OPENAI_API_KEY;
  let chatGptPromise = null;
  if (hasChatGPT) {
    console.log(`🤖 ChatGPT Cross-Check startet (parallel)...`);
    chatGptPromise = runChatGPTTests({ searchLabel, hasDomain, cleanDomain, companyName, locationHint });
  }

  // ══════════════════════════════════════════════════════════
  // Gemini Tests 2 + 3 PARALLEL statt sequentiell
  // ══════════════════════════════════════════════════════════
  console.log(`🧪 Gemini Tests 2+3: Reputation + Erwähnungen (parallel)`);
  const [reviewsTest, mentionsTest] = await Promise.all([
    runGeminiReviews({ modelWithSearch, searchLabel, hasDomain, cleanDomain, companyName, locationHint }),
    runGeminiMentions({ modelWithSearch, searchLabel, hasDomain, cleanDomain, companyName, locationHint }),
  ]);
  testResults.push(reviewsTest, mentionsTest);

  // ChatGPT-Ergebnisse einsammeln
  const chatGptResults = chatGptPromise ? await chatGptPromise : [];
  testResults.push(...chatGptResults);
  if (chatGptResults.length) console.log(`✅ ChatGPT Cross-Check abgeschlossen (${chatGptResults.length} Tests)`);

  // ══════════════════════════════════════════════════════════
  // GEBÜNDELTE Sentiment-Analyse (1 Call für alle Tests)
  // ══════════════════════════════════════════════════════════
  const sentimentInputs = testResults
    .filter(t => t.sentiment !== 'fehler') // Fehler-Tests nicht analysieren
    .map(t => ({
      id: t.id,
      testType: t.id.replace('chatgpt_', ''),
      mentioned: t.mentioned,
      text: stripHTML(t.response || ''),
    }));

  try {
    const sentiments = await analyzeSentimentsBundled(modelLight, sentimentInputs);
    for (const t of testResults) {
      if (t.sentiment !== 'fehler' && sentiments[t.id]) {
        t.sentiment = sentiments[t.id];
      }
    }
  } catch (e) {
    console.warn(`⚠️ Bundled Sentiment fehlgeschlagen komplett: ${e.message} — Legacy-Fallback aktiv`);
    for (const t of testResults) {
      if (t.sentiment === 'neutral' || !t.sentiment) {
        try {
          t.sentiment = await analyzeSentimentLegacy(t.response, t.id.replace('chatgpt_', ''), t.mentioned);
        } catch {}
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // SCORE BERECHNEN
  // ══════════════════════════════════════════════════════════
  const geminiTests = testResults.filter(t => !t.engine || t.engine === 'gemini');
  const chatgptTests = testResults.filter(t => t.engine === 'chatgpt');
  const chatGptWorking = chatgptTests.some(t => t.sentiment !== 'fehler');

  // ── FIX: Gewichte switchen bei ChatGPT-Fail (User soll nicht bestraft werden)
  const weights = (hasChatGPT && chatGptWorking)
    ? SCORE_WEIGHTS.withChatGPT
    : SCORE_WEIGHTS.withoutChatGPT;
  const tw = SCORE_WEIGHTS.testWeights;

  function calcEngineScore(tests, engineMaxPoints, testTypeMap) {
    let weightedSum = 0, totalWeight = 0;
    for (const [testId, weight] of Object.entries(testTypeMap)) {
      const t = tests.find(x => x.id === testId);
      if (t && t.sentiment !== 'fehler') {
        totalWeight += weight;
        if (t.mentioned) weightedSum += weight;
      }
    }
    return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * engineMaxPoints) : 0;
  }

  let score = 0;
  const scoreBreakdown = [];

  // Gemini
  const geminiMentions = geminiTests.filter(t => t.mentioned).length;
  const geminiScore = calcEngineScore(geminiTests, weights.gemini, {
    knowledge: tw.knowledge,
    mentions: tw.mentions,
    reviews: tw.reviews,
  });
  score += geminiScore;
  scoreBreakdown.push({
    category: 'Gemini Sichtbarkeit',
    points: geminiScore,
    maxPoints: weights.gemini,
    detail: `${geminiMentions} von ${geminiTests.length} Gemini-Tests ${hasDomain ? 'finden die Domain' : 'finden den Namen'}`,
  });

  // ChatGPT
  if (hasChatGPT && chatGptWorking) {
    const workingChatgpt = chatgptTests.filter(t => t.sentiment !== 'fehler');
    const chatgptMentions = workingChatgpt.filter(t => t.mentioned).length;
    const chatgptScore = calcEngineScore(chatgptTests, weights.chatgpt, {
      chatgpt_knowledge: tw.knowledge,
      chatgpt_mentions: tw.mentions,
      chatgpt_reviews: tw.reviews,
    });
    score += chatgptScore;
    scoreBreakdown.push({
      category: 'ChatGPT Sichtbarkeit',
      points: chatgptScore,
      maxPoints: weights.chatgpt,
      detail: `${chatgptMentions} von ${workingChatgpt.length} ChatGPT-Tests ${hasDomain ? 'finden die Domain' : 'finden den Namen'}`,
    });
  }

  // Technische Authority (inkl. neuer Faktoren)
  let techScore = 0;
  const techDetails = [];
  if (hasDomain) {
    if (domainAnalysis.hasSchema)                  { techScore += 4; techDetails.push('Schema ✓'); }
    if (domainAnalysis.valuableSchemaCount >= 2)   { techScore += 3; techDetails.push(`${domainAnalysis.valuableSchemaCount} wertvolle Typen`); }
    else if (domainAnalysis.schemaTypes.length >= 3) { techScore += 1; }
    if (domainAnalysis.hasAboutPage)               { techScore += 2; techDetails.push('Über-uns ✓'); }
    if (domainAnalysis.hasContactPage)             { techScore += 1; techDetails.push('Kontakt ✓'); }
    if (domainAnalysis.hasAuthorInfo)              { techScore += 2; techDetails.push('Autor ✓'); }

    // KI-Crawler-Zugriff (NEU)
    if (crawlerAccess?.robotsTxtFound) {
      const blocked = crawlerAccess.blockedCrawlers?.length || 0;
      if (blocked === 0) { techScore += 2; techDetails.push('Crawler frei'); }
      else if (blocked <= 2) { techScore += 0; }
      else { techScore -= 2; techDetails.push(`${blocked} Bots blockiert!`); }
    }
    if (crawlerAccess?.llmsTxtFound) { techScore += 1; techDetails.push('llms.txt'); }
  }
  techScore = Math.max(0, Math.min(techScore, weights.tech));
  score += techScore;
  scoreBreakdown.push({
    category: 'Technische Authority',
    points: techScore,
    maxPoints: weights.tech,
    detail: hasDomain
      ? techDetails.join(', ') || 'Keine Signale gefunden'
      : 'Keine Domain angegeben',
  });

  // Reputation
  const reputationTests = testResults.filter(t => t.sentiment && t.sentiment !== 'fehler' && t.sentiment !== 'fehlend');
  const positiveCount = reputationTests.filter(t => t.mentioned && t.sentiment === 'positiv').length;
  const neutralCount  = reputationTests.filter(t => t.mentioned && t.sentiment === 'neutral').length;
  const negativeCount = reputationTests.filter(t => t.mentioned && t.sentiment === 'negativ').length;
  const repTotal = reputationTests.length || 1;
  const repRawScore = (positiveCount * 1.0 + neutralCount * 0.5 + negativeCount * 0.1) / repTotal;
  const sentimentScore = Math.min(Math.round(repRawScore * weights.reputation), weights.reputation);
  score += sentimentScore;
  scoreBreakdown.push({
    category: 'Online-Reputation',
    points: sentimentScore,
    maxPoints: weights.reputation,
    detail: `${positiveCount} positiv, ${neutralCount} neutral, ${negativeCount} negativ`,
  });

  // Kategorisierung
  let scoreCategory = 'niedrig', scoreCategoryLabel = 'Kaum sichtbar', scoreCategoryColor = '#ef4444';
  if (score >= 65) { scoreCategory = 'hoch';   scoreCategoryLabel = 'Gut sichtbar'; scoreCategoryColor = '#22c55e'; }
  else if (score >= 35) { scoreCategory = 'mittel'; scoreCategoryLabel = 'Ausbaufähig'; scoreCategoryColor = '#f59e0b'; }

  const scoreMin = Math.max(0, score - 8);
  const scoreMax = Math.min(100, score + 8);

  // ══════════════════════════════════════════════════════════
  // VERDICT
  // ══════════════════════════════════════════════════════════
  const verdict = buildVerdict({
    geminiTests, chatgptTests, hasDomain, searchLabel,
    detectedIndustry, cleanIndustry, crawlerAccess,
  });

  // ══════════════════════════════════════════════════════════
  // EMPFEHLUNGEN
  // ══════════════════════════════════════════════════════════
  const recommendations = buildRecommendations({
    testResults, geminiTests, chatgptTests, hasChatGPT, hasDomain,
    domainAnalysis, crawlerAccess, negativeCount, positiveCount,
  });

  // Competitors aggregieren
  const allCompetitors = [...new Set(testResults.flatMap(t => t.competitors || []))].slice(0, 12);

  // Engine-Details
  const engineDetails = {
    gemini: {
      knowledge: geminiTests.find(t => t.id === 'knowledge')?.mentioned || false,
      reviews:   geminiTests.find(t => t.id === 'reviews')?.mentioned || false,
      mentions:  geminiTests.find(t => t.id === 'mentions')?.mentioned || false,
    },
    chatgpt: (hasChatGPT && chatGptWorking) ? {
      knowledge: chatgptTests.find(t => t.id === 'chatgpt_knowledge')?.mentioned || false,
      reviews:   chatgptTests.find(t => t.id === 'chatgpt_reviews')?.mentioned || false,
      mentions:  chatgptTests.find(t => t.id === 'chatgpt_mentions')?.mentioned || false,
    } : null,
  };

  // Tracking
  const mentionCount = testResults.filter(t => t.mentioned).length;
  await Promise.allSettled([
    trackVisibilityCheck({
      domain: searchLabel,
      industry: detectedIndustry || cleanIndustry,
      score, scoreLabel: scoreCategoryLabel,
      mentionCount, totalTests: testResults.length,
      hasSchema: domainAnalysis.hasSchema,
      country: req.headers['cf-ipcountry'] || null,
    }),
    trackVisibilityCheckStats({
      domain: searchLabel, score, scoreLabel: scoreCategoryLabel,
      mentionCount, totalTests: testResults.length,
      hasSchema: domainAnalysis.hasSchema,
      industry: detectedIndustry || cleanIndustry,
    }),
    sendCheckNotification({
      domain: searchLabel,
      industry: detectedIndustry || cleanIndustry,
      score, scoreLabel: scoreCategoryLabel, scoreColor: scoreCategoryColor,
      mentionCount, totalTests: testResults.length,
      testResults, domainAnalysis,
      competitors: allCompetitors, recommendations,
    }),
  ]);

  console.log(`📊 ${searchLabel}: Score ${score}/100 (${scoreCategoryLabel})`);

  // ══════════════════════════════════════════════════════════
  // RESPONSE
  // ══════════════════════════════════════════════════════════
  const finalResponse = {
    success: true,
    domain: cleanDomain || searchLabel,
    industry: detectedIndustry || cleanIndustry || null,
    companyName: companyName || null,
    brandNameProvided: !!cleanBrand,
    hasDomain,
    timestamp: new Date().toISOString(),
    score: {
      total: score,
      range: { min: scoreMin, max: scoreMax },
      category: scoreCategory,
      label: scoreCategoryLabel,
      color: scoreCategoryColor,
      breakdown: scoreBreakdown,
      verdict,
    },
    domainAnalysis: {
      title: domainAnalysis.title,
      description: domainAnalysis.description,
      schema: {
        found: domainAnalysis.hasSchema,
        types: [...new Set(domainAnalysis.schemaTypes)],
        valuableTypes: domainAnalysis.valuableTypes || [],
        valuableCount: domainAnalysis.valuableSchemaCount,
      },
      eeat: {
        aboutPage:  domainAnalysis.hasAboutPage,
        contactPage: domainAnalysis.hasContactPage,
        authorInfo:  domainAnalysis.hasAuthorInfo,
      },
      crawlError: domainAnalysis.crawlError,
    },
    crawlerAccess,
    aiTests: testResults,
    engineDetails,
    competitors: allCompetitors,
    recommendations,
    meta: {
      geminiTests: geminiTests.length,
      chatgptTests: chatgptTests.length,
      totalTests: testResults.length,
      remainingChecks: (await checkRateLimit(clientIP, 'visibility', DAILY_LIMIT)).remaining,
      cacheVersion: CACHE_VERSION,
      chatGptWorking,
    },
    reportToken: safeSignToken(cacheKey),
  };

  // Primary-Cache (24h)
  try {
    await redis.set(cacheKey, finalResponse, { ex: PRIMARY_CACHE_TTL });
    console.log(`💾 CACHE SET: ${searchLabel} (24h)`);
  } catch (e) {
    console.warn(`⚠️ Cache Error: ${e.message}`);
  }

  // Report-Cache (7d) — damit E-Mail-Report auch nach 24h noch funktioniert
  try {
    await redis.set(`report:${cacheKey}`, finalResponse, { ex: REPORT_CACHE_TTL });
  } catch (e) {
    console.warn(`⚠️ Report-Cache Error: ${e.message}`);
  }

  return res.status(200).json(finalResponse);
}

// ════════════════════════════════════════════════════════════
// EINZELNE TEST-FUNKTIONEN
// ════════════════════════════════════════════════════════════

async function runGeminiKnowledge({
  modelWithSearch, modelLight,
  searchLabel, hasDomain, cleanDomain, companyName, locationHint,
  cleanIndustry, isGenericIndustry,
}) {
  try {
    const brandHint = (companyName && hasDomain) ? ` (auch bekannt als "${companyName}")` : '';
    const prompt = `Suche nach **${searchLabel}**${brandHint} und beschreibe kurz:${locationHint}
- Was bietet dieses${hasDomain ? 's Unternehmen' : ' Person/Unternehmen'} an?
- In welcher Branche ist ${hasDomain ? 'es' : 'sie/es'} tätig?
- Wo ist der Standort?

Antworte in 3-5 Sätzen. Schreibe Firmennamen **fett**.
Fokus auf den DACH-Raum.
Falls nichts gefunden: "Zu **${searchLabel}** wurden keine Informationen gefunden."

WICHTIG: Beginne DIREKT mit dem Inhalt.`;

    const result = await modelWithSearch.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
    });

    const rawText = result.response.text();
    const formatted = formatResponseText(rawText);
    const plain = stripHTML(formatted);
    const groundingMetadata = result.response?.candidates?.[0]?.groundingMetadata;

    let mentioned = false;
    if (hasDomain) {
      mentioned = isDomainMentioned(plain, cleanDomain, 'knowledge')
                || isSubstantialBusinessResponse(plain, cleanDomain, 'knowledge');
    }
    if (!mentioned && companyName) {
      if (plain.toLowerCase().includes(companyName.toLowerCase()) && !isNegativeResponse(plain)) {
        mentioned = true;
      }
    }

    let detectedIndustry = null;
    if ((!cleanIndustry || isGenericIndustry) && mentioned) {
      try {
        detectedIndustry = await detectIndustryFromResponse(modelLight, rawText, cleanDomain || searchLabel);
      } catch (e) { console.warn(`Industry-Detection failed: ${e.message}`); }
    }

    let extractedCompany = null;
    if (!companyName && hasDomain) {
      extractedCompany = extractCompanyName(rawText, cleanDomain);
    }

    return {
      result: {
        id: 'knowledge',
        description: 'Bekanntheit im Web',
        mentioned,
        sentiment: 'neutral', // wird später von bundled sentiment überschrieben
        competitors: [],
        response: formatted,
        groundingUsed: true,
        engine: 'gemini',
      },
      detectedIndustry,
      companyName: extractedCompany,
    };
  } catch (error) {
    return {
      result: {
        id: 'knowledge',
        description: 'Bekanntheit im Web',
        mentioned: false,
        sentiment: 'fehler',
        competitors: [],
        response: '❌ Test fehlgeschlagen: ' + escapeHTML(error.message),
        groundingUsed: true,
        engine: 'gemini',
      },
      detectedIndustry: null,
      companyName: null,
    };
  }
}

async function runGeminiReviews({ modelWithSearch, searchLabel, hasDomain, cleanDomain, companyName, locationHint }) {
  const companyHint = (companyName && hasDomain) ? `\n\nHINWEIS: Auch bekannt als "${companyName}".` : '';
  const prompt = `Suche nach Bewertungen und Rezensionen zu **${searchLabel}**.${locationHint}${companyHint}

Prüfe: Google Reviews, Trustpilot, ProvenExpert, Kununu, ähnliche Plattformen.

Fasse zusammen: Bewertung (Sterne/Score), was sagen Kunden, wie viele Bewertungen.

Falls keine gefunden: "Zu **${searchLabel}** wurden keine Online-Bewertungen gefunden."

Fokus auf DACH-Raum. Beginne DIREKT mit dem Inhalt.`;

  try {
    const result = await modelWithSearch.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
    });
    const text = formatResponseText(result.response.text());
    const plain = stripHTML(text);

    let mentioned = false;
    if (hasDomain) {
      mentioned = isDomainMentioned(plain, cleanDomain, 'reviews')
               || isSubstantialBusinessResponse(plain, cleanDomain, 'reviews');
    }
    if (!mentioned && companyName) {
      if (plain.toLowerCase().includes(companyName.toLowerCase()) && !isNegativeResponse(plain)) {
        mentioned = true;
      }
    }

    return {
      id: 'reviews',
      description: 'Online-Reputation',
      mentioned,
      sentiment: 'neutral',
      competitors: [],
      response: text,
      groundingUsed: true,
      engine: 'gemini',
    };
  } catch (error) {
    return {
      id: 'reviews',
      description: 'Online-Reputation',
      mentioned: false,
      sentiment: 'fehler',
      competitors: [],
      response: '❌ Test fehlgeschlagen: ' + escapeHTML(error.message),
      groundingUsed: true,
      engine: 'gemini',
    };
  }
}

async function runGeminiMentions({ modelWithSearch, searchLabel, hasDomain, cleanDomain, companyName, locationHint }) {
  const companyHint = (companyName && hasDomain) ? `\n\nHINWEIS: Auch bekannt als "${companyName}".` : '';
  const prompt = hasDomain
    ? `Suche nach EXTERNEN Erwähnungen von **${cleanDomain}** auf ANDEREN Websites.${locationHint}${companyHint}

WICHTIG:
- NUR Erwähnungen auf FREMDEN Domains zählen!
- Unterseiten AUF ${cleanDomain} selbst zählen NICHT.
- Auch Subdomains (blog.${cleanDomain}) zählen NICHT.

Prüfe: Branchenverzeichnisse (Herold, WKO, Gelbe Seiten), Artikel/Blogs auf ANDEREN Sites, Social Profile (LinkedIn, XING, Facebook).

Liste nur EXTERNE Erwähnungen. Schreibe Quellennamen **fett**.
Falls nichts gefunden: "Zu **${cleanDomain}** wurden keine externen Erwähnungen gefunden."

Fokus DACH. Beginne DIREKT mit dem Inhalt.`
    : `Suche nach Erwähnungen von **${searchLabel}** im Internet.${locationHint}

Prüfe: Branchenverzeichnisse, Artikel/Blogs, Social Profile, Bewertungsportale.

Liste gefundene Erwähnungen. Schreibe Quellennamen **fett**.
Falls nichts gefunden: "Zu **${searchLabel}** wurden keine Erwähnungen gefunden."

Fokus DACH. Beginne DIREKT mit dem Inhalt.`;

  try {
    const result = await modelWithSearch.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
    });
    const text = formatResponseText(result.response.text());
    const plain = stripHTML(text);
    const groundingMetadata = result.response?.candidates?.[0]?.groundingMetadata;

    let mentioned = false;
    if (hasDomain) {
      mentioned = isDomainMentioned(plain, cleanDomain, 'mentions')
               || isSubstantialBusinessResponse(plain, cleanDomain, 'mentions');
    }
    if (!mentioned && companyName) {
      if (plain.toLowerCase().includes(companyName.toLowerCase()) && !isNegativeResponse(plain)) {
        mentioned = true;
      }
    }

    const domainBase = hasDomain ? cleanDomain.replace(/\.[^.]+$/, '') : '';
    const competitors = extractCompetitors(groundingMetadata, text, domainBase);

    return {
      id: 'mentions',
      description: 'Externe Erwähnungen',
      mentioned,
      sentiment: 'neutral',
      competitors,
      response: text,
      groundingUsed: true,
      engine: 'gemini',
    };
  } catch (error) {
    return {
      id: 'mentions',
      description: 'Externe Erwähnungen',
      mentioned: false,
      sentiment: 'fehler',
      competitors: [],
      response: '❌ Test fehlgeschlagen: ' + escapeHTML(error.message),
      groundingUsed: true,
      engine: 'gemini',
    };
  }
}

async function runChatGPTTests({ searchLabel, hasDomain, cleanDomain, companyName, locationHint }) {
  const companyHint = (companyName && hasDomain) ? ` (auch bekannt als "${companyName}")` : '';

  const testDefs = [
    {
      id: 'chatgpt_knowledge',
      description: 'Bekanntheit (ChatGPT)',
      prompt: hasDomain
        ? `Was weißt du über die Website ${cleanDomain}${companyHint}?${locationHint}
Beschreibe kurz: Was bietet es an? Welche Branche? Wo ist der Standort?

Antworte in 3-5 Sätzen auf Deutsch. Firmennamen **fett**. Fokus DACH.
Falls nichts bekannt: "Zu **${cleanDomain}** habe ich keine Informationen."

Beginne DIREKT mit dem Inhalt.`
        : `Was weißt du über **${searchLabel}**?${locationHint}
Beschreibe kurz: Was bietet es/sie an? Welche Branche? Wo ist der Standort?

Antworte in 3-5 Sätzen auf Deutsch. Namen **fett**. Fokus DACH.
Falls nichts bekannt: "Zu **${searchLabel}** habe ich keine Informationen."

Beginne DIREKT mit dem Inhalt.`,
    },
    {
      id: 'chatgpt_reviews',
      description: 'Online-Reputation (ChatGPT)',
      prompt: `Suche nach Bewertungen zu **${searchLabel}**.${locationHint}${companyHint}

Prüfe Google Reviews, Trustpilot, ProvenExpert, Kununu.

Fasse zusammen: Bewertung, Kundenstimmen, Anzahl.

Auf Deutsch, Plattformnamen **fett**. Fokus DACH.
Falls keine gefunden: "Zu **${searchLabel}** wurden keine Online-Bewertungen gefunden."

Beginne DIREKT mit dem Inhalt.`,
    },
    {
      id: 'chatgpt_mentions',
      description: 'Externe Erwähnungen (ChatGPT)',
      prompt: hasDomain
        ? `Suche EXTERNE Erwähnungen von **${cleanDomain}**${companyHint} auf ANDEREN Websites.${locationHint}

WICHTIG: NUR Erwähnungen auf FREMDEN Domains! Unterseiten auf ${cleanDomain} zählen NICHT.

Prüfe Branchenverzeichnisse, Artikel/Blogs, Social Profile, Bewertungsportale.

Liste externe Erwähnungen, Quellennamen **fett**. Fokus DACH.
Falls nichts: "Zu **${cleanDomain}** wurden keine externen Erwähnungen gefunden."

Beginne DIREKT mit dem Inhalt.`
        : `Suche Erwähnungen von **${searchLabel}** im Internet.${locationHint}

Prüfe Branchenverzeichnisse, Artikel/Blogs, Social Profile, Bewertungsportale.

Liste Erwähnungen, Quellennamen **fett**. Fokus DACH.
Falls nichts: "Zu **${searchLabel}** wurden keine Erwähnungen gefunden."

Beginne DIREKT mit dem Inhalt.`,
    },
  ];

  return Promise.all(testDefs.map(async (test) => {
    try {
      const rawText = await chatGPTQuery(test.prompt, { useSearch: true });
      const text = formatResponseText(rawText);
      const plain = stripHTML(text);
      const testType = test.id.replace('chatgpt_', '');

      let mentioned = false;
      if (hasDomain) {
        mentioned = isDomainMentioned(plain, cleanDomain, testType)
                 || isSubstantialBusinessResponse(plain, cleanDomain, testType);
      }
      if (!mentioned && companyName) {
        if (plain.toLowerCase().includes(companyName.toLowerCase()) && !isNegativeResponse(plain)) {
          mentioned = true;
        }
      }

      const domainBase = hasDomain ? cleanDomain.replace(/\.[^.]+$/, '') : '';
      const competitors = testType === 'mentions'
        ? extractCompetitors(null, text, domainBase)
        : [];

      return {
        id: test.id,
        description: test.description,
        mentioned,
        sentiment: 'neutral',
        competitors,
        response: text.length > 1200 ? text.substring(0, 1200) + '...' : text,
        engine: 'chatgpt',
      };
    } catch (error) {
      return {
        id: test.id,
        description: test.description,
        mentioned: false,
        sentiment: 'fehler',
        competitors: [],
        response: '❌ ChatGPT-Test fehlgeschlagen: ' + escapeHTML(error.message),
        engine: 'chatgpt',
      };
    }
  }));
}

// ════════════════════════════════════════════════════════════
// VERDICT / RECOMMENDATIONS
// ════════════════════════════════════════════════════════════

function buildVerdict({ geminiTests, chatgptTests, hasDomain, searchLabel, detectedIndustry, cleanIndustry, crawlerAccess }) {
  const geminiKnows   = geminiTests.find(t => t.id === 'knowledge')?.mentioned;
  const chatgptKnows  = chatgptTests.find(t => t.id === 'chatgpt_knowledge')?.mentioned;
  const geminiReviews = geminiTests.find(t => t.id === 'reviews')?.mentioned;
  const chatgptReviews = chatgptTests.find(t => t.id === 'chatgpt_reviews')?.mentioned;
  const geminiMentions = geminiTests.find(t => t.id === 'mentions')?.mentioned;
  const chatgptMentions = chatgptTests.find(t => t.id === 'chatgpt_mentions')?.mentioned;
  const searchTerm = hasDomain ? `nach ${detectedIndustry || cleanIndustry || 'deiner Branche'} in deiner Region` : `nach "${searchLabel}"`;

  let verdict = '';
  if (geminiKnows && chatgptKnows) {
    verdict = `Wenn jemand Gemini oder ChatGPT ${searchTerm} fragt, wirst du wahrscheinlich erwähnt.`;
  } else if (geminiKnows || chatgptKnows) {
    const knows  = geminiKnows ? 'Gemini' : 'ChatGPT';
    const doesnt = geminiKnows ? 'ChatGPT' : 'Gemini';
    verdict = `${knows} kennt dich, aber ${doesnt} nicht. Du erreichst nur einen Teil der KI-Nutzer.`;
  } else {
    verdict = `Weder Gemini noch ChatGPT kennen dich. Bei Branchenanfragen werden nur deine Konkurrenten empfohlen.`;
  }
  if (!geminiReviews && !chatgptReviews) {
    verdict += ' Bei Fragen nach Bewertungen schweigen beide KIs — hier verlierst du Punkte.';
  }
  if (!geminiMentions && !chatgptMentions && (geminiKnows || chatgptKnows)) {
    verdict += ' Externe Erwähnungen auf Drittseiten fehlen, das schwächt deine Autorität.';
  }
  // Neuer Warnsatz bei robots.txt-Block
  if (crawlerAccess?.blockedCrawlers?.length >= 2) {
    verdict += ` ⚠️ Deine robots.txt blockiert ${crawlerAccess.blockedCrawlers.length} KI-Crawler — das ist wahrscheinlich die Hauptursache.`;
  }
  return verdict;
}

function buildRecommendations({
  testResults, geminiTests, chatgptTests, hasChatGPT, hasDomain,
  domainAnalysis, crawlerAccess, negativeCount, positiveCount,
}) {
  const recommendations = [];
  const mentionCount = testResults.filter(t => t.mentioned).length;

  // KI-Crawler-Block (HÖCHSTE Priorität, weil alles andere sinnlos ist wenn geblockt)
  if (crawlerAccess?.blockedCrawlers?.length > 0) {
    const names = crawlerAccess.blockedCrawlers.map(b => b.name).join(', ');
    recommendations.push({
      priority: 'hoch',
      title: 'KI-Crawler in robots.txt freigeben',
      description: `Deine robots.txt blockiert: ${names}. Solange diese Bots deine Seite nicht crawlen dürfen, können die KI-Systeme deinen Content nicht lernen. Entferne die "Disallow: /"-Einträge für diese User-Agents.`,
      link: null,
      pointPotential: `+${Math.min(crawlerAccess.blockedCrawlers.length * 3, 12)}–${Math.min(crawlerAccess.blockedCrawlers.length * 5, 20)} Punkte`,
    });
  }

  if (mentionCount === 0) {
    recommendations.push({
      priority: 'hoch',
      title: 'Online-Präsenz aufbauen',
      description: hasDomain
        ? 'Deine Domain wird kaum gefunden. Fokussiere auf Google Business Profile und Branchenverzeichnisse.'
        : 'Du wirst in KI-Antworten kaum gefunden. Fokussiere auf Google Business Profile, Branchenverzeichnisse und eine eigene Website.',
      link: '/geo-seo',
      pointPotential: '+20–35 Punkte',
    });
  }

  if (hasDomain && !domainAnalysis.hasSchema) {
    recommendations.push({
      priority: 'hoch',
      title: 'Schema.org Markup hinzufügen',
      description: 'Strukturierte Daten helfen KI deine Inhalte zu verstehen. Besonders wertvoll: FAQPage, Article, Product, LocalBusiness.',
      link: '/schema-org-meta-description',
      pointPotential: '+5–8 Punkte',
    });
  } else if (hasDomain && domainAnalysis.valuableSchemaCount === 0) {
    recommendations.push({
      priority: 'mittel',
      title: 'Wertvolle Schema-Typen ergänzen',
      description: 'Du hast Schema-Markup, aber keinen der KI-freundlichen Typen (FAQPage, Article, HowTo, Product, LocalBusiness). Diese Typen verbessern die KI-Erkennung deutlich.',
      link: '/schema-org-meta-description',
      pointPotential: '+3–5 Punkte',
    });
  }

  if (hasDomain && !crawlerAccess?.llmsTxtFound) {
    recommendations.push({
      priority: 'mittel',
      title: 'llms.txt einrichten',
      description: 'Der neue llms.txt-Standard hilft KI-Systemen, deinen Content strukturiert zu erfassen. Eine Markdown-Datei im Root mit deinen wichtigsten Seiten reicht.',
      link: null,
      pointPotential: '+1–2 Punkte',
    });
  }

  if (negativeCount >= 2) {
    recommendations.push({
      priority: 'hoch',
      title: 'Online-Reputation verbessern',
      description: 'Mehrere Tests zeigen negative Signale. Aktiv Bewertungen sammeln und auf Kritik reagieren.',
      link: null,
      pointPotential: '+8–15 Punkte',
    });
  }

  const geminiReviews = geminiTests.find(t => t.id === 'reviews')?.mentioned;
  const chatgptReviews = chatgptTests.find(t => t.id === 'chatgpt_reviews')?.mentioned;
  if (!geminiReviews && !chatgptReviews && mentionCount > 0) {
    recommendations.push({
      priority: 'hoch',
      title: 'Google-Bewertungen aufbauen',
      description: 'Keine KI findet Bewertungen zu dir. Schon 5–10 Google Reviews ändern das. Beide KIs zitieren Google Reviews als Vertrauenssignal.',
      link: null,
      pointPotential: '+5–10 Punkte',
    });
  } else if (positiveCount === 0 && mentionCount > 0) {
    recommendations.push({
      priority: 'hoch',
      title: 'Bewertungen sammeln',
      description: 'Du wirst gefunden, aber es fehlen positive Signale. Bitte zufriedene Kunden um Reviews.',
      link: null,
      pointPotential: '+5–10 Punkte',
    });
  }

  const geminiMentions = geminiTests.find(t => t.id === 'mentions')?.mentioned;
  const chatgptMentions = chatgptTests.find(t => t.id === 'chatgpt_mentions')?.mentioned;
  const geminiKnows = geminiTests.find(t => t.id === 'knowledge')?.mentioned;
  const chatgptKnows = chatgptTests.find(t => t.id === 'chatgpt_knowledge')?.mentioned;

  if ((!geminiMentions || !chatgptMentions) && (geminiKnows || chatgptKnows)) {
    const missing = !geminiMentions && !chatgptMentions ? 'Beide KIs finden' : (!geminiMentions ? 'Gemini findet' : 'ChatGPT findet');
    recommendations.push({
      priority: 'hoch',
      title: 'Externe Erwähnungen stärken',
      description: `${missing} keine Erwähnungen auf Drittseiten. Gastartikel, Verzeichnisse (WKO, Herold) und Fachportale helfen.`,
      link: null,
      pointPotential: '+5–9 Punkte',
    });
  }

  if (hasDomain) {
    const missingEEAT = [];
    if (!domainAnalysis.hasAboutPage)  missingEEAT.push('"Über uns" Seite');
    if (!domainAnalysis.hasContactPage) missingEEAT.push('Kontakt/Impressum');
    if (!domainAnalysis.hasAuthorInfo)  missingEEAT.push('Autoren-Info');
    if (missingEEAT.length > 0) {
      recommendations.push({
        priority: missingEEAT.length >= 2 ? 'hoch' : 'mittel',
        title: 'E-E-A-T Signale stärken',
        description: `Fehlend: ${missingEEAT.join(', ')}. Diese Infos helfen KI-Systemen, dein Unternehmen als vertrauenswürdig einzustufen.`,
        link: null,
        pointPotential: `+${missingEEAT.length * 2}–${missingEEAT.length * 3} Punkte`,
      });
    }
  } else {
    recommendations.push({
      priority: 'hoch',
      title: 'Eigene Website erstellen',
      description: 'Eine professionelle Website mit Schema.org, Über-uns-Seite und Impressum stärkt deine KI-Sichtbarkeit enorm.',
      link: null,
      pointPotential: '+15–25 Punkte',
    });
  }

  const chatgptMentionCount = chatgptTests.filter(t => t.mentioned).length;
  const geminiMentionCount = geminiTests.filter(t => t.mentioned).length;
  if (chatgptTests.length > 0 && chatgptMentionCount === 0 && geminiMentionCount > 0) {
    recommendations.push({
      priority: 'mittel',
      title: 'ChatGPT-Sichtbarkeit verbessern',
      description: 'Gemini kennt dich, aber ChatGPT nicht. Mehr externe Erwähnungen, Wikipedia-Einträge und strukturierte Daten helfen.',
      link: null,
      pointPotential: '+10–20 Punkte',
    });
  }
  if (chatgptTests.length > 0 && chatgptMentionCount > 0 && geminiMentionCount === 0) {
    recommendations.push({
      priority: 'mittel',
      title: 'Google/Gemini-Sichtbarkeit verbessern',
      description: 'ChatGPT kennt dich, aber Gemini nicht. Google Business Profile und Schema.org sind entscheidend.',
      link: '/schema-org-meta-description',
      pointPotential: '+10–20 Punkte',
    });
  }

  return recommendations;
}
