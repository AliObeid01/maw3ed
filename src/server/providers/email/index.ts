import type { EmailProvider } from './EmailProvider';
import { FakeEmailProvider } from './FakeEmailProvider';
import { ResendEmailProvider } from './ResendEmailProvider';

export type { EmailAttachment, EmailMessage, EmailProvider, EmailResult } from './EmailProvider';
export { EmailSendError, IDEMPOTENT_MISMATCH } from './EmailProvider';
export { ResendEmailProvider } from './ResendEmailProvider';
export { FakeEmailProvider } from './FakeEmailProvider';

const g = globalThis as unknown as { __maw3edFakeEmail?: FakeEmailProvider };

/** The shared fake, so tests can inspect what the app "sent". */
export const fakeEmailProvider: FakeEmailProvider = (g.__maw3edFakeEmail ??=
  new FakeEmailProvider());

/** Test seam: replace the provider that `getEmailProvider` returns for a non-fake name. */
let override: EmailProvider | undefined;
export function setEmailProviderOverride(provider: EmailProvider | undefined) {
  override = provider;
}

/**
 * Which provider is configured. Fails CLOSED: in production an unset or 'fake' EMAIL_PROVIDER is a
 * configuration error, never a silent fallback to the fake.
 */
export function emailProviderName(): string {
  const configured = process.env.EMAIL_PROVIDER;
  if (process.env.NODE_ENV === 'production') {
    if (!configured || configured === 'fake')
      throw new Error(
        'EMAIL_PROVIDER must be set to a real provider in production (unset or "fake" is not allowed).',
      );
    return configured;
  }
  return configured || 'fake';
}

/** True only for the fake provider outside production. Production never reports fake (it throws). */
export const isFakeEmail = () => emailProviderName() === 'fake';

export function getEmailProvider(): EmailProvider {
  const name = emailProviderName();
  if (name === 'fake') return fakeEmailProvider;
  if (override) return override;
  if (name === 'resend') {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey) throw new Error('RESEND_API_KEY must be set when EMAIL_PROVIDER=resend.');
    if (!from) throw new Error('EMAIL_FROM must be set when EMAIL_PROVIDER=resend.');
    return new ResendEmailProvider({ apiKey, from });
  }
  throw new Error(`Unknown EMAIL_PROVIDER "${name}".`);
}
