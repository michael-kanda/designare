// lib/notifications.js - E-Mail-Benachrichtigung via Brevo + Tracking
import * as brevo from '@getbrevo/brevo';

// =================================================================
// TRACKING
// =================================================================
export async function trackVisibilityCheck(data) {
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
// E-MAIL-BENACHRICHTIGUNG via Brevo
// =================================================================
export async function sendCheckNotification({ domain, industry, score, scoreLabel, scoreColor, mentionCount, totalTests, testResults, domainAnalysis, competitors, recommendations }) {
  try {
    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(
      brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY
    );

    const badgeColor = scoreColor || '#f59e0b';

    const testRows = (testResults || []).map(t => {
      const statusIcon = t.mentioned ? '✅' : '❌';
      const sentimentIcon = t.sentiment === 'positiv' ? '🟢' : t.sentiment === 'negativ' ? '🔴' : t.sentiment === 'fehlend' ? '⚪' : '🟡';
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

    const schemaInfo = domainAnalysis?.hasSchema
      ? `✅ Vorhanden (${(domainAnalysis.schemaTypes || []).join(', ') || 'unbekannte Typen'})`
      : '❌ Nicht vorhanden';

    const eeatItems = [];
    if (domainAnalysis?.hasAboutPage) eeatItems.push('Über-uns');
    if (domainAnalysis?.hasContactPage) eeatItems.push('Kontakt');
    if (domainAnalysis?.hasAuthorInfo) eeatItems.push('Autor-Info');
    const eeatInfo = eeatItems.length > 0 ? `✅ ${eeatItems.join(', ')}` : '❌ Keine gefunden';

    const recoHtml = (recommendations || []).map(r => {
      const prioColor = r.priority === 'hoch' ? '#ef4444' : '#f59e0b';
      return `<div style="margin-bottom:8px;padding:8px 12px;background:#1a1a2e;border-left:3px solid ${prioColor};border-radius:4px;">
        <strong style="color:#fff;">${r.title}</strong><br>
        <span style="color:#aaa;font-size:13px;">${r.description}</span>
      </div>`;
    }).join('');

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
    
    <div style="text-align:center;padding:20px 0;border-bottom:1px solid #333;">
      <h1 style="margin:0;font-size:20px;color:#fff;">🤖 KI-Sichtbarkeits-Check</h1>
      <p style="margin:5px 0 0;color:#888;">Neuer Check durchgeführt</p>
    </div>

    <div style="text-align:center;padding:30px 0;">
      <div style="display:inline-block;width:100px;height:100px;border-radius:50%;background:${badgeColor};line-height:100px;font-size:32px;font-weight:bold;color:#fff;">
        ${score}
      </div>
      <p style="margin:10px 0 0;font-size:18px;color:${badgeColor};font-weight:bold;">${scoreLabel}</p>
    </div>

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

    <div style="background:#111;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="margin:0 0 10px;color:#fff;font-size:14px;">📊 Technische Analyse</h3>
      <p style="margin:4px 0;color:#ccc;font-size:13px;">Schema.org: ${schemaInfo}</p>
      <p style="margin:4px 0;color:#ccc;font-size:13px;">E-E-A-T: ${eeatInfo}</p>
      <p style="margin:4px 0;color:#ccc;font-size:13px;">Title: ${domainAnalysis?.title || '–'}</p>
    </div>

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

    <div style="background:#111;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="margin:0 0 10px;color:#fff;font-size:14px;">🏢 Genannte Konkurrenten</h3>
      <p style="color:#ccc;font-size:13px;margin:0;">${competitorList}</p>
    </div>

    ${recoHtml ? `
    <div style="background:#111;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="margin:0 0 10px;color:#fff;font-size:14px;">💡 Empfehlungen</h3>
      ${recoHtml}
    </div>` : ''}

    <div style="text-align:center;padding:20px 0;border-top:1px solid #333;color:#666;font-size:11px;">
      KI-Sichtbarkeits-Check · designare.at
    </div>

  </div>
</body>
</html>`;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`📧 Benachrichtigung gesendet für ${domain}`);

  } catch (error) {
    console.error('⚠️ E-Mail-Benachrichtigung fehlgeschlagen:');
    console.error('  Message:', error?.message);
    console.error('  Body:', JSON.stringify(error?.body || error?.response?.body || 'keine Details'));
    console.error('  Status:', error?.statusCode || error?.response?.statusCode || 'unbekannt');
  }
}
