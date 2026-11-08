'use client';

import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useErrorMessage } from '@/components/app/states';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Sheet } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import { downgradeToFree, getBilling, type Billing } from '@/lib/api/billing';
import { useResource } from '@/lib/api/useResource';

/** Numbers from a PLAN_LIMIT error's `data`, or null when the payload is not as expected. */
function planLimitData(data: unknown): { limit: number; current: number } | null {
  if (typeof data !== 'object' || data === null) return null;
  const { limit, current } = data as Record<string, unknown>;
  return typeof limit === 'number' && typeof current === 'number' ? { limit, current } : null;
}

/** Settings plan card: current plan, bookable staff usage, test checkout behind a confirmation sheet. */
export function PlanCard() {
  const t = useTranslations('billing');
  const toast = useToast();
  const errorText = useErrorMessage();
  const billing = useResource(getBilling, 'billing');
  const [downOpen, setDownOpen] = useState(false);
  const [pending, setPending] = useState<'downgrade' | null>(null);
  const [error, setError] = useState<string>();

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

  const downgrade = async () => {
    if (pending) return;
    setPending('downgrade');
    setError(undefined);
    try {
      billing.setData(await downgradeToFree());
      toast.show(t('downgraded'));
    } catch (e) {
      const counts =
        e instanceof ApiError && e.code === 'PLAN_LIMIT' ? planLimitData(e.data) : null;
      setError(counts ? t('downgradeBlocked', counts) : errorText(e));
    } finally {
      setDownOpen(false);
      setPending(null);
    }
  };

  return (
    <Card
      as="section"
      padding="none"
      aria-labelledby="plan-card-title"
      className="flex flex-col gap-4 p-[22px] lg:self-start"
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
          <ButtonLink href="/app/checkout?plan=pro" variant="accent" size="row">
            {t('upgradeCta')}
          </ButtonLink>
        )}
      </div>

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
            onClick={() => setDownOpen(true)}
            disabled={pending !== null}
            className="inline-flex min-h-11 items-center font-semibold text-muted underline disabled:opacity-60"
          >
            {t('downgradeLink')}
          </button>
        ) : null}
      </div>

      <Sheet
        open={downOpen}
        onOpenChange={(open) => (pending ? undefined : setDownOpen(open))}
        title={t('downgradeConfirmTitle')}
        description={t('downgradeConfirmBody')}
        closeLabel={t('close')}
      >
        <div className="flex flex-col gap-3">
          <Button
            variant="danger"
            size="lg"
            block
            loading={pending === 'downgrade'}
            onClick={downgrade}
          >
            {t('downgradeConfirmCta')}
          </Button>
          <Button
            variant="secondary"
            block
            disabled={pending !== null}
            onClick={() => setDownOpen(false)}
          >
            {t('cancel')}
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}
