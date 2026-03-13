// lib/rag-service.js - RAG-Kontext via Upstash Vector (Section-Chunking)
// 🩺 DIAGNOSE-VERSION: Detailliertes Logging an jedem kritischen Punkt
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

/**
 * Sucht RAG-Kontext zur User-Nachricht.
 */
export async function searchContext(userMessage, currentPage = null) {
  let additionalContext = '';
  let availableLinks = [];

  try {
    // ═══════════════════════════════════════════════
    // 🩺 DIAGNOSE SCHRITT 1: Index-Status prüfen
    // ═══════════════════════════════════════════════
    let indexInfo;
    try {
      indexInfo = await vectorIndex.info();
      console.log(`🩺 [1/5] Index-Status: ${indexInfo.vectorCount} Vektoren | Dimension: ${indexInfo.dimension} | Pending: ${indexInfo.pendingVectorCount}`);

      if (indexInfo.vectorCount === 0) {
        console.error('🩺 ❌ PROBLEM GEFUNDEN: Vector-DB ist LEER! (0 Vektoren)');
        return { additionalContext: '', availableLinks: [] };
      }
      if (indexInfo.pendingVectorCount > 0) {
        console.warn(`🩺 ⚠️ ${indexInfo.pendingVectorCount} Vektoren noch PENDING (nicht querybar)`);
      }
    } catch (infoErr) {
      console.error('🩺 ❌ Index-Info fehlgeschlagen:', infoErr.message);
      // Weiter versuchen – vielleicht klappt die Query trotzdem
    }

    // ═══════════════════════════════════════════════
    // 🩺 DIAGNOSE SCHRITT 2: Embedding generieren
    // ═══════════════════════════════════════════════
    console.log("🩺 [2/5] Embedding für:", userMessage.substring(0, 80));
    const embedStart = Date.now();
    const embedResult = await embeddingModel.embedContent(userMessage);
    const embedTime = Date.now() - embedStart;

    const rawValues = embedResult?.embedding?.values;
    if (!rawValues || rawValues.length === 0) {
      console.error('🩺 ❌ PROBLEM GEFUNDEN: Embedding ist LEER! Gemini hat keine Vektoren zurückgegeben.');
      console.error('🩺 Raw embedResult:', JSON.stringify(embedResult).substring(0, 500));
      return { additionalContext: '', availableLinks: [] };
    }

    const queryVector = rawValues.slice(0, 768);
    console.log(`🩺 [2/5] Embedding OK: ${rawValues.length} raw → ${queryVector.length} used | ${embedTime}ms | Erste 3 Werte: [${queryVector.slice(0, 3).map(v => v.toFixed(6)).join(', ')}]`);

    // 🩺 Check: Sind alle Werte 0? (kaputtes Embedding)
    const allZero = queryVector.every(v => v === 0);
    if (allZero) {
      console.error('🩺 ❌ PROBLEM GEFUNDEN: Embedding besteht nur aus Nullen!');
    }

    // 🩺 Check: Dimension-Mismatch mit Index?
    if (indexInfo && indexInfo.dimension && indexInfo.dimension !== queryVector.length) {
      console.error(`🩺 ❌ PROBLEM GEFUNDEN: Dimension-Mismatch! Index: ${indexInfo.dimension}, Query: ${queryVector.length}`);
    }

    // ═══════════════════════════════════════════════
    // 🩺 DIAGNOSE SCHRITT 3: Vector-Query
    // ═══════════════════════════════════════════════
    console.log("🩺 [3/5] Query an Upstash (topK=8, includeMetadata=true)...");
    const queryStart = Date.now();
    const queryResult = await vectorIndex.query({
      vector: queryVector,
      topK: 8,
      includeMetadata: true
    });
    const queryTime = Date.now() - queryStart;

    console.log(`🩺 [3/5] Query OK: ${queryResult?.length ?? 'null'} Ergebnisse in ${queryTime}ms`);

    // 🩺 Check: Query gibt null oder undefined zurück
    if (!queryResult) {
      console.error('🩺 ❌ PROBLEM GEFUNDEN: queryResult ist null/undefined (kein Array)');
      return { additionalContext: '', availableLinks: [] };
    }

    // 🩺 Check: Leeres Array (DB hat Daten aber Query findet nichts)
    if (queryResult.length === 0) {
      console.error(`🩺 ❌ PROBLEM GEFUNDEN: 0 Ergebnisse obwohl DB ${indexInfo?.vectorCount || '?'} Vektoren hat`);
      return { additionalContext: '', availableLinks: [] };
    }

    // ═══════════════════════════════════════════════
    // 🩺 DIAGNOSE SCHRITT 4: Ergebnisse analysieren
    // ═══════════════════════════════════════════════

    // 🩺 Check: Haben die Ergebnisse überhaupt Metadata?
    const withoutMetadata = queryResult.filter(m => !m.metadata || Object.keys(m.metadata).length === 0);
    if (withoutMetadata.length > 0) {
      console.warn(`🩺 ⚠️ ${withoutMetadata.length}/${queryResult.length} Ergebnisse OHNE Metadata:`,
        withoutMetadata.map(m => m.id).join(', '));
    }

    // 🩺 Check: Haben die Ergebnisse Content in der Metadata?
    const withoutContent = queryResult.filter(m => m.metadata && (!m.metadata.content || m.metadata.content.trim().length === 0));
    if (withoutContent.length > 0) {
      console.warn(`🩺 ⚠️ ${withoutContent.length}/${queryResult.length} Ergebnisse mit LEEREM content:`,
        withoutContent.map(m => `${m.id} (score: ${m.score.toFixed(3)})`).join(', '));
    }

    // Scores loggen (wie bisher)
    console.log('🩺 [4/5] Scores:', queryResult.map(m =>
      `${m.id} → ${m.score.toFixed(3)}${m.score > MIN_SCORE ? ' ✓' : ' ✗'} [content: ${(m.metadata?.content || '').length}ch]`
    ).join(' | '));

    // ═══════════════════════════════════════════════
    // 🩺 DIAGNOSE SCHRITT 5: Filtern + Kontext bauen
    // ═══════════════════════════════════════════════
    const MIN_CONTENT_LENGTH = 50;

    const matchedChunks = queryResult
      .filter(match => match.score > MIN_SCORE)
      .filter(match => {
        const content = match.metadata?.content || '';
        if (content.trim().length < MIN_CONTENT_LENGTH) {
          console.log(`🩺 Chunk "${match.id}" übersprungen – zu wenig Content (${content.trim().length} Zeichen)`);
          return false;
        }
        return true;
      })
      .slice(0, 5)
      .map(match => match.metadata);

    console.log(`🩺 [5/5] Finale Chunks: ${matchedChunks.length} | additionalContext wird ${matchedChunks.length > 0 ? 'BEFÜLLT' : 'LEER bleiben'}`);

    if (matchedChunks.length > 0) {
      console.log('🩺 Chunks:',
        matchedChunks.map(c => {
          const contentLen = (c.content || '').trim().length;
          return `"${c.title}${c.section_heading ? ` – ${c.section_heading}` : ''}" (${contentLen}ch)${c.type === 'knowledge-base' ? ' [KB]' : ''}`;
        }).join(', ')
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
    } else if (queryResult.length > 0) {
      const bestScore = queryResult[0].score;
      const bestId = queryResult[0].id;
      console.log(`🩺 Alle ${queryResult.length} Ergebnisse unter Schwelle ${MIN_SCORE}. Bestes: ${bestId} → ${bestScore.toFixed(3)}`);
    }

  } catch (error) {
    // 🩺 Erweitertes Error-Logging
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
