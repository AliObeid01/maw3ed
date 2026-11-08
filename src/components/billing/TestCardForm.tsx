'use client';

import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ltr } from '@/components/ui/Bidi';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Input } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import {
  TEST_CARD_DECLINED,
  TEST_CARD_SUCCESS,
  formatCardNumber,
  formatCvc,
  formatExpiry,
  scenarioFor,
  validateCard,
  type CardErrors,
  type CardField,
  type Scenario,
} from '@/lib/billing/testCard';

const ORDER: readonly CardField[] = ['number', 'expiry', 'cvc', 'name'];

/**
 * The TEST card form shared by the Pro checkout and the deposit page. It behaves like a real card form (formatted
 * input, Luhn, expiry in the future, autofill hints) but it is a simulation: the typed values are checked in this
 * component and NEVER leave it. `onPay` receives only the scenario derived from the typed number. There is no
 * `name` attribute on any field, no storage, no logging and no network call here.
 */
export function TestCardForm({
  amountText,
  busy,
  onPay,
  alert,
  className,
}: {
  /** Already formatted, for example "$9". */
  amountText: string;
  busy: boolean;
  /** The only thing that leaves the form. */
  onPay: (scenario: Scenario) => void;
  /** An error from the last attempt (declined, network...), shown above the button. */
  alert?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('testCard');
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [name, setName] = useState('');
  const [pick, setPick] = useState<Scenario>('success');
  const [errors, setErrors] = useState<CardErrors>({});
  const [tick, setTick] = useState(0);

  // After a failed submit, focus the first invalid field.
  useEffect(() => {
    if (tick === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [tick]);

  const options = useMemo(
    () => [
      { value: 'success', label: t('scenario.success') },
      { value: 'declined', label: t('scenario.declined') },
    ],
    [t],
  );

  const text = (field: CardField) => {
    const code = errors[field];
    if (!code) return undefined;
    if (code === 'expired') return t('errors.expiry.expired');
    if (field === 'number') return t(code === 'required' ? 'errors.number.required' : 'errors.number.invalid');
    if (field === 'expiry') return t(code === 'required' ? 'errors.expiry.required' : 'errors.expiry.invalid');
    if (field === 'cvc') return t(code === 'required' ? 'errors.cvc.required' : 'errors.cvc.invalid');
    return t(code === 'required' ? 'errors.name.required' : 'errors.name.invalid');
  };
  const clear = (field: CardField) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  function fill() {
    const year = String((new Date().getFullYear() + 3) % 100).padStart(2, '0');
    setNumber(pick === 'declined' ? TEST_CARD_DECLINED : TEST_CARD_SUCCESS);
    setExpiry(`12/${year}`);
    setCvc('123');
    setName('Test Customer');
    setErrors({});
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = validateCard({ number, expiry, cvc, name }, new Date());
    const clean: CardErrors = {};
    for (const key of ORDER) if (found[key]) clean[key] = found[key];
    setErrors(clean);
    if (Object.keys(clean).length > 0) {
      setTick((n) => n + 1);
      return;
    }
    const scenario = scenarioFor(number);
    if (scenario) onPay(scenario);
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      autoComplete="on"
      aria-labelledby={`${id}-title`}
      data-testid="test-card-form"
      className={className ?? 'flex flex-col gap-4'}
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="m-0 text-lg font-semibold">
          {t('heading')}
        </h2>
        <p className="m-0 text-[13px] text-muted">{t('privacy')}</p>
      </div>

      <Callout tone="warning" icon={<FlaskConical />}>
        {t('testMode')}
      </Callout>

      <div className="flex flex-col gap-3 rounded-card-sm bg-canvas p-3.5">
        <Select
          label={t('scenarioLabel')}
          title={t('scenarioTitle')}
          value={pick}
          onChange={(v) => setPick(v === 'declined' ? 'declined' : 'success')}
          options={options}
          hint={t('hint', {
            number: ltr(pick === 'declined' ? TEST_CARD_DECLINED : TEST_CARD_SUCCESS),
          })}
          disabled={busy}
        />
        <Button type="button" variant="secondary" size="row" disabled={busy} onClick={fill}>
          {t('fill')}
        </Button>
      </div>

      <Input
        label={t('number')}
        type="text"
        dir="ltr"
        inputMode="numeric"
        autoComplete="cc-number"
        placeholder={t('numberPlaceholder')}
        value={number}
        onChange={(e) => {
          setNumber(formatCardNumber(e.target.value));
          clear('number');
        }}
        error={text('number')}
        readOnly={busy}
        spellCheck={false}
        className="tabular-nums"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label={t('expiry')}
          type="text"
          dir="ltr"
          inputMode="numeric"
          autoComplete="cc-exp"
          placeholder={t('expiryPlaceholder')}
          value={expiry}
          onChange={(e) => {
            setExpiry(formatExpiry(e.target.value));
            clear('expiry');
          }}
          error={text('expiry')}
          readOnly={busy}
          spellCheck={false}
          maxLength={5}
          className="tabular-nums"
        />
        <Input
          label={t('cvc')}
          type="text"
          dir="ltr"
          inputMode="numeric"
          autoComplete="cc-csc"
          placeholder={t('cvcPlaceholder')}
          value={cvc}
          onChange={(e) => {
            setCvc(formatCvc(e.target.value));
            clear('cvc');
          }}
          error={text('cvc')}
          readOnly={busy}
          spellCheck={false}
          maxLength={4}
          className="tabular-nums"
        />
      </div>
      <Input
        label={t('name')}
        type="text"
        autoComplete="cc-name"
        placeholder={t('namePlaceholder')}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          clear('name');
        }}
        error={text('name')}
        readOnly={busy}
        maxLength={80}
      />

      {alert}

      <Button type="submit" variant="accent" size="lg" block loading={busy} disabled={busy}>
        {busy ? t('paying') : t('pay', { amount: ltr(amountText) })}
      </Button>
    </form>
  );
}
