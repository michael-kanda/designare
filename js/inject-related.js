// js/inject-related.js
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');
const RELATED_TEMPLATE_PATH = path.join(__dirname, '../related-articles.html');
const ARTICLES_DB_PATH = path.join(__dirname, '../articles-db.json');

// Anzahl der Related Articles
const RELATED_COUNT = 3;

function generateRelatedItemHtml(article) {
  return `
        <a href="${article.slug}.html" class="related-card" title="${article.title}: ${article.description}">
            <i class="${article.icon}" aria-hidden="true"></i>
            <div class="related-card-content">
                <span class="related-card-category">${article.category}</span>
                <h3>${article.title}</h3>
                <p>${article.description}</p>
            </div>
        </a>`;
}

function findRelatedArticles(currentSlug, articlesDb) {
  const current = articlesDb.articles.find(a => a.slug === currentSlug);
  
  if (!current) {
    // Fallback: Zufällige Artikel wenn kein Match
    return articlesDb.articles
      .filter(a => a.slug !== currentSlug)
      .slice(0, RELATED_COUNT);
  }

  const currentTags = current.tags || [];
  
  // Scoring: Mehr gemeinsame Tags = höherer Score
  const scored = articlesDb.articles
    .filter(a => a.slug !== currentSlug)
    .map(article => {
      const commonTags = (article.tags || []).filter(tag => currentTags.includes(tag));
      const categoryBonus = article.category === current.category ? 2 : 0;
      return {
        ...article,
        score: commonTags.length + categoryBonus
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, RELATED_COUNT);
}

async function injectRelated() {
  try {
    console.log('🔗 Lade Related-Articles-Template...');
    const relatedTemplate = await fs.readFile(RELATED_TEMPLATE_PATH, 'utf-8');
    const articlesDb = JSON.parse(await fs.readFile(ARTICLES_DB_PATH, 'utf-8'));

    const files = await fs.readdir(PUBLIC_DIR);
    const htmlFiles = files.filter(file => file.endsWith('.html'));

    console.log(`🔍 Gefunden: ${htmlFiles.length} HTML-Dateien`);
    console.log(`📚 Artikel-Datenbank: ${articlesDb.articles.length} Einträge`);

    for (const file of htmlFiles) {
      const filePath = path.join(PUBLIC_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      const $ = cheerio.load(content);
      const placeholder = $('#related-placeholder');

      if (placeholder.length > 0) {
        // Slug aus Dateiname extrahieren
        const currentSlug = file.replace('.html', '');
        
        // Related Articles finden
        const relatedArticles = findRelatedArticles(currentSlug, articlesDb);
        
        // HTML generieren
        const relatedItemsHtml = relatedArticles
          .map(article => generateRelatedItemHtml(article))
          .join('\n');
        
        const relatedHtml = relatedTemplate.replace('{{RELATED_ITEMS}}', relatedItemsHtml);
        
        placeholder.replaceWith(relatedHtml);
        
        await fs.writeFile(filePath, $.html(), 'utf-8');
        console.log(`✅ Related injiziert in: ${file} (${relatedArticles.map(a => a.slug).join(', ')})`);
      } else {
        console.log(`⏭️ Kein Related-Placeholder in: ${file}`);
      }
    }
    
    console.log('🎉 Related-Articles-Injektion abgeschlossen!');

  } catch (error) {
    console.error('❌ Fehler:', error);
    process.exit(1);
  }
}

injectRelated();
