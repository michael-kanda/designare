// api/email-template.js - Shared E-Mail Shell für alle designare.at Mails
// Einheitliches helles Layout: outer #f4f4f6, weiße Card, konsistenter Footer
// Tabellenbasiert für maximale Client-Kompatibilität (Gmail, Outlook, Apple Mail)

/**
 * Wraps content in the designare.at email shell.
 * @param {string} innerHtml - The main content HTML
 * @param {Object} opts
 * @param {string} [opts.preheader] - Hidden preheader text for inbox preview
 * @param {string} [opts.footerExtra] - Additional footer line (e.g. unsubscribe)
 * @returns {string} Complete HTML email
 */
export function emailShell(innerHtml, opts = {}) {
  const preheader = opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${opts.preheader}</div>` : '';
  const footerExtra = opts.footerExtra || '';
  const showSlogan = opts.showSlogan !== false; // default true

  const sloganHtml = showSlogan
    ? `<span style="color:#ccc;"> · </span><span style="color:#bbb;">&lt;/&gt; Komplize für Web &amp; KI aus Wien</span>`
    : '';

  return `<!DOCTYPE html>
<html lang="de" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>designare.at</title>
  <!--[if mso]><style>table,td{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;">

        ${innerHtml}

        <!-- FOOTER -->
        <tr><td style="padding:20px 32px;background:#f8f8fa;border-top:1px solid #eee;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="font-size:12px;color:#999;line-height:1.6;">
              <a href="https://designare.at" style="color:#c4a35a;text-decoration:none;font-weight:600;">designare.at</a>
              <span style="color:#ccc;"> · </span>
              <a href="mailto:michael@designare.at" style="color:#888;text-decoration:none;">Michael Kanda</a>
              ${sloganHtml}
            </td></tr>
            ${footerExtra ? `<tr><td style="padding-top:10px;font-size:11px;color:#ccc;line-height:1.5;">${footerExtra}</td></tr>` : ''}
          </table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * HTML-Escape helper
 */
export function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates an HMAC-like token for unsubscribe links (simple hash, no crypto dependency)
 * Uses a secret + email to create a verification token
 */
export function unsubscribeToken(email, secret) {
  let hash = 0;
  const str = `${secret}:${email.toLowerCase().trim()}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generates an unsubscribe footer line with tokenized link
 */
export function unsubscribeFooter(email, baseUrl = 'https://designare.at') {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.EVITA_DASHBOARD_TOKEN || 'designare-default';
  const token = unsubscribeToken(email, secret);
  const encodedEmail = encodeURIComponent(email);
  const url = `${baseUrl}/api/email-unsubscribe?email=${encodedEmail}&token=${token}`;
  
  return `Diese E-Mail wurde einmalig über <a href="https://designare.at" style="color:#bbb;text-decoration:underline;">designare.at</a> versendet. <a href="${url}" style="color:#bbb;text-decoration:underline;">Weitere E-Mails blockieren</a>`;
}
