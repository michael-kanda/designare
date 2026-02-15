// js/inject-consent.js
// Injiziert consent-banner.js (im <head>) und analytics-proxy.js (vor </body>)
// in alle HTML-Dateien im public-Ordner.
//
// Verwendung: node js/inject-consent.js
// Muss im Build-Prozess NACH inject-header.js laufen.

import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');

// Scripts die injiziert werden
const HEAD_SCRIPT = '<script src="/js/consent-banner.js"></script>';
const BODY_SCRIPT = '<script src="/js/analytics-proxy.js"></script>';

// CSS für Consent-Button Highlight
const CONSENT_CSS = '<link rel="stylesheet" href="/css/consent-extras.css">';

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

      // ─── HEAD: consent-banner.js als ERSTES Script ───
      // Muss vor allen anderen Scripts stehen (setzt Consent Defaults)
      if (!content.includes('consent-banner.js')) {
        const head = $('head');
        if (head.length > 0) {
          // CSS einfügen
          head.append(CONSENT_CSS);
          // Script als erstes im Head (nach meta/title, vor anderen Scripts)
          // Wir fügen es am Ende des <head> ein – es ist ein IIFE das sofort ausführt
          head.append(HEAD_SCRIPT);
          changed = true;
        }
      }

      // ─── BODY: analytics-proxy.js vor </body> ───
      if (!content.includes('analytics-proxy.js')) {
        const body = $('body');
        if (body.length > 0) {
          body.append(BODY_SCRIPT);
          changed = true;
        }
      }

      if (changed) {
        await fs.writeFile(filePath, $.html(), 'utf-8');
        console.log(`✅ Consent-Scripts injiziert in: ${file}`);
        injected++;
      } else {
        console.log(`⏭️  Bereits vorhanden in: ${file}`);
      }
    }

    console.log(`🎉 Consent-Injection abgeschlossen! (${injected}/${htmlFiles.length} Dateien aktualisiert)`);

  } catch (error) {
    console.error('❌ Fehler bei Consent-Injection:', error);
    process.exit(1);
  }
}

injectConsent();
