// tests/__mocks__/brevo.js
import { vi } from 'vitest';

export const brevoMock = {
  sendTransacEmail: vi.fn(async () => ({ messageId: 'mock-msg-123' })),
  setApiKey: vi.fn(),
  _reset: () => { brevoMock.sendTransacEmail.mockReset(); }
};

class TransactionalEmailsApi {
  constructor() {
    this.sendTransacEmail = brevoMock.sendTransacEmail;
    this.setApiKey = brevoMock.setApiKey;
  }
}

class SendSmtpEmail {
  constructor() {
    this.sender = null;
    this.to = null;
    this.subject = null;
    this.htmlContent = null;
    this.textContent = null;
    this.tags = null;
    this.headers = null;
  }
}

const TransactionalEmailsApiApiKeys = { apiKey: 0 };

export default {
  TransactionalEmailsApi,
  TransactionalEmailsApiApiKeys,
  SendSmtpEmail
};
