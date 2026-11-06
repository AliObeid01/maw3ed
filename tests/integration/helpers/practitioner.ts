import { POST as activate } from '@/app/api/activation/[token]/route';
import { POST as giveLogin } from '@/app/api/staff/[id]/login/route';
import { POST as createStaff } from '@/app/api/staff/route';
import { call } from './api';

export const FAKE_PHONE = '+96170000001';

/** The owner creates a staff member, gives a login for a fake number and the barber activates it. */
export async function activatedPractitioner(
  owner: { cookie: string },
  phone = FAKE_PHONE,
  name = 'Barber One',
) {
  const s = await call(createStaff, '/api/staff', {
    body: { displayName: name, bookable: false, serviceIds: [] },
    cookie: owner.cookie,
  });
  const staffId = s.body!.id as string;
  const l = await call(giveLogin, `/api/staff/${staffId}/login`, {
    body: { phone },
    cookie: owner.cookie,
    params: { id: staffId },
  });
  const token = (l.body!.url as string).split('/activate/')[1]!;
  const a = await call(activate, `/api/activation/${token}`, {
    body: { password: 'correct-horse-battery' },
    params: { token },
  });
  if (a.status !== 200) throw new Error(`activation failed: ${a.status}`);
  return { staffId, cookie: a.cookie as string, userId: a.body!.user.id as string };
}
