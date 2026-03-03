/**
 * build-runner.js – Modularer Build-Prozess für designare
 * Speicherort: js/build-runner.js
 * Aufruf: node js/build-runner.js
 */

import { execSync } from 'node:child_process';
import { mkdirSync, cpSync, readdirSync } from 'node:fs';
import path from 'node:path';

// ─── Konfiguration ───────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, '..');

const steps = [
  // 1. Generierung
  { name: 'Articles DB generieren',   cmd: 'node js/generate-articles-db.js' },
  { name: 'Knowledge generieren',     cmd: 'node js/generate-knowledge.js' },
  { name: 'Sitemap generieren',       cmd: 'node generate-sitemap.js' },

  // 2. Ratings (vor dem Kopieren, damit public/ die aktualisierten Dateien bekommt)
  { name: 'Ratings injizieren',       cmd: 'node js/inject-ratings.js' },

  // 3. Assets nach public/ kopieren
  { name: 'Assets kopieren',          fn: copyAssets },

  // 4. CSS bündeln
  { name: 'CSS bündeln',              cmd: 'npx gulp' },

  // 5. Injektionen (sequenziell – Reihenfolge beibehalten)
  { name: 'Theme-Init injizieren',    cmd: 'node js/inject-theme-init.js' },
  { name: 'Header injizieren',        cmd: 'node js/inject-header.js' },
  { name: 'Footer injizieren',        cmd: 'node js/inject-footer.js' },
  { name: 'Modals injizieren',        cmd: 'node js/inject-modals.js' },
  { name: 'Side-Menu injizieren',     cmd: 'node js/inject-side-menu.js' },
  { name: 'Breadcrumb injizieren',    cmd: 'node js/inject-breadcrumb.js' },
  { name: 'Related injizieren',       cmd: 'node js/inject-related.js' },
  { name: 'Blog-Artikel injizieren',  cmd: 'node js/inject-blog-articles.js' },
  { name: 'Lazy-Loading injizieren',  cmd: 'node js/inject-lazy-loading.js' },
  { name: 'Consent injizieren',       cmd: 'node js/inject-consent.js' },

  // 6. Abschluss
  { name: 'Build loggen',             cmd: 'node js/log-build.js' },
];

// ─── Asset-Kopier-Logik ──────────────────────────────────────────

function copyAssets() {
  mkdirSync(path.join(ROOT, 'public', 'css'), { recursive: true });

  const targets = [
    { pattern: '*.html' },
    { pattern: '*.svg' },
    { pattern: '*.csv' },
    { pattern: '*.json' },
    { dir: 'js' },
    { dir: 'images' },
    { dir: 'font' },
    { dir: 'CSV-Importer-PRO' },
    { dir: 'downloads' },
  ];

  for (const target of targets) {
    try {
      if (target.dir) {
        const src = path.join(ROOT, target.dir);
        const dest = path.join(ROOT, 'public', target.dir);
        cpSync(src, dest, { recursive: true, force: true });
      } else {
        // Glob-Pattern: alle passenden Dateien im Root kopieren
        const ext = target.pattern.replace('*.', '.');
        const files = readdirSync(ROOT).filter(f => f.endsWith(ext));
        for (const file of files) {
          cpSync(path.join(ROOT, file), path.join(ROOT, 'public', file), { force: true });
        }
      }
    } catch {
      // Ordner/Dateien existieren nicht – kein Fehler, wie im Original
    }
  }
}

// ─── Runner ──────────────────────────────────────────────────────

function run() {
  const totalStart = performance.now();
  const results = [];

  console.log('\n🔨 Build gestartet\n');
  console.log('─'.repeat(55));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = `[${String(i + 1).padStart(2, '0')}/${steps.length}] ${step.name}`;
    const stepStart = performance.now();

    try {
      if (step.fn) {
        step.fn();
      } else {
        execSync(step.cmd, { cwd: ROOT, stdio: 'pipe' });
      }

      const duration = ((performance.now() - stepStart) / 1000).toFixed(2);
      console.log(`  ✅ ${label}  (${duration}s)`);
      results.push({ name: step.name, ok: true, duration });

    } catch (err) {
      const duration = ((performance.now() - stepStart) / 1000).toFixed(2);
      console.error(`  ❌ ${label}  (${duration}s)`);
      console.error(`     Fehler: ${err.stderr?.toString().trim() || err.message}\n`);
      results.push({ name: step.name, ok: false, duration });

      // Zusammenfassung trotzdem ausgeben, dann abbrechen
      printSummary(results, totalStart);
      process.exit(1);
    }
  }

  printSummary(results, totalStart);
}

// ─── Zusammenfassung ─────────────────────────────────────────────

function printSummary(results, totalStart) {
  const totalDuration = ((performance.now() - totalStart) / 1000).toFixed(2);
  const failed = results.filter(r => !r.ok);

  console.log('─'.repeat(55));

  if (failed.length === 0) {
    console.log(`\n✅ Build erfolgreich abgeschlossen (${totalDuration}s)\n`);
  } else {
    console.log(`\n❌ Build fehlgeschlagen bei: ${failed.map(f => f.name).join(', ')}`);
    console.log(`   Gesamtdauer: ${totalDuration}s\n`);
  }
}

// ─── Start ───────────────────────────────────────────────────────

run();
