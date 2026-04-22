// api/send-visibility-report.js
// Sendet KI-Sichtbarkeits-Auswertung per E-Mail.
//
// ── CHANGELOG v2 ─────────────────────────────────────────────
// SECURITY:
//   + Rate-Limit pro IP (10 Reports/Tag)
//   + Rate-Limit pro Empfänger-Adresse (3 Reports/Tag) → Anti-Bombing
//   + CORS restriktiv (nur designare.at)
//   + Signed Report Token (HMAC) → nur valide Check-Ergebnisse dürfen versendet werden
//   + Idempotenz-Lock (120s) → Doppelklick-Schutz
//   + Hex-Color-Validierung für CSS-Injection-Schutz
//   + HTML-Payload-Größenlimit (Clipping bei Gmail vorbeugen)
// UX / LOGIC:
//   + Separater Report-Cache (7 Tage) statt 24h-Primär-Cache → E-Mail funktioniert
//     auch wenn der Visibility-Cache schon abgelaufen ist
//   + List-Unsubscribe-Header für bessere Deliverability
//   + Sender auf hello@ statt noreply@
//   + Präzisere Fehlermeldungen

import * as brevo from '@getbrevo/brevo';
import { trackVisibilityEmail } from './evita-track.js';
import { emailShell, esc } from './email-template.js';
import { Redis } from '@upstash/redis';
import { CACHE_VERSION } from './vis-constants.js';
import { verifyReportToken } from './signed-report.js';
import { checkRateLimit, incrementRateLimit, getClientIP } from './rate-limiter.js';
import {
  checkEmailRecipientLimit,
  incrementEmailRecipientLimit,
  acquireIdempotencyLock,
} from './email-recipient-limit.js';

const redis = Redis.fromEnv();

const IP_DAILY_LIMIT = 10;
const ALLOWED_ORIGINS = [
  'https://designare.at',
  'https://www.designare.at',
];
// Im Dev-Modus auch localhost erlauben
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:8080');
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ────────────────────────────────────────────────────────────
// Validierung
// ────────────────────────────────────────────────────────────
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

function safeHex(color, fallback = '#f59e0b') {
  return (typeof color === 'string' && HEX_COLOR_RE.test(color)) ? color : fallback;
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const clientIP = getClientIP(req);

  // ── IP-Rate-Limit ──
  const ipLimit = await checkRateLimit(clientIP, 'email-report', IP_DAILY_LIMIT);
  if (!ipLimit.allowed) {
    return res.status(429).json({
      success: false,
      message: `Tageslimit erreicht (${IP_DAILY_LIMIT} Report-Mails pro Tag). Bitte morgen erneut versuchen.`,
    });
  }

  try {
    const { email, brandName, standort, industry, reportToken } = req.body || {};
    const rawDomain = req.body?.domain;

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Ungültige E-Mail-Adresse.' });
    }
    if (!rawDomain && !brandName) {
      return res.status(400).json({ success: false, message: 'Fehlende Auswertungsdaten.' });
    }
    if (!reportToken) {
      return res.status(400).json({
        success: false,
        message: 'Report-Token fehlt. Bitte führe den Check erneut aus.',
      });
    }

    // ── Cache-Key rekonstruieren (muss exakt zur Check-Route passen) ──
    const cleanBrand    = brandName?.trim() || null;
    const cleanStandort = standort?.trim() || null;
    const cleanIndustry = industry?.trim() || null;
    const cleanDomain   = rawDomain?.trim()?.toLowerCase() || null;

    const brandSuffix    = cleanBrand    ? `:${cleanBrand.toLowerCase().replace(/\s+/g, '-')}` : '';
    const locationSuffix = cleanStandort ? `:${cleanStandort.toLowerCase().replace(/\s+/g, '-')}` : '';
    const industrySuffix = cleanIndustry ? `:${cleanIndustry.toLowerCase().replace(/\s+/g, '-')}` : '';
    const cacheKey = `visibility_${CACHE_VERSION}:${cleanDomain || 'brand'}${brandSuffix}${locationSuffix}${industrySuffix}`;

    // ── Token verifizieren ──
    try {
      verifyReportToken(reportToken, cacheKey);
    } catch (err) {
      return res.status(403).json({ success: false, message: `Token ungültig: ${err.message}` });
    }

    // ── Empfänger-Rate-Limit ──
    const emailLimit = await checkEmailRecipientLimit(email);
    if (!emailLimit.allowed) {
      return res.status(429).json({
        success: false,
        message: 'Diese E-Mail-Adresse hat heute bereits das Limit erreicht. Morgen wieder möglich.',
      });
    }

    // ── Idempotenz (Doppelklick-Schutz) ──
    const lockAcquired = await acquireIdempotencyLock(email, cacheKey);
    if (!lockAcquired) {
      return res.status(200).json({
        success: true,
        alreadySent: true,
        message: 'Report wurde vor Kurzem bereits gesendet. Bitte prüfe dein Postfach.',
      });
    }

    // ── Report-Daten laden: erst aus separatem Report-Cache (7d), dann Fallback auf Primary-Cache ──
    const reportKey = `report:${cacheKey}`;
    let cachedResult = null;
    try {
      cachedResult = await redis.get(reportKey);
    } catch (e) {
      console.warn(`⚠️ Report-Cache Read Error: ${e.message}`);
    }
    if (!cachedResult) {
      try {
        cachedResult = await redis.get(cacheKey);
      } catch (e) {
        console.warn(`⚠️ Primary-Cache Read Error: ${e.message}`);
      }
    }

    if (!cachedResult) {
      return res.status(404).json({
        success: false,
        message: 'Auswertung ist abgelaufen. Bitte führe den Check erneut aus und fordere die E-Mail dann direkt an.',
      });
    }

    // ── E-Mail bauen ──
    const htmlContent = buildEmailHtml(cachedResult, cleanDomain, cleanBrand, industry);
    const scoreTotal = cachedResult?.score?.total ?? 0;
    const scoreLabel = cachedResult?.score?.label ?? 'Unbekannt';
    const reportDomain = cachedResult.domain || cleanDomain || cleanBrand;

    // Payload-Größe prüfen (Gmail clipped ab ~102KB)
    if (htmlContent.length > 95_000) {
      console.warn(`⚠️ E-Mail-HTML ist ${Math.round(htmlContent.length / 1024)}KB — wird ggf. geclipped.`);
    }

    // ── Senden ──
    const apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.subject = `KI-Sichtbarkeits-Report: ${reportDomain} – ${scoreTotal}/100`;
    sendSmtpEmail.to = [{ email: email.trim() }];
    sendSmtpEmail.sender = { email: 'hello@designare.at', name: 'Michael Kanda | designare.at' };
    sendSmtpEmail.replyTo = { email: 'michael@designare.at', name: 'Michael Kanda' };
    sendSmtpEmail.htmlContent = htmlContent;

    // List-Unsubscribe-Header verbessern Deliverability (auch bei transactional)
    sendSmtpEmail.headers = {
      'List-Unsubscribe': '<mailto:michael@designare.at?subject=unsubscribe>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Entity-Type': 'visibility-report',
    };

    await apiInstance.sendTransacEmail(sendSmtpEmail);

    // ── Zähler hochzählen erst NACH erfolgreichem Versand ──
    await incrementRateLimit(clientIP, 'email-report');
    await incrementEmailRecipientLimit(email);

    // E-Mail maskiert loggen
    const maskedEmail = email.replace(/(.{2}).*(@.*)/, '$1***$2');
    console.log(`📧 Visibility-Report → ${maskedEmail} für ${reportDomain} (Score ${scoreTotal})`);

    await trackVisibilityEmail({
      domain: reportDomain,
      email: email.trim(),
      score: scoreTotal,
      scoreLabel,
      industry: cachedResult.industry || null,
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ Visibility-Report Fehler:', error?.message);
    return res.status(500).json({
      success: false,
      message: 'E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.',
    });
  }
}

// ────────────────────────────────────────────────────────────
// E-Mail-HTML-Builder (ausgelagert für Lesbarkeit)
// ────────────────────────────────────────────────────────────
function buildEmailHtml(cachedResult, cleanDomain, cleanBrand, industry) {
  const { score, domainAnalysis, aiTests, competitors, recommendations, timestamp } = cachedResult;
  const domain = cachedResult.domain || cleanDomain || cleanBrand;

  const scoreTotal = score?.total || 0;
  const scoreLabel = score?.label || 'Unbekannt';
  const scoreColor = safeHex(score?.color, '#f59e0b');

  const checkTime = (() => {
    const d = timestamp ? new Date(timestamp) : new Date();
    return d.toLocaleString('de-AT', {
      timeZone: 'Europe/Vienna',
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  })();

  // Score-Breakdown
  const breakdownRows = (score?.breakdown || []).map(item => {
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

  // Test-Results (Fehler-Tests explizit kennzeichnen)
  const testRows = (aiTests || []).map(t => {
    const isError = t.sentiment === 'fehler';
    const statusCell = isError
      ? '<span style="color:#999;">⚠️</span>'
      : (t.mentioned ? '✅' : '❌');
    const sentimentCell = isError ? '—' :
      t.sentiment === 'positiv' ? '🟢' :
      t.sentiment === 'negativ' ? '🔴' :
      t.sentiment === 'fehlend' ? '⚪' : '🟡';

    const engineLabel = t.engine === 'chatgpt' ? 'ChatGPT' : 'Gemini';
    const engineBg = t.engine === 'chatgpt' ? '#10a37f' : '#4285f4';
    return `
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#333;border-top:1px solid #f0f0f0;">
          ${esc(t.description)}
          <span style="background:${engineBg};color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px;">${engineLabel}</span>
          ${isError ? '<span style="color:#999;font-size:11px;margin-left:4px;">(Test fehlgeschlagen)</span>' : ''}
        </td>
        <td style="padding:10px 14px;text-align:center;border-top:1px solid #f0f0f0;">${statusCell}</td>
        <td style="padding:10px 14px;text-align:center;border-top:1px solid #f0f0f0;">${sentimentCell}</td>
      </tr>`;
  }).join('');

  // Schema & E-E-A-T
  const schemaText = domainAnalysis?.schema?.found
    ? `✅ ${(domainAnalysis.schema.types || []).slice(0, 5).map(t => esc(t)).join(', ') || 'Vorhanden'}`
    : '❌ Nicht gefunden';

  const eeatItems = [];
  if (domainAnalysis?.eeat?.aboutPage)  eeatItems.push('Über-uns');
  if (domainAnalysis?.eeat?.contactPage) eeatItems.push('Kontakt');
  if (domainAnalysis?.eeat?.authorInfo)  eeatItems.push('Autor-Info');
  const eeatText = eeatItems.length > 0 ? `✅ ${eeatItems.join(', ')}` : '❌ Keine gefunden';

  // Robots/KI-Crawler-Block
  const crawlerBlock = cachedResult.crawlerAccess ? (() => {
    const { blockedCrawlers = [], llmsTxtFound } = cachedResult.crawlerAccess;
    const blockedText = blockedCrawlers.length === 0
      ? '✅ Alle wichtigen KI-Crawler erlaubt'
      : `⚠️ ${blockedCrawlers.length} KI-Bots blockiert (${blockedCrawlers.slice(0, 3).map(b => esc(b.name)).join(', ')}${blockedCrawlers.length > 3 ? '…' : ''})`;
    const llmsText = llmsTxtFound ? '✅ llms.txt vorhanden' : '➖ llms.txt fehlt (optional)';
    return `
      <tr><td style="padding:0 32px 24px;">
        <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:14px;">KI-Crawler-Zugriff</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8fa;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#888;border-bottom:1px solid #eee;">robots.txt</td>
            <td style="padding:12px 16px;font-size:13px;color:#1a1a1a;border-bottom:1px solid #eee;text-align:right;">${blockedText}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:#888;">llms.txt</td>
            <td style="padding:12px 16px;font-size:13px;color:#1a1a1a;text-align:right;">${llmsText}</td>
          </tr>
        </table>
      </td></tr>`;
  })() : '';

  // Empfehlungen
  const recoHtml = (recommendations || []).slice(0, 6).map(r => {
    const isHigh = r.priority === 'hoch';
    return `
      <div style="padding:14px 16px;background:${isHigh ? '#fff8f8' : '#fffcf5'};border-left:3px solid ${isHigh ? '#ef4444' : '#f59e0b'};border-radius:0 8px 8px 0;margin-bottom:10px;">
        <div style="font-size:11px;color:${isHigh ? '#ef4444' : '#f59e0b'};font-weight:700;letter-spacing:0.3px;margin-bottom:4px;">${isHigh ? 'HOHE PRIORITÄT' : 'MITTLERE PRIORITÄT'}</div>
        <div style="font-size:13px;color:#1a1a1a;font-weight:600;margin-bottom:3px;">${esc(r.title)}</div>
        <div style="font-size:12px;color:#666;line-height:1.5;">${esc(r.description)}</div>
        ${r.pointPotential ? `<div style="font-size:11px;color:#22c55e;margin-top:4px;">↗ Potenzial: ${esc(r.pointPotential)}</div>` : ''}
      </div>`;
  }).join('');

  // Konkurrenten
  const competitorHtml = (competitors || []).length > 0
    ? competitors.slice(0, 10).map(c => `<span style="display:inline-block;background:#fff0f0;color:#c44;padding:3px 10px;border-radius:4px;font-size:11px;margin:2px;">${esc(c)}</span>`).join('')
    : '';

  const innerHtml = `
    <tr><td style="padding:28px 32px 20px;border-bottom:1px solid #eee;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td><span style="font-size:17px;font-weight:700;color:#1a1a1a;">KI-Sichtbarkeits-Report</span></td>
        <td align="right"><span style="font-size:12px;color:#999;">${esc(checkTime)}</span></td>
      </tr></table>
    </td></tr>

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

    <tr><td style="padding:28px 32px;">
      <div style="font-size:14px;font-weight:700;color:#1a1a1a;margin-bottom:16px;">Score-Zusammensetzung</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${breakdownRows}</table>
    </td></tr>

    <tr><td style="padding:0 32px;"><div style="border-top:1px solid #eee;"></div></td></tr>

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

    ${crawlerBlock}

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

    <tr><td style="padding:0 32px 28px;text-align:center;">
      <a href="https://designare.at/ki-sichtbarkeit" style="display:inline-block;background:#c4a35a;color:#fff;padding:14px 32px;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">Erneut testen</a>
      <div style="margin-top:8px;font-size:11px;color:#aaa;">Ergebnisse ändern sich – teste regelmäßig</div>
    </td></tr>`;

  return emailShell(innerHtml, {
    preheader: `${domain}: ${scoreTotal}/100 – ${scoreLabel}`,
    footerExtra: `Analyse vom ${checkTime}. Du erhältst diese E-Mail, weil du eine Auswertung angefordert hast. Kein Abo, keine weiteren Mails.`,
  });
}
