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

const MIN_SCORE = 0.55;
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
      console.log('🔍 RAG Scores:', queryResult.map(m => `${m.id} → ${m.score.toFixed(3)}`).join(' | '));
    } else {
      console.log('🔍 RAG: Keine Ergebnisse');
    }

    const matchedChunks = queryResult
      .filter(match => match.score > MIN_SCORE)
      .slice(0, 5) // Mehr Kandidaten holen (topK=8), aber max 5 an Evita liefern
      .map(match => match.metadata);

    if (matchedChunks.length > 0) {
      additionalContext = matchedChunks.map(chunk => {
        // Kontext-Header: Seitentitel + ggf. Sektions-Überschrift + URL
        let ctx = chunk.title;
        if (chunk.section_heading) ctx += ` – ${chunk.section_heading}`;
        if (chunk.url) ctx += ` (${chunk.url})`;
        const contentToUse = chunk.content ? chunk.content.substring(0, MAX_CONTENT_LENGTH) : '';
        ctx += `\n${contentToUse}`;
        return ctx;
      }).join('\n\n');

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
