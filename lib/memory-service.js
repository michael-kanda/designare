// lib/memory-service.js - Evita Session-Gedächtnis (Redis)
// Speichert Name, Themen, Besuchszähler, Turn-Counter pro Session-ID
// NEU: turnCount wird im Backend geführt (nicht mehr Frontend-abhängig via history.length)
import { redis } from './redis.js';

const MEMORY_TTL = 60 * 60 * 24 * 30; // 30 Tage
const REDIS_PREFIX = 'evita:session:';

/**
 * Lädt Memory-Daten für eine Session
 * @returns {Object|null} Memory-Objekt oder null
 */
export async function getMemory(sessionId) {
  if (!sessionId) return null;
  try {
    const data = await redis.get(`${REDIS_PREFIX}${sessionId}`);
    if (!data) return null;
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (error) {
    console.error('Redis GET Fehler:', error.message);
    return null;
  }
}

/**
 * Speichert Memory-Daten für eine Session
 */
export async function saveMemory(sessionId, memoryData) {
  if (!sessionId) return;
  try {
    await redis.set(
      `${REDIS_PREFIX}${sessionId}`,
      JSON.stringify(memoryData),
      { ex: MEMORY_TTL }
    );
  } catch (error) {
    console.error('Redis SET Fehler:', error.message);
  }
}

/**
 * Extrahiert strukturierte Daten aus dem Memory-Objekt
 * mit sicheren Defaults für alle Felder.
 * 
 * NEU: turnCount wird aus Redis gelesen (nicht aus history.length abgeleitet).
 * Turn 0 = noch kein Turn passiert → isFirstTurn = true
 */
export function extractMemoryContext(memory, userName) {
  const isReturningUser = memory !== null;
  const knownName = userName || memory?.name || null;
  const previousTopics = memory?.topics || [];
  const lastVisit = memory?.lastVisit || null;
  const emailsSent = memory?.emailsSent || 0;

  // NEU: turnCount aus Redis-Memory (0 = frische Session)
  const turnCount = memory?.turnCount || 0;
  const isFirstTurn = turnCount === 0;

  // FIX: visitCount nur beim ersten Turn einer Session erhöhen,
  // nicht bei jedem Request. Sonst zählt ein 10-Nachrichten-Chat als 10 Besuche.
  const visitCount = isFirstTurn
    ? (memory?.visitCount || 0) + 1
    : (memory?.visitCount || 1);

  return { isReturningUser, knownName, previousTopics, visitCount, lastVisit, emailsSent, turnCount, isFirstTurn };
}

/**
 * Baut ein aktualisiertes Memory-Objekt nach einem Chat-Turn.
 * 
 * NEU: turnCount wird hier inkrementiert (Single Source of Truth im Backend).
 */
export function buildUpdatedMemory({ memory, detectedName, knownName, visitCount, previousTopics, topicKeywords, userMessage, emailsSent }) {
  const currentTurnCount = memory?.turnCount || 0;

  return {
    name: detectedName || knownName || null,
    visitCount,
    lastVisit: new Date().toISOString(),
    topics: [...new Set([...previousTopics, ...topicKeywords])].slice(-15),
    lastMessages: [
      ...(memory?.lastMessages || []).slice(-8),
      { role: 'user', content: userMessage.substring(0, 200), timestamp: new Date().toISOString() }
    ],
    emailsSent,
    // NEU: Turn-Counter (inkrementiert bei jedem Chat-Turn)
    turnCount: currentTurnCount + 1
  };
}

/**
 * Formatiert vergangene Zeit als menschenlesbaren String
 */
export function getTimeSinceText(lastDate) {
  // FIX: lastDate kann ein ISO-String aus Redis sein → defensiv in Date konvertieren
  const date = lastDate instanceof Date ? lastDate : new Date(lastDate);
  const diffMs = new Date() - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 5) return 'wenigen Minuten';
  if (diffMins < 60) return `${diffMins} Minuten`;
  if (diffHours < 24) return `${diffHours} Stunden`;
  if (diffDays === 1) return 'einem Tag';
  if (diffDays < 7) return `${diffDays} Tagen`;
  if (diffDays < 14) return 'einer Woche';
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} Wochen`;
  return `${Math.floor(diffDays / 30)} Monaten`;
}
