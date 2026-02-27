// tests/memory-service.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { redisMock } from './__mocks__/upstash-redis.js';
import { getMemory, saveMemory, extractMemoryContext, buildUpdatedMemory, getTimeSinceText } from '../lib/memory-service.js';

beforeEach(() => {
  redisMock._reset();
  redisMock.get.mockReset();
  redisMock.set.mockReset();
});

describe('getMemory', () => {
  it('gibt null bei fehlender sessionId', async () => {
    expect(await getMemory(null)).toBeNull();
    expect(await getMemory('')).toBeNull();
  });

  it('gibt null wenn kein Eintrag existiert', async () => {
    redisMock.get.mockResolvedValue(null);
    expect(await getMemory('abc123')).toBeNull();
  });

  it('parsed JSON-String aus Redis', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify({ name: 'Alfred', visitCount: 3 }));
    const result = await getMemory('abc123');
    expect(result.name).toBe('Alfred');
    expect(result.visitCount).toBe(3);
  });

  it('gibt Objekt direkt zurück wenn Redis schon parsed hat', async () => {
    redisMock.get.mockResolvedValue({ name: 'Berta' });
    const result = await getMemory('abc123');
    expect(result.name).toBe('Berta');
  });

  it('gibt null bei Redis-Fehler (fail-safe)', async () => {
    redisMock.get.mockRejectedValue(new Error('connection lost'));
    expect(await getMemory('abc123')).toBeNull();
  });
});

describe('saveMemory', () => {
  it('speichert nicht bei fehlender sessionId', async () => {
    await saveMemory(null, { name: 'Test' });
    expect(redisMock.set).not.toHaveBeenCalled();
  });

  it('ruft redis.set mit TTL auf', async () => {
    redisMock.set.mockResolvedValue('OK');
    await saveMemory('sess-123', { name: 'Alfred', visitCount: 1 });
    expect(redisMock.set).toHaveBeenCalledOnce();
    const args = redisMock.set.mock.calls[0];
    expect(args[0]).toBe('evita:session:sess-123');
    expect(JSON.parse(args[1]).name).toBe('Alfred');
    expect(args[2]).toEqual({ ex: 60 * 60 * 24 * 30 }); // 30 Tage
  });
});

describe('extractMemoryContext', () => {
  it('erkennt neuen Besucher (memory = null)', () => {
    const ctx = extractMemoryContext(null, null);
    expect(ctx.isReturningUser).toBe(false);
    expect(ctx.knownName).toBeNull();
    expect(ctx.visitCount).toBe(1);
    expect(ctx.emailsSent).toBe(0);
  });

  it('erkennt wiederkehrenden Besucher', () => {
    const memory = { name: 'Alfred', visitCount: 4, topics: ['seo', 'ki'], emailsSent: 1 };
    const ctx = extractMemoryContext(memory, null);
    expect(ctx.isReturningUser).toBe(true);
    expect(ctx.knownName).toBe('Alfred');
    expect(ctx.visitCount).toBe(5);
    expect(ctx.emailsSent).toBe(1);
  });

  it('bevorzugt übergebenen userName über Memory', () => {
    const memory = { name: 'Alfred' };
    const ctx = extractMemoryContext(memory, 'Berta');
    expect(ctx.knownName).toBe('Berta');
  });
});

describe('buildUpdatedMemory', () => {
  it('baut korrektes Memory-Objekt', () => {
    const result = buildUpdatedMemory({
      memory: null,
      detectedName: 'Alfred',
      knownName: null,
      visitCount: 1,
      previousTopics: [],
      topicKeywords: ['seo', 'ki'],
      userMessage: 'Wie funktioniert SEO?',
      emailsSent: 0
    });

    expect(result.name).toBe('Alfred');
    expect(result.visitCount).toBe(1);
    expect(result.topics).toContain('seo');
    expect(result.topics).toContain('ki');
    expect(result.lastMessages).toHaveLength(1);
    expect(result.lastMessages[0].content).toBe('Wie funktioniert SEO?');
  });

  it('begrenzt Topics auf 15', () => {
    const manyTopics = Array.from({ length: 20 }, (_, i) => `topic${i}`);
    const result = buildUpdatedMemory({
      memory: null, detectedName: null, knownName: null, visitCount: 1,
      previousTopics: manyTopics, topicKeywords: ['neu'],
      userMessage: 'test', emailsSent: 0
    });
    expect(result.topics.length).toBeLessThanOrEqual(15);
  });

  it('begrenzt lastMessages auf 9 (8 alte + 1 neue)', () => {
    const oldMessages = Array.from({ length: 15 }, (_, i) => ({
      role: 'user', content: `msg${i}`, timestamp: new Date().toISOString()
    }));
    const result = buildUpdatedMemory({
      memory: { lastMessages: oldMessages },
      detectedName: null, knownName: null, visitCount: 1,
      previousTopics: [], topicKeywords: [],
      userMessage: 'neueste', emailsSent: 0
    });
    expect(result.lastMessages).toHaveLength(9);
    expect(result.lastMessages[8].content).toBe('neueste');
  });

  it('kürzt userMessage auf 200 Zeichen', () => {
    const longMsg = 'x'.repeat(500);
    const result = buildUpdatedMemory({
      memory: null, detectedName: null, knownName: null, visitCount: 1,
      previousTopics: [], topicKeywords: [],
      userMessage: longMsg, emailsSent: 0
    });
    expect(result.lastMessages[0].content.length).toBe(200);
  });
});

describe('getTimeSinceText', () => {
  it('wenige Minuten', () => {
    expect(getTimeSinceText(new Date(Date.now() - 2 * 60000))).toBe('wenigen Minuten');
  });

  it('Minuten', () => {
    expect(getTimeSinceText(new Date(Date.now() - 15 * 60000))).toBe('15 Minuten');
  });

  it('Stunden', () => {
    expect(getTimeSinceText(new Date(Date.now() - 3 * 3600000))).toBe('3 Stunden');
  });

  it('Tage', () => {
    expect(getTimeSinceText(new Date(Date.now() - 3 * 86400000))).toBe('3 Tagen');
  });

  it('Wochen', () => {
    expect(getTimeSinceText(new Date(Date.now() - 14 * 86400000))).toBe('2 Wochen');
  });

  it('Monate', () => {
    expect(getTimeSinceText(new Date(Date.now() - 60 * 86400000))).toBe('2 Monaten');
  });
});
