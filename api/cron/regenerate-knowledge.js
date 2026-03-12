// api/cron/regenerate-knowledge.js
// Vektor-DB Sync: Holt die bereits gebaute knowledge.json und lädt Sektionen in Upstash Vector
// Läuft täglich um 3:00 Uhr nachts (Europe/Vienna) ODER manuell via Dashboard-Button
//
// ARCHITEKTUR:
//   Build-Time:  generate-knowledge.js → crawlt HTML → erzeugt knowledge.json (mit Sektionen + Einleitungen)
//   Runtime:     regenerate-knowledge.js (diese Datei) → holt knowledge.json → erzeugt Embeddings → Upstash Upload
//
// Warum nicht direkt crawlen? Serverless Functions haben keinen Zugriff auf statische HTML-Dateien.

import { Index } from "@upstash/vector";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { redis } from '../../lib/redis.js';

// Vercel Pro: bis zu 5 Minuten
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

// ── FIX: Immer die Produktions-Domain verwenden ──
// req.headers.host liefert bei Cron-Jobs die interne Vercel-Preview-URL,
// die durch Vercel Authentication (HTTP 401) geschützt ist.
// Daher: Env-Variable mit Fallback auf Produktions-Domain.
const SITE_HOST = process.env.SITE_URL || 'designare.at';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const vectorIndex = new Index({
    url: process.env.UPSTASH_VECTOR_REST_URL,
    token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

// ===================================================================
// HELPER: Tags normalisieren (String → Array)
// ===================================================================
function normalizeTags(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags.map(t => t.trim()).filter(Boolean);
    if (typeof tags === 'string') {
        // Komma-separierter String → Array
        return tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    return [];
}

export default async function handler(req, res) {
    // ── Auth: Nur Vercel Cron oder Bearer Secret ──
    const authHeader = req.headers.authorization;
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const hasValidSecret = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;

    if (!isVercelCron && !hasValidSecret) {
        console.log('Unauthorized cron attempt blocked');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('🚀 Vektor-DB Sync: Starte...');
    const startTime = Date.now();

    try {
        // ==========================================
        // 1. KNOWLEDGE.JSON LADEN
        // ==========================================
        // FIX: Stabile Produktions-URL statt req.headers.host
        const knowledgeUrl = `https://${SITE_HOST}/knowledge.json`;

        console.log(`📥 Lade ${knowledgeUrl}...`);

        const jsonResponse = await fetch(knowledgeUrl);
        if (!jsonResponse.ok) {
            throw new Error(`knowledge.json nicht erreichbar: HTTP ${jsonResponse.status} von ${knowledgeUrl}. Wurde "npm run build" ausgeführt?`);
        }

        const knowledgeData = await jsonResponse.json();
        const pages = knowledgeData.pages || [];

        if (pages.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'knowledge.json enthält keine Seiten',
                timestamp: new Date().toISOString()
            });
        }

        console.log(`✅ ${pages.length} Seiten aus knowledge.json geladen`);

        // ── Dynamische Excludes aus Redis (Dashboard-Feature) ──
        let dynamicExcludes = [];
        try {
            dynamicExcludes = await redis.smembers('build:exclude:urls') || [];
            if (dynamicExcludes.length > 0) {
                console.log(`🚫 ${dynamicExcludes.length} Seiten via Dashboard ausgeschlossen: ${dynamicExcludes.join(', ')}`);
            }
        } catch (redisError) {
            console.warn('⚠️  Redis Exclude-Abfrage fehlgeschlagen:', redisError.message);
        }

        // Seiten filtern (Dashboard-Excludes)
        const filteredPages = dynamicExcludes.length > 0
            ? pages.filter(page => !dynamicExcludes.some(slug =>
                page.slug === slug || page.url === `/${slug}.html` || page.url === `/${slug}`
              ))
            : pages;

        console.log(`📄 ${filteredPages.length} Seiten nach Exclude-Filter`);

        // ==========================================
        // 1b. KNOWLEDGE-BASE CHUNKS AUS REDIS LADEN
        // ==========================================
        let kbChunkCount = 0;
        try {
            const kbSlugs = await redis.smembers('kb:_index') || [];
            if (kbSlugs.length > 0) {
                console.log(`📚 ${kbSlugs.length} Knowledge-Base Chunks gefunden: ${kbSlugs.join(', ')}`);
                const chunkResults = await Promise.all(
                    kbSlugs.map(slug => redis.get(`kb:${slug}`).catch(() => null))
                );
                for (let i = 0; i < kbSlugs.length; i++) {
                    const raw = chunkResults[i];
                    if (!raw) {
                        console.warn(`⚠️  KB-Chunk kb:${kbSlugs[i]} ist leer/null – übersprungen`);
                        continue;
                    }
                    try {
                        const chunk = typeof raw === 'string' ? JSON.parse(raw) : raw;

                        // Validierung: Content muss vorhanden sein
                        if (!chunk.content || chunk.content.trim().length < 20) {
                            console.warn(`⚠️  KB-Chunk kb:${kbSlugs[i]} hat zu wenig Content (${(chunk.content || '').length} Zeichen) – übersprungen`);
                            continue;
                        }

                        // FIX: Tags defensiv normalisieren (String ODER Array → immer Array)
                        const tags = normalizeTags(chunk.tags);

                        // Content ZUERST, Tags am Ende – sonst verwässern Tags das Embedding
                        const tagSuffix = tags.length > 0
                            ? `\nStichworte: ${tags.join(', ')}`
                            : '';

                        filteredPages.push({
                            title: chunk.title,
                            slug: `kb-${kbSlugs[i]}`,
                            url: null,
                            text: `${chunk.content}${tagSuffix}`,
                            sections: [],
                            type: 'knowledge-base',
                            tags
                        });
                        kbChunkCount++;
                        console.log(`   📚 KB-Chunk geladen: "${chunk.title}" (${chunk.content.length} Zeichen, ${tags.length} Tags)`);
                    } catch (parseErr) {
                        console.warn(`⚠️  KB-Chunk kb:${kbSlugs[i]} nicht parsbar:`, parseErr.message);
                    }
                }
                console.log(`✅ ${kbChunkCount} KB-Chunks als Seiten hinzugefügt → ${filteredPages.length} Seiten total`);
            } else {
                console.log('ℹ️  Keine Knowledge-Base Chunks in Redis gefunden (kb:_index leer)');
            }
        } catch (kbError) {
            console.warn('⚠️  Knowledge-Base Laden fehlgeschlagen:', kbError.message);
        }

        // ==========================================
        // 2. UPSTASH VECTOR UPLOAD (Section-Chunking)
        // ==========================================
        console.log('🚀 Starte Embedding & Upload...');
        const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

        let uploadedChunks = 0;
        let uploadErrors = 0;
        const errors = [];

        // Reset: Sauberer Neuaufbau
        try {
            await vectorIndex.reset();
            console.log('🗑️  Vector-DB zurückgesetzt');
        } catch (resetError) {
            console.error('⚠️  Vector-DB Reset fehlgeschlagen:', resetError.message);
        }

        for (const page of filteredPages) {
            const sections = page.sections || [];

            if (sections.length === 0) {
                // ── FALLBACK: Seite ohne Sektionen → ganzer Text als ein Chunk ──
                const textToEmbed = `${page.title}\n${page.text || ''}`.substring(0, 4000);

                try {
                    const result = await embeddingModel.embedContent(textToEmbed);
                    const vector = result.embedding.values.slice(0, 768);

                    // FIX: Kein `data` Feld mehr – nur `vector` + `metadata`
                    // `data` triggert Upstash's eingebautes Embedding und kann
                    // bei Custom-Vektor-Indizes zu Konflikten führen
                    await vectorIndex.upsert({
                        id: `page_${page.slug}`,
                        vector,
                        metadata: {
                            title: page.title,
                            url: page.url || (page.type === 'knowledge-base' ? null : `/${page.slug}.html`),
                            section_heading: null,
                            content: (page.text || '').substring(0, 2000),
                            type: page.type || 'page'
                        }
                    });

                    uploadedChunks++;
                    const typeLabel = page.type === 'knowledge-base' ? 'KB-Chunk' : 'Seiten-Vektor';
                    console.log(`   📤 ${page.slug} (${typeLabel}, ${textToEmbed.length} Zeichen)`);
                    await new Promise(r => setTimeout(r, 300));

                } catch (err) {
                    uploadErrors++;
                    errors.push({ file: page.slug, error: err.message });
                    console.error(`   ❌ ${page.slug}: ${err.message}`);
                }

            } else {
                // ── SECTION-CHUNKING: Ein Vektor pro Sektion (inkl. Einleitung) ──
                for (let s = 0; s < sections.length; s++) {
                    const section = sections[s];
                    const textToEmbed = `${page.title} – ${section.heading}\n${section.content}`;

                    try {
                        const result = await embeddingModel.embedContent(textToEmbed);
                        const vector = result.embedding.values.slice(0, 768);

                        // FIX: Kein `data` Feld mehr
                        await vectorIndex.upsert({
                            id: `section_${page.slug}__${s}`,
                            vector,
                            metadata: {
                                title: page.title,
                                url: page.url || (page.type === 'knowledge-base' ? null : `/${page.slug}.html`),
                                section_heading: section.heading,
                                content: section.content,
                                type: page.type || 'page'
                            }
                        });

                        uploadedChunks++;
                        console.log(`   📤 ${page.slug} → §${s}: "${section.heading.substring(0, 50)}"`);
                        await new Promise(r => setTimeout(r, 300));

                    } catch (err) {
                        uploadErrors++;
                        errors.push({ file: `${page.slug}__${s}`, error: err.message });
                        console.error(`   ❌ ${page.slug} §${s}: ${err.message}`);
                    }
                }
            }
        }

        // ==========================================
        // 3. ERGEBNIS
        // ==========================================
        const processingTime = Date.now() - startTime;
        const stats = {
            total_pages: filteredPages.length,
            kb_chunks: kbChunkCount,
            vector_chunks: uploadedChunks,
            vector_upload_errors: uploadErrors,
            processing_time_ms: processingTime
        };

        console.log(`\n✅ Vektor-DB Sync abgeschlossen:`);
        console.log(`   📄 ${filteredPages.length} Seiten (davon ${kbChunkCount} KB-Chunks)`);
        console.log(`   📤 ${uploadedChunks} Chunks hochgeladen`);
        if (uploadErrors > 0) console.log(`   ❌ ${uploadErrors} Fehler`);
        console.log(`   ⏱️  ${processingTime}ms`);

        return res.status(200).json({
            success: true,
            message: `${uploadedChunks} Chunks aus ${filteredPages.length} Seiten in Vektor-DB geladen`,
            stats,
            errors: errors.length > 0 ? errors : undefined,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Vektor-DB Sync Fehler:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}
