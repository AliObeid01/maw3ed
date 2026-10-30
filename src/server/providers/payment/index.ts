import { FakePaymentProvider } from './FakePaymentProvider';
import type { PaymentProvider } from './PaymentProvider';

export type {
  CheckoutRequest,
  CheckoutSession,
  CheckoutStatus,
  PaymentProvider,
} from './PaymentProvider';
export { FakePaymentProvider } from './FakePaymentProvider';

const g = globalThis as unknown as { __maw3edFakePayment?: FakePaymentProvider };

/** The shared fake, so tests can inspect what the app "charged". */
export const fakePaymentProvider: FakePaymentProvider = (g.__maw3edFakePayment ??=
  new FakePaymentProvider());

/** Which provider is configured. Only the fake exists (test checkout); unset means fake. */
export function paymentProviderName(): string {
  return process.env.PAYMENT_PROVIDER || 'fake';
}

export function getPaymentProvider(): PaymentProvider {
  const name = paymentProviderName();
  if (name === 'fake') return fakePaymentProvider;
  throw new Error(`Unknown PAYMENT_PROVIDER "${name}".`);
}
