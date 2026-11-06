import { redirect } from 'next/navigation';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

/** The PR-4 placeholder is gone: old links lead to the barber's Today (owners to their own). */
export default async function Page() {
  await assertPractitionerPath('/app/welcome');
  redirect('/app');
}
