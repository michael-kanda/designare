// js/generate-articles-db.js
// Scannt alle Blog-HTML-Dateien und generiert articles-db.json automatisch
// Ausführen: node js/generate-articles-db.js (VOR den inject-Scripts)

import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'articles-db.json');

// Dateien die NICHT Blog-Artikel sind
const EXCLUDED_FILES = [
    'index.html',
    'blog.html',
    'disclaimer.html',
    'impressum.html',
    'datenschutz.html',
    'kontakt.html',
    '404.html'
];

// Standard-Kategorien mit Icons
const CATEGORY_ICONS = {
    "WordPress": "fa-brands fa-wordpress",
    "Webentwicklung": "fa-solid fa-code",
    "SEO": "fa-solid fa-magnifying-glass",
    "GEO": "fa-solid fa-brain",
    "KI": "fa-solid fa-robot",
    "Tools": "fa-solid fa-toolbox"
};

// Kategorie aus Tags erraten falls nicht angegeben
function guessCategory(tags, title, description) {
    const text = `${tags.join(' ')} ${title} ${description}`.toLowerCase();
    
    if (text.includes('wordpress') || text.includes('plugin')) return 'WordPress';
    if (text.includes('geo') || text.includes('maschinenles')) return 'GEO';
    if (text.includes('seo') || text.includes('search')) return 'SEO';
    if (text.includes('ki') || text.includes('chatbot') || text.includes('serverless')) return 'KI';
    if (text.includes('tool') || text.includes('dashboard') || text.includes('csv')) return 'Tools';
    if (text.includes('html') || text.includes('code') || text.includes('markup')) return 'Webentwicklung';
    
    return 'Webentwicklung'; // Default
}

// Icon für Kategorie
function getCategoryIcon(category) {
    return CATEGORY_ICONS[category] || 'fa-solid fa-file-lines';
}

// Text kürzen für Answer
function truncateText(text, maxLength = 200) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength).replace(/\s+\S*$/, '') + '...';
}

// HTML-Datei parsen und Artikel-Daten extrahieren
async function parseArticle(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const $ = cheerio.load(content);
    const slug = path.basename(filePath, '.html');
    
    // Article-Element finden
    const article = $('article').first();
    
    // Basis-Daten
    const h1 = $('h1').first();
    const title = h1.find('.article-white').length > 0
        ? h1.clone().find('.article-white').remove().end().text().trim() + ' ' + h1.find('.article-white').text().trim()
        : h1.text().trim();
    
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    
    // Data-Attribute vom <article>
    const dataCategory = article.attr('data-category') || '';
    const dataIcon = article.attr('data-icon') || '';
    const dataTags = article.attr('data-tags') || '';
    const dataQuestion = article.attr('data-question') || '';
    const dataAnswer = article.attr('data-answer') || '';
    
    // Tags parsen
    const tags = dataTags 
        ? dataTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
        : [];
    
    // Kategorie bestimmen
    const category = dataCategory || guessCategory(tags, title, metaDesc);
    
    // Icon bestimmen
    const icon = dataIcon || getCategoryIcon(category);
    
    // Question generieren falls nicht vorhanden
    let question = dataQuestion;
    if (!question && title) {
        // Einfache Heuristik: Titel in Frage umwandeln
        if (title.toLowerCase().includes('vs') || title.toLowerCase().includes('oder')) {
            question = `${title}: Wo liegt der Unterschied?`;
        } else if (title.toLowerCase().includes('warum')) {
            question = title.endsWith('?') ? title : `${title}?`;
        } else {
            question = `Was ist ${title}?`;
        }
    }
    
    // Answer: data-answer oder Meta-Description oder Intro-Text
    let answer = dataAnswer;
    if (!answer) {
        // Versuche ersten Absatz nach H1 zu finden
        const introP = $('article p').first().text().trim();
        answer = truncateText(introP || metaDesc, 250);
    }
    
    return {
        slug,
        title: title.replace(/\s+/g, ' ').trim(),
        description: metaDesc,
        question,
        answer,
        category,
        icon,
        tags
    };
}

async function generateArticlesDb() {
    console.log('🔍 Scanne HTML-Dateien...\n');
    
    try {
        // Alle HTML-Dateien im Root finden
        const files = await fs.readdir(ROOT_DIR);
        const htmlFiles = files.filter(f => 
            f.endsWith('.html') && 
            !EXCLUDED_FILES.includes(f)
        );
        
        console.log(`   ${htmlFiles.length} potenzielle Artikel gefunden\n`);
        
        const articles = [];
        const skipped = [];
        
        for (const file of htmlFiles) {
            const filePath = path.join(ROOT_DIR, file);
            
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const $ = cheerio.load(content);
                
                // Prüfen ob es ein Blog-Artikel ist (hat <article> und H1)
                const hasArticle = $('article').length > 0;
                const hasH1 = $('h1').length > 0;
                const hasBlogMain = $('#blog-main').length > 0 || $('article.blog-article').length > 0;
                
                if (hasArticle && hasH1 && hasBlogMain) {
                    const article = await parseArticle(filePath);
                    
                    // Nur hinzufügen wenn Title vorhanden
                    if (article.title) {
                        articles.push(article);
                        console.log(`   ✅ ${file}`);
                        console.log(`      → "${article.question}"`);
                    } else {
                        skipped.push({ file, reason: 'Kein Titel' });
                    }
                } else {
                    skipped.push({ file, reason: 'Kein Blog-Artikel' });
                }
            } catch (err) {
                skipped.push({ file, reason: err.message });
            }
        }
        
        // Sortieren nach Slug
        articles.sort((a, b) => a.slug.localeCompare(b.slug));
        
        // articles-db.json erstellen
        const db = {
            articles,
            categories: CATEGORY_ICONS
        };
        
        await fs.writeFile(OUTPUT_PATH, JSON.stringify(db, null, 2), 'utf-8');
        
        console.log(`\n📝 articles-db.json erstellt:`);
        console.log(`   ${articles.length} Artikel`);
        console.log(`   ${Object.keys(CATEGORY_ICONS).length} Kategorien\n`);
        
        if (skipped.length > 0) {
            console.log(`⏭️  Übersprungen (${skipped.length}):`);
            skipped.forEach(s => console.log(`   - ${s.file}: ${s.reason}`));
        }
        
        console.log('\n🎉 Fertig!');
        
    } catch (error) {
        console.error('❌ Fehler:', error);
        process.exit(1);
    }
}

generateArticlesDb();
