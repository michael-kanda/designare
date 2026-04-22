// js/log-build.js
// Läuft am Ende von `npm run build` und loggt die Ergebnisse nach Redis
// So sieht man im Dashboard was bei jedem Build passiert ist

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// ─── Redis-Konfiguration ──────────────────────────────────────────
// Im Build-Kontext sind die ENV-Variablen über Vercel verfügbar
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisCommand(command, args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.log('⚠️  Redis nicht konfiguriert – Build-Log wird übersprungen');
    return null;
  }

  try {
    const response = await fetch(`${REDIS_URL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([command, ...args])
    });
    const data = await response.json();
    return data.result;
  } catch (e) {
    console.error('Redis Fehler:', e.message);
    return null;
  }
}

async function logBuild() {
  const startTime = Date.now();
  console.log('\n📋 Build-Log wird erstellt...\n');

  const buildLog = {
    timestamp: new Date().toISOString(),
    status: 'success',
    node_version: process.version,
    articles: { count: 0, categories: {}, list: [] },
    knowledge: { pages: 0, keywords: 0, sections: 0, list: [] },
    files_generated: [],
    errors: []
  };

  // ─── articles-db.json prüfen ───────────────────────────────────
  try {
    const articlesPath = path.join(ROOT_DIR, 'articles-db.json');
    if (fs.existsSync(articlesPath)) {
      const articlesDb = JSON.parse(fs.readFileSync(articlesPath, 'utf-8'));
      buildLog.articles.count = articlesDb.articles?.length || 0;

      // Kategorien zählen + Artikelliste erstellen
      const cats = {};
      (articlesDb.articles || []).forEach(a => {
        cats[a.category] = (cats[a.category] || 0) + 1;
        buildLog.articles.list.push({
          slug: a.slug,
          title: a.title,
          category: a.category,
          tags: a.tags || [],
          question: a.question || ''
        });
      });
      buildLog.articles.categories = cats;
      buildLog.files_generated.push('articles-db.json');

      console.log(`   ✅ articles-db.json: ${buildLog.articles.count} Artikel`);
    } else {
      buildLog.errors.push('articles-db.json nicht gefunden');
      console.log('   ❌ articles-db.json nicht gefunden');
    }
  } catch (e) {
    buildLog.errors.push(`articles-db.json Fehler: ${e.message}`);
    console.log(`   ❌ articles-db.json: ${e.message}`);
  }

  // ─── knowledge.json prüfen ─────────────────────────────────────
  try {
    const knowledgePath = path.join(ROOT_DIR, 'knowledge.json');
    if (fs.existsSync(knowledgePath)) {
      const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf-8'));
      buildLog.knowledge.pages = knowledge.stats?.total_pages || knowledge.pages?.length || 0;
      buildLog.knowledge.keywords = knowledge.stats?.total_keywords || 0;
      buildLog.knowledge.sections = knowledge.stats?.total_sections || 0;
      buildLog.files_generated.push('knowledge.json');

      // Detaillierte Seitenliste erstellen
      (knowledge.pages || []).forEach(p => {
        buildLog.knowledge.list.push({
          slug: p.slug,
          title: p.title,
          url: p.url || `/${p.slug}`,
          type: p.type || 'page',
          keywords: (p.keywords || []).slice(0, 8),
          sections_count: p.sections?.length || 0,
          text_length: p.text?.length || 0
        });
      });

      console.log(`   ✅ knowledge.json: ${buildLog.knowledge.pages} Seiten, ${buildLog.knowledge.keywords} Keywords`);
    } else {
      buildLog.errors.push('knowledge.json nicht gefunden');
      console.log('   ❌ knowledge.json nicht gefunden');
    }
  } catch (e) {
    buildLog.errors.push(`knowledge.json Fehler: ${e.message}`);
    console.log(`   ❌ knowledge.json: ${e.message}`);
  }

  // ─── knowledge.min.json prüfen ─────────────────────────────────
  try {
    const minPath = path.join(ROOT_DIR, 'knowledge.min.json');
    if (fs.existsSync(minPath)) {
      buildLog.files_generated.push('knowledge.min.json');
    }
  } catch (e) {}

  // ─── sitemap.xml prüfen ────────────────────────────────────────
  try {
    const sitemapPath = path.join(ROOT_DIR, 'sitemap.xml');
    if (fs.existsSync(sitemapPath)) {
      buildLog.files_generated.push('sitemap.xml');
      console.log('   ✅ sitemap.xml generiert');
    }
  } catch (e) {}

  // ─── HTML-Dateien im public/ zählen ────────────────────────────
  try {
    const publicDir = path.join(ROOT_DIR, 'public');
    if (fs.existsSync(publicDir)) {
      const publicFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
      buildLog.html_pages = publicFiles.length;
      console.log(`   ✅ ${publicFiles.length} HTML-Seiten in public/`);
    }
  } catch (e) {}

  // ─── Status bestimmen ──────────────────────────────────────────
  if (buildLog.errors.length > 0) {
    buildLog.status = buildLog.articles.count > 0 || buildLog.knowledge.pages > 0
      ? 'partial' // Teilweise erfolgreich
      : 'failed';
  }

  buildLog.duration_ms = Date.now() - startTime;

  // ─── An Redis senden ───────────────────────────────────────────

  // Detaillierte Seitenliste separat speichern (wird bei jedem Build überschrieben)
  // So bleibt die Build-History kompakt, aber die aktuelle Inventarliste ist immer verfügbar
  const inventory = {
    timestamp: buildLog.timestamp,
    articles: buildLog.articles.list,
    knowledge: buildLog.knowledge.list
  };
  await redisCommand('SET', ['build:log:inventory', JSON.stringify(inventory)]);

  // Für die Build-History: kompakte Version ohne die langen Listen
  const compactLog = {
    ...buildLog,
    articles: { ...buildLog.articles, list: undefined },
    knowledge: { ...buildLog.knowledge, list: undefined }
  };
  delete compactLog.articles.list;
  delete compactLog.knowledge.list;

  const logJson = JSON.stringify(compactLog);

  // In Build-Log-Liste speichern (neueste zuerst)
  await redisCommand('LPUSH', ['build:log:results', logJson]);
  await redisCommand('LTRIM', ['build:log:results', '0', '99']); // Max 100

  // Letztes Build-Datum speichern (für schnellen Zugriff) – mit Listen
  await redisCommand('SET', ['build:log:latest', JSON.stringify(buildLog)]);

  // Tages-Counter erhöhen
  const today = new Date().toISOString().split('T')[0];
  await redisCommand('HINCRBY', [`build:log:daily:${today}`, 'builds', '1']);

  console.log(`\n📋 Build-Log gespeichert (${buildLog.status})`);
  console.log(`   Dauer: ${buildLog.duration_ms}ms\n`);
}

logBuild().catch(err => {
  console.error('⚠️  Build-Log Fehler (nicht kritisch):', err.message);
  // Build-Log-Fehler sollen den Build NICHT abbrechen
  process.exit(0);
});
