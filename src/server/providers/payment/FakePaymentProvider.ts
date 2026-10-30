import { createHash, randomUUID } from 'node:crypto';
import type {
  CheckoutRequest,
  CheckoutSession,
  CheckoutStatus,
  PaymentProvider,
} from './PaymentProvider';

const MAX_RECORDED = 100;
const FAKE_ID_PREFIX = 'fake_cs_';

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
  /** Test hook: ids whose status check answers something other than PAID. */
  readonly outcomes = new Map<string, CheckoutStatus>();
  readonly statusChecks: string[] = [];

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
    const externalId = `${FAKE_ID_PREFIX}${suffix}`;
    this.sessions.set(externalId, request);
    if (this.sessions.size > MAX_RECORDED)
      this.sessions.delete(this.sessions.keys().next().value as string);
    return { externalId, checkoutUrl: null };
  }

  /**
   * The simulated hosted checkout is paid the moment the customer presses the test button. It must work
   * across serverless instances (the session may have been created on another one), so any id this fake
   * issued counts as known; tests can force another outcome per id with `outcomes`.
   */
  async getStatus(externalId: string): Promise<CheckoutStatus> {
    this.statusChecks.push(externalId);
    if (this.statusChecks.length > MAX_RECORDED) this.statusChecks.shift();
    const forced = this.outcomes.get(externalId);
    if (forced) return forced;
    return this.sessions.has(externalId) || externalId.startsWith(FAKE_ID_PREFIX)
      ? 'PAID'
      : 'FAILED';
  }

  reset() {
    this.statusChecks.length = 0;
    this.outcomes.clear();
    this.calls.length = 0;
    this.sessions.clear();
    this.failNext = undefined;
  }
}
