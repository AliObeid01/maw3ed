export interface CheckoutRequest {
  businessId: string;
  purpose: 'PLAN';
  /** Amount in major units (for example dollars). */
  amount: number;
  currency: string;
  /** Provider-side de-duplication key; the same key yields the same checkout. */
  idempotencyKey?: string | undefined;
}

export interface CheckoutSession {
  externalId: string;
  /** Hosted checkout page, when the provider has one. The app never renders a card form itself. */
  checkoutUrl: string | null;
}

export type CheckoutStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface PaymentProvider {
  readonly name: string;
  /** True when no real money moves (the UI labels this TEST MODE). */
  readonly testMode: boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  getStatus(externalId: string): Promise<CheckoutStatus>;
}
