// js/inject-consent.js
// 1. Kopiert consent-extras.css nach public/css/ (falls nicht vorhanden)
// 2. Injiziert consent-banner.js als ERSTES Script im <head>
// 3. Verschiebt analytics-proxy.js vom <head> ans Body-Ende
//
// Muss im Build NACH den anderen inject-Scripts und NACH dem Asset-Copy laufen.

import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../public');
const PUBLIC_CSS_DIR = path.join(PUBLIC_DIR, 'css');

async function ensureConsentCSS() {
  // consent-extras.css wird nicht vom bundle-css erfasst,
  // also manuell nach public/css/ kopieren
  const src = path.join(__dirname, '../css/consent-extras.css');
  const dest = path.join(PUBLIC_CSS_DIR, 'consent-extras.css');

  try {
    await fs.access(src);
    await fs.mkdir(PUBLIC_CSS_DIR, { recursive: true });
    await fs.copyFile(src, dest);
    console.log('✅ consent-extras.css → public/css/');
  } catch (err) {
    // Falls die CSS-Datei nicht existiert, kein Fehler – Styles sind optional
    console.warn('⚠️  consent-extras.css nicht gefunden, übersprungen');
  }
}

async function injectConsent() {
  try {
    // CSS sicherstellen
    await ensureConsentCSS();

    const files = await fs.readdir(PUBLIC_DIR);
    const htmlFiles = files.filter(f => f.endsWith('.html'));

    console.log(`🔍 Consent-Injection: ${htmlFiles.length} HTML-Dateien`);
    let injected = 0;

    for (const file of htmlFiles) {
      const filePath = path.join(PUBLIC_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const $ = cheerio.load(content);

      let changed = false;

      // ─── 1. consent-banner.js als ERSTES Script im <head> ───
      if (!content.includes('consent-banner.js')) {
        const head = $('head');
        if (head.length > 0) {
          // prepend: landet ganz am Anfang von <head>
          // Reihenfolge: erst CSS prepend, dann Script prepend
          // → Script steht VOR CSS im DOM (prepend fügt oben ein)
          head.prepend('<link rel="stylesheet" href="css/consent-extras.css">');
          head.prepend('<script src="js/consent-banner.js"></script>');
          changed = true;
        }
      }

      // ─── 2. analytics-proxy.js: aus <head> entfernen, ans Body-Ende ───
      const proxyInHead = $('head script[src*="analytics-proxy"]');
      if (proxyInHead.length > 0) {
        proxyInHead.remove();
        $('body').append('<script src="js/analytics-proxy.js"></script>');
        changed = true;
      } else if (!content.includes('analytics-proxy.js')) {
        $('body').append('<script src="js/analytics-proxy.js"></script>');
        changed = true;
      }

      if (changed) {
        await fs.writeFile(filePath, $.html(), 'utf-8');
        console.log(`✅ ${file}`);
        injected++;
      } else {
        console.log(`⏭️  ${file} (bereits korrekt)`);
      }
    }

    console.log(`🎉 Consent-Injection: ${injected}/${htmlFiles.length} aktualisiert`);

  } catch (error) {
    console.error('❌ Fehler:', error);
    process.exit(1);
  }
}

injectConsent();
