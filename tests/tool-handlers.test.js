// tests/tool-handlers.test.js
import { describe, it, expect } from 'vitest';
import {
  handleOpenBooking, handleComposeEmail, handleRememberUserName,
  handleSuggestChips, dispatchFunctionCalls
} from '../lib/tool-handlers.js';

describe('handleOpenBooking', () => {
  it('setzt openBooking flag', () => {
    const payload = { answer: '' };
    handleOpenBooking({ reason: 'SEO-Beratung' }, payload, '');
    expect(payload.openBooking).toBe(true);
    expect(payload.bookingReason).toBe('SEO-Beratung');
  });

  it('setzt Default-Antwort wenn keine Textantwort', () => {
    const payload = { answer: '' };
    handleOpenBooking({}, payload, '   ');
    expect(payload.answer).toContain('Kalender');
  });

  it('überschreibt bestehende Antwort nicht', () => {
    const payload = { answer: 'Klar machen wir!' };
    handleOpenBooking({}, payload, 'Klar machen wir!');
    expect(payload.answer).toBe('Klar machen wir!');
  });
});

describe('handleComposeEmail', () => {
  it('baut Email-Draft korrekt auf', () => {
    const payload = { answer: '' };
    handleComposeEmail({
      to: 'test@test.com', to_name: 'Tester',
      subject: 'Hallo', body: 'Testnachricht'
    }, payload);

    expect(payload.emailDraft.to).toBe('test@test.com');
    expect(payload.emailDraft.toName).toBe('Tester');
    expect(payload.emailDraft.subject).toBe('Hallo');
    expect(payload.answer).toContain('Entwurf');
    expect(payload.answer).toContain('test@test.com');
    expect(payload.answer).toContain('Hallo');
  });

  it('ignoriert unvollständige Aufrufe (fehlender to)', () => {
    const payload = { answer: 'original' };
    handleComposeEmail({ subject: 'X', body: 'Y' }, payload);
    expect(payload.emailDraft).toBeUndefined();
    expect(payload.answer).toBe('original');
  });

  it('setzt leeren toName als Default', () => {
    const payload = { answer: '' };
    handleComposeEmail({ to: 'a@b.com', subject: 'X', body: 'Y' }, payload);
    expect(payload.emailDraft.toName).toBe('');
  });
});

describe('handleRememberUserName', () => {
  it('speichert gültigen Namen', () => {
    const payload = {};
    handleRememberUserName({ name: 'Alfred' }, payload);
    expect(payload.detectedName).toBe('Alfred');
  });

  it('ignoriert zu kurze Namen', () => {
    const payload = {};
    handleRememberUserName({ name: 'A' }, payload);
    expect(payload.detectedName).toBeUndefined();
  });

  it('ignoriert zu lange Namen', () => {
    const payload = {};
    handleRememberUserName({ name: 'A'.repeat(21) }, payload);
    expect(payload.detectedName).toBeUndefined();
  });

  it('trimmt Leerzeichen', () => {
    const payload = {};
    handleRememberUserName({ name: '  Berta  ' }, payload);
    expect(payload.detectedName).toBe('Berta');
  });
});

describe('handleSuggestChips', () => {
  const baseCtx = { currentPage: null, history: [], userMessage: 'was kostet seo', answerText: 'Das kommt drauf an.' };

  it('filtert doppelte URLs raus', () => {
    const payload = {};
    handleSuggestChips({
      chips: [
        { type: 'link', text: 'SEO', url: '/seo' },
        { type: 'link', text: 'SEO nochmal', url: '/seo' },
        { type: 'link', text: 'KI', url: '/ki' }
      ]
    }, payload, baseCtx);

    expect(payload.chips.filter(c => c.type === 'link')).toHaveLength(2);
  });

  it('filtert aktuelle Seite raus', () => {
    const payload = {};
    handleSuggestChips({
      chips: [
        { type: 'link', text: 'SEO', url: '/seo' },
        { type: 'link', text: 'KI', url: '/ki' }
      ]
    }, payload, { ...baseCtx, currentPage: '/seo' });

    const linkChips = payload.chips.filter(c => c.type === 'link');
    expect(linkChips.every(c => c.url !== '/seo')).toBe(true);
  });

  it('fügt Booking-Chip bei langer Konversation hinzu', () => {
    const payload = {};
    const longHistory = [{ role: 'user' }, { role: 'model' }, { role: 'user' }, { role: 'model' }];
    handleSuggestChips({
      chips: [{ type: 'link', text: 'SEO', url: '/seo' }]
    }, payload, { ...baseCtx, history: longHistory });

    expect(payload.chips[0].type).toBe('booking');
  });

  it('fügt Booking-Chip bei Booking-Keywords hinzu', () => {
    const payload = {};
    handleSuggestChips({
      chips: [{ type: 'link', text: 'Infos', url: '/info' }]
    }, payload, { ...baseCtx, userMessage: 'ich möchte einen termin' });

    expect(payload.chips.some(c => c.type === 'booking')).toBe(true);
  });

  it('begrenzt auf max 2 Link-Chips', () => {
    const payload = {};
    handleSuggestChips({
      chips: [
        { type: 'link', text: 'A', url: '/a' },
        { type: 'link', text: 'B', url: '/b' },
        { type: 'link', text: 'C', url: '/c' }
      ]
    }, payload, baseCtx);

    const linkChips = payload.chips.filter(c => c.type === 'link');
    expect(linkChips.length).toBeLessThanOrEqual(2);
  });
});

describe('dispatchFunctionCalls', () => {
  it('verarbeitet mehrere Function Calls gleichzeitig', () => {
    const functionCalls = [
      { name: 'remember_user_name', args: { name: 'Alfred' } },
      { name: 'suggest_chips', args: { chips: [{ type: 'link', text: 'SEO', url: '/seo' }] } }
    ];
    const result = dispatchFunctionCalls(functionCalls, 'Hallo Alfred!', {
      currentPage: null, history: [], userMessage: 'Ich bin Alfred'
    });

    expect(result.detectedName).toBe('Alfred');
    expect(result.answer).toBe('Hallo Alfred!');
    expect(result.chips).toBeDefined();
  });

  it('unterdrückt Chips bei E-Mail-Draft', () => {
    const functionCalls = [
      { name: 'compose_email', args: { to: 'a@b.com', subject: 'X', body: 'Y' } },
      { name: 'suggest_chips', args: { chips: [{ type: 'link', text: 'SEO', url: '/seo' }] } }
    ];
    const result = dispatchFunctionCalls(functionCalls, '', {
      currentPage: null, history: [], userMessage: 'Schreib eine Mail'
    });

    expect(result.emailDraft).toBeDefined();
    expect(result.chips).toBeUndefined();
  });

  it('unterdrückt Chips bei Booking', () => {
    const functionCalls = [
      { name: 'open_booking', args: { reason: 'Test' } },
      { name: 'suggest_chips', args: { chips: [{ type: 'link', text: 'A', url: '/a' }] } }
    ];
    const result = dispatchFunctionCalls(functionCalls, 'Kalender öffne ich!', {
      currentPage: null, history: [], userMessage: 'Termin bitte'
    });

    expect(result.openBooking).toBe(true);
    expect(result.chips).toBeUndefined();
  });

  it('gibt saubere Antwort ohne Function Calls', () => {
    const result = dispatchFunctionCalls([], 'Einfach nur Text.', {
      currentPage: null, history: [], userMessage: 'Hallo'
    });

    expect(result.answer).toBe('Einfach nur Text.');
    expect(result.openBooking).toBeUndefined();
    expect(result.emailDraft).toBeUndefined();
  });
});
