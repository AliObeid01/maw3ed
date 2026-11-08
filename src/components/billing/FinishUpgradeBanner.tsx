'use client';

import { Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useSyncExternalStore } from 'react';
import { useAppSession } from '@/components/app/SessionContext';
import { ButtonLink } from '@/components/ui/Button';
import { getBilling } from '@/lib/api/billing';
import { useResource } from '@/lib/api/useResource';
import { clearProIntent, proIntentFor } from '@/lib/billing/proIntent';

const SHOWN_ON = new Set(['/app', '/app/settings']);
const noop = () => () => undefined;

/**
 * "Finish upgrading to Pro": shown on the dashboard home and in Settings to an OWNER who picked Pro at signup and has not
 * paid yet. There is no dismiss button on purpose; it disappears when the plan is Pro. The account is never locked:
 * until then the business is simply on Free (one bookable staff member, enforced by the server).
 */
export function FinishUpgradeBanner() {
  const session = useAppSession();
  const pathname = usePathname();
  // The device-side reminder, read after mount so the server HTML never differs from the first client render.
  const intent = useSyncExternalStore(
    noop,
    () => proIntentFor(session.slug),
    () => false,
  );
  if (session.role !== 'OWNER' || !intent || !SHOWN_ON.has(pathname)) return null;
  return <Loaded />;
}

function Loaded() {
  const t = useTranslations('billing.finish');
  const billing = useResource(getBilling, 'billing-finish');
  const pro = billing.data?.plan === 'PRO';
  useEffect(() => {
    if (pro) clearProIntent();
  }, [pro]);
  if (!billing.data || pro) return null;
  return (
    <section
      aria-labelledby="finish-upgrade-title"
      data-testid="finish-upgrade"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-card-sm border border-brand bg-brand-soft p-4 text-brand-deep"
    >
      <span aria-hidden="true" className="flex shrink-0">
        <Sparkles size={20} />
      </span>
      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
        <h2 id="finish-upgrade-title" className="m-0 text-base font-semibold">
          {t('title')}
        </h2>
        <p className="m-0 text-sm leading-[1.45]">{t('body')}</p>
      </div>
      <ButtonLink href="/app/checkout?plan=pro" variant="accent" size="row">
        {t('cta')}
      </ButtonLink>
    </section>
  );
}
