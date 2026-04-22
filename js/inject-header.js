// js/inject-header.js
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

// ESM Workaround für __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Konfiguration
const PUBLIC_DIR = path.join(__dirname, '../public');
const HEADER_PATH = path.join(__dirname, '../header.html');

async function injectHeader() {
  try {
    // 1. Header Inhalt laden
    console.log('📄 Lade Header...');
    const headerHtml = await fs.readFile(HEADER_PATH, 'utf-8');

    // 2. Alle HTML Dateien im Public Ordner finden
    const files = await fs.readdir(PUBLIC_DIR);
    const htmlFiles = files.filter(file => file.endsWith('.html'));

    console.log(`🔍 Gefunden: ${htmlFiles.length} HTML-Dateien in ${PUBLIC_DIR}`);

    // 3. Jede Datei bearbeiten
    for (const file of htmlFiles) {
      const filePath = path.join(PUBLIC_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Cheerio laden
      const $ = cheerio.load(content);
      const placeholder = $('#header-placeholder');

      if (placeholder.length > 0) {
        // Placeholder durch echten Header ersetzen
        placeholder.replaceWith(headerHtml);
        
        // Datei überschreiben
        await fs.writeFile(filePath, $.html(), 'utf-8');
        console.log(`✅ Header injiziert in: ${file}`);
      } else {
        console.log(`⚠️ Kein Placeholder in: ${file} (übersprungen)`);
      }
    }
    console.log('🎉 Header-Injektion abgeschlossen!');

  } catch (error) {
    console.error('❌ Fehler beim Injizieren des Headers:', error);
    process.exit(1);
  }
}

injectHeader();
