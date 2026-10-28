import type { EmailProvider } from './EmailProvider';
import { FakeEmailProvider } from './FakeEmailProvider';

export type { EmailMessage, EmailProvider, EmailResult } from './EmailProvider';
export { FakeEmailProvider } from './FakeEmailProvider';

const g = globalThis as unknown as { __maw3edFakeEmail?: FakeEmailProvider };

/** The shared fake, so tests can inspect what the app "sent". */
export const fakeEmailProvider: FakeEmailProvider = (g.__maw3edFakeEmail ??=
  new FakeEmailProvider());

/** True when running with the fake provider (the default), e.g. to expose dev-only links. */
export const isFakeEmail = () => (process.env.EMAIL_PROVIDER ?? 'fake') === 'fake';

export function getEmailProvider(): EmailProvider {
  const name = process.env.EMAIL_PROVIDER ?? 'fake';
  if (name === 'fake') return fakeEmailProvider;
  if (name === 'resend') throw new Error('EMAIL_PROVIDER=resend is not implemented yet.');
  throw new Error(`Unknown EMAIL_PROVIDER "${name}".`);
}
