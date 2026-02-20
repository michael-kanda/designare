// api/ai-visibility-check.js - KI-Sichtbarkeits-Check mit Grounding + Formatierung + Dashboard-Tracking
// Version 13: Cheerio, Redis Rate-Limiting, Dashboard-Integration
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as brevo from '@getbrevo/brevo';
import * as cheerio from 'cheerio';
import { checkRateLimit, incrementRateLimit, getClientIP } from './rate-limiter.js';
import { trackVisibilityCheckStats } from './evita-track.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// =================================================================
// OPENAI / CHATGPT CLIENT
// =================================================================
async function chatGPTQuery(prompt) {
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
// HELPER: Domain-Erwähnung erkennen (flexibel)
// Erkennt auch "Stempel Lobenhofer" für "stempel-lobenhofer.at"
// =================================================================
function isDomainMentioned(text, cleanDomain) {
  const lower = text.toLowerCase();
  
  // Exakte Domain (stempel-lobenhofer.at)
  if (lower.includes(cleanDomain)) {
    if (isNegationContext(lower)) return false;
    return true;
  }
  
  // Domain ohne TLD (stempel-lobenhofer)
  const domainBase = cleanDomain.replace(/\.[^.]+$/, '');
  if (lower.includes(domainBase)) {
    if (isNegationContext(lower)) return false;
    return true;
  }
  
  // Bindestriche durch Leerzeichen ersetzen (stempel lobenhofer)
  const domainWords = domainBase.replace(/-/g, ' ');
  if (domainWords !== domainBase && lower.includes(domainWords)) {
    if (isNegationContext(lower)) return false;
    return true;
  }
  
  // =================================================================
  // EINZELTEILE-PRÜFUNG (mit Schutz gegen False Positives)
  // =================================================================
  // Problem: "hotel-wien.at" → ["hotel", "wien"] matcht jeden Text über Hotels in Wien.
  // Lösung: (1) generische Wörter ignorieren, (2) Proximity-Check
  const parts = domainBase.split(/[-.]/).filter(p => p.length >= 4);
  
  if (parts.length >= 2) {
    // Generische Wörter, die in KI-Antworten natürlich vorkommen
    const genericWords = new Set([
      // Branchen & Berufe
      'auto', 'hotel', 'shop', 'design', 'digital', 'online', 'service',
      'agentur', 'group', 'media', 'consulting', 'tech', 'studio', 'team',
      'partner', 'expert', 'profi', 'center', 'haus', 'werk', 'plus',
      'best', 'first', 'smart', 'easy', 'global', 'premium', 'prime',
      'rechtsanwalt', 'steuerberater', 'immobilien', 'versicherung',
      'marketing', 'software', 'development', 'solutions', 'systems',
      'handwerk', 'elektro', 'transport', 'logistik', 'bauer', 'garten',
      'restaurant', 'gastro', 'sport', 'fitness', 'beauty', 'dental',
      // Orte (DACH)
      'wien', 'graz', 'linz', 'salzburg', 'innsbruck', 'bregenz', 'klagenfurt',
      'berlin', 'hamburg', 'münchen', 'muenchen', 'frankfurt', 'köln', 'koeln',
      'stuttgart', 'düsseldorf', 'duesseldorf', 'dortmund', 'essen', 'leipzig',
      'zürich', 'zuerich', 'bern', 'basel', 'genf',
      'austria', 'österreich', 'oesterreich', 'deutschland', 'germany', 'schweiz',
      // Generische Begriffe
      'info', 'data', 'home', 'page', 'site', 'mail', 'news', 'blog',
      'book', 'deal', 'sale', 'fair', 'pure', 'real', 'true', 'good',
      'north', 'south', 'east', 'west', 'city', 'land', 'park'
    ]);
    
    // Wie viele Teile sind NICHT generisch?
    const uniqueParts = parts.filter(p => !genericWords.has(p));
    
    // Fall 1: Alle Teile generisch → kein Match über Einzelteile
    // "hotel-wien" → beide generisch → zu unsicher
    if (uniqueParts.length === 0) {
      return false;
    }
    
    // Fall 2: Mindestens ein Teil ist unique → Proximity-Check
    // Die Teile müssen im Text nahe beieinander stehen (max 60 Zeichen Abstand)
    if (parts.every(part => lower.includes(part))) {
      const positions = parts.map(part => {
        const idx = lower.indexOf(part);
        return { part, start: idx, end: idx + part.length };
      });
      
      // Sortiere nach Position im Text
      positions.sort((a, b) => a.start - b.start);
      
      // Maximaler Abstand zwischen dem Ende des ersten und Anfang des letzten Teils
      const first = positions[0];
      const last = positions[positions.length - 1];
      const distance = last.start - first.end;
      
      // Max 60 Zeichen Abstand (≈ ein kurzer Nebensatz)
      if (distance <= 60) {
        if (isNegationContext(lower)) return false;
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Prüft ob der Text eine Negation enthält die bedeutet, dass die Domain NICHT bekannt ist.
 * Wird von isDomainMentioned aufgerufen.
 * 
 * Wichtig: Nur reine "nicht gefunden"-Texte matchen. 
 * Wenn substanzielle Infos vorhanden sind ("bietet an", "Unternehmen ist tätig"),
 * wird die Negation ignoriert – denn dann wurde die Domain inhaltlich beschrieben.
 */
function isNegationContext(textLower) {
  const negationPatterns = [
    'keine informationen',
    'nicht bekannt',
    'nichts bekannt',
    'keine daten',
    'keine kenntnis',
    'nicht gefunden',
    'keine ergebnisse',
    'mir nicht bekannt',
    'habe ich keine',
    'kann ich keine',
    'wurden keine informationen',
    'no information',
    'not familiar',
  ];
  
  const hasNegation = negationPatterns.some(p => textLower.includes(p));
  if (!hasNegation) return false;
  
  // Substanz-Check: Wenn echte Infos da sind, ist die Negation nur ein Nebensatz
  const hasSubstance = 
    textLower.includes('bietet') ||
    textLower.includes('dienstleistung') ||
    textLower.includes('unternehmen') ||
    textLower.includes('spezialisiert') ||
    textLower.includes('tätig') ||
    textLower.includes('anbieter') ||
    textLower.includes('standort') ||
    textLower.includes('bewertung') ||     // Reviews: Domain wurde gesucht
    textLower.includes('rezension') ||     // Reviews: Domain wurde gesucht
    textLower.includes('erwähnung') ||     // Mentions: Domain wurde gefunden
    textLower.includes('gelistet') ||      // Mentions: Domain in Verzeichnis
    textLower.includes('profil');           // Mentions: Social Media Profil
  
  // Negation + keine Substanz = Domain ist wirklich nicht bekannt
  return !hasSubstance;
}

// =================================================================
// RATE LIMITING (via Redis – siehe rate-limiter.js)
// =================================================================
const DAILY_LIMIT = 3;

// =================================================================
// DOMAIN VALIDATION
// =================================================================

function validateAndCleanDomain(input) {
  if (!input || typeof input !== 'string') {
    return { valid: false, domain: null, error: 'Domain ist erforderlich' };
  }

  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^[a-z]+:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.replace(/\/.*$/, '');
  domain = domain.replace(/:\d+$/, '');

  if (/\s/.test(domain)) {
    return { valid: false, domain: null, error: 'Domain darf keine Leerzeichen enthalten' };
  }

  const dangerousPatterns = [
    /[<>'"`;]/,
    /--/,
    /\/\*/,
    /\.\./,
    /\x00/,
    /javascript:/i,
    /data:/i,
    /vbscript:/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(domain)) {
      return { valid: false, domain: null, error: 'Ungültige Zeichen in der Domain' };
    }
  }

  if (domain.length > 253 || domain.length < 4) {
    return { valid: false, domain: null, error: 'Ungültige Domain-Länge' };
  }

  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
  if (!domainRegex.test(domain)) {
    return { valid: false, domain: null, error: 'Ungültiges Domain-Format' };
  }

  const invalidTLDs = ['localhost', 'local', 'test', 'invalid', 'example'];
  if (invalidTLDs.includes(domain.split('.').pop())) {
    return { valid: false, domain: null, error: 'Test-Domains nicht erlaubt' };
  }

  return { valid: true, domain: domain, error: null };
}

// =================================================================
// TRACKING
// =================================================================

async function trackVisibilityCheck(data) {
  console.log('[VISIBILITY]', JSON.stringify({
    timestamp: new Date().toISOString(),
    domain: data.domain,
    industry: data.industry || null,
    score: data.score,
    scoreLabel: data.scoreLabel,
    mentionCount: data.mentionCount,
    totalTests: data.totalTests,
    hasSchema: data.hasSchema,
    country: data.country || 'unknown'
  }));
}

// =================================================================
// HELPER: Langweilige Einleitungen entfernen
// =================================================================
function removeBoringIntros(text) {
  const patterns = [
    /^okay[,.\s]*/i,
    /^ok[,.\s]+/i,
    /^ich werde[^.]*\.\s*/i,
    /^ich habe[^.]*gesucht[^.]*\.\s*/i,
    /^hier (sind|ist)[^:]*:\s*/i,
    /^basierend auf[^:]*:\s*/i,
    /^laut[^:]*suchergebnissen?[^:]*:\s*/i,
    /^gerne[,!.\s]*/i,
    /^natürlich[,!.\s]*/i,
    /^selbstverständlich[,!.\s]*/i,
  ];

  let cleaned = text;
  for (let i = 0; i < 3; i++) {
    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, '');
    }
  }
  return cleaned.trim();
}

// =================================================================
// HELPER: Text formatieren (Absätze statt Listen) — MIT XSS-SCHUTZ
// =================================================================

// HTML-Entities escapen (MUSS vor jeder HTML-Erzeugung laufen)
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function formatResponseText(text) {
  // SCHRITT 1: Boring Intros entfernen (noch auf Rohtext)
  let formatted = removeBoringIntros(text);
  
  // SCHRITT 1b: Gemini Grounding Citations entfernen
  // Spezifische Patterns zuerst (bevor [cite diese teilweise matcht)
  formatted = formatted.replace(/\[citation[^\]]*\]/gi, '');
  formatted = formatted.replace(/\[source[^\]]*\]/gi, '');
  // Vollständig: [cite: 2, 22, 23, 40] — Abgeschnitten: [cite: 2, 22  oder  [cite
  formatted = formatted.replace(/\[cite(?::[\d,\s]*)?(?:\]|(?=\s)|$)/gi, '');
  // Angeklebt: [citeExterne → entferne nur "[cite", behalte den Rest
  formatted = formatted.replace(/\[cite(?=[A-Za-zÄÖÜäöü])/gi, '');
  // Aufräumen: doppelte Leerzeichen die durch Entfernung entstehen
  formatted = formatted.replace(/\s{2,}/g, ' ');
  
  // SCHRITT 2: Markdown-Fett extrahieren BEVOR wir escapen
  // Wir merken uns die fetten Stellen mit einem Platzhalter
  const boldParts = [];
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_, content) => {
    const index = boldParts.length;
    boldParts.push(content);
    return `%%BOLD_${index}%%`;
  });
  
  // SCHRITT 3: ALLES escapen (XSS-Schutz!)
  formatted = escapeHTML(formatted);
  
  // SCHRITT 4: Bold-Platzhalter durch <strong> ersetzen (escaped content!)
  formatted = formatted.replace(/%%BOLD_(\d+)%%/g, (_, index) => {
    return `<strong>${escapeHTML(boldParts[parseInt(index)])}</strong>`;
  });
  
  // SCHRITT 5: Zeilenumbrüche normalisieren
  formatted = formatted.replace(/\r\n/g, '\n');
  formatted = formatted.replace(/\r/g, '\n');
  
  // SCHRITT 6: Absätze erkennen (Doppel-Zeilenumbrüche)
  const blocks = formatted.split(/\n{2,}/);
  
  const htmlBlocks = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    
    // Prüfe ob Block eine Liste ist (Bullets oder Nummern)
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const isList = lines.length > 1 && lines.every(l => /^[\d]+[.)]\s|^[•\-\*]\s/.test(l));
    
    if (isList) {
      const items = lines.map(l => l.replace(/^[\d]+[.)]\s*|^[•\-\*]\s*/, '').trim());
      // Content ist bereits escaped!
      return '<ul class="ai-list">' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
    }
    
    // Einzelne Bullet/Nummer-Zeilen in Fließtext → kompakt
    block = block.replace(/\n\s*\d+[.)]\s+/g, '<br>');
    block = block.replace(/\n\s*[•\-\*]\s+/g, '<br>');
    block = block.replace(/^\s*\d+[.)]\s+/, '');
    block = block.replace(/^\s*[•\-\*]\s+/, '');
    
    // Restliche einzelne Zeilenumbrüche → <br>
    block = block.replace(/\n/g, '<br>');
    
    return `<p>${block}</p>`;
  }).filter(Boolean);
  
  let result = htmlBlocks.join('');
  
  // Cleanup
  result = result.replace(/<p>\s*<\/p>/g, '');
  result = result.replace(/(<br>\s*){3,}/gi, '<br><br>');
  result = result.replace(/\s{2,}/g, ' ');
  result = result.replace(/\s+([.!?,:;])/g, '$1');
  result = result.replace(/Zu\s+<strong>/gi, 'Zu <strong>');
  
  return result.trim();
}
// =================================================================
// HELPER: Industry sanitizen
// =================================================================
function sanitizeIndustry(input) {
  if (!input || typeof input !== 'string') return null;
  let industry = input.trim().substring(0, 100);
  industry = industry.replace(/[<>'"`;\\]/g, '');
  return industry.length > 0 ? industry : null;
}

// =================================================================
// NEU: E-MAIL-BENACHRICHTIGUNG via Brevo
// =================================================================
async function sendCheckNotification({ domain, industry, score, scoreLabel, scoreColor, mentionCount, totalTests, testResults, domainAnalysis, competitors, recommendations }) {
  try {
    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(
      brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY
    );

    // Score-Badge Farbe
    const badgeColor = scoreColor || '#f59e0b';

    // Test-Ergebnisse als HTML-Tabelle
    const testRows = (testResults || []).map(t => {
      const statusIcon = t.mentioned ? '✅' : '❌';
      const sentimentIcon = t.sentiment === 'positiv' ? '🟢' : t.sentiment === 'negativ' ? '🔴' : '🟡';
      const engineBadge = t.engine === 'chatgpt' 
        ? '<span style="background:#10a37f;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px;">GPT</span>' 
        : '<span style="background:#4285f4;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px;">Gemini</span>';
      const cleanResponse = (t.response || '').replace(/<[^>]*>/g, '').substring(0, 300);
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #333;color:#ccc;">${t.description} ${engineBadge}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #333;text-align:center;">${statusIcon}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #333;text-align:center;">${sentimentIcon} ${t.sentiment}</td>
        </tr>
        <tr>
          <td colspan="3" style="padding:6px 12px 12px;border-bottom:1px solid #444;color:#999;font-size:12px;">${cleanResponse}${cleanResponse.length >= 300 ? '...' : ''}</td>
        </tr>`;
    }).join('');

    // Schema-Info
    const schemaInfo = domainAnalysis?.hasSchema
      ? `✅ Vorhanden (${(domainAnalysis.schemaTypes || []).join(', ') || 'unbekannte Typen'})`
      : '❌ Nicht vorhanden';

    // E-E-A-T Info
    const eeatItems = [];
    if (domainAnalysis?.hasAboutPage) eeatItems.push('Über-uns');
    if (domainAnalysis?.hasContactPage) eeatItems.push('Kontakt');
    if (domainAnalysis?.hasAuthorInfo) eeatItems.push('Autor-Info');
    const eeatInfo = eeatItems.length > 0 ? `✅ ${eeatItems.join(', ')}` : '❌ Keine gefunden';

    // Empfehlungen
    const recoHtml = (recommendations || []).map(r => {
      const prioColor = r.priority === 'hoch' ? '#ef4444' : '#f59e0b';
      return `<div style="margin-bottom:8px;padding:8px 12px;background:#1a1a2e;border-left:3px solid ${prioColor};border-radius:4px;">
        <strong style="color:#fff;">${r.title}</strong><br>
        <span style="color:#aaa;font-size:13px;">${r.description}</span>
      </div>`;
    }).join('');

    // Konkurrenten
    const competitorList = (competitors || []).length > 0
      ? competitors.slice(0, 10).join(', ')
      : 'Keine gefunden';

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = `🤖 KI-Check: ${domain} → ${score}/100 (${scoreLabel})`;
    sendSmtpEmail.to = [{ email: process.env.NOTIFICATION_EMAIL || 'michael@designare.at', name: 'Michael Kanda' }];
    sendSmtpEmail.sender = { email: 'noreply@designare.at', name: 'KI-Sichtbarkeits-Check' };
    sendSmtpEmail.htmlContent = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a1a;color:#fff;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    
    <!-- Header -->
    <div style="text-align:center;padding:20px 0;border-bottom:1px solid #333;">
      <h1 style="margin:0;font-size:20px;color:#fff;">🤖 KI-Sichtbarkeits-Check</h1>
      <p style="margin:5px 0 0;color:#888;">Neuer Check durchgeführt</p>
    </div>

    <!-- Score Badge -->
    <div style="text-align:center;padding:30px 0;">
      <div style="display:inline-block;width:100px;height:100px;border-radius:50%;background:${badgeColor};line-height:100px;font-size:32px;font-weight:bold;color:#fff;">
        ${score}
      </div>
      <p style="margin:10px 0 0;font-size:18px;color:${badgeColor};font-weight:bold;">${scoreLabel}</p>
    </div>

    <!-- Domain & Branche -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr>
        <td style="padding:8px 12px;color:#888;width:120px;">Domain:</td>
        <td style="padding:8px 12px;color:#fff;font-weight:bold;font-size:16px;">${domain}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#888;">Branche:</td>
        <td style="padding:8px 12px;color:#ccc;">${industry || 'Nicht angegeben'}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#888;">Zeitpunkt:</td>
        <td style="padding:8px 12px;color:#ccc;">${new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#888;">Erwähnungen:</td>
        <td style="padding:8px 12px;color:#ccc;">${mentionCount} von ${totalTests} Tests</td>
      </tr>
    </table>

    <!-- Technische Analyse -->
    <div style="background:#111;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="margin:0 0 10px;color:#fff;font-size:14px;">📊 Technische Analyse</h3>
      <p style="margin:4px 0;color:#ccc;font-size:13px;">Schema.org: ${schemaInfo}</p>
      <p style="margin:4px 0;color:#ccc;font-size:13px;">E-E-A-T: ${eeatInfo}</p>
      <p style="margin:4px 0;color:#ccc;font-size:13px;">Title: ${domainAnalysis?.title || '–'}</p>
    </div>

    <!-- Test-Ergebnisse -->
    <div style="background:#111;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="margin:0 0 10px;color:#fff;font-size:14px;">🧪 KI-Test-Ergebnisse</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid #444;">
            <th style="padding:8px 12px;text-align:left;color:#888;font-size:12px;">TEST</th>
            <th style="padding:8px 12px;text-align:center;color:#888;font-size:12px;">ERWÄHNT</th>
            <th style="padding:8px 12px;text-align:center;color:#888;font-size:12px;">SENTIMENT</th>
          </tr>
        </thead>
        <tbody>
          ${testRows}
        </tbody>
      </table>
    </div>

    <!-- Konkurrenten -->
    <div style="background:#111;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="margin:0 0 10px;color:#fff;font-size:14px;">🏢 Genannte Konkurrenten</h3>
      <p style="color:#ccc;font-size:13px;margin:0;">${competitorList}</p>
    </div>

    <!-- Empfehlungen -->
    ${recoHtml ? `
    <div style="background:#111;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="margin:0 0 10px;color:#fff;font-size:14px;">💡 Empfehlungen</h3>
      ${recoHtml}
    </div>` : ''}

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;border-top:1px solid #333;color:#666;font-size:11px;">
      KI-Sichtbarkeits-Check · designare.at
    </div>

  </div>
</body>
</html>`;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`📧 Benachrichtigung gesendet für ${domain}`);

  } catch (error) {
    // E-Mail-Fehler soll den Check NICHT blockieren
    console.error('⚠️ E-Mail-Benachrichtigung fehlgeschlagen:');
    console.error('  Message:', error?.message);
    console.error('  Body:', JSON.stringify(error?.body || error?.response?.body || 'keine Details'));
    console.error('  Status:', error?.statusCode || error?.response?.statusCode || 'unbekannt');
  }
}

// =================================================================
// SENTIMENT-ANALYSE (LLM-basiert mit Keyword-Fallback)
// =================================================================

/**
 * LLM-basierte Sentiment-Analyse via gpt-4o-mini.
 * Erkennt Negationen, Ironie und Kontext korrekt.
 * Fällt bei Fehler automatisch auf Keyword-Analyse zurück.
 */
async function analyzeSentiment(text, testType, domainMentioned) {
  // Shortcut: Domain nicht erwähnt + kein relevanter Inhalt → immer negativ
  if (!domainMentioned && ['knowledge', 'mentions'].includes(testType)) {
    return 'negativ';
  }

  try {
    // Kein API-Key → direkt Fallback
    if (!process.env.OPENAI_API_KEY) {
      return analyzeSentimentFallback(text, testType, domainMentioned);
    }

    // Nur relevanten Text senden (spart Tokens)
    const cleanText = text
      .replace(/<[^>]*>/g, '')      // HTML-Tags entfernen
      .substring(0, 800)             // Max 800 Zeichen
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
- "positiv" = Unternehmen wird substantiell beschrieben, gute Bewertungen, positive Erwähnungen
- "neutral" = Unternehmen wird erwähnt aber ohne klare Wertung, gemischte Signale, wenig Substanz
- "negativ" = Unternehmen nicht gefunden, keine Informationen vorhanden, schlechte Bewertungen, negative Kritik

WICHTIG: Achte auf Negationen! "nicht zufrieden", "keine guten Bewertungen", "früher gut aber jetzt schlecht" = negativ.

Antworte mit EXAKT einem Wort: positiv, neutral oder negativ`;

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

    if (['positiv', 'neutral', 'negativ'].includes(result)) {
      return result;
    }

    // LLM hat etwas anderes geantwortet → Fallback
    console.warn(`⚠️ Sentiment-LLM unerwartete Antwort: "${result}", Fallback auf Keywords`);
    return analyzeSentimentFallback(text, testType, domainMentioned);

  } catch (error) {
    console.warn(`⚠️ Sentiment-LLM Fehler: ${error.message}, Fallback auf Keywords`);
    return analyzeSentimentFallback(text, testType, domainMentioned);
  }
}

/**
 * Keyword-basierter Fallback (wird nur bei LLM-Fehler verwendet).
 * Behält die bisherige Logik als Sicherheitsnetz.
 */
function analyzeSentimentFallback(text, testType, domainMentioned) {
  const textLower = text.toLowerCase();
  
  const notFoundIndicators = [
    'keine informationen', 'nicht gefunden', 'keine ergebnisse',
    'nicht bekannt', 'konnte ich keine', 'wurden keine',
    'nichts gefunden', 'nicht zu finden', 'keine daten', 'nicht auffindbar'
  ];
  
  const hasNotFound = notFoundIndicators.some(indicator => textLower.includes(indicator));
  
  if (testType === 'knowledge') {
    if (!domainMentioned) return 'negativ';
    
    const hasSubstantialInfo = 
      textLower.includes('bietet') || textLower.includes('anbieter') ||
      textLower.includes('dienstleistung') || textLower.includes('produkt') ||
      textLower.includes('unternehmen') || textLower.includes('firma') ||
      textLower.includes('standort') || textLower.includes('spezialisiert') ||
      textLower.includes('tätig') || textLower.includes('gegründet') ||
      textLower.includes('seit') || textLower.includes('agentur') ||
      textLower.includes('service');
    
    if (hasSubstantialInfo) return 'positiv';
    if (hasNotFound && !hasSubstantialInfo) return 'negativ';
    return 'neutral';
  }
  
  if (testType === 'reviews') {
    const noBewertungen = [
      'keine bewertungen', 'keine rezensionen', 'keine online-bewertungen',
      'wurden keine bewertungen', 'keine bewertungen gefunden', 'keine rezensionen gefunden'
    ];
    if (noBewertungen.some(phrase => textLower.includes(phrase))) return 'negativ';
    
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
    if (hasNotFound || !domainMentioned) return 'negativ';
    
    const sourceCount = [
      'herold','wko','gelbe seiten','facebook','instagram','linkedin',
      'twitter','xing','trustpilot','provenexpert','branchenverzeichnis',
      'artikel','blog','presse','erwähnung'
    ].filter(s => textLower.includes(s)).length;
    
    return sourceCount >= 4 ? 'positiv' : 'neutral';
  }
  
  return 'neutral';
}

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
      
      // ============================================================
      // NEU: Größenlimit (5 MB) — Schutz vor Speicher-Overflow
      // ============================================================
      const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5 MB
      
      // Variante A: Content-Length Header prüfen (schnell, aber nicht immer vorhanden)
      const contentLength = parseInt(response.headers.get('content-length') || '0');
      if (contentLength > MAX_HTML_SIZE) {
        throw new Error(`Seite zu groß (${Math.round(contentLength / 1024 / 1024)} MB). Max: 5 MB.`);
      }
      
      // Variante B: Stream lesen mit Byte-Limit (funktioniert immer)
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
          // Wir brechen ab, verwenden aber was wir haben — 
          // die ersten 5 MB reichen für Schema.org + E-E-A-T
          console.log(`⚠️ HTML abgeschnitten bei ${Math.round(totalBytes / 1024)} KB`);
          break;
        }
        
        html += decoder.decode(value, { stream: true });
      }
      
      // Finales Flush des Decoders
      html += decoder.decode();
      
      const $ = cheerio.load(html);
      
      // =============================================================
      // SCHEMA.ORG (JSON-LD)
      // =============================================================
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
      
      // =============================================================
      // E-E-A-T SIGNALE (Multi-Signal mit Cheerio)
      // =============================================================
      const schemaTypesLower = domainAnalysis.schemaTypes.map(t => t.toLowerCase());
      
      // Alle href-Werte sammeln
      const allHrefs = [];
      $('a[href]').each((_, el) => allHrefs.push($(el).attr('href').toLowerCase()));
      
      // Sichtbarer Text (ohne Script/Style)
      $('script, style, noscript').remove();
      const visibleText = $('body').text().replace(/\s+/g, ' ').toLowerCase();
      
      // --- ABOUT / ÜBER-UNS ---
      const aboutKeywords = ['about', 'über-uns', 'ueber-uns', 'about-us', 'who-we-are', 'unser-team', 'das-sind-wir', '/team', '#about', '#über-uns', '#ueber-uns', '#team', '#michael', '#founder', '#gruender'];
      const hasAboutLink = allHrefs.some(href => aboutKeywords.some(kw => href.includes(kw)));
      const hasAboutSchema = schemaTypesLower.includes('aboutpage');
      const hasAboutText = /über uns|about us|unser team|über michael|über den gründer|about the founder/.test(visibleText);
      const hasAboutSection = $('[id]').toArray().some(el => 
        /^(about|ueber-uns|über-uns|team|michael|founder|gruender)$/i.test($(el).attr('id'))
      );
      domainAnalysis.hasAboutPage = hasAboutLink || hasAboutSection || (hasAboutSchema && hasAboutText);
      
      // --- KONTAKT / IMPRESSUM ---
      const contactKeywords = ['kontakt', 'contact', 'impressum', 'imprint', 'legal-notice', 'contact-us'];
      const hasContactLink = allHrefs.some(href => contactKeywords.some(kw => href.includes(kw)));
      const hasContactSchema = schemaTypesLower.includes('contactpage');
      const hasContactInfo = $('a[href^="tel:"], a[href^="mailto:"]').length > 0;
      const hasImpressumText = /impressum|kontakt|contact/.test(visibleText);
      domainAnalysis.hasContactPage = hasContactLink || hasContactSchema || (hasContactInfo && hasImpressumText);
      
      // --- AUTOREN-INFORMATIONEN ---
      const hasAuthorSchema = ['person', 'author', 'profilepage'].some(t => schemaTypesLower.includes(t));
      
      // Schema.org Person mit echten Daten (jobTitle, name etc.)
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
      
      // Debug-Logging
      console.log(`   E-E-A-T Signals (Cheerio):`);
      console.log(`     About: link=${hasAboutLink}, section=${hasAboutSection}, schema=${hasAboutSchema}, text=${hasAboutText} → ${domainAnalysis.hasAboutPage}`);
      console.log(`     Contact: link=${hasContactLink}, schema=${hasContactSchema}, tel/mailto=${hasContactInfo}, text=${hasImpressumText} → ${domainAnalysis.hasContactPage}`);
      console.log(`     Author: schema=${hasAuthorSchema}, schemaData=${hasAuthorInSchema}, meta=${hasMetaAuthor}, text=${hasAuthorText}, byline=${hasByline} → ${domainAnalysis.hasAuthorInfo}`);

      // Reload $ for title/description (we removed scripts above)
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
    
    // Generische Branchen-Eingaben, bei denen Auto-Detection trotzdem laufen soll
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
      
      const mentioned = isDomainMentioned(formattedKnowledge, cleanDomain);
      
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
      
      const mentioned = isDomainMentioned(text, cleanDomain);
      
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
      
      const mentioned = isDomainMentioned(text, cleanDomain);
      
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
    // PHASE 2b: ChatGPT Cross-Check (2 Tests parallel)
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
      
      // Parallel ausführen für Speed
      const chatGptPromises = chatGptTests.map(async (test) => {
        try {
          console.log(`🤖 ChatGPT Test: ${test.description}...`);
          
          const rawText = await chatGPTQuery(test.prompt);
          const text = formatResponseText(rawText);
          
          let mentioned = isDomainMentioned(text, cleanDomain);
          
          const sentiment = await analyzeSentiment(text, 'knowledge', mentioned);
          
          // Konkurrenten extrahieren
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
      
      // ChatGPT-Ergebnisse auch in testResults aufnehmen
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
    
    // Ergebnisse nach Engine trennen
    const geminiTests = testResults.filter(t => !t.engine || t.engine === 'gemini');
    const chatgptTests = testResults.filter(t => t.engine === 'chatgpt');
    const allTests = testResults.filter(t => t.sentiment !== 'fehler');
    
    // 1. Gemini Web-Präsenz (max 35 Punkte) 
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
    
    // 2. ChatGPT Cross-Check (max 15 Punkte)
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
    
    // 3. Technische Authority (max 30 Punkte)
    let techScore = 0;
    if (domainAnalysis.hasSchema) techScore += 10;
    if (domainAnalysis.schemaTypes.length >= 3) techScore += 6;
    if (domainAnalysis.hasAboutPage) techScore += 5;
    if (domainAnalysis.hasContactPage) techScore += 5;
    if (domainAnalysis.hasAuthorInfo) techScore += 5;
    // Cap bei 30 (falls alle Signale da sind: 10+6+5+5+5 = 31)
    techScore = Math.min(techScore, 30);
    score += techScore;
    scoreBreakdown.push({
      category: 'Technische Authority',
      points: techScore,
      maxPoints: 30,
      detail: `Schema: ${domainAnalysis.hasSchema ? '✓' : '✗'}, E-E-A-T: ${[domainAnalysis.hasAboutPage, domainAnalysis.hasContactPage, domainAnalysis.hasAuthorInfo].filter(Boolean).length}/3`
    });
    
    // 4. Sentiment & Reputation (max 20 Punkte)
    // Fairere Bewertung: negativ ≠ 0, sondern anteilig
    // positiv = volle Punkte, neutral = 60%, negativ = 20%
    const positiveCount = allTests.filter(t => t.sentiment === 'positiv').length;
    const neutralCount = allTests.filter(t => t.sentiment === 'neutral').length;
    const negativeCount = allTests.filter(t => t.sentiment === 'negativ').length;
    
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

    // Score-Kategorie bestimmen
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
    
    // E-E-A-T Empfehlungen – spezifisch für fehlende Signale
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
    
    // ChatGPT-spezifische Empfehlungen
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

    // =================================================================
    // 📊 DASHBOARD: Visibility-Check in Redis tracken
    // =================================================================
    await trackVisibilityCheckStats({
      domain: cleanDomain,
      score,
      scoreLabel: scoreCategoryLabel,
      mentionCount,
      totalTests: testResults.length,
      hasSchema: domainAnalysis.hasSchema,
      industry: detectedIndustry || cleanIndustry
    });

    // =================================================================
    // E-MAIL-BENACHRICHTIGUNG SENDEN (muss vor Response abgeschlossen sein auf Vercel)
    // =================================================================
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

    return res.status(200).json({
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
    });

  } catch (error) {
    console.error("❌ Error:", error);
    return res.status(500).json({ success: false, message: 'Fehler: ' + error.message });
  }
}

// =================================================================
// HELPER: Branche aus Antwort extrahieren
// =================================================================
async function detectIndustryFromResponse(model, knowledgeText, domain) {
  try {
    // KI-Antwort bereinigen: Nur Klartext, keine Steuerzeichen/Quotes
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
