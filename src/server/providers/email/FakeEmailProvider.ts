import { createHash } from 'node:crypto';
import {
  EmailSendError,
  IDEMPOTENT_MISMATCH,
  type EmailMessage,
  type EmailProvider,
  type EmailResult,
} from './EmailProvider';

const fingerprint = (m: EmailMessage) =>
  createHash('sha256')
    .update(JSON.stringify([m.to, m.subject, m.text, m.html, m.attachments ?? null]))
    .digest('hex');

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
  /**
   * Like Resend: the same idempotency key with a different request is rejected (409
   * invalid_idempotent_request) instead of silently deduplicated. On by default so tests catch payloads
   * that vary between attempts.
   */
  strictIdempotency = true;
  private readonly fingerprints = new Map<string, string>();

  async send(message: EmailMessage): Promise<EmailResult> {
    this.calls.push(message);
    if (this.calls.length > MAX_RECORDED) this.calls.shift();
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    const hash = fingerprint(message);
    const existing = this.delivered.get(message.idempotencyKey);
    if (existing) {
      if (this.strictIdempotency && this.fingerprints.get(message.idempotencyKey) !== hash)
        throw new EmailSendError(IDEMPOTENT_MISMATCH, true);
      return existing;
    }
    this.fingerprints.set(message.idempotencyKey, hash);
    const result = { providerMessageId: `fake-${++this.sequence}` };
    this.delivered.set(message.idempotencyKey, result);
    if (this.delivered.size > MAX_RECORDED) {
      const oldest = this.delivered.keys().next().value as string;
      this.delivered.delete(oldest);
      this.fingerprints.delete(oldest);
    }
    return result;
  }

  reset() {
    this.calls.length = 0;
    this.delivered.clear();
    this.fingerprints.clear();
    this.strictIdempotency = true;
    this.sequence = 0;
    this.failNext = undefined;
  }
}
