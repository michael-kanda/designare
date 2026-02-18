// api/silas-track.js - Leichtgewichtiger Tracking-Endpoint für Silas-Frontend-Events
// Trackt Downloads, Template-Nutzung und andere Client-seitige Aktionen
import { trackSilasDownload, trackSilasTemplate } from './evita-track.js';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { event, data } = req.body || {};

    if (!event) {
      return res.status(400).json({ error: 'Missing event type' });
    }

    switch (event) {
      // ── Downloads ────────────────────────────────────────────
      case 'download':
        await trackSilasDownload({
          type: data?.type || 'unknown',  // 'csv', 'txt', 'html'
          count: data?.count || 1
        });
        break;

      // ── Template gewählt ─────────────────────────────────────
      case 'template':
        await trackSilasTemplate(data?.template || 'unknown');
        break;

      // ── Unbekanntes Event → trotzdem 200 (Fire & Forget) ────
      default:
        console.warn(`[silas-track] Unbekanntes Event: ${event}`);
        break;
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('[silas-track] Fehler:', error.message);
    // Tracking-Fehler nie zum Client durchschlagen lassen
    return res.status(200).json({ ok: true });
  }
}
