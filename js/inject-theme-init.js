// js/inject-theme-init.js
// Fügt das Theme-Flash-Prevention-Script in den <head> aller HTML-Dateien ein
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');

// Das inline Script für sofortige Theme-Anwendung
const THEME_INIT_SCRIPT = `<script>
(function(){try{if(localStorage.getItem('theme')==='light'){document.documentElement.classList.add('light-mode')}}catch(e){}})();
</script>`;

async function injectThemeInit() {
  try {
    console.log('🎨 Starte Theme-Init-Injection...');
    
    const files = await fs.readdir(PUBLIC_DIR);
    const htmlFiles = files.filter(file => file.endsWith('.html'));
    
    console.log(`🔍 Gefunden: ${htmlFiles.length} HTML-Dateien`);
    
    for (const file of htmlFiles) {
      const filePath = path.join(PUBLIC_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      // Prüfen ob Script bereits vorhanden
      if (content.includes('light-mode') && content.includes('documentElement.classList')) {
        console.log(`⏭️  Script bereits vorhanden in: ${file}`);
        continue;
      }
      
      const $ = cheerio.load(content);
      const head = $('head');
      
      if (head.length > 0) {
        // Script direkt nach <head> und vor allem anderen einfügen
        // Finde das erste Element im head
        const firstChild = head.children().first();
        
        if (firstChild.length > 0) {
          // Vor dem ersten Element einfügen
          firstChild.before(THEME_INIT_SCRIPT + '\n');
        } else {
          // Head ist leer, einfach anhängen
          head.prepend(THEME_INIT_SCRIPT + '\n');
        }
        
        await fs.writeFile(filePath, $.html(), 'utf-8');
        console.log(`✅ Theme-Init injiziert in: ${file}`);
      } else {
        console.log(`⚠️  Kein <head> gefunden in: ${file}`);
      }
    }
    
    console.log('🎉 Theme-Init-Injection abgeschlossen!');
    
  } catch (error) {
    console.error('❌ Fehler:', error);
    process.exit(1);
  }
}

injectThemeInit();
