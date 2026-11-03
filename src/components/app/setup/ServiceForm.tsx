'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Input, Select } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Switch';
import { createService, updateService, type Service } from '@/lib/api/setup';
import { BUFFER_OPTIONS, DURATION_OPTIONS, parsePrice, withCurrent } from '@/lib/setup/duration';
import { errorKey, invalidFields } from '@/lib/setup/errors';
import { useErrorMessage, useSharedText } from '../states';
import { useAppFormat } from '@/lib/useAppFormat';

type FieldKey = 'name' | 'price';
const NAME_MAX = 80;

/** Add or edit one service (boards 3.5). Name, duration, buffer after, price and (when editing) active. */
export function ServiceForm({
  service,
  onSaved,
  onCancel,
}: {
  service?: Service;
  onSaved: (saved: Service, created: boolean) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('app.services');
  const shared = useSharedText();
  const errorText = useErrorMessage();
  const { duration, currencySymbol } = useAppFormat();
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState(service?.name ?? '');
  const [durationMin, setDurationMin] = useState(service?.durationMin ?? 30);
  const [bufferMin, setBufferMin] = useState(service?.bufferMin ?? 10);
  const [price, setPrice] = useState(service ? String(service.price) : '');
  const [active, setActive] = useState(service?.active ?? true);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [banner, setBanner] = useState<string>();
  const [pending, setPending] = useState(false);

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-form-banner]')
        ?.focus(),
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const next: Partial<Record<FieldKey, string>> = {};
    const trimmed = name.trim();
    if (!trimmed) next.name = t('errors.nameRequired');
    else if (trimmed.length > NAME_MAX) next.name = t('errors.nameTooLong', { max: NAME_MAX });
    const parsedPrice = price.trim() === '' ? 0 : parsePrice(price);
    if (parsedPrice === null) next.price = t('errors.priceInvalid');
    setErrors(next);
    setBanner(undefined);
    if (Object.keys(next).length > 0 || parsedPrice === null) {
      focusFirstInvalid();
      return;
    }

    setPending(true);
    try {
      const body = { name: trimmed, durationMin, bufferMin, price: parsedPrice };
      const saved = service
        ? await updateService(service.id, { ...body, active })
        : await createService(body);
      onSaved(saved, !service);
    } catch (error) {
      const fields = invalidFields(error);
      const serverErrors: Partial<Record<FieldKey, string>> = {};
      if (fields.includes('name')) serverErrors.name = t('errors.fieldInvalid');
      if (fields.includes('price')) serverErrors.price = t('errors.fieldInvalid');
      setErrors(serverErrors);
      setBanner(
        Object.keys(serverErrors).length > 0 && errorKey(error) === 'validation'
          ? t('errors.checkFields')
          : errorText(error),
      );
      focusFirstInvalid();
    } finally {
      setPending(false);
    }
  };

  const durations = withCurrent(DURATION_OPTIONS, durationMin);
  const buffers = withCurrent(BUFFER_OPTIONS, bufferMin);

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
      {banner ? (
        <div
          role="alert"
          tabIndex={-1}
          data-form-banner
          className="rounded-card-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Callout tone="danger" icon={<CircleAlert />}>
            {banner}
          </Callout>
        </div>
      ) : null}
      <Input
        label={t('field.name')}
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('field.namePlaceholder')}
        error={errors.name}
        autoComplete="off"
        maxLength={NAME_MAX + 20}
        enterKeyHint="next"
      />
      <div className="grid grid-cols-2 gap-2.5">
        <Select
          label={t('field.duration')}
          name="durationMin"
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
        >
          {durations.map((value) => (
            <option key={value} value={value}>
              {duration(value)}
            </option>
          ))}
        </Select>
        <Select
          label={t('field.buffer')}
          name="bufferMin"
          value={bufferMin}
          onChange={(e) => setBufferMin(Number(e.target.value))}
        >
          {buffers.map((value) => (
            <option key={value} value={value}>
              {duration(value)}
            </option>
          ))}
        </Select>
      </div>
      <Input
        label={t('field.price', { currency: currencySymbol() })}
        name="price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="0"
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        className="text-start"
        error={errors.price}
        hint={t('field.bufferHint')}
      />
      {service ? (
        <div className="flex min-h-[50px] items-center gap-3 rounded-input bg-canvas px-3.5">
          <span className="flex-1 text-[15px] font-medium">{t('field.active')}</span>
          <Switch checked={active} onCheckedChange={setActive} label={t('field.active')} />
        </div>
      ) : null}
      <div className="flex gap-2.5 pt-1">
        <Button
          variant="secondary"
          size="lg"
          className="min-w-0 flex-1"
          onClick={onCancel}
          disabled={pending}
        >
          {shared.cancel}
        </Button>
        <Button type="submit" size="lg" className="min-w-0 flex-1" loading={pending}>
          {pending ? shared.saving : shared.save}
        </Button>
      </div>
    </form>
  );
}
