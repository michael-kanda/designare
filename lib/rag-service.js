// lib/rag-service.js - RAG-Kontext via Upstash Vector (Section-Chunking)
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

// FIX: Score-Schwelle leicht gesenkt (0.55 → 0.45)
// KB-Chunks (ohne Seitenstruktur) können niedrigere Scores haben als
// strukturierte Seiten-Sektionen, besonders bei allgemeinen Fragen.
// 0.45 fängt auch "ungefähre" Treffer ab, die trotzdem relevant sind.
const MIN_SCORE = 0.45;

// Erhöht von 800 auf 1500: Sektions-Chunks sind kleiner als ganze Seiten,
// daher kann mehr Kontext pro Treffer an Evita übergeben werden
const MAX_CONTENT_LENGTH = 1500;

/**
 * Sucht RAG-Kontext zur User-Nachricht.
 * @param {string} userMessage - Die aktuelle Frage des Users
 * @param {string|null} currentPage - Aktuelle URL des Users (zum Ausfiltern)
 * @returns {{ additionalContext: string, availableLinks: Array<{url: string, title: string}> }}
 */
export async function searchContext(userMessage, currentPage = null) {
  let additionalContext = '';
  let availableLinks = [];

  try {
    console.log("🔍 Suche in Vector-DB nach:", userMessage);
    const embedResult = await embeddingModel.embedContent(userMessage);
    const queryVector = embedResult.embedding.values.slice(0, 768);

    const queryResult = await vectorIndex.query({
      vector: queryVector,
      topK: 8,
      includeMetadata: true
    });

    // Debug: Alle Scores loggen um Threshold-Probleme zu erkennen
    if (queryResult.length > 0) {
      console.log('🔍 RAG Scores:', queryResult.map(m =>
        `${m.id} → ${m.score.toFixed(3)}${m.score > MIN_SCORE ? ' ✓' : ' ✗'}`
      ).join(' | '));
    } else {
      console.log('🔍 RAG: Keine Ergebnisse (Vector-DB leer oder Query-Fehler)');
    }

    // Mindest-Content-Länge: Chunks ohne Substanz verschwenden Kontext-Plätze
    const MIN_CONTENT_LENGTH = 50;

    const matchedChunks = queryResult
      .filter(match => match.score > MIN_SCORE)
      .filter(match => {
        const content = match.metadata?.content || '';
        if (content.trim().length < MIN_CONTENT_LENGTH) {
          console.log(`🔍 RAG: Chunk "${match.id}" übersprungen – zu wenig Content (${content.trim().length} Zeichen)`);
          return false;
        }
        return true;
      })
      .slice(0, 5)
      .map(match => match.metadata);

    // Debug: Gefilterte Chunks loggen (mit Content-Länge)
    if (matchedChunks.length > 0) {
      console.log(`🔍 RAG: ${matchedChunks.length} Chunks über Schwelle (${MIN_SCORE}):`,
        matchedChunks.map(c => {
          const contentLen = (c.content || '').trim().length;
          return `"${c.title}${c.section_heading ? ` – ${c.section_heading}` : ''}" (${contentLen}ch)${c.type === 'knowledge-base' ? ' [KB]' : ''}`;
        }).join(', ')
      );
    } else if (queryResult.length > 0) {
      // Es gab Ergebnisse, aber alle unter dem Threshold
      const bestScore = queryResult[0].score;
      const bestId = queryResult[0].id;
      console.log(`🔍 RAG: Alle ${queryResult.length} Ergebnisse unter Schwelle ${MIN_SCORE}. Bestes: ${bestId} → ${bestScore.toFixed(3)}`);
    }

    if (matchedChunks.length > 0) {
      additionalContext = matchedChunks.map((chunk, i) => {
        // Kontext-Header: Seitentitel + ggf. Sektions-Überschrift + URL
        let header = `[Quelle ${i + 1}] ${chunk.title}`;
        if (chunk.section_heading) header += ` – ${chunk.section_heading}`;
        if (chunk.url) header += ` (${chunk.url})`;
        const contentToUse = chunk.content ? chunk.content.substring(0, MAX_CONTENT_LENGTH).trim() : '';
        return `${header}\n${contentToUse}`;
      }).join('\n---\n');

      const currentPath = currentPage ? currentPage.replace(/\/$/, '') : '';

      // Dedupliziere Links nach URL (mehrere Sektionen können von derselben Seite stammen)
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
    }
  } catch (error) {
    console.error('❌ RAG / Vector Fehler:', error.message);
  }

  // Permanente Links hinzufügen (sofern nicht aktuelle Seite / bereits enthalten)
  for (const pl of PERMANENT_LINKS) {
    const isCurrentPage = currentPage && currentPage.replace(/\/$/, '') === pl.url;
    const alreadyIncluded = availableLinks.some(l => l.url === pl.url);
    if (!isCurrentPage && !alreadyIncluded) availableLinks.push(pl);
  }

  return { additionalContext, availableLinks };
}
