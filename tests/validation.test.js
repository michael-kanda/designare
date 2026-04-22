// tests/validation.test.js
import { describe, it, expect } from 'vitest';
import { isValidEmail, sanitizeHtml, textToHtml, getClientIp, MAX_MESSAGE_LENGTH } from '../lib/validation.js';

describe('isValidEmail', () => {
  it('akzeptiert gültige E-Mails', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name+tag@domain.co.at')).toBe(true);
    expect(isValidEmail('a@b.cc')).toBe(true);
  });

  it('lehnt ungültige E-Mails ab', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('kein-at-zeichen')).toBe(false);
    expect(isValidEmail('@missing-local.com')).toBe(false);
    expect(isValidEmail('missing@.com')).toBe(false);
    expect(isValidEmail('leerzeichen drin@test.com')).toBe(false);
  });
});

describe('sanitizeHtml', () => {
  it('escaped gefährliche Zeichen', () => {
    expect(sanitizeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escaped Ampersand', () => {
    expect(sanitizeHtml('A & B')).toBe('A &amp; B');
  });

  it('escaped Anführungszeichen', () => {
    expect(sanitizeHtml("it's a 'test'")).toBe("it&#039;s a &#039;test&#039;");
  });
});

describe('textToHtml', () => {
  it('wandelt Absätze in <p> Tags', () => {
    const result = textToHtml('Absatz 1\n\nAbsatz 2');
    expect(result).toContain('<p>Absatz 1</p>');
    expect(result).toContain('<p>Absatz 2</p>');
  });

  it('wandelt Zeilenumbrüche in <br>', () => {
    const result = textToHtml('Zeile 1\nZeile 2');
    expect(result).toContain('Zeile 1<br>Zeile 2');
  });

  it('escaped HTML in Nutzereingabe', () => {
    const result = textToHtml('<b>bold</b>');
    expect(result).not.toContain('<b>');
    expect(result).toContain('&lt;b&gt;');
  });
});

describe('getClientIp', () => {
  it('liest x-forwarded-for (erster Wert)', () => {
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: {} };
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('fällt auf x-real-ip zurück', () => {
    const req = { headers: { 'x-real-ip': '10.0.0.1' }, socket: {} };
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('gibt unknown zurück wenn nichts da', () => {
    const req = { headers: {}, socket: {} };
    expect(getClientIp(req)).toBe('unknown');
  });
});

describe('MAX_MESSAGE_LENGTH', () => {
  it('ist 2000', () => {
    expect(MAX_MESSAGE_LENGTH).toBe(2000);
  });
});
