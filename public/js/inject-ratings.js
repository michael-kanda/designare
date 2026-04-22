#!/usr/bin/env node
// js/inject-ratings.js
// Injiziert AggregateRating in alle HTML-Dateien vor dem Build/Deploy
//
// AUTOMATISCH: Findet selbständig alle HTML-Dateien mit feedback-placeholder
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
    
    // Alle Schema.org Typen die ein AggregateRating bekommen können
    supportedSchemaTypes: [
        'BlogPosting',
        'Article',
        'NewsArticle',
        'TechArticle',
        'HowTo',
        'Review',
        'Product',
        'LocalBusiness',
        'WebPage'
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
        // Sucht nach dem feedback-placeholder div
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
                'User-Agent': 'Rating-Injector/1.0'
            },
            // Timeout nach 10 Sekunden
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

// JSON-LD im HTML finden und aktualisieren
function injectRatingIntoHtml(htmlContent, aggregateRating) {
    if (!aggregateRating) return { html: htmlContent, changed: false };
    
    // Regex um JSON-LD Scripts zu finden
    const jsonLdRegex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
    
    let changed = false;
    
    const updatedHtml = htmlContent.replace(jsonLdRegex, (match, jsonContent) => {
        try {
            const schema = JSON.parse(jsonContent);
            
            // Prüfen ob es ein unterstützter Schema-Typ ist
            if (CONFIG.supportedSchemaTypes.includes(schema['@type'])) {
                
                // Prüfen ob sich das Rating geändert hat
                const existingRating = schema.aggregateRating;
                const newRatingValue = aggregateRating.ratingValue;
                const newRatingCount = aggregateRating.ratingCount;
                
                if (!existingRating || 
                    existingRating.ratingValue !== newRatingValue ||
                    existingRating.ratingCount !== newRatingCount) {
                    
                    schema.aggregateRating = aggregateRating;
                    changed = true;
                    
                    // Formatiert zurückgeben (4 Spaces Indent passend zum HTML)
                    const jsonStr = JSON.stringify(schema, null, 2);
                    const indentedJson = jsonStr.split('\n').map(line => '    ' + line).join('\n');
                    return `<script type="application/ld+json">\n${indentedJson}\n    </script>`;
                }
            }
            
            return match; // Unverändert zurückgeben
            
        } catch (e) {
            // JSON Parse Fehler - unverändert lassen
            console.warn('  ⚠️  Konnte JSON-LD nicht parsen:', e.message);
            return match;
        }
    });
    
    return { html: updatedHtml, changed };
}

// === HAUPTFUNKTION ===

async function main() {
    console.log('\n🚀 Rating-Injection gestartet (Auto-Discovery)');
    console.log('═'.repeat(50));
    console.log(`   API: ${CONFIG.apiBaseUrl}`);
    console.log(`   Verzeichnis: ${CONFIG.htmlDir}\n`);
    
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
        console.log('   Tipp: Füge <div id="feedback-placeholder"></div> zu deinen Blog-Artikeln hinzu.\n');
        return;
    }
    
    console.log(`📄 ${filesWithFeedback.length} Datei(en) mit Feedback-Widget gefunden:\n`);
    filesWithFeedback.forEach(f => console.log(`   • ${f}`));
    console.log('');
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
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
            
            // 3. Rating injizieren
            const { html: updatedHtml, changed } = injectRatingIntoHtml(htmlContent, rating);
            
            if (changed) {
                // 4. Datei speichern
                fs.writeFileSync(filepath, updatedHtml, 'utf-8');
                console.log(`✅ ${rating.ratingValue}⭐ (${rating.ratingCount} Bewertungen)`);
                updatedCount++;
            } else {
                console.log('⏭️  Schema bereits aktuell');
                skippedCount++;
            }
            
        } catch (error) {
            console.log(`❌ Fehler: ${error.message}`);
            errorCount++;
        }
    }
    
    // Zusammenfassung
    console.log('\n' + '═'.repeat(50));
    console.log('📊 Zusammenfassung:');
    console.log(`   🔍 Gefunden:     ${filesWithFeedback.length} Dateien`);
    console.log(`   ✅ Aktualisiert: ${updatedCount}`);
    console.log(`   ⏭️  Übersprungen: ${skippedCount}`);
    if (errorCount > 0) {
        console.log(`   ❌ Fehler:       ${errorCount}`);
    }
    console.log('═'.repeat(50) + '\n');
    
    // Kein Exit-Error bei 0 Updates (ist normal bei erstem Run ohne Bewertungen)
    if (errorCount > 0) {
        process.exit(1);
    }
}

// Script ausführen
main().catch(error => {
    console.error('❌ Kritischer Fehler:', error);
    process.exit(1);
});
