// js/build.js
// Kombiniertes Build-Script: Footer, Breadcrumb, Related Articles
// Ausführen: node js/build.js

import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Konfiguration
const SRC_DIR = path.join(__dirname, '../src');       // Quell-Dateien mit Placeholdern
const PUBLIC_DIR = path.join(__dirname, '../public'); // Ziel-Ordner (fertige Dateien)
const TEMPLATES_DIR = path.join(__dirname, '..');     // Templates (footer.html, etc.)

// Template-Pfade
const FOOTER_PATH = path.join(TEMPLATES_DIR, 'footer.html');
const BREADCRUMB_PATH = path.join(TEMPLATES_DIR, 'breadcrumb.html');
const RELATED_PATH = path.join(TEMPLATES_DIR, 'related-articles.html');
const ARTICLES_DB_PATH = path.join(TEMPLATES_DIR, 'articles-db.json');

// Related Articles Konfiguration
const RELATED_COUNT = 3;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function generateRelatedItemHtml(article) {
  return `
        <a href="${article.slug}.html" class="related-card">
            <i class="${article.icon}" aria-hidden="true"></i>
            <div class="related-card-content">
                <span class="related-card-category">${article.category}</span>
                <h3>${article.title}</h3>
                <p>${article.description}</p>
            </div>
        </a>`;
}

function findRelatedArticles(currentSlug, currentTags, articlesDb) {
  // Scoring basierend auf gemeinsamen Tags
  const scored = articlesDb.articles
    .filter(a => a.slug !== currentSlug)
    .map(article => {
      const commonTags = (article.tags || []).filter(tag => currentTags.includes(tag));
      return { ...article, score: commonTags.length };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, RELATED_COUNT);
}

function extractArticleTitle($) {
  const h1 = $('article.blog-article h1');
  if (h1.length === 0) return 'Artikel';
  
  // Text vor dem ersten ":" oder span nehmen
  let title = h1.clone().children('span').remove().end().text().trim();
  if (!title) {
    title = h1.text().trim().split(':')[0].trim();
  }
  return title;
}

function extractArticleTags($) {
  const article = $('article.blog-article');
  const tagsAttr = article.attr('data-tags');
  if (tagsAttr) {
    return tagsAttr.split(',').map(t => t.trim());
  }
  return [];
}

// ============================================================
// MAIN BUILD FUNCTION
// ============================================================

async function build() {
  console.log('🚀 Build gestartet...\n');

  try {
    // Templates laden
    console.log('📄 Lade Templates...');
    const footerHtml = await fs.readFile(FOOTER_PATH, 'utf-8');
    const breadcrumbTemplate = await fs.readFile(BREADCRUMB_PATH, 'utf-8');
    const relatedTemplate = await fs.readFile(RELATED_PATH, 'utf-8');
    const articlesDb = JSON.parse(await fs.readFile(ARTICLES_DB_PATH, 'utf-8'));
    console.log(`   ✓ ${articlesDb.articles.length} Artikel in der Datenbank\n`);

    // Public-Ordner erstellen falls nicht vorhanden
    await fs.mkdir(PUBLIC_DIR, { recursive: true });

    // Alle HTML-Dateien im src-Ordner finden
    const files = await fs.readdir(SRC_DIR);
    const htmlFiles = files.filter(file => file.endsWith('.html'));
    console.log(`🔍 ${htmlFiles.length} HTML-Dateien gefunden\n`);

    // Jede Datei verarbeiten
    for (const file of htmlFiles) {
      console.log(`📝 Verarbeite: ${file}`);
      
      const srcPath = path.join(SRC_DIR, file);
      const destPath = path.join(PUBLIC_DIR, file);
      const content = await fs.readFile(srcPath, 'utf-8');
      const $ = cheerio.load(content);
      const currentSlug = file.replace('.html', '');

      // 1. FOOTER injizieren
      const footerPlaceholder = $('#footer-placeholder');
      if (footerPlaceholder.length > 0) {
        footerPlaceholder.replaceWith(footerHtml);
        console.log('   ✓ Footer injiziert');
      }

      // 2. BREADCRUMB injizieren
      const breadcrumbPlaceholder = $('#breadcrumb-placeholder');
      if (breadcrumbPlaceholder.length > 0) {
        const articleTitle = extractArticleTitle($);
        const breadcrumbHtml = breadcrumbTemplate.replace('{{ARTICLE_TITLE}}', articleTitle);
        breadcrumbPlaceholder.replaceWith(breadcrumbHtml);
        console.log(`   ✓ Breadcrumb injiziert ("${articleTitle}")`);
      }

      // 3. RELATED ARTICLES injizieren
      const relatedPlaceholder = $('#related-placeholder');
      if (relatedPlaceholder.length > 0) {
        const currentTags = extractArticleTags($);
        const relatedArticles = findRelatedArticles(currentSlug, currentTags, articlesDb);
        
        if (relatedArticles.length > 0) {
          const relatedItemsHtml = relatedArticles.map(a => generateRelatedItemHtml(a)).join('\n');
          const relatedHtml = relatedTemplate.replace('{{RELATED_ITEMS}}', relatedItemsHtml);
          relatedPlaceholder.replaceWith(relatedHtml);
          console.log(`   ✓ Related injiziert (${relatedArticles.map(a => a.slug).join(', ')})`);
        } else {
          relatedPlaceholder.remove();
          console.log('   ⚠ Keine Related Articles gefunden');
        }
      }

      // Datei in public speichern
      await fs.writeFile(destPath, $.html(), 'utf-8');
      console.log(`   ✓ Gespeichert: public/${file}\n`);
    }

    console.log('🎉 Build abgeschlossen!');
    console.log(`   ${htmlFiles.length} Dateien verarbeitet → public/`);

  } catch (error) {
    console.error('❌ Build-Fehler:', error);
    process.exit(1);
  }
}

build();
