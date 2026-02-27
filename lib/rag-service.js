// lib/rag-service.js - RAG-Kontext via Upstash Vector
// Sucht relevante Website-Inhalte zur User-Frage
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

const MIN_SCORE = 0.70;
const MAX_CONTENT_LENGTH = 800;

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
      topK: 3,
      includeMetadata: true
    });

    const matchedPages = queryResult
      .filter(match => match.score > MIN_SCORE)
      .map(match => match.metadata);

    if (matchedPages.length > 0) {
      additionalContext = matchedPages.map(page => {
        let ctx = `${page.title}`;
        if (page.url) ctx += ` (${page.url})`;
        const contentToUse = page.content ? page.content.substring(0, MAX_CONTENT_LENGTH) : '';
        ctx += `\n${contentToUse}`;
        return ctx;
      }).join('\n\n');

      const currentPath = currentPage ? currentPage.replace(/\/$/, '') : '';

      availableLinks = matchedPages
        .filter(p => p.url && !LINK_BLACKLIST.some(s => p.url.includes(s)))
        .filter(p => !currentPath || !p.url.includes(currentPath))
        .map(p => ({ url: p.url, title: p.title }));
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
