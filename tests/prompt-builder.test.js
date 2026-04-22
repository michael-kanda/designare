// tests/prompt-builder.test.js
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../lib/prompt-builder.js';

const baseParams = {
  isReturningUser: false,
  knownName: null,
  visitCount: 1,
  lastVisit: null,
  previousTopics: [],
  emailsSent: 0,
  currentPage: null,
  additionalContext: '',
  availableLinks: []
};

describe('buildSystemPrompt', () => {
  it('enthält Evita-Identität', () => {
    const prompt = buildSystemPrompt(baseParams);
    expect(prompt).toContain('Evita');
    expect(prompt).toContain('designare.at');
  });

  it('enthält NEUER BESUCHER für Erstbesucher', () => {
    const prompt = buildSystemPrompt(baseParams);
    expect(prompt).toContain('NEUER BESUCHER');
  });

  it('enthält WIEDERKEHRENDER BESUCHER mit Name', () => {
    const prompt = buildSystemPrompt({
      ...baseParams,
      isReturningUser: true,
      knownName: 'Alfred',
      visitCount: 3,
      lastVisit: new Date(Date.now() - 86400000).toISOString()
    });
    expect(prompt).toContain('WIEDERKEHRENDER BESUCHER');
    expect(prompt).toContain('Alfred');
    expect(prompt).toContain('Besuch 3');
  });

  it('enthält frühere Themen bei Returning User', () => {
    const prompt = buildSystemPrompt({
      ...baseParams,
      isReturningUser: true,
      knownName: 'Berta',
      previousTopics: ['seo', 'ki', 'wordpress']
    });
    expect(prompt).toContain('seo');
    expect(prompt).toContain('ki');
  });

  it('zeigt emailsSent im Prompt', () => {
    const prompt = buildSystemPrompt({ ...baseParams, emailsSent: 2 });
    expect(prompt).toContain('bisher: 2');
  });

  it('enthält aktuelle Seite als Anweisung', () => {
    const prompt = buildSystemPrompt({ ...baseParams, currentPage: '/seo-check' });
    expect(prompt).toContain('/seo-check');
    expect(prompt).toContain('NIEMALS als Link-Chip');
  });

  it('enthält RAG-Kontext', () => {
    const prompt = buildSystemPrompt({
      ...baseParams,
      additionalContext: 'SEO ist wichtig für Sichtbarkeit.'
    });
    expect(prompt).toContain('WEBSEITEN-KONTEXT');
    expect(prompt).toContain('SEO ist wichtig');
  });

  it('listet verfügbare Links auf', () => {
    const prompt = buildSystemPrompt({
      ...baseParams,
      availableLinks: [
        { url: '/seo', title: 'SEO-Optimierung' },
        { url: '/ki', title: 'KI-Beratung' }
      ]
    });
    expect(prompt).toContain('VERFÜGBARE LINKS');
    expect(prompt).toContain('/seo');
    expect(prompt).toContain('SEO-Optimierung');
  });

  it('enthält Whitelist-Hinweis im Email-Tool', () => {
    const prompt = buildSystemPrompt(baseParams);
    expect(prompt).toContain('Whitelist');
  });

  it('enthält Datum', () => {
    const prompt = buildSystemPrompt(baseParams);
    // Sollte irgendein Datum enthalten (Format: Montag, 27. Februar 2026)
    expect(prompt).toMatch(/Datum:/);
  });

  it('enthält keine Emojis-Regel', () => {
    const prompt = buildSystemPrompt(baseParams);
    expect(prompt).toContain('KEINE Emojis');
  });
});
