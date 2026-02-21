// api/cron/regenerate-knowledge.js
// Automatische Regenerierung der Knowledge-Base UND Vektor-DB Upload via Vercel Cron
// Läuft täglich um 3:00 Uhr nachts (Europe/Vienna)

import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { Index } from "@upstash/vector";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Konfiguration
const CONFIG = {
    htmlDir: process.cwd(),
    outputFile: path.join(process.cwd(), 'knowledge.json'),
    excludeFiles: ['404.html', 'impressum.html', 'datenschutz.html', 'disclaimer.html'],
    excludePartials: ['header.html', 'footer.html', 'modals.html', 'side-menu.html', 'blog-feedback.html'],
    maxSectionLength: 2000,
    maxTotalLength: 8000
};

// Cron-Secret für Sicherheit (verhindert unbefugte Aufrufe)
const CRON_SECRET = process.env.CRON_SECRET;

// API Clients initialisieren (Upstash & Gemini)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

/**
 * Bereinigt Text von HTML und übermäßigen Whitespaces
 */
function cleanText(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, ' ')
        .replace(/\t+/g, ' ')
        .trim();
}

/**
 * Extrahiert Keywords aus Text
 */
function extractKeywords(text, title) {
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

    const combined = `${title} ${text}`.toLowerCase();
    const words = combined.match(/[a-zäöüß]{3,}/g) || [];
    
    const wordCount = {};
    words.forEach(word => {
        if (!stopwords.has(word) && word.length > 3) {
            wordCount[word] = (wordCount[word] || 0) + 1;
        }
    });
    
    return Object.entries(wordCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([word]) => word);
}

/**
 * Extrahiert Content aus HTML-Datei
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
        type: 'page',
        last_indexed: new Date().toISOString()
    };

    content.title = $('h1').first().text().trim() || 
                    $('title').text().trim() || 
                    filename.replace('.html', '').replace(/-/g, ' ');

    content.meta_description = $('meta[name="description"]').attr('content') || '';

    if ($('article').length > 0) content.type = 'article';
    else if (filename === 'index.html') content.type = 'homepage';
    else if (filename.toLowerCase().includes('blog')) content.type = 'blog';

    $('h1, h2, h3').each((i, el) => {
        const heading = $(el).text().trim();
        if (heading && heading.length > 2) {
            content.headings.push({ level: el.tagName.toLowerCase(), text: heading });
        }
    });

    $('h2').each((i, el) => {
        const sectionTitle = $(el).text().trim();
        let sectionContent = '';
        
        let next = $(el).next();
        while (next.length && !next.is('h2')) {
            if (next.is('p, li, span, div')) {
                const text = next.text().trim();
                if (text) sectionContent += text + ' ';
            }
            next = next.next();
        }
        
        if (sectionTitle && sectionContent) {
            content.sections.push({
                heading: sectionTitle,
                content: cleanText(sectionContent).substring(0, CONFIG.maxSectionLength)
            });
        }
    });

    $('script, style, nav, header, footer, .modal, #side-menu-panel').remove();
    const mainContent = $('article').text() || $('main').text() || $('body').text();
    content.text = cleanText(mainContent).substring(0, CONFIG.maxTotalLength);

    content.keywords = extractKeywords(content.text, content.title);
    
    const filenameKeywords = filename.replace('.html', '').split('-').filter(w => w.length > 2);
    content.keywords = [...new Set([...content.keywords, ...filenameKeywords])];

    return content;
}

/**
 * Generiert Such-Index
 */
function generateSearchIndex(knowledgeBase) {
    const searchIndex = {};
    
    knowledgeBase.forEach((page, pageIndex) => {
        page.keywords.forEach(keyword => {
            if (!searchIndex[keyword]) searchIndex[keyword] = [];
            searchIndex[keyword].push(pageIndex);
        });
        
        const titleWords = page.title.toLowerCase().match(/[a-zäöüß]{3,}/g) || [];
        titleWords.forEach(word => {
            if (!searchIndex[word]) searchIndex[word] = [];
            if (!searchIndex[word].includes(pageIndex)) searchIndex[word].push(pageIndex);
        });
    });
    
    return searchIndex;
}

/**
 * Hauptfunktion - wird von Vercel Cron aufgerufen
 */
export default async function handler(req, res) {
    // Sicherheitscheck: Nur Vercel Cron oder mit Secret erlauben
    const authHeader = req.headers.authorization;
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const hasValidSecret = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;
    
    if (!isVercelCron && !hasValidSecret) {
        console.log('Unauthorized cron attempt blocked');
        return res.status(401).json({ 
            error: 'Unauthorized',
            message: 'This endpoint is only accessible via Vercel Cron or with valid authorization'
        });
    }

    console.log('🚀 Cron: Starte Knowledge-Base Regenerierung & Vektor-Upload...');
    const startTime = Date.now();

    try {
        // ==========================================
        // TEIL 1: LOKALES CRAWLING & JSON ERSTELLUNG
        // ==========================================
        let files = [];
        try {
            const allFiles = fs.readdirSync(CONFIG.htmlDir);
            files = allFiles.filter(file => 
                file.endsWith('.html') && 
                !CONFIG.excludeFiles.includes(file) && 
                !CONFIG.excludePartials.includes(file)
            );
        } catch (dirError) {
            // Fallback: Versuche public Verzeichnis
            const publicDir = path.join(CONFIG.htmlDir, 'public');
            if (fs.existsSync(publicDir)) {
                const allFiles = fs.readdirSync(publicDir);
                files = allFiles.filter(file => 
                    file.endsWith('.html') && 
                    !CONFIG.excludeFiles.includes(file) && 
                    !CONFIG.excludePartials.includes(file)
                );
                CONFIG.htmlDir = publicDir;
            }
        }

        if (files.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'Keine HTML-Dateien gefunden',
                timestamp: new Date().toISOString()
            });
        }

        const knowledgeBase = [];
        const errors = [];

        for (const file of files) {
            try {
                const filePath = path.join(CONFIG.htmlDir, file);
                const html = fs.readFileSync(filePath, 'utf8');
                const $ = cheerio.load(html);
                const content = extractContent($, file);

                if (content.text && content.text.length > 100) {
                    knowledgeBase.push(content);
                    console.log(`✅ Indexiert: ${file} (${content.keywords.length} Keywords)`);
                }
            } catch (fileError) {
                errors.push({ file, type: 'parsing_error', error: fileError.message });
                console.error(`❌ Fehler bei ${file}:`, fileError.message);
            }
        }

        // Generiere Such-Index (WICHTIG: War in meiner alten Antwort vergessen)
        const searchIndex = generateSearchIndex(knowledgeBase);

        // Erstelle Output
        const output = {
            generated_at: new Date().toISOString(),
            generated_by: 'cron',
            stats: {
                total_pages: knowledgeBase.length,
                total_keywords: knowledgeBase.reduce((sum, p) => sum + p.keywords.length, 0),
                total_sections: knowledgeBase.reduce((sum, p) => sum + p.sections.length, 0),
                processing_time_ms: 0 // Wird am Ende aktualisiert
            },
            pages: knowledgeBase,
            search_index: searchIndex
        };

        // Speichere JSON lokal
        fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2));
        console.log(`✅ Lokale knowledge.json aktualisiert: ${knowledgeBase.length} Seiten`);

        // ==========================================
        // TEIL 2: UPSTASH VECTOR DATENBANK UPLOAD
        // ==========================================
        console.log("🚀 Starte Upload in die Upstash Vector Datenbank...");
        const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        let uploadErrorsCount = 0;

        for (let i = 0; i < knowledgeBase.length; i++) {
            const page = knowledgeBase[i];
            const textToEmbed = `${page.title}\n${page.text}`;
            
            try {
                const result = await embeddingModel.embedContent(textToEmbed);
                const denseVector = result.embedding.values;

                await vectorIndex.upsert({
                    id: `page_${page.slug}`, // Eindeutige ID basierend auf dem Slug
                    vector: denseVector,
                    data: textToEmbed,
                    metadata: {
                        title: page.title,
                        url: page.url,
                        content: page.text
                    }
                });

                // Vermeide Rate-Limits der Gemini API (300ms warten)
                await new Promise(res => setTimeout(res, 300)); 

            } catch (uploadError) {
                console.error(`❌ Vector-Upload Fehler bei ${page.title}:`, uploadError.message);
                uploadErrorsCount++;
                errors.push({ file: page.slug, type: 'vector_upload_error', error: uploadError.message });
            }
        }

        // Gesamtzeit updaten
        output.stats.processing_time_ms = Date.now() - startTime;
        output.stats.vector_upload_errors = uploadErrorsCount;

        console.log(`✅ Cron Job abgeschlossen in ${output.stats.processing_time_ms}ms`);

        return res.status(200).json({
            success: true,
            message: `Knowledge-Base erfolgreich regeneriert und in Vektor-DB geladen`,
            stats: output.stats,
            errors: errors.length > 0 ? errors : undefined,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Cron Komplettausfall:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
