// tests/rate-limiter.test.js
import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../lib/rate-limiter.js';

describe('checkRateLimit', () => {
  it('erlaubt Requests innerhalb des Limits', () => {
    const ip = `test-${Date.now()}-allow`;
    expect(checkRateLimit(ip, 'general')).toBe(true);
    expect(checkRateLimit(ip, 'general')).toBe(true);
  });

  it('blockt nach 20 Requests pro Minute (general)', () => {
    const ip = `test-${Date.now()}-block`;
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(ip, 'general')).toBe(true);
    }
    // Nr. 21 → geblockt
    expect(checkRateLimit(ip, 'general')).toBe(false);
  });

  it('blockt nach 3 E-Mails pro Minute', () => {
    const ip = `test-${Date.now()}-email`;
    expect(checkRateLimit(ip, 'email')).toBe(true);
    expect(checkRateLimit(ip, 'email')).toBe(true);
    expect(checkRateLimit(ip, 'email')).toBe(true);
    // Nr. 4 → geblockt
    expect(checkRateLimit(ip, 'email')).toBe(false);
  });

  it('isoliert verschiedene IPs', () => {
    const ip1 = `test-${Date.now()}-iso1`;
    const ip2 = `test-${Date.now()}-iso2`;
    
    // IP1 auslasten
    for (let i = 0; i < 20; i++) checkRateLimit(ip1, 'general');
    expect(checkRateLimit(ip1, 'general')).toBe(false);
    
    // IP2 hat eigenes Budget
    expect(checkRateLimit(ip2, 'general')).toBe(true);
  });

  it('isoliert general und email Limits', () => {
    const ip = `test-${Date.now()}-types`;
    
    // 3 E-Mails aufbrauchen
    for (let i = 0; i < 3; i++) checkRateLimit(ip, 'email');
    expect(checkRateLimit(ip, 'email')).toBe(false);
    
    // General-Budget ist davon unberührt
    expect(checkRateLimit(ip, 'general')).toBe(true);
  });
});
