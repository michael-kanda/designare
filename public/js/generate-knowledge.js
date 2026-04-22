// js/generate-knowledge.js - VERBESSERTE VERSION
// Mehr Content, bessere Struktur, semantische Keywords

import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

const HTML_DIR = './'; 
const OUTPUT_FILE = './knowledge.json';

// Dateien die NICHT indexiert werden sollen
const EXCLUDE_FILES = [
    '404.html', 
    'impressum.html', 
    'datenschutz.html',
    'disclaimer.html'
];

// Partials/Templates die keine eigenständigen Seiten sind
const EXCLUDE_PARTIALS = [
    'header.html',
    'footer.html',
    'modals.html',
    'side-menu.html',
    'blog-feedback.html'
];

// Maximale Textlänge pro Sektion (in Zeichen)
const MAX_SECTION_LENGTH = 2000;
const MAX_TOTAL_LENGTH = 8000;

/**
 * Extrahiert sauberen Text ohne HTML-Tags und übermäßige Whitespaces
 */
function cleanText(text) {
    return text
        .replace(/\s+/g, ' ')           // Mehrfache Whitespaces zu einem
        .replace(/\n+/g, ' ')           // Newlines zu Spaces
        .replace(/\t+/g, ' ')           // Tabs zu Spaces
        .trim();
}

/**
 * Extrahiert Keywords aus dem Text für bessere Suche
 */
function extractKeywords(text, title) {
    // Stopwörter die ignoriert werden
    const stopwords = new Set([
        'der', 'die', 'das', 'und', 'oder', 'aber', 'wenn', 'weil', 'dass',
        'ein', 'eine', 'einer', 'einem', 'einen', 'ist', 'sind', 'war', 'waren',
        'wird', 'werden', 'wurde', 'wurden', 'hat', 'haben', 'hatte', 'hatten',
        'kann', 'können', 'konnte', 'konnten', 'muss', 'müssen', 'musste',
        'nicht', 'auch', 'noch', 'schon', 'nur', 'sehr', 'mehr', 'als', 'wie',
        'bei', 'bis', 'für', 'mit', 'nach', 'über', 'unter', 'vor', 'von', 'zu',
        'auf', 'aus', 'durch', 'gegen', 'ohne', 'um', 'an', 'in', 'im', 'am',
        'den', 'dem', 'des', 'dir', 'dich', 'mir', 'mich', 'sich', 'uns', 'euch',
        'ihr', 'ihre', 'ihrer', 'ihrem', 'ihren', 'sein', 'seine', 'seiner',
        'dein', 'deine', 'deiner', 'deinem', 'deinen', 'unser', 'unsere',
        'hier', 'dort', 'dann', 'wann', 'wo', 'was', 'wer', 'welche', 'welcher',
        'dieser', 'diese', 'dieses', 'diesem', 'diesen', 'jeder', 'jede', 'jedes',
        'alle', 'allem', 'allen', 'aller', 'alles', 'andere', 'anderen', 'anderer',
        'viel', 'viele', 'vielen', 'vieler', 'wenig', 'wenige', 'wenigen',
        'gut', 'neue', 'neuen', 'neuer', 'ersten', 'erste', 'erster'
    ]);

    // Kombiniere Title und Text
    const combined = `${title} ${text}`.toLowerCase();
    
    // Extrahiere Wörter (min. 3 Zeichen)
    const words = combined.match(/[a-zäöüß]{3,}/g) || [];
    
    // Zähle Worthäufigkeit (ohne Stopwörter)
    const wordCount = {};
    words.forEach(word => {
        if (!stopwords.has(word) && word.length > 3) {
            wordCount[word] = (wordCount[word] || 0) + 1;
        }
    });
    
    // Sortiere nach Häufigkeit und nimm Top 15
    const keywords = Object.entries(wordCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([word]) => word);
    
    return keywords;
}

/**
 * Extrahiert strukturierte Inhalte aus einer HTML-Datei
 */
function extractContent($, filename) {
    const content = {
        title: '',
        slug: filename.replace('.html', ''),
        url: `/${filename}`,
        meta_description: '',
        headings: [],
        sections: [],
        text: '',
        keywords: [],
        type: 'page'
    };

    // Titel extrahieren (Priorität: h1 > title > filename)
    content.title = $('h1').first().text().trim() || 
                    $('title').text().trim() || 
                    filename.replace('.html', '').replace(/-/g, ' ');

    // Meta Description
    content.meta_description = $('meta[name="description"]').attr('content') || '';

    // Bestimme Seitentyp
    if ($('article').length > 0) {
        content.type = 'article';
    } else if (filename === 'index.html') {
        content.type = 'homepage';
    } else if (filename.toLowerCase().includes('blog')) {
        content.type = 'blog';
    }

    // Extrahiere alle Überschriften mit ihrem Content
    $('h1, h2, h3').each((i, el) => {
        const heading = $(el).text().trim();
        if (heading && heading.length > 2) {
            content.headings.push({
                level: el.tagName.toLowerCase(),
                text: heading
            });
        }
    });

    // Extrahiere Sektionen basierend auf H2-Überschriften
    $('h2').each((i, el) => {
        const sectionTitle = $(el).text().trim();
        let sectionContent = '';
        
        // Sammle Content bis zur nächsten H2
        let next = $(el).next();
        while (next.length && !next.is('h2')) {
            if (next.is('p, li, span, div')) {
                const text = next.text().trim();
                if (text) {
                    sectionContent += text + ' ';
                }
            }
            next = next.next();
        }
        
        if (sectionTitle && sectionContent) {
            content.sections.push({
                heading: sectionTitle,
                content: cleanText(sectionContent).substring(0, MAX_SECTION_LENGTH)
            });
        }
    });

    // Haupt-Textinhalt extrahieren
    // Priorität: article > main > .content > body
    let mainContent = $('article').text() || 
                      $('main').text() || 
                      $('.content').text() || 
                      $('body').text();

    // Entferne Script/Style Inhalte die eventuell mitgekommen sind
    $('script, style, nav, header, footer, .modal, #side-menu-panel').remove();
    mainContent = $('article').text() || $('main').text() || $('body').text();

    content.text = cleanText(mainContent).substring(0, MAX_TOTAL_LENGTH);

    // Keywords extrahieren
    content.keywords = extractKeywords(content.text, content.title);

    // Füge manuelle Keywords basierend auf Dateinamen hinzu
    const filenameKeywords = filename
        .replace('.html', '')
        .split('-')
        .filter(w => w.length > 2);
    content.keywords = [...new Set([...content.keywords, ...filenameKeywords])];

    return content;
}

/**
 * Generiert einen kompakten Such-Index für schnellere Abfragen
 */
function generateSearchIndex(knowledgeBase) {
    const searchIndex = {};
    
    knowledgeBase.forEach((page, pageIndex) => {
        // Indexiere jedes Keyword
        page.keywords.forEach(keyword => {
            if (!searchIndex[keyword]) {
                searchIndex[keyword] = [];
            }
            searchIndex[keyword].push(pageIndex);
        });
        
        // Indexiere auch Wörter aus dem Titel
        const titleWords = page.title.toLowerCase().match(/[a-zäöüß]{3,}/g) || [];
        titleWords.forEach(word => {
            if (!searchIndex[word]) {
                searchIndex[word] = [];
            }
            if (!searchIndex[word].includes(pageIndex)) {
                searchIndex[word].push(pageIndex);
            }
        });
    });
    
    return searchIndex;
}

/**
 * Hauptfunktion
 */
async function generateKnowledge() {
    console.log('🚀 Starte Knowledge-Base Generierung...\n');
    
    // Finde alle HTML-Dateien
    const allFiles = fs.readdirSync(HTML_DIR).filter(file => file.endsWith('.html'));
    
    // Filtere Excludes
    const files = allFiles.filter(file => 
        !EXCLUDE_FILES.includes(file) && 
        !EXCLUDE_PARTIALS.includes(file)
    );

    console.log(`📄 Gefunden: ${allFiles.length} HTML-Dateien`);
    console.log(`📄 Indexiere: ${files.length} Seiten (${allFiles.length - files.length} ausgeschlossen)\n`);

    const knowledgeBase = [];
    let totalKeywords = 0;
    let totalSections = 0;

    for (const file of files) {
        try {
            const filePath = path.join(HTML_DIR, file);
            const html = fs.readFileSync(filePath, 'utf8');
            const $ = cheerio.load(html);

            const content = extractContent($, file);

            if (content.text && content.text.length > 100) {
                knowledgeBase.push(content);
                totalKeywords += content.keywords.length;
                totalSections += content.sections.length;
                
                console.log(`✅ ${file}`);
                console.log(`   → Titel: "${content.title.substring(0, 50)}..."`);
                console.log(`   → ${content.keywords.length} Keywords, ${content.sections.length} Sektionen`);
                console.log(`   → ${content.text.length} Zeichen Content\n`);
            } else {
                console.log(`⏭️  ${file} - Zu wenig Content, übersprungen\n`);
            }
        } catch (error) {
            console.error(`❌ Fehler bei ${file}:`, error.message, '\n');
        }
    }

    // Generiere Such-Index
    const searchIndex = generateSearchIndex(knowledgeBase);

    // Erstelle finale Ausgabe
    const output = {
        generated_at: new Date().toISOString(),
        stats: {
            total_pages: knowledgeBase.length,
            total_keywords: totalKeywords,
            total_sections: totalSections
        },
        pages: knowledgeBase,
        search_index: searchIndex
    };

    // Speichere als JSON
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    
    // Erstelle auch eine kompakte Version für Production
    const compactOutput = {
        pages: knowledgeBase.map(page => ({
            title: page.title,
            slug: page.slug,
            text: page.text,
            keywords: page.keywords,
            sections: page.sections
        })),
        search_index: searchIndex
    };
    fs.writeFileSync('./knowledge.min.json', JSON.stringify(compactOutput));

    console.log('═'.repeat(50));
    console.log(`✅ Knowledge-Base erfolgreich erstellt!`);
    console.log(`   📊 ${knowledgeBase.length} Seiten indexiert`);
    console.log(`   🔑 ${totalKeywords} Keywords extrahiert`);
    console.log(`   📑 ${totalSections} Sektionen erfasst`);
    console.log(`   💾 Gespeichert in: ${OUTPUT_FILE}`);
    console.log(`   💾 Kompakt-Version: knowledge.min.json`);
    console.log('═'.repeat(50));
}

generateKnowledge().catch(console.error);
