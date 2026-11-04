'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Bidi } from '@/components/ui/Bidi';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { useAppSession } from '../SessionContext';
import { AccountCard } from './AccountCard';

/**
 * /app/account, for every signed-in role (OWNER and STAFF). Who you are, the password and sessions
 * (sign out here or on other devices). Only the signed-in user's own data: nothing about the business or other people.
 */
export function AccountView() {
  const t = useTranslations('app.account');
  const tf = useTranslations('app.frame');
  const uid = useId();
  const { userName, email, emailVerified, role } = useAppSession();
  return (
    <div className="flex max-w-xl flex-col gap-4 lg:grid lg:max-w-4xl lg:grid-cols-2 lg:items-start lg:gap-5">
      <Card padding="none" as="section" aria-labelledby={`${uid}-profile`} className="flex flex-col gap-4 p-[22px]">
        <h2 id={`${uid}-profile`} className="m-0 text-lg font-semibold">
          {t('profile.title')}
        </h2>
        <dl className="m-0 flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{t('profile.name')}</dt>
            <dd className="m-0 text-base font-semibold">{userName}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted">{t('profile.email')}</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2">
              <Bidi dir="ltr" className="min-w-0 text-base font-semibold break-all">{email}</Bidi>
              <Chip tone={emailVerified ? 'success' : 'warning'}>
                {emailVerified ? t('profile.verified') : t('profile.unverified')}
              </Chip>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted">{t('profile.role')}</dt>
            <dd className="m-0 text-base font-semibold">{tf(`role.${role}`)}</dd>
          </div>
        </dl>
      </Card>

      <AccountCard />
    </div>
  );
}
