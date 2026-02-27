import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Aliase damit Mocks sauber funktionieren
    alias: {
      '@upstash/redis': new URL('./tests/__mocks__/upstash-redis.js', import.meta.url).pathname,
      '@upstash/vector': new URL('./tests/__mocks__/upstash-vector.js', import.meta.url).pathname,
      '@getbrevo/brevo': new URL('./tests/__mocks__/brevo.js', import.meta.url).pathname,
      '@google/generative-ai': new URL('./tests/__mocks__/google-ai.js', import.meta.url).pathname,
    }
  }
});
