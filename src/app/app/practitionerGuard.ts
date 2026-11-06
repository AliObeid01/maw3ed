import { redirect } from 'next/navigation';
import { PRACTITIONER_HOME, practitionerGate } from '@/lib/auth/practitionerPaths';
import { loadSession } from './loadSession';

/**
 * Called first by EVERY server page under src/app/app with the page's own path (a literal, not a header). The layout
 * guard alone is not enough: a client-side soft navigation does not re-run layouts, so each page checks again on the
 * server. A barber on a page that is not theirs is redirected to Today; owners and receptionists pass through.
 * (`tests/unit/auth/practitionerGuard.test.ts` fails when a page forgets to call it.)
 */
export async function assertPractitionerPath(pathname: string) {
  const session = await loadSession();
  // `forbidden` means an unknown page: for a page that is a coding mistake, so go home rather than render.
  if (practitionerGate(session.role, pathname).kind !== 'allow') redirect(PRACTITIONER_HOME);
  return session;
}
