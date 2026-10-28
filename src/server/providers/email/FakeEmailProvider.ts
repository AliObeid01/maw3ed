import type { EmailMessage, EmailProvider, EmailResult } from './EmailProvider';

const MAX_RECORDED = 100;

/**
 * Records calls so tests can assert "sent exactly once" (keeps the last 100 so it cannot grow without
 * bound). Repeating an idempotency key does not resend.
 */
export class FakeEmailProvider implements EmailProvider {
  readonly calls: EmailMessage[] = [];
  /** Distinct messages actually "delivered" (one per idempotency key). */
  readonly delivered = new Map<string, EmailResult>();
  private sequence = 0;
  failNext: Error | undefined;

  async send(message: EmailMessage): Promise<EmailResult> {
    this.calls.push(message);
    if (this.calls.length > MAX_RECORDED) this.calls.shift();
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    const existing = this.delivered.get(message.idempotencyKey);
    if (existing) return existing;
    const result = { providerMessageId: `fake-${++this.sequence}` };
    this.delivered.set(message.idempotencyKey, result);
    if (this.delivered.size > MAX_RECORDED) {
      this.delivered.delete(this.delivered.keys().next().value as string);
    }
    return result;
  }

  reset() {
    this.calls.length = 0;
    this.delivered.clear();
    this.sequence = 0;
    this.failNext = undefined;
  }
}
