// lib/memory-service.js - Evita Session-Gedächtnis (Redis)
// Speichert Name, Themen, Besuchszähler pro Session-ID
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
 * mit sicheren Defaults für alle Felder
 */
export function extractMemoryContext(memory, userName) {
  const isReturningUser = memory !== null;
  const knownName = userName || memory?.name || null;
  const previousTopics = memory?.topics || [];
  const visitCount = (memory?.visitCount || 0) + 1;
  const lastVisit = memory?.lastVisit || null;
  const emailsSent = memory?.emailsSent || 0;

  return { isReturningUser, knownName, previousTopics, visitCount, lastVisit, emailsSent };
}

/**
 * Baut ein aktualisiertes Memory-Objekt nach einem Chat-Turn
 */
export function buildUpdatedMemory({ memory, detectedName, knownName, visitCount, previousTopics, topicKeywords, userMessage, emailsSent }) {
  return {
    name: detectedName || knownName || null,
    visitCount,
    lastVisit: new Date().toISOString(),
    topics: [...new Set([...previousTopics, ...topicKeywords])].slice(-15),
    lastMessages: [
      ...(memory?.lastMessages || []).slice(-8),
      { role: 'user', content: userMessage.substring(0, 200), timestamp: new Date().toISOString() }
    ],
    emailsSent
  };
}

/**
 * Formatiert vergangene Zeit als menschenlesbaren String
 */
export function getTimeSinceText(lastDate) {
  const diffMs = new Date() - lastDate;
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
