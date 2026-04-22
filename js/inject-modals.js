// js/inject-modals.js
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');
const MODALS_PATH = path.join(__dirname, '../modals.html');

async function injectModals() {
  try {
    console.log('📄 Lade Modals...');
    const modalsHtml = await fs.readFile(MODALS_PATH, 'utf-8');

    const files = await fs.readdir(PUBLIC_DIR);
    const htmlFiles = files.filter(file => file.endsWith('.html'));

    console.log(`🔍 Gefunden: ${htmlFiles.length} HTML-Dateien in ${PUBLIC_DIR}`);

    for (const file of htmlFiles) {
      const filePath = path.join(PUBLIC_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      const $ = cheerio.load(content, { decodeEntities: false });
      
      let placeholder = $('#modal-container');

      if (placeholder.length > 0) {
        placeholder.replaceWith(modalsHtml);
        await fs.writeFile(filePath, $.html(), 'utf-8');
        console.log(`✅ Modals injiziert in: ${file}`);
      } else {
        console.log(`⚠️ Kein Placeholder in: ${file} (übersprungen)`);
      }
    }
    console.log('🎉 Modals-Injektion abgeschlossen!');

  } catch (error) {
    console.error('❌ Fehler beim Injizieren der Modals:', error);
    process.exit(1);
  }
}

injectModals();
