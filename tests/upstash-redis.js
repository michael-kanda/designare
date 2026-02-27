// tests/__mocks__/upstash-redis.js
// Mock Redis – alle Methoden trackbar via vi.fn()
import { vi } from 'vitest';

const store = new Map();
const sets = new Map();

export const redisMock = {
  get: vi.fn(async (key) => store.get(key) || null),
  set: vi.fn(async (key, value) => { store.set(key, value); return 'OK'; }),
  sismember: vi.fn(async (key, member) => {
    const s = sets.get(key);
    return s ? s.has(member) : false;
  }),
  scard: vi.fn(async (key) => {
    const s = sets.get(key);
    return s ? s.size : 0;
  }),
  sadd: vi.fn(async (key, member) => {
    if (!sets.has(key)) sets.set(key, new Set());
    sets.get(key).add(member);
    return 1;
  }),
  // Helpers für Tests
  _store: store,
  _sets: sets,
  _reset: () => { store.clear(); sets.clear(); }
};

export class Redis {
  constructor() {
    return redisMock;
  }
}
