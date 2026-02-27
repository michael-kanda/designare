// tests/__mocks__/upstash-vector.js
import { vi } from 'vitest';

export const vectorMock = {
  query: vi.fn(async () => []),
  _reset: () => { vectorMock.query.mockReset(); }
};

export class Index {
  constructor() {
    return vectorMock;
  }
}
