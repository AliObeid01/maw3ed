'use client';

import { Check, CircleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { OwnerOnly, useErrorMessage } from '@/components/app/states';
import { ltr } from '@/components/ui/Bidi';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api/auth';
import { checkoutPro, getBilling } from '@/lib/api/billing';
import { useResource } from '@/lib/api/useResource';
import { useAppFormat } from '@/lib/useAppFormat';
import { clearProIntent } from '@/lib/billing/proIntent';
import type { Scenario } from '@/lib/billing/testCard';
import { TestCardForm } from './TestCardForm';

type Outcome = 'idle' | 'paying' | 'declined' | 'failed' | 'paid';

/**
 * /app/checkout?plan=pro: the one place an owner becomes Pro. Order summary plus the TEST card form. The page
 * sends the endpoint only `{ plan: 'PRO', scenario }`; whatever was typed in the card fields stays in the form.
 */
export function CheckoutView() {
  return (
    <OwnerOnly>
      <OwnerCheckout />
    </OwnerOnly>
  );
}

function OwnerCheckout() {
  const t = useTranslations('billing');
  const router = useRouter();
  const errorText = useErrorMessage();
  const { money } = useAppFormat();
  const billing = useResource(getBilling, 'billing-checkout');
  const [outcome, setOutcome] = useState<Outcome>('idle');
  const [message, setMessage] = useState<string>();
  // One key per page visit: a double tap or a retry after a lost response can never charge twice.
  const keyRef = useRef<string>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const wasPro = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (billing.data && wasPro.current === undefined) wasPro.current = billing.data.plan === 'PRO';
  }, [billing.data]);
  useEffect(() => {
    if (outcome === 'paid') headingRef.current?.focus();
  }, [outcome]);

  if (billing.error && !billing.data)
    return (
      <Card className="flex flex-col items-start gap-3">
        <p role="alert" className="m-0 text-sm text-danger">
          {t('checkout.loadFailed')}
        </p>
        <Button variant="secondary" onClick={billing.reload}>
          {t('retry')}
        </Button>
      </Card>
    );
  if (!billing.data)
    return (
      <div aria-busy="true" className="grid gap-5 lg:grid-cols-2">
        <Skeleton aria-hidden="true" className="h-[200px] rounded-card" />
        <Skeleton aria-hidden="true" className="h-[420px] rounded-card" />
      </div>
    );

  const pro = billing.data.plan === 'PRO';
  const priceText = money(billing.data.price.amount);
  const price = ltr(t('price', { amount: billing.data.price.amount }));

  async function pay(scenario: Scenario) {
    if (outcome === 'paying') return;
    keyRef.current ??= crypto.randomUUID();
    setOutcome('paying');
    setMessage(undefined);
    try {
      billing.setData(await checkoutPro(keyRef.current, scenario));
      keyRef.current = undefined;
      clearProIntent();
      setOutcome('paid');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PAYMENT_DECLINED') {
        setOutcome('declined');
      } else {
        setOutcome('failed');
        setMessage(errorText(error));
      }
    }
  }

  if (outcome === 'paid' || pro) {
    const justNow = outcome === 'paid';
    return (
      <Card className="mx-auto flex w-full max-w-[560px] flex-col gap-4" data-testid="checkout-done">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand"
        >
          <Check size={26} />
        </span>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="m-0 text-[22px] font-semibold outline-none md:text-[26px]"
        >
          {justNow ? t('checkout.successTitle') : t('checkout.alreadyTitle')}
        </h2>
        <p role="status" className="m-0 text-[15px] text-muted">
          {justNow ? t('checkout.successBody') : t('checkout.alreadyBody')}
        </p>
        <ButtonLink href="/app" variant="accent" size="lg" block>
          {t('checkout.goDashboard')}
        </ButtonLink>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
      {/* The page title is the shell header's h1. */}
      <p className="m-0 text-base text-muted">{t('checkout.subtitle')}</p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <Card as="section" aria-labelledby="checkout-summary" className="flex flex-col gap-4">
          <h2 id="checkout-summary" className="m-0 text-lg font-semibold">
            {t('checkout.summary')}
          </h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-[18px] gap-y-3 text-base">
            <dt className="text-muted">{t('checkout.plan')}</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2 font-medium">
              {t('checkout.planValue')}
              <Chip tone="warning">{t('testBadge')}</Chip>
            </dd>
            <dt className="text-muted">{t('checkout.price')}</dt>
            <dd className="m-0 font-medium">{price}</dd>
          </dl>
          <p className="m-0 flex items-start gap-2 text-[15px]">
            <Check size={20} strokeWidth={2.5} aria-hidden="true" className="mt-px shrink-0 text-success" />
            {t('checkout.perk')}
          </p>
          <div className="h-px bg-divider" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3">
            <span className="text-lg font-semibold">{t('checkout.total')}</span>
            <span dir="ltr" className="text-[30px] leading-none font-semibold tabular-nums">
              {priceText}
            </span>
          </div>
        </Card>

        <Card as="section" className="flex flex-col gap-4">
          <TestCardForm
            amountText={priceText}
            busy={outcome === 'paying'}
            onPay={(scenario) => void pay(scenario)}
            alert={
              outcome === 'declined' || outcome === 'failed' ? (
                <div role="alert" data-testid="checkout-problem">
                  <Callout tone="danger" icon={<CircleAlert />}>
                    {outcome === 'declined' ? (
                      <b className="block font-semibold">{t('checkout.declinedTitle')}</b>
                    ) : null}
                    {outcome === 'declined' ? t('checkout.declined') : (message ?? t('checkout.failed'))}
                  </Callout>
                </div>
              ) : null
            }
          />
        </Card>
      </div>
    </div>
  );
}

