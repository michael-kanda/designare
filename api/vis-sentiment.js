// lib/sentiment.js - Sentiment-Analyse (LLM-basiert mit Keyword-Fallback)

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

    const prompt = `Du bist ein Sentiment-Analyzer. Bewerte den folgenden Text über ein Unternehmen.

Kontext: ${testLabels[testType] || 'Allgemeine Information'}
Domain erwähnt: ${domainMentioned ? 'Ja' : 'Nein'}

Text:
"""
${cleanText}
"""

Regeln:
- "positiv" = Unternehmen wird substantiell beschrieben, gute Bewertungen, positive Erwähnungen, oder es werden externe Quellen aufgelistet
- "neutral" = Unternehmen wird erwähnt aber ohne klare Wertung, gemischte Signale
- "negativ" = Explizit schlechte Bewertungen oder starke Kritik
- "fehlend" = Unternehmen nicht gefunden, KEINE Informationen vorhanden, oder Text sagt explizit dass nichts gefunden wurde

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
// KEYWORD-FALLBACK
// =================================================================
function analyzeSentimentFallback(text, testType, domainMentioned) {
  const textLower = text.replace(/<[^>]*>/g, '').toLowerCase();
  
  const notFoundIndicators = [
    'keine informationen', 'nicht gefunden', 'keine ergebnisse',
    'nicht bekannt', 'konnte ich keine', 'wurden keine',
    'nichts gefunden', 'nicht zu finden', 'keine daten', 'nicht auffindbar'
  ];
  
  const hasNotFound = notFoundIndicators.some(indicator => textLower.includes(indicator));
  
  if (testType === 'knowledge') {
    if (!domainMentioned) return 'fehlend';
    
    const hasSubstantialInfo = 
      textLower.includes('bietet') || textLower.includes('anbieter') ||
      textLower.includes('dienstleistung') || textLower.includes('produkt') ||
      textLower.includes('unternehmen') || textLower.includes('firma') ||
      textLower.includes('standort') || textLower.includes('spezialisiert') ||
      textLower.includes('tätig') || textLower.includes('gegründet') ||
      textLower.includes('seit') || textLower.includes('agentur') ||
      textLower.includes('service');
    
    if (hasSubstantialInfo) return 'positiv';
    if (hasNotFound && !hasSubstantialInfo) return 'fehlend';
    return 'neutral';
  }
  
  if (testType === 'reviews') {
    const noBewertungen = [
      'keine bewertungen', 'keine rezensionen', 'keine online-bewertungen',
      'wurden keine bewertungen', 'keine bewertungen gefunden', 'keine rezensionen gefunden'
    ];
    if (noBewertungen.some(phrase => textLower.includes(phrase))) return 'fehlend';
    
    const hasLowRating = [
      /\b[1-2][.,]\d?\s*(sterne|stars|von\s*5)/i, /\b[12]\s*von\s*5/i,
      /bewertung[:\s]+1/i, /[12]\.0\s*(sterne|von)/i
    ].some(p => p.test(text));
    if (hasLowRating) return 'negativ';
    
    const hasHighRating = [
      /\b[4-5][.,]\d?\s*(sterne|stars|von\s*5)/i, /\b[45]\s*von\s*5/i,
      /4\.[5-9]/, /5\.0/
    ].some(p => p.test(text));
    
    const hasPositiveWords = ['zufrieden','empfehlen','positiv','sehr gut','hervorragend','ausgezeichnet']
      .some(w => textLower.includes(w));
    
    if (hasHighRating || hasPositiveWords) return 'positiv';
    if ([/\b3[.,]\d?\s*(sterne|stars|von\s*5)/i, /\b3\s*von\s*5/i].some(p => p.test(text))) return 'neutral';
    return 'neutral';
  }
  
  if (testType === 'mentions') {
    if (hasNotFound) return 'fehlend';
    
    const sourceCount = [
      'herold','wko','gelbe seiten','facebook','instagram','linkedin',
      'twitter','xing','trustpilot','provenexpert','branchenverzeichnis',
      'artikel','blog','presse','erwähnung','youtube','firmenabc',
      'meinanwalt','anwalt.de','kununu','xing','yelp'
    ].filter(s => textLower.includes(s)).length;
    
    if (sourceCount >= 4) return 'positiv';
    if (sourceCount >= 1) return 'neutral';
    if (!domainMentioned) return 'fehlend';
    return 'neutral';
  }
  
  return 'neutral';
}
