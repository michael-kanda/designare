// api/send-visibility-report.js - Sendet KI-Sichtbarkeits-Auswertung per E-Mail an den Nutzer
import * as brevo from '@getbrevo/brevo';
import { trackVisibilityEmail } from './evita-track.js';

// =================================================================
// E-Mail-Validierung
// =================================================================
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim()) && email.length <= 254;
}

// =================================================================
// HTML-Escape
// =================================================================
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =================================================================
// HANDLER
// =================================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const { email, domain, industry, score, domainAnalysis, aiTests, competitors, recommendations, timestamp } = req.body || {};

    // Validierung
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Ungültige E-Mail-Adresse' });
    }

    if (!domain || !score) {
      return res.status(400).json({ success: false, message: 'Fehlende Auswertungsdaten' });
    }

    // Rate Limit: Max 3 Report-Mails pro IP/Tag (gleiche Logik wie Check)
    const clientIP = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();

    // =================================================================
    // E-MAIL TEMPLATE BAUEN
    // =================================================================
    const scoreTotal = score.total || 0;
    const scoreLabel = score.label || 'Unbekannt';
    const scoreColor = score.color || '#f59e0b';

    // Test-Ergebnisse Tabelle
    const testRows = (aiTests || []).map(t => {
      const statusIcon = t.mentioned ? '✅' : '❌';
      const sentimentIcon = t.sentiment === 'positiv' ? '🟢' : t.sentiment === 'negativ' ? '🔴' : '🟡';
      const engineBadge = t.engine === 'chatgpt'
        ? '<span style="background:#10a37f;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">ChatGPT</span>'
        : '<span style="background:#4285f4;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;">Gemini</span>';
      const cleanResponse = esc((t.response || '').replace(/<[^>]*>/g, '').substring(0, 400));
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #2a2a3e;color:#e0e0e0;font-weight:500;">${esc(t.description)} ${engineBadge}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #2a2a3e;text-align:center;">${statusIcon}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #2a2a3e;text-align:center;">${sentimentIcon}</td>
        </tr>
        <tr>
          <td colspan="3" style="padding:6px 12px 14px;border-bottom:1px solid #1e1e2e;color:#888;font-size:12px;line-height:1.5;">${cleanResponse}${cleanResponse.length >= 400 ? '...' : ''}</td>
        </tr>`;
    }).join('');

    // Score Breakdown
    const breakdownRows = (score.breakdown || []).map(item => {
      const pct = item.maxPoints > 0 ? Math.round((item.points / item.maxPoints) * 100) : 0;
      return `
        <tr>
          <td style="padding:8px 12px;color:#e0e0e0;">${esc(item.category)}</td>
          <td style="padding:8px 12px;text-align:center;color:#c4a35a;font-weight:600;">${item.points}/${item.maxPoints}</td>
          <td style="padding:8px 12px;width:120px;">
            <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:8px;overflow:hidden;">
              <div style="background:#c4a35a;height:100%;width:${pct}%;border-radius:4px;"></div>
            </div>
          </td>
        </tr>`;
    }).join('');

    // Schema & E-E-A-T
    const schemaInfo = domainAnalysis?.schema?.found
      ? `✅ Vorhanden (${(domainAnalysis.schema.types || []).map(t => esc(t)).join(', ') || 'Typen erkannt'})`
      : '❌ Nicht gefunden';

    const eeatItems = [];
    if (domainAnalysis?.eeat?.aboutPage) eeatItems.push('Über-uns');
    if (domainAnalysis?.eeat?.contactPage) eeatItems.push('Kontakt/Impressum');
    if (domainAnalysis?.eeat?.authorInfo) eeatItems.push('Autor-Info');
    const eeatInfo = eeatItems.length > 0 ? `✅ ${eeatItems.join(', ')}` : '❌ Keine gefunden';

    // Empfehlungen
    const recoHtml = (recommendations || []).map(r => {
      const prioColor = r.priority === 'hoch' ? '#ef4444' : '#f59e0b';
      const prioLabel = r.priority === 'hoch' ? '⚡ Hohe Priorität' : '📌 Mittlere Priorität';
      return `
        <div style="margin-bottom:10px;padding:12px 16px;background:#12121e;border-left:3px solid ${prioColor};border-radius:0 6px 6px 0;">
          <div style="font-size:11px;color:${prioColor};font-weight:600;margin-bottom:4px;">${prioLabel}</div>
          <div style="color:#e0e0e0;font-weight:600;margin-bottom:4px;">${esc(r.title)}</div>
          <div style="color:#999;font-size:13px;line-height:1.5;">${esc(r.description)}</div>
        </div>`;
    }).join('');

    // Konkurrenten
    const competitorHtml = (competitors || []).length > 0
      ? competitors.slice(0, 10).map(c => `<span style="display:inline-block;background:rgba(239,68,68,0.1);color:#fca5a5;padding:4px 10px;border-radius:4px;font-size:12px;margin:3px 3px 0 0;">${esc(c)}</span>`).join('')
      : '<span style="color:#666;">Keine gefunden</span>';

    // Zeitpunkt
    const checkTime = timestamp 
      ? new Date(timestamp).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }) 
      : new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna' });

    // =================================================================
    // HTML E-MAIL
    // =================================================================
    const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#08080f;color:#e0e0e0;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px;">
    
    <!-- Header -->
    <div style="text-align:center;padding:24px 0;border-bottom:1px solid #1e1e2e;">
      <h1 style="margin:0;font-size:22px;color:#e0e0e0;">🤖 Dein KI-Sichtbarkeits-Report</h1>
      <p style="margin:8px 0 0;color:#888;font-size:14px;">${esc(domain)}${industry ? ` · ${esc(industry)}` : ''}</p>
    </div>

    <!-- Score -->
    <div style="text-align:center;padding:32px 0;">
      <div style="display:inline-block;width:110px;height:110px;border-radius:50%;background:${scoreColor};line-height:110px;font-size:36px;font-weight:bold;color:#fff;">
        ${scoreTotal}
      </div>
      <p style="margin:12px 0 0;font-size:20px;color:${scoreColor};font-weight:700;">${esc(scoreLabel)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:#666;">Score von 100 möglichen Punkten</p>
    </div>

    <!-- Score Breakdown -->
    <div style="background:#111119;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 12px;color:#e0e0e0;font-size:15px;">📊 Score-Zusammensetzung</h3>
      <table style="width:100%;border-collapse:collapse;">
        ${breakdownRows}
      </table>
    </div>

    <!-- Technische Analyse -->
    <div style="background:#111119;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 12px;color:#e0e0e0;font-size:15px;">🔍 Technische Analyse</h3>
      <p style="margin:6px 0;color:#ccc;font-size:13px;">Schema.org: ${schemaInfo}</p>
      <p style="margin:6px 0;color:#ccc;font-size:13px;">E-E-A-T Signale: ${eeatInfo}</p>
    </div>

    <!-- KI-Test-Ergebnisse -->
    <div style="background:#111119;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 12px;color:#e0e0e0;font-size:15px;">🧪 KI-Test-Ergebnisse</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:2px solid #2a2a3e;">
            <th style="padding:8px 12px;text-align:left;color:#888;font-size:11px;text-transform:uppercase;">Test</th>
            <th style="padding:8px 12px;text-align:center;color:#888;font-size:11px;text-transform:uppercase;">Erwähnt</th>
            <th style="padding:8px 12px;text-align:center;color:#888;font-size:11px;text-transform:uppercase;">Sentiment</th>
          </tr>
        </thead>
        <tbody>
          ${testRows}
        </tbody>
      </table>
    </div>

    <!-- Konkurrenten -->
    <div style="background:#111119;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 12px;color:#e0e0e0;font-size:15px;">🏢 Konkurrenten in KI-Antworten</h3>
      <div>${competitorHtml}</div>
    </div>

    <!-- Empfehlungen -->
    ${recoHtml ? `
    <div style="background:#111119;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 12px;color:#e0e0e0;font-size:15px;">💡 Empfehlungen</h3>
      ${recoHtml}
    </div>` : ''}

    <!-- CTA -->
    <div style="text-align:center;padding:24px 0;margin-bottom:20px;">
      <a href="https://designare.at/ki-sichtbarkeit" style="display:inline-block;background:#c4a35a;color:#000;padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">🔄 Erneut testen</a>
      <p style="margin:12px 0 0;font-size:12px;color:#666;">Ergebnisse können sich ändern – teste regelmäßig, um Fortschritte zu erkennen.</p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;border-top:1px solid #1e1e2e;">
      <p style="color:#888;font-size:12px;margin:0;">Analyse vom ${checkTime}</p>
      <p style="color:#555;font-size:11px;margin:8px 0 0;">KI-Sichtbarkeits-Check · <a href="https://designare.at" style="color:#c4a35a;text-decoration:none;">designare.at</a></p>
      <p style="color:#444;font-size:10px;margin:8px 0 0;">Du erhältst diese E-Mail, weil du eine Auswertung angefordert hast. Kein Abo, keine weiteren Mails.</p>
    </div>

  </div>
</body>
</html>`;

    // =================================================================
    // SENDEN VIA BREVO
    // =================================================================
    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(
      brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY
    );

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = `🤖 Dein KI-Sichtbarkeits-Report: ${esc(domain)} → ${scoreTotal}/100`;
    sendSmtpEmail.to = [{ email: email.trim() }];
    sendSmtpEmail.sender = { email: 'noreply@designare.at', name: 'KI-Sichtbarkeits-Check · designare.at' };
    sendSmtpEmail.replyTo = { email: 'michael@designare.at', name: 'Michael Kanda' };
    sendSmtpEmail.htmlContent = htmlContent;

    await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log(`📧 Visibility-Report gesendet an ${email.replace(/(.{2}).*(@.*)/, '$1***$2')} für ${domain}`);

    // =================================================================
    // TRACKING
    // =================================================================
    await trackVisibilityEmail({
      domain,
      email: email.trim(),
      score: scoreTotal,
      scoreLabel,
      industry: industry || null
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ Visibility-Report Fehler:', error?.message);
    console.error('  Details:', JSON.stringify(error?.body || error?.response?.body || 'keine'));

    return res.status(500).json({ success: false, message: 'E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.' });
  }
}
