// lib/sentiment.js - Sentiment-Analyse (LLM-basiert mit Keyword-Fallback)
// Nutzt zentrale Konstanten aus vis-constants.js

import { SENTIMENT_KEYWORDS } from './vis-constants.js';

// =================================================================
// SENTIMENT-ANALYSE (LLM-basiert mit Keyword-Fallback)
// =================================================================
export async function analyzeSentiment(text, testType, domainMentioned) {
  if (!domainMentioned && testType === 'knowledge') {
    return 'fehlend';
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return analyzeSentimentFallback(text, testType, domainMentioned);
    }

    const cleanText = text
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
      .substring(0, 800)
      .trim();

    if (!cleanText || cleanText.length < 10) {
      return 'neutral';
    }

    const testLabels = {
      knowledge: 'Bekanntheit/Wissen über ein Unternehmen',
      reviews: 'Online-Bewertungen und Reputation',
      mentions: 'Externe Erwähnungen auf anderen Websites'
    };

    const prompt = `Du bist ein Sentiment-Analyzer für einen KI-Sichtbarkeits-Check.

Kontext: ${testLabels[testType] || 'Allgemeine Information'}
Domain erwähnt: ${domainMentioned ? 'Ja' : 'Nein'}

Text:
"""
${cleanText}
"""

Bewertungsregeln je nach Kontext:

BEKANNTHEIT (knowledge):
- "positiv" = Unternehmen wird mit konkreten Details beschrieben (Branche, Standort, Dienstleistungen, Gründung) — auch wenn die Beschreibung rein faktisch ist
- "neutral" = Unternehmen wird nur am Rande oder sehr vage erwähnt
- "fehlend" = Text sagt explizit, dass KEINE Informationen vorhanden sind

BEWERTUNGEN (reviews):
- "positiv" = Bewertungen ≥ 3.5 Sterne, positive Kundenmeinungen, gute Reputation
- "neutral" = Gemischte Bewertungen (ca. 3 Sterne) oder nur Plattform-Erwähnung ohne Wertung
- "negativ" = Bewertungen < 3 Sterne, deutliche Kritik
- "fehlend" = Keine Bewertungen gefunden / keine Daten zu Reviews

ERWÄHNUNGEN (mentions):
- "positiv" = Mehrere konkrete externe Quellen gefunden (≥ 3)
- "neutral" = 1-2 Erwähnungen gefunden
- "fehlend" = Keine externen Erwähnungen gefunden

Antworte mit EXAKT einem Wort: positiv, neutral, negativ oder fehlend`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 5
      })
    });

    if (!response.ok) {
      console.warn(`⚠️ Sentiment-LLM HTTP ${response.status}, Fallback auf Keywords`);
      return analyzeSentimentFallback(text, testType, domainMentioned);
    }

    const data = await response.json();
    const result = (data.choices?.[0]?.message?.content || '').trim().toLowerCase();

    if (['positiv', 'neutral', 'negativ', 'fehlend'].includes(result)) {
      return result;
    }

    console.warn(`⚠️ Sentiment-LLM unerwartete Antwort: "${result}", Fallback auf Keywords`);
    return analyzeSentimentFallback(text, testType, domainMentioned);

  } catch (error) {
    console.warn(`⚠️ Sentiment-LLM Fehler: ${error.message}, Fallback auf Keywords`);
    return analyzeSentimentFallback(text, testType, domainMentioned);
  }
}

// =================================================================
// KEYWORD-FALLBACK (nutzt zentrale Konstanten)
// =================================================================
function analyzeSentimentFallback(text, testType, domainMentioned) {
  const textLower = text.replace(/<[^>]*>/g, '').toLowerCase();
  
  const hasNotFound = SENTIMENT_KEYWORDS.notFound.some(indicator => textLower.includes(indicator));
  
  if (testType === 'knowledge') {
    if (!domainMentioned) return 'fehlend';
    
    const hasSubstantialInfo = SENTIMENT_KEYWORDS.substantialInfo.some(kw => textLower.includes(kw));
    
    if (hasSubstantialInfo) return 'positiv';
    if (hasNotFound && !hasSubstantialInfo) return 'fehlend';
    return 'neutral';
  }
  
  if (testType === 'reviews') {
    // Erst echte Ratings prüfen, DANN Negation
    const hasHighRating = [
      /\b[4-5][.,]\d?\s*(sterne|stars|von\s*5)/i, /\b[45]\s*von\s*5/i,
      /4\.[5-9]/, /5\.0/, /5\/5/
    ].some(p => p.test(text));
    
    const hasPositiveWords = SENTIMENT_KEYWORDS.positiveReviewWords.some(w => textLower.includes(w));
    
    if (hasHighRating || hasPositiveWords) return 'positiv';
    
    const hasLowRating = [
      /\b[1-2][.,]\d?\s*(sterne|stars|von\s*5)/i, /\b[12]\s*von\s*5/i,
      /bewertung[:\s]+1/i, /[12]\.0\s*(sterne|von)/i
    ].some(p => p.test(text));
    if (hasLowRating) return 'negativ';
    
    if (SENTIMENT_KEYWORDS.reviewNegation.some(phrase => textLower.includes(phrase))) {
      return 'fehlend';
    }
    
    if ([/\b3[.,]\d?\s*(sterne|stars|von\s*5)/i, /\b3\s*von\s*5/i].some(p => p.test(text))) return 'neutral';
    return 'neutral';
  }
  
  if (testType === 'mentions') {
    // Erst Quellen zählen, DANN Negation
    const sourceCount = SENTIMENT_KEYWORDS.mentionSources.filter(s => textLower.includes(s)).length;
    
    if (sourceCount >= 4) return 'positiv';
    if (sourceCount >= 1) return 'neutral';
    
    if (hasNotFound) return 'fehlend';
    if (!domainMentioned) return 'fehlend';
    return 'neutral';
  }
  
  return 'neutral';
}
