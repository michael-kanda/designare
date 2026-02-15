// js/inject-consent.js
// Injiziert consent-banner.js als ERSTES Script im <head>
// und stellt sicher dass analytics-proxy.js korrekt positioniert ist.
//
// Muss im Build NACH inject-header, inject-footer, inject-modals laufen.

import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../public');

async function injectConsent() {
  try {
    const files = await fs.readdir(PUBLIC_DIR);
    const htmlFiles = files.filter(f => f.endsWith('.html'));

    console.log(`🔍 Consent-Injection: ${htmlFiles.length} HTML-Dateien gefunden`);
    let injected = 0;

    for (const file of htmlFiles) {
      const filePath = path.join(PUBLIC_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const $ = cheerio.load(content);

      let changed = false;

      // ─── 1. consent-banner.js als ALLERERSTES Script im <head> ───
      // Muss vor ALLEM anderen JS stehen (setzt Consent Defaults)
      if (!content.includes('consent-banner.js')) {
        const head = $('head');
        if (head.length > 0) {
          // CSS für Consent-Buttons
          head.prepend('<link rel="stylesheet" href="/css/consent-extras.css">');
          // consent-banner.js direkt nach dem CSS, VOR allen anderen Scripts
          // prepend setzt es an den Anfang von <head>
          head.prepend('<script src="/js/consent-banner.js"></script>');
          changed = true;
        }
      }

      // ─── 2. analytics-proxy.js: von <head> nach vor </body> verschieben ───
      // Im Source liegt es im <head> – für Custom Events besser im <body>
      const existingProxy = $('head script[src*="analytics-proxy"]');
      if (existingProxy.length > 0) {
        existingProxy.remove();
        $('body').append('<script src="/js/analytics-proxy.js"></script>');
        changed = true;
      } else if (!content.includes('analytics-proxy.js')) {
        // Falls komplett fehlend: am Body-Ende einfügen
        $('body').append('<script src="/js/analytics-proxy.js"></script>');
        changed = true;
      }

      if (changed) {
        await fs.writeFile(filePath, $.html(), 'utf-8');
        console.log(`✅ Consent-Scripts injiziert in: ${file}`);
        injected++;
      } else {
        console.log(`⏭️  Bereits korrekt in: ${file}`);
      }
    }

    console.log(`🎉 Consent-Injection abgeschlossen! (${injected}/${htmlFiles.length})`);

  } catch (error) {
    console.error('❌ Fehler bei Consent-Injection:', error);
    process.exit(1);
  }
}

injectConsent();
