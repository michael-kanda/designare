#!/usr/bin/env node
// js/inject-ratings.js
// Injiziert AggregateRating in alle HTML-Dateien vor dem Build/Deploy
// 
// WICHTIG: AggregateRating ist nur für bestimmte Schema.org Typen erlaubt!
// Google lehnt Ratings für BlogPosting, Article, NewsArticle etc. ab.
//
// Verwendung:
//   node js/inject-ratings.js
//   oder automatisch via "build" in package.json

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module __dirname Workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// === KONFIGURATION ===
const CONFIG = {
    // Deine Produktions-URL für API-Calls
    apiBaseUrl: process.env.API_BASE_URL || 'https://designare.at',
    
    // Verzeichnis mit HTML-Dateien (Projekt-Root)
    htmlDir: ROOT_DIR,
    
    // ✅ NUR diese Schema.org Typen dürfen AggregateRating bekommen
    // Quelle: https://developers.google.com/search/docs/appearance/structured-data/review-snippet
    allowedSchemaTypes: [
        // Produkte & Software
        'Product',
        'SoftwareApplication',
        'WebApplication',
        'MobileApplication',
        'VideoGame',
        
        // Business & Organisationen
        'LocalBusiness',
        'Organization',
        'Restaurant',
        'Hotel',
        'Store',
        
        // Medien & Unterhaltung
        'Book',
        'Movie',
        'TVSeries',
        'MusicRecording',
        'MusicAlbum',
        'MediaObject',
        
        // Bildung & Events
        'Course',
        'Event',
        
        // Rezepte
        'Recipe',
        
        // Creative Works (spezifisch erlaubte)
        'CreativeWorkSeason',
        'CreativeWorkSeries'
    ],
    
    // ❌ Diese Typen NIEMALS mit AggregateRating versehen
    // Google gibt hier explizit Fehler aus!
    blockedSchemaTypes: [
        'BlogPosting',
        'Article',
        'NewsArticle',
        'TechArticle',
        'ScholarlyArticle',
        'Report',
        'HowTo',
        'FAQPage',
        'QAPage',
        'WebPage',
        'CollectionPage',
        'ItemPage',
        'AboutPage',
        'ContactPage',
        'Review',           // Review HAT ein Rating, bekommt aber kein AggregateRating
        'Person',
        'ImageGallery'
    ],
    
    // Dateien die NIE verarbeitet werden sollen (Partials, Templates, etc.)
    excludeFiles: [
        'index.html',
        'header.html',
        'footer.html',
        'modals.html',
        'side-menu.html',
        'blog-feedback.html',
        '404.html'
    ],
    
    // Verzeichnisse die ignoriert werden sollen
    excludeDirs: [
        'node_modules',
        'public',
        '.git',
        '.vercel',
        'api',
        'css',
        'js',
        'images',
        'Font'
    ]
};

// === HELPER FUNKTIONEN ===

// Alle HTML-Dateien im Root-Verzeichnis finden (nicht rekursiv in Unterordner)
function findHtmlFiles(dir) {
    const files = [];
    
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            // Nur Dateien im Root, keine Unterordner
            if (entry.isFile() && entry.name.endsWith('.html')) {
                // Ausgeschlossene Dateien überspringen
                if (!CONFIG.excludeFiles.includes(entry.name)) {
                    files.push(entry.name);
                }
            }
        }
    } catch (error) {
        console.error(`Fehler beim Lesen von ${dir}:`, error.message);
    }
    
    return files;
}

// Prüft ob eine HTML-Datei das Feedback-Widget enthält
function hasFeedbackWidget(filepath) {
    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        return content.includes('id="feedback-placeholder"') || 
               content.includes("id='feedback-placeholder'");
    } catch (error) {
        console.warn(`  ⚠️  Konnte ${filepath} nicht lesen:`, error.message);
        return false;
    }
}

// Slug aus Dateiname generieren (identisch zum Frontend)
function getSlugFromFilename(filename) {
    return filename
        .replace(/\.html?$/, '')
        .replace(/\//g, '-')
        || 'home';
}

// Rating von der API holen
async function fetchRating(slug) {
    const url = `${CONFIG.apiBaseUrl}/api/schema?slug=${encodeURIComponent(slug)}`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Rating-Injector/2.0'
            },
            signal: AbortSignal.timeout(10000)
        });
        
        if (!response.ok) {
            console.warn(`  ⚠️  API returned ${response.status} for ${slug}`);
            return null;
        }
        
        const data = await response.json();
        return data.aggregateRating || null;
        
    } catch (error) {
        if (error.name === 'TimeoutError') {
            console.warn(`  ⚠️  Timeout für ${slug}`);
        } else {
            console.warn(`  ⚠️  Konnte Rating für ${slug} nicht laden:`, error.message);
        }
        return null;
    }
}

// Prüft ob ein Schema-Typ AggregateRating haben darf
function isRatingAllowed(schemaType) {
    // Explizit geblockt?
    if (CONFIG.blockedSchemaTypes.includes(schemaType)) {
        return false;
    }
    // Explizit erlaubt?
    if (CONFIG.allowedSchemaTypes.includes(schemaType)) {
        return true;
    }
    // Im Zweifel: NICHT erlauben (sicherer Ansatz)
    return false;
}

// JSON-LD im HTML finden und aktualisieren
function injectRatingIntoHtml(htmlContent, aggregateRating, filename) {
    if (!aggregateRating) return { html: htmlContent, changed: false, reason: 'no-rating' };
    
    // Regex um JSON-LD Scripts zu finden
    const jsonLdRegex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
    
    let changed = false;
    let reason = 'no-match';
    let foundType = null;
    
    const updatedHtml = htmlContent.replace(jsonLdRegex, (match, jsonContent) => {
        try {
            const schema = JSON.parse(jsonContent);
            
            // Fall 1: Einfaches Schema (kein @graph)
            if (schema['@type'] && !schema['@graph']) {
                foundType = schema['@type'];
                
                if (isRatingAllowed(schema['@type'])) {
                    // Prüfen ob sich das Rating geändert hat
                    const existingRating = schema.aggregateRating;
                    const newRatingValue = aggregateRating.ratingValue;
                    const newRatingCount = aggregateRating.ratingCount;
                    
                    if (!existingRating || 
                        existingRating.ratingValue !== newRatingValue ||
                        existingRating.ratingCount !== newRatingCount) {
                        
                        schema.aggregateRating = aggregateRating;
                        changed = true;
                        reason = 'updated';
                        
                        const jsonStr = JSON.stringify(schema, null, 2);
                        const indentedJson = jsonStr.split('\n').map(line => '    ' + line).join('\n');
                        return `<script type="application/ld+json">\n${indentedJson}\n    </script>`;
                    } else {
                        reason = 'already-current';
                    }
                } else {
                    reason = `blocked-type:${schema['@type']}`;
                }
            }
            
            // Fall 2: @graph Array (mehrere Schemas)
            if (schema['@graph'] && Array.isArray(schema['@graph'])) {
                let graphChanged = false;
                
                for (const node of schema['@graph']) {
                    if (node['@type'] && isRatingAllowed(node['@type'])) {
                        foundType = node['@type'];
                        
                        const existingRating = node.aggregateRating;
                        const newRatingValue = aggregateRating.ratingValue;
                        const newRatingCount = aggregateRating.ratingCount;
                        
                        if (!existingRating || 
                            existingRating.ratingValue !== newRatingValue ||
                            existingRating.ratingCount !== newRatingCount) {
                            
                            node.aggregateRating = aggregateRating;
                            graphChanged = true;
                            changed = true;
                            reason = 'updated';
                        }
                    }
                }
                
                if (graphChanged) {
                    const jsonStr = JSON.stringify(schema, null, 2);
                    const indentedJson = jsonStr.split('\n').map(line => '    ' + line).join('\n');
                    return `<script type="application/ld+json">\n${indentedJson}\n    </script>`;
                }
            }
            
            return match; // Unverändert zurückgeben
            
        } catch (e) {
            console.warn(`  ⚠️  Konnte JSON-LD nicht parsen:`, e.message);
            reason = 'parse-error';
            return match;
        }
    });
    
    return { html: updatedHtml, changed, reason, foundType };
}

// === HAUPTFUNKTION ===

async function main() {
    console.log('\n🚀 Rating-Injection gestartet (v2.0 - Schema-Type-Safe)');
    console.log('═'.repeat(60));
    console.log(`   API: ${CONFIG.apiBaseUrl}`);
    console.log(`   Verzeichnis: ${CONFIG.htmlDir}`);
    console.log(`   Erlaubte Typen: ${CONFIG.allowedSchemaTypes.length}`);
    console.log(`   Geblockte Typen: ${CONFIG.blockedSchemaTypes.length}\n`);
    
    // Prüfen ob API erreichbar ist
    console.log('🔌 Teste API-Verbindung...');
    try {
        const testResponse = await fetch(`${CONFIG.apiBaseUrl}/api/schema?slug=test`, {
            signal: AbortSignal.timeout(5000)
        });
        if (testResponse.ok) {
            console.log('   ✅ API erreichbar\n');
        } else {
            console.log(`   ⚠️  API antwortet mit Status ${testResponse.status}\n`);
        }
    } catch (e) {
        console.log('   ❌ API nicht erreichbar - fahre trotzdem fort\n');
    }
    
    // AUTOMATISCH: Alle HTML-Dateien finden
    console.log('🔍 Suche HTML-Dateien mit Feedback-Widget...\n');
    
    const allHtmlFiles = findHtmlFiles(CONFIG.htmlDir);
    const filesWithFeedback = [];
    
    for (const filename of allHtmlFiles) {
        const filepath = path.join(CONFIG.htmlDir, filename);
        if (hasFeedbackWidget(filepath)) {
            filesWithFeedback.push(filename);
        }
    }
    
    if (filesWithFeedback.length === 0) {
        console.log('ℹ️  Keine Dateien mit Feedback-Widget gefunden.');
        console.log('   Tipp: Füge <div id="feedback-placeholder"></div> zu deinen Seiten hinzu.\n');
        return;
    }
    
    console.log(`📄 ${filesWithFeedback.length} Datei(en) mit Feedback-Widget gefunden:\n`);
    filesWithFeedback.forEach(f => console.log(`   • ${f}`));
    console.log('');
    
    let updatedCount = 0;
    let skippedCount = 0;
    let blockedCount = 0;
    let errorCount = 0;
    
    const blockedFiles = [];
    
    for (const filename of filesWithFeedback) {
        const filepath = path.join(CONFIG.htmlDir, filename);
        const slug = getSlugFromFilename(filename);
        
        process.stdout.write(`   ${filename} (slug: ${slug})... `);
        
        try {
            // 1. Rating von API holen
            const rating = await fetchRating(slug);
            
            if (!rating) {
                console.log('⏭️  Keine Bewertungen vorhanden');
                skippedCount++;
                continue;
            }
            
            // 2. HTML einlesen
            const htmlContent = fs.readFileSync(filepath, 'utf-8');
            
            // 3. Rating injizieren (mit Type-Check!)
            const { html: updatedHtml, changed, reason, foundType } = injectRatingIntoHtml(htmlContent, rating, filename);
            
            if (changed) {
                // 4. Datei speichern
                fs.writeFileSync(filepath, updatedHtml, 'utf-8');
                console.log(`✅ ${rating.ratingValue}⭐ (${rating.ratingCount} Bewertungen) → ${foundType}`);
                updatedCount++;
            } else if (reason.startsWith('blocked-type:')) {
                const blockedType = reason.split(':')[1];
                console.log(`🚫 Schema-Typ "${blockedType}" erlaubt kein AggregateRating`);
                blockedCount++;
                blockedFiles.push({ file: filename, type: blockedType });
            } else if (reason === 'already-current') {
                console.log('⏭️  Schema bereits aktuell');
                skippedCount++;
            } else {
                console.log(`⏭️  Kein passendes Schema gefunden (${reason})`);
                skippedCount++;
            }
            
        } catch (error) {
            console.log(`❌ Fehler: ${error.message}`);
            errorCount++;
        }
    }
    
    // Zusammenfassung
    console.log('\n' + '═'.repeat(60));
    console.log('📊 Zusammenfassung:');
    console.log(`   🔍 Gefunden:     ${filesWithFeedback.length} Dateien`);
    console.log(`   ✅ Aktualisiert: ${updatedCount}`);
    console.log(`   ⏭️  Übersprungen: ${skippedCount}`);
    console.log(`   🚫 Geblockt:     ${blockedCount} (Schema-Typ nicht erlaubt)`);
    if (errorCount > 0) {
        console.log(`   ❌ Fehler:       ${errorCount}`);
    }
    
    // Warnung für geblockte Dateien
    if (blockedFiles.length > 0) {
        console.log('\n' + '─'.repeat(60));
        console.log('⚠️  HINWEIS: Folgende Dateien haben Bewertungen, aber der');
        console.log('   Schema-Typ erlaubt kein AggregateRating (Google-Richtlinie):');
        console.log('');
        for (const { file, type } of blockedFiles) {
            console.log(`   • ${file} → @type: "${type}"`);
        }
        console.log('');
        console.log('   💡 Lösung: Ändere den Schema-Typ auf z.B. "SoftwareApplication"');
        console.log('      oder entferne das Feedback-Widget von Blog-Artikeln.');
    }
    
    console.log('═'.repeat(60) + '\n');
    
    if (errorCount > 0) {
        process.exit(1);
    }
}

// Script ausführen
main().catch(error => {
    console.error('❌ Kritischer Fehler:', error);
    process.exit(1);
});
