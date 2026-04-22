// lib/rag-service.js - RAG-Kontext via Upstash Vector (Section-Chunking)
// 🚀 OPTIMIERT: Lazy Diagnostics – info()-Call nur bei leeren Ergebnissen
// Sucht relevante Sektionen aus Website-Inhalten zur User-Frage
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Index } from "@upstash/vector";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

// Embedding-Modell (einmalig pro Cold-Start)
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

// Seiten die nie als Link vorgeschlagen werden sollen
const LINK_BLACKLIST = ['CSV-Creator', 'CSV-Importer-PRO'];

// Links die immer verfügbar sein sollen
const PERMANENT_LINKS = [
  { url: '/ki-sichtbarkeit', title: 'KI-Sichtbarkeits-Check' }
];

const MIN_SCORE = 0.45;
const MAX_CONTENT_LENGTH = 1500;
const MIN_CONTENT_LENGTH = 50;

/**
 * Notfall-Diagnose: Wird NUR aufgerufen wenn die Query 0 Ergebnisse liefert.
 * Prüft ob die DB leer ist oder andere Infrastruktur-Probleme vorliegen.
 */
async function diagnoseEmptyResults(queryVector) {
  try {
    const indexInfo = await vectorIndex.info();
    console.error(`🩺 Notfall-Diagnose: ${indexInfo.vectorCount} Vektoren | Dimension: ${indexInfo.dimension} | Pending: ${indexInfo.pendingVectorCount}`);

    if (indexInfo.vectorCount === 0) {
      console.error('🩺 ❌ URSACHE: Vector-DB ist LEER! (0 Vektoren)');
    } else if (indexInfo.pendingVectorCount > 0) {
      console.error(`🩺 ⚠️ ${indexInfo.pendingVectorCount} Vektoren noch PENDING (nicht querybar)`);
    } else if (indexInfo.dimension !== queryVector.length) {
      console.error(`🩺 ❌ URSACHE: Dimension-Mismatch! Index: ${indexInfo.dimension}, Query: ${queryVector.length}`);
    } else {
      console.error(`🩺 ❓ DB hat ${indexInfo.vectorCount} Vektoren, Dimensionen passen – Scores vermutlich alle unter Schwelle`);
    }
  } catch (err) {
    console.error('🩺 ❌ Notfall-Diagnose fehlgeschlagen:', err.message);
  }
}

/**
 * Sucht RAG-Kontext zur User-Nachricht.
 */
export async function searchContext(userMessage, currentPage = null) {
  let additionalContext = '';
  let availableLinks = [];

  try {
    // ═══════════════════════════════════════════════
    // SCHRITT 1: Embedding generieren
    // ═══════════════════════════════════════════════
    console.log("🔍 [1/3] Embedding für:", userMessage.substring(0, 80));
    const embedStart = Date.now();
    const embedResult = await embeddingModel.embedContent(userMessage);
    const embedTime = Date.now() - embedStart;

    const rawValues = embedResult?.embedding?.values;
    if (!rawValues || rawValues.length === 0) {
      console.error('❌ Embedding ist LEER! Gemini hat keine Vektoren zurückgegeben.');
      return { additionalContext: '', availableLinks: [] };
    }

    const queryVector = rawValues.slice(0, 768);
    console.log(`🔍 [1/3] Embedding OK: ${queryVector.length} Dimensionen | ${embedTime}ms`);

    // ═══════════════════════════════════════════════
    // SCHRITT 2: Vector-Query
    // ═══════════════════════════════════════════════
    console.log("🔍 [2/3] Query an Upstash (topK=8)...");
    const queryStart = Date.now();
    const queryResult = await vectorIndex.query({
      vector: queryVector,
      topK: 8,
      includeMetadata: true
    });
    const queryTime = Date.now() - queryStart;

    console.log(`🔍 [2/3] Query OK: ${queryResult?.length ?? 0} Ergebnisse in ${queryTime}ms`);

    // Keine Ergebnisse → Lazy Diagnostics auslösen
    if (!queryResult || queryResult.length === 0) {
      console.error('❌ 0 Ergebnisse – starte Notfall-Diagnose...');
      await diagnoseEmptyResults(queryVector);
      return { additionalContext: '', availableLinks: [] };
    }

    // ═══════════════════════════════════════════════
    // SCHRITT 3: Filtern + Kontext bauen
    // ═══════════════════════════════════════════════
    console.log('🔍 [3/3] Scores:', queryResult.map(m =>
      `${m.id} → ${m.score.toFixed(3)}${m.score > MIN_SCORE ? ' ✓' : ' ✗'}`
    ).join(' | '));

    const matchedChunks = queryResult
      .filter(match => match.score > MIN_SCORE)
      .filter(match => {
        const content = match.metadata?.content || '';
        if (content.trim().length < MIN_CONTENT_LENGTH) {
          console.log(`⏭️ Chunk "${match.id}" übersprungen – zu wenig Content (${content.trim().length} Zeichen)`);
          return false;
        }
        return true;
      })
      .slice(0, 5)
      .map(match => match.metadata);

    if (matchedChunks.length > 0) {
      console.log(`✅ ${matchedChunks.length} Chunks gefunden:`,
        matchedChunks.map(c =>
          `"${c.title}${c.section_heading ? ` – ${c.section_heading}` : ''}"${c.type === 'knowledge-base' ? ' [KB]' : ''}`
        ).join(', ')
      );

      additionalContext = matchedChunks.map((chunk, i) => {
        let header = `[Quelle ${i + 1}] ${chunk.title}`;
        if (chunk.section_heading) header += ` – ${chunk.section_heading}`;
        if (chunk.url) header += ` (${chunk.url})`;
        const contentToUse = chunk.content ? chunk.content.substring(0, MAX_CONTENT_LENGTH).trim() : '';
        return `${header}\n${contentToUse}`;
      }).join('\n---\n');

      const currentPath = currentPage ? currentPage.replace(/\/$/, '') : '';

      const seenUrls = new Set();
      availableLinks = matchedChunks
        .filter(c => c.url && !LINK_BLACKLIST.some(s => c.url.includes(s)))
        .filter(c => !currentPath || !c.url.includes(currentPath))
        .filter(c => {
          if (seenUrls.has(c.url)) return false;
          seenUrls.add(c.url);
          return true;
        })
        .map(c => ({ url: c.url, title: c.title }));
    } else {
      const best = queryResult[0];
      console.log(`⚠️ Alle ${queryResult.length} Ergebnisse unter Schwelle ${MIN_SCORE}. Bestes: ${best.id} → ${best.score.toFixed(3)}`);
    }

  } catch (error) {
    console.error('❌ RAG / Vector Fehler:', error.message);
    console.error('🩺 Error-Typ:', error.constructor.name);
    console.error('🩺 Stack:', error.stack?.split('\n').slice(0, 3).join(' → '));
    if (error.cause) console.error('🩺 Cause:', error.cause);
  }

  // Permanente Links hinzufügen
  for (const pl of PERMANENT_LINKS) {
    const isCurrentPage = currentPage && currentPage.replace(/\/$/, '') === pl.url;
    const alreadyIncluded = availableLinks.some(l => l.url === pl.url);
    if (!isCurrentPage && !alreadyIncluded) availableLinks.push(pl);
  }

  return { additionalContext, availableLinks };
}
