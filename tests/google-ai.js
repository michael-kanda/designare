// tests/__mocks__/google-ai.js
import { vi } from 'vitest';

export const generativeModelMock = {
  generateContent: vi.fn(async () => ({
    response: {
      candidates: [{
        content: {
          parts: [{ text: 'Mock-Antwort von Evita' }]
        }
      }],
      text: () => 'Mock-Antwort von Evita'
    }
  })),
  embedContent: vi.fn(async () => ({
    embedding: { values: new Array(768).fill(0.1) }
  })),
  _reset: () => {
    generativeModelMock.generateContent.mockReset();
    generativeModelMock.embedContent.mockReset();
  }
};

export class GoogleGenerativeAI {
  constructor() {}
  getGenerativeModel() {
    return generativeModelMock;
  }
}

// Enum für Tool-Deklarationen
export const FunctionDeclarationSchemaType = {
  STRING: 'STRING',
  OBJECT: 'OBJECT',
  ARRAY: 'ARRAY',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN'
};
