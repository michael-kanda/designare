// api/cron-rebuild.js
// Wird täglich um 03:00 UTC von Vercel Cron aufgerufen
// Triggert einen neuen Deploy via Deploy Hook → build generiert knowledge.json + articles-db.json
// Loggt den Trigger in Redis für das Dashboard
//
// ═══════════════════════════════════════════════════════════════
// CHANGELOG v1.1
// ═══════════════════════════════════════════════════════════════
//   ✓ x-vercel-cron Header Check (konsistent mit regenerate-knowledge.js)
//   ✓ Präziser Trigger-Typ im Log (cron | bearer | manual)
//   ✓ Defensive: fetch-Aufruf mit Timeout-Schutz (AbortSignal)

import { redis } from '../lib/redis.js';

export default async function handler(req, res) {
  // ── Auth: Vercel Cron ODER Bearer Token ODER Dashboard-Token ──
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  const dashToken = process.env.EVITA_DASHBOARD_TOKEN;

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const hasValidSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isManual = dashToken && req.query?.token === dashToken;

  if (!isVercelCron && !hasValidSecret && !isManual) {
    console.log('Unauthorized cron-rebuild attempt blocked');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Trigger-Typ für Logging präzisieren
  const triggerType = isVercelCron ? 'cron'
                    : isManual     ? 'manual'
                    : 'bearer';

  const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK;

  if (!deployHookUrl) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      trigger: triggerType,
      status: 'error',
      error: 'VERCEL_DEPLOY_HOOK nicht konfiguriert'
    };
    await redis.lpush('build:log:triggers', JSON.stringify(errorEntry));
    await redis.ltrim('build:log:triggers', 0, 99);

    return res.status(500).json({
      error: 'VERCEL_DEPLOY_HOOK Umgebungsvariable fehlt. Bitte in Vercel Settings anlegen.'
    });
  }

  try {
    // Deploy Hook aufrufen → löst neuen Build aus (mit 15s Timeout)
    const response = await fetch(deployHookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`Deploy Hook Fehler: HTTP ${response.status}`);
    }

    const result = await response.json();

    // Erfolg loggen
    const logEntry = {
      timestamp: new Date().toISOString(),
      trigger: triggerType,
      status: 'triggered',
      deployment_id: result?.job?.id || result?.id || null,
      deployment_url: result?.url || null
    };

    await redis.lpush('build:log:triggers', JSON.stringify(logEntry));
    await redis.ltrim('build:log:triggers', 0, 99);

    return res.status(200).json({
      success: true,
      message: 'Deploy getriggert',
      deployment: logEntry
    });

  } catch (error) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      trigger: triggerType,
      status: 'error',
      error: error.message
    };
    await redis.lpush('build:log:triggers', JSON.stringify(errorEntry));
    await redis.ltrim('build:log:triggers', 0, 99);

    return res.status(500).json({ error: error.message });
  }
}
