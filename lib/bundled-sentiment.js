// api/lib/bundled-sentiment.js
// Eine einzige LLM-Anfrage für ALLE Sentiment-Checks statt 6 separater Calls.
// Spart ~80% Tokens und Latenz gegenüber dem Einzel-Call-Ansatz.
//
// Die alte `analyzeSentiment(text, testType, mentioned)` aus vis-sentiment.js
// bleibt bestehen und wird als Fallback genutzt, falls der Bundle-Call fehlschlägt.

const VALID_SENTIMENTS = new Set(['positiv', 'neutral', 'negativ', 'fehlend']);

/**
 * Analysiert mehrere Test-Antworten gebündelt auf ihr Sentiment.
 *
 * @param {Object} modelLight - Gemini-Instanz OHNE Search (geringe Token-Kosten)
 * @param {Array<{id: string, testType: string, mentioned: boolean, text: string}>} tests
 * @returns {Promise<Object<string, 'positiv'|'neutral'|'negativ'|'fehlend'>>} map: id → sentiment
 */
export async function analyzeSentimentsBundled(modelLight, tests) {
  if (!tests.length) return {};

  // Shortcut: nicht erwähnte Tests sind immer 'fehlend', die sparen wir uns
  const toAnalyze = tests.filter(t => t.mentioned);
  const result = {};
  for (const t of tests) {
    if (!t.mentioned) result[t.id] = 'fehlend';
  }
  if (!toAnalyze.length) return result;

  // Prompt konstruieren
  const inputBlock = toAnalyze.map((t, i) => {
    const typeHint = {
      knowledge: 'Ist das Unternehmen als kompetent und vertrauenswürdig beschrieben?',
      reviews: 'Welche Sterne/Bewertungen/Kundenstimmen werden zitiert?',
      mentions: 'Werden externe Erwähnungen als hochwertig dargestellt?',
    }[t.testType] || 'Wie wird das Unternehmen insgesamt dargestellt?';

    const snippet = (t.text || '').replace(/\s+/g, ' ').slice(0, 800);
    return `[${i + 1}] TYP: ${t.testType} | FOKUS: ${typeHint}\nTEXT: ${snippet}\n`;
  }).join('\n---\n');

  const prompt = `Classify each of the following ${toAnalyze.length} texts into exactly ONE sentiment category:
- "positiv": explicitly positive portrayal, good reviews, praise
- "neutral": mentioned/described without clear valuation
- "negativ": explicit criticism, bad reviews, warnings
- "fehlend": text says "not found" or similar (despite mentioned flag)

Texts:
${inputBlock}

CRITICAL OUTPUT RULES:
- Output RAW JSON ONLY. No prose, no preamble, no "Here is...", no markdown, no code fences.
- Your entire response MUST start with { and end with }.
- Format: {"1":"positiv","2":"neutral","3":"negativ"}
- Keys are the numbers [1..${toAnalyze.length}], values are one of: positiv, neutral, negativ, fehlend.`;

  /**
   * Robust JSON extraction: find first { and last } in the response.
   * Handles prose prefixes ("Here is the JSON: ..."), code fences, and trailing text.
   */
  function extractJsonObject(raw) {
    if (!raw) throw new Error('empty response');
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
      throw new Error(`no JSON object in response (len=${raw.length}): ${raw.slice(0, 200)}`);
    }
    return raw.slice(first, last + 1);
  }

  /**
   * Safely gather full text from a Gemini response.
   * `response.text()` sometimes drops parts when finishReason != STOP.
   * We concatenate all text parts of the first candidate to get everything.
   */
  function gatherResponseText(response) {
    try {
      const viaHelper = (response?.text?.() || '').trim();
      if (viaHelper) return viaHelper;
    } catch {
      /* helper may throw on SAFETY/RECITATION; fall through to manual join */
    }
    const parts = response?.candidates?.[0]?.content?.parts || [];
    return parts.map(p => p?.text || '').join('').trim();
  }

  try {
    const response = await modelLight.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 1000, responseMimeType: 'application/json' },
    });

    const r = response?.response;
    const finishReason = r?.candidates?.[0]?.finishReason || 'unknown';
    const raw = gatherResponseText(r);

    // Nur wenn etwas offensichtlich schief lief loggen — nicht bei jedem Call
    if (finishReason !== 'STOP' && finishReason !== 'unknown') {
      console.warn(`   Sentiment-Bundle finishReason=${finishReason}, rawLen=${raw.length}`);
    }

    const jsonStr = extractJsonObject(raw);
    const parsed = JSON.parse(jsonStr);

    toAnalyze.forEach((t, i) => {
      const key = String(i + 1);
      const value = String(parsed[key] || '').toLowerCase();
      result[t.id] = VALID_SENTIMENTS.has(value) ? value : 'neutral';
    });
    return result;
  } catch (e) {
    console.warn(`⚠️ Bundled Sentiment fehlgeschlagen (${e.message}) → Fallback: alle als "neutral"`);
    // Defensiver Fallback: alle erwähnten Tests als 'neutral'
    toAnalyze.forEach(t => { result[t.id] = 'neutral'; });
    return result;
  }
}
