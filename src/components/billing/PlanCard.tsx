'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useErrorMessage } from '@/components/app/states';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import { checkoutPro, downgradeToFree, getBilling, type Billing } from '@/lib/api/billing';
import { useResource } from '@/lib/api/useResource';

/** Settings plan card: current plan, bookable staff usage, test checkout behind a confirmation sheet. */
export function PlanCard() {
  const t = useTranslations('billing');
  const toast = useToast();
  const errorText = useErrorMessage();
  const billing = useResource(getBilling, 'billing');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<'upgrade' | 'downgrade' | null>(null);
  const [error, setError] = useState<string>();
  const [justUpgraded, setJustUpgraded] = useState(false);
  // One key per confirmation, reused if the owner taps again, so a retry can never charge twice.
  const keyRef = useRef<string>(undefined);

  if (billing.error && !billing.data)
    return (
      <Card as="section" padding="none" className="flex flex-col gap-3 p-[22px]">
        <p role="alert" className="m-0 text-sm text-danger">
          {t('loadFailed')}
        </p>
        <Button variant="secondary" onClick={billing.reload}>
          {t('retry')}
        </Button>
      </Card>
    );
  if (!billing.data) return <Skeleton aria-hidden="true" className="h-[120px] rounded-card" />;

  const data: Billing = billing.data;
  const pro = data.plan === 'PRO';
  const limit = data.limits.bookableStaff;
  const price = t('price', { amount: data.price.amount });

  const upgrade = async () => {
    if (pending) return;
    keyRef.current ??= crypto.randomUUID();
    setPending('upgrade');
    setError(undefined);
    try {
      billing.setData(await checkoutPro(keyRef.current));
      keyRef.current = undefined;
      setConfirmOpen(false);
      setJustUpgraded(true);
      toast.show(t('upgraded'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(null);
    }
  };

  const downgrade = async () => {
    if (pending) return;
    setPending('downgrade');
    setError(undefined);
    try {
      billing.setData(await downgradeToFree());
      setJustUpgraded(false);
      toast.show(t('downgraded'));
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'PLAN_LIMIT'
          ? t('downgradeBlocked', { limit: limit ?? 1, current: data.usage.bookableStaff })
          : errorText(e),
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <Card
      as="section"
      padding="none"
      aria-labelledby="plan-card-title"
      className="flex flex-col gap-4 p-[22px] lg:col-span-2"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-[3px]">
          <span className="text-[13px] text-muted">{t('label')}</span>
          <span className="flex items-center gap-2">
            <span id="plan-card-title" className="text-xl font-semibold">
              {pro ? t('pro') : t('free')}
            </span>
            {data.testMode ? <Chip tone="neutral">{t('testBadge')}</Chip> : null}
          </span>
          <span className="text-sm text-muted">
            {limit === null
              ? t('usageUnlimited', { current: data.usage.bookableStaff })
              : t('usage', { current: data.usage.bookableStaff, limit })}
          </span>
        </div>
        {pro ? null : (
          <Button variant="accent" size="row" onClick={() => setConfirmOpen(true)}>
            {t('upgradeCta')}
          </Button>
        )}
      </div>

      {justUpgraded && pro ? (
        <Callout tone="brand">
          <span role="status">{t('successBody')}</span>
        </Callout>
      ) : null}
      {error ? (
        <div role="alert">
          <Callout tone="danger" icon={<CircleAlert />}>
            {error}
          </Callout>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Link
          href="/pricing"
          className="inline-flex min-h-11 items-center font-semibold text-brand"
        >
          {t('comparePlans')}
        </Link>
        {pro ? (
          <button
            type="button"
            onClick={downgrade}
            disabled={pending !== null}
            className="inline-flex min-h-11 items-center font-semibold text-muted underline disabled:opacity-60"
          >
            {t('downgradeLink')}
          </button>
        ) : null}
      </div>

      <Sheet
        open={confirmOpen}
        onOpenChange={(open) => (pending ? undefined : setConfirmOpen(open))}
        title={t('confirmTitle')}
        description={t('confirmBody', { price })}
        closeLabel={t('close')}
      >
        <div className="flex flex-col gap-4">
          <Callout tone="warning" icon={<CircleAlert />}>
            {t('testModeNote')}
          </Callout>
          {error ? (
            <p role="alert" className="m-0 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button
            variant="accent"
            size="lg"
            block
            loading={pending === 'upgrade'}
            onClick={upgrade}
          >
            {t('confirmCta')}
          </Button>
          <Button
            variant="secondary"
            block
            disabled={pending !== null}
            onClick={() => setConfirmOpen(false)}
          >
            {t('cancel')}
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}
