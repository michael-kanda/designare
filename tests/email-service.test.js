// tests/email-service.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { redisMock } from './__mocks__/upstash-redis.js';
import { brevoMock } from './__mocks__/brevo.js';
import { isEmailBlocked, isEmailWhitelisted, buildEmailHtml, sendEmail, MAX_EMAILS_PER_SESSION } from '../lib/email-service.js';

beforeEach(() => {
  redisMock._reset();
  redisMock.sismember.mockReset();
  redisMock.scard.mockReset();
  brevoMock.sendTransacEmail.mockReset();
});

describe('isEmailBlocked', () => {
  it('gibt false für nicht-blockierte Adresse', async () => {
    redisMock.sismember.mockResolvedValue(false);
    expect(await isEmailBlocked('test@example.com')).toBe(false);
  });

  it('gibt true für blockierte Adresse', async () => {
    redisMock.sismember.mockResolvedValue(true);
    expect(await isEmailBlocked('blocked@spam.com')).toBe(true);
  });

  it('normalisiert auf Kleinbuchstaben + Trim', async () => {
    redisMock.sismember.mockResolvedValue(false);
    await isEmailBlocked('  Test@Example.COM  ');
    expect(redisMock.sismember).toHaveBeenCalledWith('evita:email:blocklist', 'test@example.com');
  });

  it('gibt true bei Redis-Fehler (Fail-Closed)', async () => {
    redisMock.sismember.mockRejectedValue(new Error('connection lost'));
    expect(await isEmailBlocked('any@test.com')).toBe(true);
  });
});

describe('isEmailWhitelisted', () => {
  it('gibt false bei leerer Whitelist', async () => {
    redisMock.scard.mockResolvedValue(0);
    expect(await isEmailWhitelisted('test@example.com')).toBe(false);
    // sismember sollte gar nicht erst aufgerufen werden
    expect(redisMock.sismember).not.toHaveBeenCalled();
  });

  it('gibt true für gewhitelistete Adresse', async () => {
    redisMock.scard.mockResolvedValue(2);
    redisMock.sismember.mockResolvedValue(true);
    expect(await isEmailWhitelisted('allowed@test.com')).toBe(true);
  });

  it('gibt false für nicht-gewhitelistete Adresse', async () => {
    redisMock.scard.mockResolvedValue(2);
    redisMock.sismember.mockResolvedValue(false);
    expect(await isEmailWhitelisted('stranger@test.com')).toBe(false);
  });

  it('normalisiert auf Kleinbuchstaben + Trim', async () => {
    redisMock.scard.mockResolvedValue(1);
    redisMock.sismember.mockResolvedValue(true);
    await isEmailWhitelisted('  Test@Example.COM  ');
    expect(redisMock.sismember).toHaveBeenCalledWith('evita:email:whitelist', 'test@example.com');
  });

  it('gibt false bei Redis-Fehler (Fail-Closed)', async () => {
    redisMock.scard.mockRejectedValue(new Error('timeout'));
    expect(await isEmailWhitelisted('any@test.com')).toBe(false);
  });
});

describe('buildEmailHtml', () => {
  it('enthält den Betreff', () => {
    const html = buildEmailHtml('Hallo Welt', 'Test-Betreff', 'test@example.com');
    expect(html).toContain('Test-Betreff');
  });

  it('enthält den Body-Text', () => {
    const html = buildEmailHtml('Erster Absatz\n\nZweiter Absatz', 'Betreff', 'test@example.com');
    expect(html).toContain('Erster Absatz');
    expect(html).toContain('Zweiter Absatz');
  });

  it('escaped HTML im Body (XSS-Schutz)', () => {
    const html = buildEmailHtml('<script>alert(1)</script>', 'Betreff', 'test@example.com');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('sendEmail', () => {
  it('ruft Brevo API auf und gibt Result zurück', async () => {
    brevoMock.sendTransacEmail.mockResolvedValue({ messageId: 'msg-456' });
    const result = await sendEmail({
      to: 'recipient@test.com',
      toName: 'Tester',
      subject: 'Hallo',
      body: 'Testnachricht',
      sessionId: 'sess-abc'
    });
    expect(result.messageId).toBe('msg-456');
    expect(brevoMock.sendTransacEmail).toHaveBeenCalledOnce();
  });

  it('wirft Fehler bei Brevo-Ausfall', async () => {
    brevoMock.sendTransacEmail.mockRejectedValue(new Error('Brevo down'));
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'X', body: 'Y', sessionId: 's' })
    ).rejects.toThrow('Brevo down');
  });
});

describe('MAX_EMAILS_PER_SESSION', () => {
  it('ist 3', () => {
    expect(MAX_EMAILS_PER_SESSION).toBe(3);
  });
});
