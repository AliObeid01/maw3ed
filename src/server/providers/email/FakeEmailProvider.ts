import type { EmailMessage, EmailProvider, EmailResult } from './EmailProvider';

/** Records every call so tests can assert "sent exactly once". Repeating an idempotency key does not resend. */
export class FakeEmailProvider implements EmailProvider {
  readonly calls: EmailMessage[] = [];
  /** Distinct messages actually "delivered" (one per idempotency key). */
  readonly delivered = new Map<string, EmailResult>();
  failNext: Error | undefined;

  async send(message: EmailMessage): Promise<EmailResult> {
    this.calls.push(message);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    const existing = this.delivered.get(message.idempotencyKey);
    if (existing) return existing;
    const result = { providerMessageId: `fake-${this.delivered.size + 1}` };
    this.delivered.set(message.idempotencyKey, result);
    return result;
  }

  reset() {
    this.calls.length = 0;
    this.delivered.clear();
    this.failNext = undefined;
  }
}
