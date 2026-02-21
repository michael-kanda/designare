// api/send-visibility-report.js - Sendet KI-Sichtbarkeits-Auswertung per E-Mail an den Nutzer
import * as brevo from '@getbrevo/brevo';
import { trackVisibilityEmail } from './evita-track.js';
import { emailShell, esc } from './email-template.js';

// =================================================================
// E-Mail-Validierung
// =================================================================
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim()) && email.length <= 254;
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

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Ungültige E-Mail-Adresse' });
    }
    if (!domain || !score) {
      return res.status(400).json({ success: false, message: 'Fehlende Auswertungsdaten' });
    }

    // =================================================================
    // TEMPLATE DATA
    // =================================================================
    const scoreTotal = score.total || 0;
    const scoreLabel = score.label || 'Unbekannt';
    const scoreColor = score.color || '#f59e0b';

    const checkTime = timestamp
      ? new Date(timestamp).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    // --- Score Breakdown ---
    const breakdownRows = (score.breakdown || []).map(item => {
      const pct = item.maxPoints > 0 ? Math.round((item.points / item.maxPoints) * 100) : 0;
      return `
        <tr>
          <td style="padding:10px 0;font-size:13px;color:#444;">${esc(item.category)}</td>
          <td style="padding:10px 0;text-align:right;font-size:13px;font-weight:700;color:#c4a35a;width:60px;">${item.points}/${item.maxPoints}</td>
        </tr>
        <tr><td colspan="2" style="padding:0 0 14px;">
          <div style="background:#eee;border-radius:4px;height:6px;overflow:hidden;">
            <div style="background:#c4a35a;height:100%;width:${pct}%;border-radius:4px;"></div>
          </div>
        </td></tr>`;
    }).join('');

    // --- Test Results ---
    const testRows = (aiTests || []).map(t => {
      const statusIcon = t.mentioned ? '✅' : '❌';
      const sentimentIcon = t.sentiment === 'positiv' ? '🟢' : t.sentiment === 'negativ' ? '🔴' : '🟡';
      const engineLabel = t.engine === 'chatgpt' ? 'ChatGPT' : 'Gemini';
      const engineBg = t.engine === 'chatgpt' ? '#10a37f' : '#4285f4';
      return `
        <tr>
          <td style="padding:10px 14px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">
            ${esc(t.description)}
            <span style="background:${engineBg};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px;">${engineLabel}</span>
          </td>
          <td style="padding:10px 14px;text-align:center;border-top:1px solid #f0f0f0;">${statusIcon}</td>
          <td style="padding:10px 14px;text-align:center;border-top:1px solid #f0f0f0;">${sentimentIcon}</td>
        </tr>`;
    }).join('');

    // --- Schema & E-E-A-T ---
    const schemaText = domainAnalysis?.schema?.found
      ? `✅ ${(domainAnalysis.schema.types || []).map(t => esc(t)).join(', ') || 'Vorhanden'}`
      : '❌ Nicht gefunden';

    const eeatItems = [];
    if (domainAnalysis?.eeat?.aboutPage) eeatItems.push('Über-uns');
    if (domainAnalysis?.eeat?.contactPage) eeatItems.push('Kontakt');
    if (domainAnalysis?.eeat?.authorInfo) eeatItems.push('Autor-Info');
    const eeatText = eeatItems.length > 0 ? `✅ ${eeatItems.join(', ')}` : '❌ Keine gefunden';

    // --- Empfehlungen ---
    const recoHtml = (recommendations || []).map(r => {
      const isHigh = r.priority === 'hoch';
      return `
        <div style="padding:14px 16px;background:${isHigh ? '#fff8f8' : '#fffcf5'};border-left:3px solid ${isHigh ? '#ef4444' : '#f59e0b'};border-radius:0 8px 8px 0;margin-bottom:10px;">
          <div style="font-size:11px;color:${isHigh ? '#ef4444' : '#f59e0b'};font-weight:700;letter-spacing:0.3px;margin-bottom:4px;">${isHigh ? 'HOHE PRIORITÄT' : 'MITTLERE PRIORITÄT'}</div>
          <div style="font-size:13px;color:#1a1a1a;font-weight:600;margin-bottom:3px;">${esc(r.title)}</div>
          <div style="font-size:12px;color:#666;line-height:1.5;">${esc(r.description)}</div>
        </div>`;
    }).join('');

    // --- Konkurrenten ---
    const competitorHtml = (competitors || []).length > 0
      ? competitors.slice(0, 10).map(c => `<span style="display:inline-block;background:#fff0f0;color:#c44;padding:3px 10px;border-radius:4px;font-size:11px;margin:2px;">${esc(c)}</span>`).join('')
      : '';

    // =================================================================
    // BUILD INNER HTML
    // =================================================================
    const innerHtml = `
        <!-- HEADER -->
        <tr><td style="padding:28px 32px 20px;border-bottom:1px solid #eee;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><span style="font-size:17px;font-weight:700;color:#1a1a1a;">KI-Sichtbarkeits-Report</span></td>
            <td align="right"><span style="font-size:12px;color:#999;">${esc(checkTime)}</span></td>
          </tr></table>
        </td></tr>

        <!-- SCORE -->
        <tr><td style="padding:32px;text-align:center;background:linear-gradient(135deg,#fafaf8 0%,#f5f3ee 100%);">
          <div style="display:inline-block;width:100px;height:100px;border-radius:50%;background:${scoreColor};line-height:100px;font-size:34px;font-weight:800;color:#fff;letter-spacing:-1px;">${scoreTotal}</div>
          <div style="margin-top:10px;font-size:16px;font-weight:700;color:${scoreColor};">${esc(scoreLabel)}</div>
          <div style="margin-top:4px;font-size:13px;color:#888;">von 100 möglichen Punkten</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;text-align:left;">
            <tr>
              <td style="padding:4px 0;font-size:13px;color:#888;width:80px;">Domain</td>
              <td style="padding:4px 0;font-size:14px;color:#1a1a1a;font-weight:600;">${esc(domain)}</td>
            </tr>
            ${industry ? `<tr><td style="padding:4px 0;font-size:13px;color:#888;">Branche</td><td style="padding:4px 0;font-size:13px;color:#444;">${esc(industry)}</td></tr>` : ''}
          </table>
        </td></tr>

        <!-- BREAKDOWN -->
        <tr><td style="padding:28px 32px;">
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:16px;">Score-Zusammensetzung</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${breakdownRows}</table>
        </td></tr>

        <tr><td style="padding:0 32px;"><div style="border-top:1px solid #eee;"></div></td></tr>

        <!-- TECH -->
        <tr><td style="padding:24px 32px;">
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:14px;">Technische Analyse</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8fa;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:12px 16px;font-size:13px;color:#888;border-bottom:1px solid #eee;">Schema.org</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a1a1a;border-bottom:1px solid #eee;text-align:right;">${schemaText}</td>
            </tr>
            <tr>
              <td style="padding:12px 16px;font-size:13px;color:#888;">E-E-A-T Signale</td>
              <td style="padding:12px 16px;font-size:13px;color:#1a1a1a;text-align:right;">${eeatText}</td>
            </tr>
          </table>
        </td></tr>

        <!-- TESTS -->
        <tr><td style="padding:0 32px 24px;">
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:14px;">KI-Test-Ergebnisse</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden;border:1px solid #eee;">
            <thead><tr style="background:#f8f8fa;">
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-weight:500;">Test</th>
              <th style="padding:10px 14px;text-align:center;font-size:11px;color:#888;text-transform:uppercase;font-weight:500;width:50px;">Status</th>
              <th style="padding:10px 14px;text-align:center;font-size:11px;color:#888;text-transform:uppercase;font-weight:500;width:50px;">Ton</th>
            </tr></thead>
            <tbody>${testRows}</tbody>
          </table>
        </td></tr>

        ${competitorHtml ? `<tr><td style="padding:0 32px 24px;">
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:10px;">Konkurrenten in KI-Antworten</div>
          <div>${competitorHtml}</div>
        </td></tr>` : ''}

        ${recoHtml ? `<tr><td style="padding:0 32px 24px;">
          <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:14px;">Empfehlungen</div>
          ${recoHtml}
        </td></tr>` : ''}

        <!-- CTA -->
        <tr><td style="padding:0 32px 28px;text-align:center;">
          <a href="https://designare.at/ki-sichtbarkeit" style="display:inline-block;background:#c4a35a;color:#fff;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">Erneut testen</a>
          <div style="margin-top:8px;font-size:11px;color:#aaa;">Ergebnisse ändern sich – teste regelmäßig</div>
        </td></tr>`;

    const htmlContent = emailShell(innerHtml, {
      preheader: `${domain}: ${scoreTotal}/100 – ${scoreLabel}`,
      footerExtra: `Analyse vom ${checkTime}. Du erhältst diese E-Mail, weil du eine Auswertung angefordert hast. Kein Abo, keine weiteren Mails.`
    });

    // =================================================================
    // SEND
    // =================================================================
    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = `KI-Sichtbarkeits-Report: ${domain} – ${scoreTotal}/100`;
    sendSmtpEmail.to = [{ email: email.trim() }];
    sendSmtpEmail.sender = { email: 'noreply@designare.at', name: 'designare.at' };
    sendSmtpEmail.replyTo = { email: 'michael@designare.at', name: 'Michael Kanda' };
    sendSmtpEmail.htmlContent = htmlContent;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`📧 Visibility-Report gesendet an ${email.replace(/(.{2}).*(@.*)/, '$1***$2')} für ${domain}`);

    await trackVisibilityEmail({ domain, email: email.trim(), score: scoreTotal, scoreLabel, industry: industry || null });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ Visibility-Report Fehler:', error?.message);
    return res.status(500).json({ success: false, message: 'E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.' });
  }
}
