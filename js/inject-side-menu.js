// js/inject-side-menu.js
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');
const SIDEMENU_PATH = path.join(__dirname, '../side-menu.html');

async function injectSideMenu() {
  try {
    console.log('📄 Lade Side-Menu...');
    const sideMenuHtml = await fs.readFile(SIDEMENU_PATH, 'utf-8');

    const files = await fs.readdir(PUBLIC_DIR);
    const htmlFiles = files.filter(file => file.endsWith('.html'));

    console.log(`🔍 Gefunden: ${htmlFiles.length} HTML-Dateien in ${PUBLIC_DIR}`);

    for (const file of htmlFiles) {
      const filePath = path.join(PUBLIC_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      const $ = cheerio.load(content, { decodeEntities: false });
      
      // Suche nach aside#side-menu-placeholder ODER #side-menu-placeholder
      let placeholder = $('aside#side-menu-placeholder');
      
      if (placeholder.length === 0) {
        placeholder = $('#side-menu-placeholder');
      }

      if (placeholder.length > 0) {
        placeholder.replaceWith(sideMenuHtml);
        await fs.writeFile(filePath, $.html(), 'utf-8');
        console.log(`✅ Side-Menu injiziert in: ${file}`);
      } else {
        console.log(`⚠️ Kein Placeholder in: ${file} (übersprungen)`);
      }
    }
    console.log('🎉 Side-Menu-Injektion abgeschlossen!');

  } catch (error) {
    console.error('❌ Fehler beim Injizieren des Side-Menus:', error);
    process.exit(1);
  }
}

injectSideMenu();
