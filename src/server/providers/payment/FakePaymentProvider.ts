import { createHash, randomUUID } from 'node:crypto';
import type {
  CheckoutRequest,
  CheckoutSession,
  CheckoutStatus,
  PaymentProvider,
} from './PaymentProvider';

const MAX_RECORDED = 100;

/**
 * Simulated hosted test checkout: every checkout is paid instantly. Records calls so tests can assert how
 * often a checkout ran. Never sees or stores card data.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake';
  readonly testMode = true;
  readonly calls: CheckoutRequest[] = [];
  readonly sessions = new Map<string, CheckoutRequest>();
  failNext: Error | undefined;

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    this.calls.push(request);
    if (this.calls.length > MAX_RECORDED) this.calls.shift();
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    const suffix = request.idempotencyKey
      ? createHash('sha256')
          .update(`${request.businessId}:${request.idempotencyKey}`)
          .digest('hex')
          .slice(0, 24)
      : randomUUID().replaceAll('-', '').slice(0, 24);
    const externalId = `fake_cs_${suffix}`;
    this.sessions.set(externalId, request);
    if (this.sessions.size > MAX_RECORDED)
      this.sessions.delete(this.sessions.keys().next().value as string);
    return { externalId, checkoutUrl: null };
  }

  async getStatus(externalId: string): Promise<CheckoutStatus> {
    return this.sessions.has(externalId) ? 'PAID' : 'FAILED';
  }

  reset() {
    this.calls.length = 0;
    this.sessions.clear();
    this.failNext = undefined;
  }
}
