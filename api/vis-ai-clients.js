// lib/ai-clients.js - KI-Client-Funktionen (ChatGPT, Gemini Helpers)

// =================================================================
// OPENAI / CHATGPT CLIENT
// =================================================================
export async function chatGPTQuery(prompt) {
  const models = [
    { model: 'gpt-4o-mini', body: { temperature: 0.2, max_tokens: 1500 } },
    { model: 'gpt-5-nano', body: { max_completion_tokens: 1500 } }
  ];

  for (const { model, body } of models) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          ...body
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.warn(`⚠️ ${model} fehlgeschlagen (${response.status}), versuche Fallback...`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (content) {
        console.log(`✅ ChatGPT-Antwort via ${model}`);
        return content;
      }
    } catch (err) {
      console.warn(`⚠️ ${model} Fehler: ${err.message}, versuche Fallback...`);
      continue;
    }
  }

  throw new Error('Alle OpenAI-Modelle fehlgeschlagen (gpt-4o-mini, gpt-5-nano)');
}

// =================================================================
// HELPER: Branche aus Antwort extrahieren
// Wird jetzt mit modelLight (ohne Search) aufgerufen → spart Quota
// =================================================================
export async function detectIndustryFromResponse(model, knowledgeText, domain) {
  try {
    const cleanText = knowledgeText
      .substring(0, 500)
      .replace(/["`\\]/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    const extractPrompt = `Basierend auf diesem Text über ${domain}:

"${cleanText}"

In welcher Branche ist dieses Unternehmen tätig? 
Antworte mit NUR 1-3 Wörtern (z.B. "Luftfracht Transport", "Webentwicklung", "Gastronomie", "E-Commerce").
Keine Erklärung, nur die Branche.`;

    const result = await model.generateContent(extractPrompt);
    const industry = result.response.text().trim();
    
    if (industry.length > 50 || industry.includes('.')) {
      return null;
    }
    
    return industry;
  } catch (e) {
    console.log('Branchenerkennung fehlgeschlagen:', e.message);
    return null;
  }
}
