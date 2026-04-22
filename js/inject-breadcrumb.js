// js/inject-breadcrumb.js
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');
const BREADCRUMB_PATH = path.join(__dirname, '../breadcrumb.html');

async function injectBreadcrumb() {
  try {
    console.log('🍞 Lade Breadcrumb-Template...');
    const breadcrumbTemplate = await fs.readFile(BREADCRUMB_PATH, 'utf-8');

    const files = await fs.readdir(PUBLIC_DIR);
    const htmlFiles = files.filter(file => file.endsWith('.html'));

    console.log(`🔍 Gefunden: ${htmlFiles.length} HTML-Dateien`);

    for (const file of htmlFiles) {
      const filePath = path.join(PUBLIC_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      const $ = cheerio.load(content);
      const placeholder = $('#breadcrumb-placeholder');

      if (placeholder.length > 0) {
        // Artikel-Titel aus dem h1 extrahieren
        const h1 = $('article.blog-article h1');
        let articleTitle = 'Artikel';
        
        if (h1.length > 0) {
          // Nur den Text ohne span-Inhalt oder ersten Teil nehmen
          articleTitle = h1.clone().children('span').remove().end().text().trim();
          // Falls leer, den vollen Text nehmen
          if (!articleTitle) {
            articleTitle = h1.text().trim().split(':')[0].trim();
          }
        }

        // Breadcrumb mit Titel befüllen
        const breadcrumbHtml = breadcrumbTemplate.replace('{{ARTICLE_TITLE}}', articleTitle);
        
        placeholder.replaceWith(breadcrumbHtml);
        
        await fs.writeFile(filePath, $.html(), 'utf-8');
        console.log(`✅ Breadcrumb injiziert in: ${file} ("${articleTitle}")`);
      } else {
        console.log(`⏭️ Kein Breadcrumb-Placeholder in: ${file}`);
      }
    }
    
    console.log('🎉 Breadcrumb-Injektion abgeschlossen!');

  } catch (error) {
    console.error('❌ Fehler:', error);
    process.exit(1);
  }
}

injectBreadcrumb();
