// api/metrics.js – Version 3.0
// Standalone GA4 Measurement Protocol (ohne gtag.js)

export default async function handler(req, res) {
  // CORS Headers für sendBeacon
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Body parsen (fetch = JSON, sendBeacon = text/plain)
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error('JSON parse error:', e);
        return res.status(400).json({ error: 'Invalid JSON' });
      }
    }

    const { client_id, events } = body;

    if (!client_id || !events || !Array.isArray(events)) {
      console.error('Missing data:', { client_id: !!client_id, events: !!events });
      return res.status(400).json({ error: 'Missing client_id or events' });
    }

    // Config
    const GA_ID = process.env.GA_MEASUREMENT_ID;
    const API_SECRET = process.env.GA_API_SECRET;

    if (!GA_ID || !API_SECRET) {
      console.error('Missing GA4 config');
      return res.status(500).json({ error: 'Configuration error' });
    }

    // ─────────────────────────────────────────────
    // GEO DATA (von Vercel)
    // ─────────────────────────────────────────────

    const geoData = {
      city: req.headers['x-vercel-ip-city'] 
        ? decodeURIComponent(req.headers['x-vercel-ip-city']) 
        : undefined,
      country: req.headers['x-vercel-ip-country'] || undefined,
      region: req.headers['x-vercel-ip-country-region'] || undefined
    };

    // ─────────────────────────────────────────────
    // EVENTS ENRICHEN
    // ─────────────────────────────────────────────

    const enrichedEvents = events.map(event => {
      const params = { ...(event.params || {}) };

      // KRITISCH: Diese Parameter müssen Zahlen sein!
      if (params.ga_session_id) {
        params.ga_session_id = Number(params.ga_session_id);
      }
      if (params.ga_session_number) {
        params.ga_session_number = Number(params.ga_session_number);
      }

      // Engagement Time (GA4 braucht mindestens 1)
      params.engagement_time_msec = Math.max(1, Number(params.engagement_time_msec) || 100);

      // Geo-Daten hinzufügen
      if (geoData.city) params.geo_city = geoData.city;
      if (geoData.country) params.geo_country = geoData.country;
      if (geoData.region) params.geo_region = geoData.region;

      return {
        name: event.name,
        params: params
      };
    });

    // ─────────────────────────────────────────────
    // AN GA4 SENDEN
    // ─────────────────────────────────────────────

    const payload = {
      client_id: String(client_id),
      events: enrichedEvents,
      // Timestamp für korrekte Zeitzone
      timestamp_micros: String(Date.now() * 1000)
    };

    const debugMode = process.env.GA_DEBUG === 'true';
    const productionUrl = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_ID}&api_secret=${API_SECRET}`;

    // IMMER an Production senden
    const response = await fetch(productionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Debug: Zusätzlich validieren und loggen
    if (debugMode) {
      const debugUrl = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${GA_ID}&api_secret=${API_SECRET}`;
      const debugResponse = await fetch(debugUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const debugData = await debugResponse.json().catch(() => ({}));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('GA4 Debug Mode');
      console.log('Payload:', JSON.stringify(payload, null, 2));
      console.log('Validation:', JSON.stringify(debugData, null, 2));
      if (debugData.validationMessages?.length > 0) {
        console.error('⚠️ Validation Errors:', debugData.validationMessages);
      } else {
        console.log('✅ No validation errors');
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      return res.status(200).json({ 
        success: true, 
        debug: true,
        validation: debugData 
      });
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Analytics Error:', error);
    // Immer 200, um Client nicht zu blockieren
    return res.status(200).json({ success: false, error: error.message });
  }
}
