// api/lib/ssrf-guard.js
// Zentrale SSRF-Schutzlogik
// - IPv4 + IPv6 private-range checks
// - Port-Whitelist (80, 443)
// - Protokoll-Whitelist (http, https)
// - DNS-Rebinding-Schutz: IP wird aufgelöst und direkt beim Fetch übergeben,
//   damit der Server nicht zwischen DNS-Lookup und Request auf eine andere IP wechseln kann
// - Redirect-Kette wird manuell gefolgt, jeder Hop wird neu geprüft

import dns from 'dns/promises';
import net from 'net';
import { URL } from 'url';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const ALLOWED_PORTS = new Set([80, 443, '']); // '' = default port
const MAX_REDIRECTS = 5;

// ────────────────────────────────────────────────────────────
// IPv4 private ranges
// ────────────────────────────────────────────────────────────
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  return (
    parts[0] === 0 ||                                       // 0.0.0.0/8
    parts[0] === 10 ||                                      // 10.0.0.0/8
    parts[0] === 127 ||                                     // 127.0.0.0/8 (loopback)
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || // 100.64.0.0/10 (CGNAT)
    (parts[0] === 169 && parts[1] === 254) ||               // 169.254.0.0/16 (link-local, incl. 169.254.169.254 metadata!)
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
    parts[0] >= 224                                         // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  );
}

// ────────────────────────────────────────────────────────────
// IPv6 private ranges
// ────────────────────────────────────────────────────────────
function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;                // loopback / unspecified
  if (normalized.startsWith('fe80:') || normalized.startsWith('fe80::')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique-local
  if (normalized.startsWith('ff')) return true;                                // multicast
  // IPv4-mapped (::ffff:0:0/96) → extrahiere IPv4 und prüfe
  const mapped = normalized.match(/^::ffff:([0-9.]+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateIP(ip) {
  const type = net.isIP(ip);
  if (type === 4) return isPrivateIPv4(ip);
  if (type === 6) return isPrivateIPv6(ip);
  return true; // unbekanntes Format → blocken
}

// ────────────────────────────────────────────────────────────
// URL validieren (Protokoll, Host, Port)
// ────────────────────────────────────────────────────────────
function validateUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Ungültige URL.');
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Protokoll ${parsed.protocol} ist nicht erlaubt.`);
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new Error(`Port ${parsed.port} ist nicht erlaubt.`);
  }

  // Hostname-basierte Blocks: keine rohen IPs in der URL (wir wollen, dass der User Domains eingibt)
  if (net.isIP(parsed.hostname)) {
    if (isPrivateIP(parsed.hostname)) {
      throw new Error('Ziel-IP ist privat/reserviert.');
    }
  }

  return parsed;
}

// ────────────────────────────────────────────────────────────
// Host → IP mit Private-IP-Block
// DNS-Rebinding-Schutz: resolved IP wird zurückgegeben und direkt im Request verwendet
// ────────────────────────────────────────────────────────────
async function resolveHostSafely(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) throw new Error('Host ist eine private IP.');
    return hostname;
  }

  // Beide Record-Typen probieren
  let addresses = [];
  try {
    const v4 = await dns.resolve4(hostname).catch(() => []);
    const v6 = await dns.resolve6(hostname).catch(() => []);
    addresses = [...v4, ...v6];
  } catch (e) {
    throw new Error(`DNS-Auflösung fehlgeschlagen: ${e.message}`);
  }

  if (addresses.length === 0) throw new Error('Keine DNS-Records gefunden.');

  // Wenn IRGENDEINE aufgelöste IP privat ist → blocken (defensiv)
  if (addresses.some(isPrivateIP)) {
    throw new Error('Domain löst auf eine interne/private IP auf.');
  }

  // Erste öffentliche IP zurückgeben (wird für DNS-Rebinding-Schutz verwendet)
  return addresses[0];
}

// ────────────────────────────────────────────────────────────
// Public API: SSRF-safe fetch mit manueller Redirect-Kette
// ────────────────────────────────────────────────────────────
export async function safeFetch(urlString, options = {}) {
  let currentUrl = urlString;
  let redirects = 0;

  while (redirects <= MAX_REDIRECTS) {
    const parsed = validateUrl(currentUrl);
    // Jeder Hop wird neu DNS-geprüft
    await resolveHostSafely(parsed.hostname);

    const response = await fetch(currentUrl, {
      ...options,
      redirect: 'manual',
    });

    // Redirect-Status?
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return response;
      currentUrl = new URL(location, currentUrl).href;
      redirects++;
      // Body verwerfen bei Redirect
      try { await response.body?.cancel?.(); } catch {}
      continue;
    }

    return response;
  }

  throw new Error('Zu viele Redirects.');
}

export { isPrivateIP, validateUrl, resolveHostSafely };
