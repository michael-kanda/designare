// =================================================================
// OPENAI / CHATGPT CLIENT
// =================================================================
export async function chatGPTQuery(prompt, { useSearch = false } = {}) {
  // Strategy: try Responses API (supports web search) first, then Chat Completions fallback
  const responsesModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-5-nano'];

  // --- Responses API (with optional web search) ---
  if (useSearch) {
    for (const model of responsesModels) {
      try {
        const body = {
          model,
          input: prompt,
          tools: [{ type: 'web_search_preview' }]
        };

        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          console.warn(`⚠️ Responses API ${model} fehlgeschlagen (${response.status}), Fallback...`);
          continue;
        }

        const data = await response.json();
        // Responses API: extract text from output_text or output items
        const text = data.output_text
          || data.output?.filter(o => o.type === 'message')
              .flatMap(o => o.content?.filter(c => c.type === 'output_text').map(c => c.text))
              .join('\n')
          || '';

        if (text) {
          console.log(`✅ ChatGPT-Antwort via Responses API ${model} (web_search: on)`);
          return text;
        }
      } catch (err) {
        console.warn(`⚠️ Responses API ${model} Fehler: ${err.message}, Fallback...`);
        continue;
      }
    }
  }

  // --- Chat Completions API (no web search, training knowledge only) ---
  const completionModels = [
    { model: 'gpt-4o-mini', body: { temperature: 0.2, max_tokens: 1500 } },
    { model: 'gpt-5-nano', body: { max_completion_tokens: 1500 } }
  ];

  for (const { model, body } of completionModels) {
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
        console.warn(`⚠️ ${model} fehlgeschlagen (${response.status}), versuche Fallback...`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      if (content) {
        console.log(`✅ ChatGPT-Antwort via ${model} (training only)`);
        return content;
      }
    } catch (err) {
      console.warn(`⚠️ ${model} Fehler: ${err.message}, versuche Fallback...`);
      continue;
    }
  }

  throw new Error('Alle OpenAI-Modelle fehlgeschlagen');
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
