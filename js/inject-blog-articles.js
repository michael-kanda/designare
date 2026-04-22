// js/inject-blog-articles.js
// Injiziert FAQ-Style Cards in blog.html
// Ausführen: node js/inject-blog-articles.js

import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');
const ARTICLES_DB_PATH = path.join(__dirname, '../articles-db.json');

// FAQ Card HTML generieren
function generateFaqCard(article) {
    // HTML-Entities escapen für Schema.org
    const answerEscaped = article.answer
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    return `
                <a href="${article.slug}.html" class="faq-card">
                    <div class="faq-card-icon">
                        <i class="${article.icon}" aria-hidden="true"></i>
                    </div>
                    <div class="faq-card-content">
                        <span class="faq-card-category">${article.category}</span>
                        <h2>${article.question}</h2>
                        <p>${article.answer}</p>
                        <span class="faq-card-link">Zur Antwort <i class="fa-solid fa-arrow-right"></i></span>
                    </div>
                </a>`;
}

// Schema.org FAQ generieren
function generateFaqSchema(articles) {
    return articles.map(article => ({
        "@type": "Question",
        "name": article.question,
        "acceptedAnswer": {
            "@type": "Answer",
            "text": `${article.answer} <a href="https://designare.at/${article.slug}.html">Mehr erfahren</a>`
        }
    }));
}

async function injectBlogArticles() {
    try {
        const blogPath = path.join(PUBLIC_DIR, 'blog.html');
        
        try {
            await fs.access(blogPath);
            await fs.access(ARTICLES_DB_PATH);
        } catch {
            console.log('⚠️ blog.html oder articles-db.json nicht gefunden');
            return;
        }

        console.log('📚 Lade Artikel-Datenbank...');
        const articlesDb = JSON.parse(await fs.readFile(ARTICLES_DB_PATH, 'utf-8'));
        const articles = articlesDb.articles || [];
        
        console.log(`   ${articles.length} Artikel gefunden\n`);

        // HTML generieren
        let faqHtml = `
            <section class="faq-cards-section" aria-label="Häufige Fragen">
                <div class="faq-cards-grid">
${articles.map(a => generateFaqCard(a)).join('\n')}
                </div>
            </section>`;

        // blog.html laden und Placeholder ersetzen
        console.log('📝 Verarbeite blog.html...');
        const content = await fs.readFile(blogPath, 'utf-8');
        const $ = cheerio.load(content);
        
        const placeholder = $('#blog-faq-placeholder');
        if (placeholder.length > 0) {
            placeholder.replaceWith(faqHtml);
            console.log('   ✅ FAQ-Cards injiziert');
            
            // Schema.org FAQPage aktualisieren
            const scriptTags = $('script[type="application/ld+json"]');
            scriptTags.each((i, el) => {
                try {
                    const jsonContent = $(el).html();
                    const schema = JSON.parse(jsonContent);
                    
                    if (schema['@graph']) {
                        const faqIndex = schema['@graph'].findIndex(item => 
                            item['@type'] === 'FAQPage'
                        );
                        
                        if (faqIndex !== -1) {
                            schema['@graph'][faqIndex].mainEntity = generateFaqSchema(articles);
                            $(el).html(JSON.stringify(schema, null, 2));
                            console.log('   ✅ Schema.org FAQPage aktualisiert');
                        }
                    }
                } catch (e) {
                    // JSON Parse Fehler ignorieren
                }
            });
            
            await fs.writeFile(blogPath, $.html(), 'utf-8');
            console.log('   ✅ blog.html gespeichert\n');
        } else {
            console.log('   ⚠️ Kein #blog-faq-placeholder gefunden\n');
        }

        console.log('🎉 Blog-Injektion abgeschlossen!');

    } catch (error) {
        console.error('❌ Fehler:', error);
        process.exit(1);
    }
}

injectBlogArticles();
