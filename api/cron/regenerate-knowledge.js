// api/cron/regenerate-knowledge.js
// Vektor-DB Sync: Holt die bereits gebaute knowledge.json und lädt Sektionen in Upstash Vector
// Läuft täglich um 03:30 UTC (≈ 05:30 Wien Sommerzeit / 04:30 Winterzeit) ODER manuell via Dashboard-Button
// Vercel Crons laufen immer in UTC – Zeitzone lässt sich dort nicht konfigurieren.
//
// ARCHITEKTUR:
//   Build-Time:  generate-knowledge.js → crawlt HTML → erzeugt knowledge.json (mit Sektionen + Einleitungen)
//   Runtime:     regenerate-knowledge.js (diese Datei) → holt knowledge.json → erzeugt Embeddings → Upstash Upload
//
// Warum nicht direkt crawlen? Serverless Functions haben keinen Zugriff auf statische HTML-Dateien.
//
// ═══════════════════════════════════════════════════════════════════
// FIX: SAFE-SYNC statt RESET
// ═══════════════════════════════════════════════════════════════════
// Alt:  reset() → alle Vektoren löschen → neu hochladen
//       Problem: Wenn Upload abbricht (Timeout, API-Fehler), bleibt DB halbleer
//
// Neu:  upsert() → bestehende überschreiben → am Ende Orphans löschen
//       Vorteil: Bei Abbruch bleiben die alten Daten erhalten
// ═══════════════════════════════════════════════════════════════════

import { Index } from "@upstash/vector";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { redis } from '../../lib/redis.js';

// Vercel Pro: bis zu 5 Minuten
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

// ── FIX: Immer die Produktions-Domain verwenden ──
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
        return tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    return [];
}

// ===================================================================
// HELPER: Alle existierenden IDs aus dem Vector-Index holen
// ===================================================================
async function getAllExistingIds() {
    const allIds = [];
    let cursor = '0';

    // Upstash range() paginiert – alle Seiten durchlaufen
    do {
        const result = await vectorIndex.range({
            cursor,
            limit: 100,
            includeMetadata: false,
            includeVectors: false
        });

        for (const item of result.vectors || []) {
            allIds.push(item.id);
        }

        cursor = result.nextCursor || '';
    } while (cursor && cursor !== '0' && cursor !== '');

    return allIds;
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

    console.log('🚀 Vektor-DB Sync (Safe-Sync): Starte...');
    const startTime = Date.now();

    try {
        // ==========================================
        // 1. KNOWLEDGE.JSON LADEN
        // ==========================================
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

                        if (!chunk.content || chunk.content.trim().length < 20) {
                            console.warn(`⚠️  KB-Chunk kb:${kbSlugs[i]} hat zu wenig Content (${(chunk.content || '').length} Zeichen) – übersprungen`);
                            continue;
                        }

                        const tags = normalizeTags(chunk.tags);
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
        // 2. UPSTASH VECTOR UPLOAD (Safe-Sync)
        // ==========================================
        console.log('🚀 Starte Embedding & Upload (Safe-Sync – kein Reset!)...');
        const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

        let uploadedChunks = 0;
        let uploadErrors = 0;
        const errors = [];

        // ═══════════════════════════════════════════════════════════
        // SAFE-SYNC: Alle erfolgreich hochgeladenen IDs tracken
        // Am Ende werden nur Orphans gelöscht (IDs die nicht mehr
        // in knowledge.json / KB vorkommen)
        // ═══════════════════════════════════════════════════════════
        const uploadedIds = new Set();

        for (const page of filteredPages) {
            const sections = page.sections || [];

            if (sections.length === 0) {
                // ── FALLBACK: Seite ohne Sektionen → ganzer Text als ein Chunk ──
                const chunkId = `page_${page.slug}`;
                const textToEmbed = `${page.title}\n${page.text || ''}`.substring(0, 4000);

                try {
                    const result = await embeddingModel.embedContent(textToEmbed);
                    const vector = result.embedding.values.slice(0, 768);

                    await vectorIndex.upsert({
                        id: chunkId,
                        vector,
                        metadata: {
                            title: page.title,
                            url: page.url || (page.type === 'knowledge-base' ? null : `/${page.slug}.html`),
                            section_heading: null,
                            content: (page.text || '').substring(0, 2000),
                            type: page.type || 'page'
                        }
                    });

                    uploadedIds.add(chunkId);
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
                // ── SECTION-CHUNKING: Ein Vektor pro Sektion ──
                for (let s = 0; s < sections.length; s++) {
                    const section = sections[s];
                    const chunkId = `section_${page.slug}__${s}`;
                    const textToEmbed = `${page.title} – ${section.heading}\n${section.content}`;

                    try {
                        const result = await embeddingModel.embedContent(textToEmbed);
                        const vector = result.embedding.values.slice(0, 768);

                        await vectorIndex.upsert({
                            id: chunkId,
                            vector,
                            metadata: {
                                title: page.title,
                                url: page.url || (page.type === 'knowledge-base' ? null : `/${page.slug}.html`),
                                section_heading: section.heading,
                                content: section.content,
                                type: page.type || 'page'
                            }
                        });

                        uploadedIds.add(chunkId);
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
        // 2b. ORPHAN-CLEANUP: Veraltete Vektoren entfernen
        // ==========================================
        // Nur aufräumen wenn der Upload großteils geklappt hat
        // (Sicherheitsnetz: bei >20% Fehlern kein Cleanup → alte Daten bleiben)
        let orphansDeleted = 0;
        const totalExpected = uploadedChunks + uploadErrors;
        const errorRate = totalExpected > 0 ? uploadErrors / totalExpected : 0;

        if (errorRate > 0.2) {
            console.warn(`⚠️  Orphan-Cleanup übersprungen: Fehlerrate ${(errorRate * 100).toFixed(0)}% zu hoch (${uploadErrors}/${totalExpected}). Alte Daten bleiben erhalten.`);
        } else {
            try {
                console.log('🧹 Orphan-Cleanup: Suche veraltete Vektoren...');
                const existingIds = await getAllExistingIds();
                const orphanIds = existingIds.filter(id => !uploadedIds.has(id));

                if (orphanIds.length > 0) {
                    // Upstash delete() akzeptiert Arrays
                    await vectorIndex.delete(orphanIds);
                    orphansDeleted = orphanIds.length;
                    console.log(`🧹 ${orphansDeleted} Orphans gelöscht: ${orphanIds.join(', ')}`);
                } else {
                    console.log('🧹 Keine Orphans gefunden – DB ist sauber');
                }
            } catch (cleanupErr) {
                // Cleanup-Fehler sind unkritisch – alte Daten stören nicht
                console.warn('⚠️  Orphan-Cleanup fehlgeschlagen (unkritisch):', cleanupErr.message);
            }
        }

        // ==========================================
        // 2c. VERIFICATION: Prüfen ob KB-Chunks wirklich da sind
        // ==========================================
        // Sicherheitsnetz: Nach dem Sync stichprobenartig prüfen ob
        // die Knowledge-Base Chunks tatsächlich in der Vector-DB gelandet sind.
        // Schreibt Warnung ins Build-Log wenn was fehlt.
        let verificationResult = { status: 'ok', missing: [], checked: 0, found: 0 };

        if (kbChunkCount > 0) {
            try {
                console.log('🔍 Verification: Prüfe ob KB-Chunks in Vector-DB vorhanden...');
                const allIdsAfterSync = await getAllExistingIds();
                const allIdSet = new Set(allIdsAfterSync);

                // KB-Chunks haben IDs wie "page_kb-{slug}"
                const expectedKbIds = filteredPages
                    .filter(p => p.type === 'knowledge-base')
                    .map(p => `page_${p.slug}`);

                const missingKbIds = expectedKbIds.filter(id => !allIdSet.has(id));
                verificationResult.checked = expectedKbIds.length;
                verificationResult.found = expectedKbIds.length - missingKbIds.length;

                if (missingKbIds.length > 0) {
                    verificationResult.status = 'warning';
                    verificationResult.missing = missingKbIds;
                    console.error(`🚨 VERIFICATION FAILED: ${missingKbIds.length}/${expectedKbIds.length} KB-Chunks fehlen in Vector-DB!`);
                    console.error(`   Fehlende IDs: ${missingKbIds.join(', ')}`);

                    // Warnung ins Build-Log schreiben (sichtbar im Dashboard)
                    const warningEntry = {
                        timestamp: new Date().toISOString(),
                        trigger: 'verification-warning',
                        status: 'warning',
                        message: `${missingKbIds.length} KB-Chunks fehlen nach Sync: ${missingKbIds.join(', ')}`,
                        details: { expected: expectedKbIds.length, found: verificationResult.found, missing: missingKbIds }
                    };
                    await redis.lpush('build:log:triggers', JSON.stringify(warningEntry));
                    await redis.ltrim('build:log:triggers', 0, 99);
                } else {
                    console.log(`✅ Verification OK: Alle ${expectedKbIds.length} KB-Chunks sind in der Vector-DB`);
                }

                // Zusätzlich: Gesamtzahl prüfen (sind auch HTML-Seiten da?)
                const expectedTotal = uploadedIds.size;
                const actualTotal = allIdsAfterSync.length;
                if (actualTotal < expectedTotal * 0.8) {
                    console.warn(`⚠️  Vector-DB hat nur ${actualTotal} von ${expectedTotal} erwarteten Vektoren (< 80%)`);
                    verificationResult.status = 'warning';
                }

            } catch (verifyErr) {
                console.warn('⚠️  Verification fehlgeschlagen (unkritisch):', verifyErr.message);
                verificationResult.status = 'error';
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
            orphans_deleted: orphansDeleted,
            processing_time_ms: processingTime,
            verification: verificationResult
        };

        console.log(`\n✅ Vektor-DB Sync (Safe-Sync) abgeschlossen:`);
        console.log(`   📄 ${filteredPages.length} Seiten (davon ${kbChunkCount} KB-Chunks)`);
        console.log(`   📤 ${uploadedChunks} Chunks hochgeladen (upsert)`);
        if (orphansDeleted > 0) console.log(`   🧹 ${orphansDeleted} veraltete Vektoren entfernt`);
        if (uploadErrors > 0) console.log(`   ❌ ${uploadErrors} Fehler`);
        if (verificationResult.checked > 0) {
            const icon = verificationResult.status === 'ok' ? '✅' : '🚨';
            console.log(`   ${icon} Verification: ${verificationResult.found}/${verificationResult.checked} KB-Chunks bestätigt`);
        }
        console.log(`   ⏱️  ${processingTime}ms`);

        return res.status(200).json({
            success: true,
            message: `${uploadedChunks} Chunks aus ${filteredPages.length} Seiten in Vektor-DB geladen (${orphansDeleted} Orphans entfernt)`,
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
