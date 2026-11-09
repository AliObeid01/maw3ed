'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ltr } from '@/components/ui/Bidi';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { updateBusiness, type Business } from '@/lib/api/setup';
import { parseWhole } from '@/lib/setup/duration';
import { errorKey } from '@/lib/setup/errors';
import { useAppFormat } from '@/lib/useAppFormat';
import { useErrorMessage } from '../states';

const THRESHOLD_MAX = 20;
const AMOUNT_MAX = 1000;

/** At most two decimals, positive. Returns null for anything else. */
export function parseAmount(raw: string): number | null {
  const v = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= AMOUNT_MAX ? n : null;
}

/**
 * No-show deposits (FR-26, owner only). Saves on its own button (its own PATCH), so it never mixes with the business
 * form around it. PR-13: it sits INSIDE the Booking rules card (`embedded`: a divider and its own heading, no card of
 * its own); only the layout changed, the state, validation and save are the same. The amount is a USD placeholder: nothing real is charged.
 */
export function DepositSettings({
  business,
  onSaved,
  embedded = false,
}: {
  business: Business;
  onSaved: (b: Business) => void;
  embedded?: boolean;
}) {
  const t = useTranslations('app.settings.deposit');
  const errorText = useErrorMessage();
  const toast = useToast();
  const { money } = useAppFormat();
  const uid = useId();
  const [saved, setSaved] = useState(business.deposit);
  const [enabled, setEnabled] = useState(saved.enabled);
  const [threshold, setThreshold] = useState(String(saved.threshold));
  const [amount, setAmount] = useState(String(saved.amount));
  const [errors, setErrors] = useState<{ threshold?: string; amount?: string }>({});
  const [banner, setBanner] = useState<string>();
  const [pending, setPending] = useState(false);

  const dirty =
    enabled !== saved.enabled ||
    threshold !== String(saved.threshold) ||
    amount !== String(saved.amount);

  async function save() {
    if (pending || !dirty) return;
    const n = parseWhole(threshold);
    const a = parseAmount(amount);
    const next: typeof errors = {};
    if (n === null || n < 1 || n > THRESHOLD_MAX)
      next.threshold = t('errors.threshold', { min: 1, max: THRESHOLD_MAX });
    if (a === null) next.amount = t('errors.amount', { min: 1, max: AMOUNT_MAX });
    setErrors(next);
    setBanner(undefined);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    try {
      const result = await updateBusiness({
        depositEnabled: enabled,
        depositThreshold: n!,
        depositAmount: a!,
      });
      setSaved(result.deposit);
      setThreshold(String(result.deposit.threshold));
      setAmount(String(result.deposit.amount));
      setEnabled(result.deposit.enabled);
      onSaved(result);
      toast.show(t('saved'));
    } catch (error) {
      setBanner(errorKey(error) === 'validation' ? t('errors.check') : errorText(error));
    } finally {
      setPending(false);
    }
  }

  const Wrapper = embedded ? 'section' : Card;
  const wrapperProps = embedded
    ? { className: 'mt-1 flex flex-col gap-4 border-t border-divider pt-5' }
    : { padding: 'none' as const, as: 'section' as const, className: 'flex flex-col gap-4 p-[22px]' };
  const Heading = embedded ? 'h3' : 'h2';
  return (
    <Wrapper aria-labelledby={`${uid}-deposit`} {...wrapperProps}>
      <Heading id={`${uid}-deposit`} className="m-0 text-lg font-semibold">
        {t('title')}
      </Heading>
      {banner ? (
        <div role="alert">
          <Callout tone="danger" icon={<CircleAlert />}>
            {banner}
          </Callout>
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium">{t('enabled')}</span>
          <span className="text-[13px] text-muted">{t('enabledHint')}</span>
        </span>
        <Switch checked={enabled} onCheckedChange={setEnabled} label={t('enabled')} />
      </div>
      <Input
        label={t('threshold')}
        hint={t('thresholdHint')}
        name="depositThreshold"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        value={threshold}
        onChange={(e) => setThreshold(e.target.value)}
        error={errors.threshold}
        disabled={!enabled}
      />
      <Input
        label={t('amount')}
        hint={t('amountHint', { value: ltr(money(parseAmount(amount) ?? saved.amount)) })}
        name="depositAmount"
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={errors.amount}
        disabled={!enabled}
      />
      <p className="m-0 text-[13px] text-muted">{t('testMode')}</p>
      <Button type="button" onClick={save} loading={pending} disabled={!dirty}>
        {t('save')}
      </Button>
    </Wrapper>
  );
}
