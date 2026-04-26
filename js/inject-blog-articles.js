// js/inject-blog-articles.js
// Automatische FAQ-Card-Injektion für blog.html
// Single Source of Truth: Schema.org JSON-LD in den Artikel-HTML-Dateien selbst.
// Keine articles-db.json mehr nötig.
//
// Ausführen: node js/inject-blog-articles.js

import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');
const BLOG_FILE  = 'blog.html'; // wird selbst nicht als Artikel gewertet

// Welche Schema.org @types zählen als Blog-Artikel?
const ARTICLE_TYPES = ['TechArticle', 'Article', 'BlogPosting', 'NewsArticle'];

// =================================================================
// Category & Icon Mapping (Slug-/Keyword-basiert)
// Reihenfolge = Priorität. Erstes Match gewinnt. SPEZIFISCH ZUERST!
// =================================================================
const CATEGORY_MAP = [
    { match: /wordpress|gutenberg|pagebuilder|plugin/i,        category: 'WordPress',   icon: 'fa-brands fa-wordpress' },
    { match: /googlebot|google-?bot|crawl|2mb-grenze/i,        category: 'SEO',         icon: 'fa-solid fa-magnifying-glass-chart' },
    { match: /schema-org|maschinenlesbarkeit|geo-/i,           category: 'GEO',         icon: 'fa-solid fa-brain' },
    { match: /ki-traffic|traffic-messen|ga4|analytics/i,       category: 'Analytics',   icon: 'fa-solid fa-chart-line' },
    { match: /mcp-server|mcp-/i,                               category: 'Tech',        icon: 'fa-solid fa-server' },
    { match: /serverless|api-/i,                               category: 'Tech',        icon: 'fa-solid fa-server' },
    { match: /performance|speed|core-web-vitals|web-vitals/i,  category: 'Performance', icon: 'fa-solid fa-gauge-high' },
    { match: /seo|meta-description|search-console/i,           category: 'SEO',         icon: 'fa-solid fa-magnifying-glass-chart' },
    { match: /ki|chatgpt|gemini|llm|ai-|assistent/i,           category: 'KI',          icon: 'fa-solid fa-robot' },
];
const DEFAULT_CATEGORY = { category: 'Allgemein', icon: 'fa-solid fa-newspaper' };

function getCategoryAndIcon(slug) {
    for (const entry of CATEGORY_MAP) {
        if (entry.match.test(slug)) {
            return { category: entry.category, icon: entry.icon };
        }
    }
    return DEFAULT_CATEGORY;
}

// =================================================================
// Schema.org JSON-LD Parsing
// =================================================================
function findArticleBlock(json) {
    if (!json) return null;
    const candidates = (json['@graph'] && Array.isArray(json['@graph']))
        ? json['@graph']
        : [json];
    return candidates.find(item => {
        const t = item?.['@type'];
        if (!t) return false;
        if (Array.isArray(t)) return t.some(x => ARTICLE_TYPES.includes(x));
        return ARTICLE_TYPES.includes(t);
    });
}

async function extractArticle(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const $ = cheerio.load(content);

        let articleBlock = null;
        $('script[type="application/ld+json"]').each((_, el) => {
            if (articleBlock) return;
            try {
                const json = JSON.parse($(el).html());
                const found = findArticleBlock(json);
                if (found) articleBlock = found;
            } catch { /* ungültiges JSON-LD ignorieren */ }
        });

        if (!articleBlock) return null;

        const headline    = articleBlock.headline;
        const description = articleBlock.description;
        if (!headline || !description) return null;

        const slug = path.basename(filePath, '.html');
        const { category, icon } = getCategoryAndIcon(slug);

        return {
            slug,
            question:      headline,
            answer:        description,
            category,
            icon,
            datePublished: articleBlock.datePublished || null,
            dateModified:  articleBlock.dateModified  || null,
        };
    } catch {
        return null;
    }
}

// =================================================================
// HTML- und Schema-Generierung
// =================================================================
function generateFaqCard(article) {
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

function generateItemListSchema(articles) {
    return articles.map((article, idx) => ({
        "@type": "ListItem",
        "position": idx + 1,
        "url": `https://designare.at/${article.slug}.html`,
        "item": {
            "@type": "TechArticle",
            "headline": article.question,
            "description": article.answer,
            "url": `https://designare.at/${article.slug}.html`
        }
    }));
}

// =================================================================
// Haupt-Logik
// =================================================================
async function injectBlogArticles() {
    try {
        const blogPath = path.join(PUBLIC_DIR, BLOG_FILE);
        await fs.access(blogPath);

        // 1. public/ scannen
        console.log('🔍 Scanne public/ nach Artikeln...');
        const allFiles  = await fs.readdir(PUBLIC_DIR);
        const htmlFiles = allFiles.filter(f => f.endsWith('.html') && f !== BLOG_FILE);

        // 2. Aus jeder Datei (parallel) Artikel-Daten extrahieren
        const results  = await Promise.all(
            htmlFiles.map(f => extractArticle(path.join(PUBLIC_DIR, f)))
        );
        const articles = results.filter(Boolean);

        console.log(`   ${articles.length} von ${htmlFiles.length} Dateien sind Artikel\n`);
        if (articles.length === 0) {
            console.log('⚠️ Keine Artikel gefunden. Abbruch.');
            return;
        }

        // 3. Sortieren: dateModified DESC, dann datePublished DESC, dann slug
        articles.sort((a, b) => {
            const da = a.dateModified || a.datePublished || '';
            const db = b.dateModified || b.datePublished || '';
            if (db !== da) return db.localeCompare(da);
            return a.slug.localeCompare(b.slug);
        });

        articles.forEach(a => console.log(`   • [${a.category.padEnd(11)}] ${a.slug}`));
        console.log('');

        // 4. Section-HTML generieren
        const faqHtml = `
            <section class="faq-cards-section" aria-label="Artikel-Übersicht">
                <div class="faq-cards-grid">
${articles.map(generateFaqCard).join('\n')}
                </div>
            </section>`;

        // 5. blog.html laden, Placeholder-Inhalt frisch befüllen (idempotent)
        console.log('📝 Verarbeite blog.html...');
        const content = await fs.readFile(blogPath, 'utf-8');
        const $ = cheerio.load(content, { decodeEntities: false });

        const placeholder = $('#blog-faq-placeholder');
        if (placeholder.length === 0) {
            console.log('   ❌ Kein <div id="blog-faq-placeholder"> in blog.html gefunden');
            console.log('      Bitte in blog.html einfügen, damit das Script weiß, wohin.');
            process.exit(1);
        }
        placeholder.html(faqHtml); // Wrapper bleibt → idempotent
        console.log('   ✅ FAQ-Cards injiziert');

        // 6. Schema.org ItemList aktualisieren
        $('script[type="application/ld+json"]').each((_, el) => {
            try {
                const schema = JSON.parse($(el).html());
                if (!schema['@graph']) return;
                const listIndex = schema['@graph'].findIndex(item => item['@type'] === 'ItemList');
                if (listIndex === -1) return;
                schema['@graph'][listIndex].itemListElement = generateItemListSchema(articles);
                $(el).html(JSON.stringify(schema, null, 2));
                console.log('   ✅ Schema.org ItemList aktualisiert');
            } catch { /* ungültiges JSON-LD ignorieren */ }
        });

        await fs.writeFile(blogPath, $.html(), 'utf-8');
        console.log('   ✅ blog.html gespeichert\n');
        console.log('🎉 Blog-Injektion abgeschlossen!');

    } catch (error) {
        console.error('❌ Fehler:', error);
        process.exit(1);
    }
}

injectBlogArticles();
