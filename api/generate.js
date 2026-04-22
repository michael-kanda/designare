// api/generate.js – Silas Content Generator
// Version 2: Clean rewrite mit Brevo-Benachrichtigung + Redis Rate-Limiting
import { GoogleGenerativeAI } from "@google/generative-ai";
import { FactChecker } from './fact-checker.js';
import * as brevo from '@getbrevo/brevo';
import { checkRateLimit, incrementRateLimit, getClientIP } from './rate-limiter.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const factChecker = new FactChecker();

// =================================================================
// CONFIG
// =================================================================
const MODELS = {
  master: ['gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-2.5-flash'],
  demo:   ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-1.5-flash']
};

const SILAS_DAILY_LIMIT = 10; // Max Generierungen pro IP pro Tag (Demo)

const GENERATION_CONFIG = {
  responseMimeType: 'application/json',
  maxOutputTokens: 8192,
  temperature: 0.7
};

const MAX_RETRIES = 3;

// =================================================================
// HELPERS
// =================================================================
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extrahiert valides JSON aus der Modell-Antwort
 */
function extractJson(raw) {
  if (typeof raw !== 'string') return raw;

  let text = raw
    .replace(/```(?:json|javascript)?\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    text = text.substring(first, last + 1);
  }

  return JSON.parse(text);
}

// =================================================================
// MODELL-AUFRUF MIT FALLBACK-KETTE
// =================================================================
/**
 * Versucht die Generierung über eine Kette von Modellen mit Retry-Logik
 * @returns {{ data: Object, model: string }}
 */
async function generate(prompt, isMaster) {
  const models = isMaster ? MODELS.master : MODELS.demo;
  let lastError = null;

  for (const modelName of models) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`   [${modelName}] Versuch ${attempt}/${MAX_RETRIES}`);

        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: GENERATION_CONFIG
        });

        const result = await model.generateContent(prompt);
        const text = await result.response.text();

        if (!text || text.length < 50) {
          throw new Error('Antwort zu kurz oder leer');
        }

        const data = extractJson(text);

        // Plausibilitäts-Check
        const missing = ['faq_1', 'testimonial_1', 'guarantee_text'].filter(f => !data[f]);
        if (missing.length > 0) {
          console.warn(`   ⚠️ Fehlende Felder: ${missing.join(', ')}`);
        }

        console.log(`   ✅ Erfolg (${modelName}, ${text.length} Zeichen)`);
        return { data, model: modelName };

      } catch (error) {
        lastError = error;
        const msg = error.message || String(error);
        console.warn(`   ❌ ${modelName} #${attempt}: ${msg}`);

        const isRetryable = /503|overloaded|429|quota|Too Many/i.test(msg);

        if (isRetryable && attempt < MAX_RETRIES) {
          const wait = Math.pow(2, attempt) * 1000;
          console.log(`   ⏳ Warte ${wait / 1000}s...`);
          await delay(wait);
        } else {
          break; // Nächstes Modell
        }
      }
    }
  }

  throw new Error(`Alle Modelle fehlgeschlagen: ${lastError?.message || lastError}`);
}

// =================================================================
// BREVO E-MAIL-BENACHRICHTIGUNG
// =================================================================
async function sendNotification(keywords, results, isMaster) {
  try {
    if (!process.env.BREVO_API_KEY) return;

    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

    const success = results.filter(r => !r.error).length;
    const total = results.length;
    const config = keywords[0] || {};

    const timestamp = new Date().toLocaleString('de-AT', {
      timeZone: 'Europe/Vienna',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const modeBadge = isMaster
      ? '<span style="background:#22c55e;color:#000;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">MASTER</span>'
      : '<span style="background:#f59e0b;color:#000;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">DEMO</span>';

    // Keyword-Tabelle
    const rows = results.map(r => {
      const ok = !r.error;
      const title = ok ? (r.post_title || '-') : r.error.substring(0, 80);
      const model = ok ? `<span style="color:#666;font-size:11px;">${r._meta?.model_used || ''}</span>` : '';
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #333;color:#c4a35a;font-weight:600;">${r.keyword || '-'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #333;text-align:center;">${ok ? '✅' : '❌'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #333;color:#aaa;font-size:13px;">${title} ${model}</td>
        </tr>`;
    }).join('');

    // Einstellungen-Tags
    const tags = [
      config.brand && `Brand: ${config.brand}`,
      config.domain && `Domain: ${config.domain}`,
      config.zielgruppe && `Zielgruppe: ${config.zielgruppe}`,
      config.tonalitaet && `Tonalität: ${config.tonalitaet}`,
      config.usp && `USP: ${config.usp}`,
      config.intent && `Intent: ${config.intent}`,
      config.readability && `Niveau: ${config.readability}`,
      config.grammaticalPerson && `Perspektive: ${config.grammaticalPerson}`
    ].filter(Boolean);

    const tagsHtml = tags.length > 0
      ? tags.map(t => `<span style="display:inline-block;background:#1a1a2e;padding:3px 10px;border-radius:4px;margin:2px 4px 2px 0;font-size:12px;color:#aaa;">${t}</span>`).join('')
      : '<span style="color:#666;">Keine Zusatzinfos</span>';

    const mail = new brevo.SendSmtpEmail();
    mail.subject = `📝 Silas: ${success}/${total} Landingpages erstellt ${isMaster ? '(Master)' : '(Demo)'}`;
    mail.to = [{ email: 'michael@designare.at', name: 'Michael Kanda' }];
    mail.sender = { email: 'noreply@designare.at', name: 'Silas Content Generator' };
    mail.htmlContent = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a1a;color:#fff;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">

    <div style="text-align:center;padding:20px 0;border-bottom:1px solid #333;">
      <h1 style="margin:0;font-size:20px;color:#fff;">📝 Silas Content Generator</h1>
      <p style="margin:5px 0 0;color:#888;">${timestamp} ${modeBadge}</p>
    </div>

    <div style="padding:20px 0;text-align:center;">
      <div style="display:inline-block;background:#111;border:1px solid #333;border-radius:8px;padding:16px 30px;">
        <span style="font-size:32px;font-weight:700;color:${success === total ? '#22c55e' : '#f59e0b'};">${success}</span>
        <span style="font-size:16px;color:#888;"> / ${total} erstellt</span>
      </div>
    </div>

    <div style="padding:15px 0;">
      <h3 style="color:#c4a35a;font-size:14px;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Keywords & Ergebnisse</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid #444;">
            <th style="padding:8px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;">Keyword</th>
            <th style="padding:8px 12px;text-align:center;color:#888;font-size:11px;width:40px;">OK</th>
            <th style="padding:8px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;">Titel / Fehler</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div style="padding:15px 0;border-top:1px solid #333;">
      <h3 style="color:#c4a35a;font-size:14px;text-transform:uppercase;letter-spacing:1px;margin:0 0 10px;">Einstellungen</h3>
      <div>${tagsHtml}</div>
    </div>

    <div style="text-align:center;padding:15px 0;border-top:1px solid #333;margin-top:10px;">
      <a href="https://designare.at/silas" style="color:#c4a35a;text-decoration:none;font-size:13px;">designare.at/silas</a>
    </div>

  </div>
</body>
</html>`;

    await apiInstance.sendTransacEmail(mail);
    console.log(`📧 Silas-Mail gesendet (${success}/${total})`);

  } catch (error) {
    console.error('⚠️ Silas-Mail fehlgeschlagen:', error.message);
  }
}

// =================================================================
// HANDLER
// =================================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { keywords } = req.body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: 'Keine Keywords übergeben' });
    }

    const isMaster = req.headers['x-silas-master'] === process.env.SILAS_MASTER_PASSWORD;

    // Server-seitiges Rate-Limit (nur für Demo-User)
    if (!isMaster) {
      const clientIP = getClientIP(req);
      const rateCheck = await checkRateLimit(clientIP, 'silas', SILAS_DAILY_LIMIT);
      
      if (!rateCheck.allowed) {
        return res.status(429).json({ 
          error: `Tageslimit erreicht (${SILAS_DAILY_LIMIT} Generierungen pro Tag). Bitte morgen wieder versuchen.`
        });
      }
    }

    console.log(`\n🚀 Silas: ${keywords.length} Keywords (${isMaster ? 'Master' : 'Demo'})`);

    const results = [];

    for (const keywordData of keywords) {
      const { keyword, intent, domain, email, phone, brand, address } = keywordData;
      console.log(`\n📝 "${keyword}"`);

      try {
        // Prompt bauen (via FactChecker)
        const prompt = factChecker.generateResponsiblePrompt(keywordData);

        // Generieren mit Fallback-Kette
        const { data, model } = await generate(prompt, isMaster);

        // Fact-Check
        let factCheckResult = null;
        try {
          factCheckResult = await factChecker.checkContent(data, keyword);
        } catch (e) {
          console.warn(`   ⚠️ Fact-Check übersprungen: ${e.message}`);
        }

        // Ergebnis zusammenbauen
        results.push({
          ...data,
          keyword,
          intent,
          domain,
          email,
          phone,
          brand,
          address,
          _factCheck: factCheckResult,
          _meta: {
            model_used: model,
            generated_at: new Date().toISOString(),
            master_mode: isMaster,
            success: true
          }
        });

        console.log(`   ✅ → "${data.post_title || '(kein Titel)'}"`);

      } catch (error) {
        console.error(`   💥 Fehlgeschlagen: ${error.message}`);
        results.push({
          keyword,
          intent,
          brand,
          error: error.message,
          _meta: { success: false }
        });
      }

      // Rate-Limit-Pause zwischen Keywords
      await delay(isMaster ? 200 : 1500);
    }

    const success = results.filter(r => !r.error).length;
    console.log(`\n✅ Fertig: ${success}/${results.length} erfolgreich`);

    // Rate-Limit Zähler erhöhen (nur Demo)
    if (!isMaster) {
      const clientIP = getClientIP(req);
      await incrementRateLimit(clientIP, 'silas');
    }

    // Benachrichtigung senden (vor Response, da Serverless nach res.json() den Prozess beendet)
    await sendNotification(keywords, results, isMaster);

    return res.status(200).json(results);

  } catch (error) {
    console.error('💥 Kritischer Fehler:', error);
    return res.status(500).json({
      error: 'Interner Server-Fehler',
      details: error.message
    });
  }
}
