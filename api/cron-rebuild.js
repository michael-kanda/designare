// api/cron-rebuild.js
// Wird täglich um 03:00 UTC von Vercel Cron aufgerufen
// Triggert einen neuen Deploy via Deploy Hook → build generiert knowledge.json + articles-db.json
// Loggt den Trigger in Redis für das Dashboard

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  // Nur Vercel Cron oder autorisierte Requests erlauben
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  const dashToken = process.env.EVITA_DASHBOARD_TOKEN;

  const isVercelCron = authHeader === `Bearer ${cronSecret}`;
  const isManual = req.query?.token === dashToken;

  if (!isVercelCron && !isManual) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK;

  if (!deployHookUrl) {
    // Log den Fehler
    const errorEntry = {
      timestamp: new Date().toISOString(),
      trigger: isManual ? 'manual' : 'cron',
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
    // Deploy Hook aufrufen → löst neuen Build aus
    const response = await fetch(deployHookUrl, { method: 'POST' });

    if (!response.ok) {
      throw new Error(`Deploy Hook Fehler: HTTP ${response.status}`);
    }

    const result = await response.json();

    // Erfolg loggen
    const logEntry = {
      timestamp: new Date().toISOString(),
      trigger: isManual ? 'manual' : 'cron',
      status: 'triggered',
      deployment_id: result?.job?.id || result?.id || null,
      deployment_url: result?.url || null
    };

    await redis.lpush('build:log:triggers', JSON.stringify(logEntry));
    await redis.ltrim('build:log:triggers', 0, 99); // Max 100 Einträge

    return res.status(200).json({ 
      success: true, 
      message: 'Deploy getriggert',
      deployment: logEntry
    });

  } catch (error) {
    // Fehler loggen
    const errorEntry = {
      timestamp: new Date().toISOString(),
      trigger: isManual ? 'manual' : 'cron',
      status: 'error',
      error: error.message
    };
    await redis.lpush('build:log:triggers', JSON.stringify(errorEntry));
    await redis.ltrim('build:log:triggers', 0, 99);

    return res.status(500).json({ error: error.message });
  }
}
