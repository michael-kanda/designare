// api/rag-debug.js - RAG Diagnose-Endpoint
// Aufruf: GET /api/rag-debug?q=wie+wurde+designare+gebaut
// Zeigt: Scores, Treffer, Threshold-Info – zum Debuggen ohne Chat
//
// ACHTUNG: Nur mit CRON_SECRET oder in Development verwenden!
// In Produktion ggf. wieder entfernen oder absichern.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Index } from "@upstash/vector";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN,
});

const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
const MIN_SCORE = 0.45;

export default async function handler(req, res) {
  // Einfache Auth: Query-Parameter oder Header
  const secret = req.query.secret || req.headers['x-debug-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized. ?secret=YOUR_CRON_SECRET' });
  }

  const query = req.query.q || 'wie wurde designare.at gebaut';

  try {
    // 1. Index-Info
    const indexInfo = await vectorIndex.info();

    // 2. Embedding erzeugen
    const embedResult = await embeddingModel.embedContent(query);
    const queryVector = embedResult.embedding.values.slice(0, 768);

    // 3. Suche
    const results = await vectorIndex.query({
      vector: queryVector,
      topK: 10,
      includeMetadata: true
    });

    // 4. Aufbereiten
    const scored = results.map(r => ({
      id: r.id,
      score: r.score,
      passesThreshold: r.score > MIN_SCORE,
      title: r.metadata?.title || '?',
      section: r.metadata?.section_heading || null,
      url: r.metadata?.url || null,
      type: r.metadata?.type || 'page',
      contentPreview: (r.metadata?.content || '').substring(0, 200) + '...'
    }));

    const passing = scored.filter(s => s.passesThreshold);
    const failing = scored.filter(s => !s.passesThreshold);

    return res.status(200).json({
      query,
      threshold: MIN_SCORE,
      indexStats: {
        vectorCount: indexInfo.vectorCount,
        dimension: indexInfo.dimension
      },
      results: {
        total: scored.length,
        passingThreshold: passing.length,
        belowThreshold: failing.length
      },
      passing,
      belowThreshold: failing,
      diagnosis: passing.length === 0
        ? scored.length === 0
          ? '🔴 KEINE ERGEBNISSE – Vector-DB ist leer oder Embedding-Dimension stimmt nicht'
          : `🟡 ${scored.length} Ergebnisse, aber ALLE unter Schwelle ${MIN_SCORE}. Bestes: ${scored[0].id} mit Score ${scored[0].score.toFixed(3)}`
        : `🟢 ${passing.length} Treffer über Schwelle. Bester: "${passing[0].title}" (${passing[0].score.toFixed(3)})`
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message,
      hint: 'Prüfe UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN und GEMINI_API_KEY'
    });
  }
}
