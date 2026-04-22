// js/inject-lazy-loading.js
// Fügt loading="lazy" zu allen Bildern hinzu (außer LCP-Bilder mit fetchpriority="high")
// Ausführen: node js/inject-lazy-loading.js

import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, '../public');

async function injectLazyLoading() {
    console.log('🖼️  Lazy Loading Injection...\n');
    
    try {
        const files = await fs.readdir(PUBLIC_DIR);
        const htmlFiles = files.filter(f => f.endsWith('.html'));
        
        let totalImages = 0;
        let modifiedImages = 0;
        let skippedImages = 0;

        for (const file of htmlFiles) {
            const filePath = path.join(PUBLIC_DIR, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const $ = cheerio.load(content);
            
            let fileModified = false;
            
            $('img').each((i, el) => {
                totalImages++;
                const $img = $(el);
                
                // Skip wenn bereits loading Attribut gesetzt
                if ($img.attr('loading')) {
                    skippedImages++;
                    return;
                }
                
                // Skip LCP-Bilder (fetchpriority="high")
                if ($img.attr('fetchpriority') === 'high') {
                    skippedImages++;
                    return;
                }
                
                // Skip Bilder im ersten sichtbaren Bereich (above the fold Heuristik)
                // - Bilder in Header
                // - Erste Bilder in Hero-Sections
                const parent = $img.parent();
                const isInHeader = $img.closest('header').length > 0;
                const isProfilePic = $img.hasClass('profile-picture');
                
                if (isInHeader || isProfilePic) {
                    skippedImages++;
                    return;
                }
                
                // Lazy loading hinzufügen
                $img.attr('loading', 'lazy');
                modifiedImages++;
                fileModified = true;
            });
            
            if (fileModified) {
                await fs.writeFile(filePath, $.html(), 'utf-8');
                console.log(`   ✅ ${file}`);
            }
        }
        
        console.log(`\n📊 Ergebnis:`);
        console.log(`   ${totalImages} Bilder gefunden`);
        console.log(`   ${modifiedImages} mit lazy loading versehen`);
        console.log(`   ${skippedImages} übersprungen (LCP/Header/bereits gesetzt)`);
        console.log('\n🎉 Fertig!');
        
    } catch (error) {
        console.error('❌ Fehler:', error);
        process.exit(1);
    }
}

injectLazyLoading();
