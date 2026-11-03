'use client';

import { Check, CircleAlert, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Input } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Switch';
import {
  createStaff,
  setStaffServices,
  updateStaff,
  type Service,
  type StaffMember,
} from '@/lib/api/setup';
import { ApiError } from '@/lib/api/auth';
import { cn } from '@/lib/cn';
import { errorKey, invalidFields } from '@/lib/setup/errors';
import { useErrorMessage, useSharedText } from '../states';

const NAME_MAX = 60;

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Add or edit one staff member (board 3.6): display name, bookable switch, services performed, deactivate. */
export function StaffForm({
  member,
  services,
  onSaved,
  onPartialSave,
  onCancel,
}: {
  member?: StaffMember;
  services: Service[];
  onSaved: (saved: StaffMember, created: boolean) => void;
  /** The name/bookable change was saved but a later step failed: refresh the list without a success toast. */
  onPartialSave: (saved: StaffMember) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('app.staff');
  const shared = useSharedText();
  const errorText = useErrorMessage();
  const formRef = useRef<HTMLFormElement>(null);

  const [displayName, setDisplayName] = useState(member?.displayName ?? '');
  const [bookable, setBookable] = useState(member?.bookable ?? true);
  const [serviceIds, setServiceIds] = useState<string[]>(member?.serviceIds ?? []);
  const [nameError, setNameError] = useState<string>();
  const [banner, setBanner] = useState<string>();
  const [upgrade, setUpgrade] = useState(false);
  const tb = useTranslations('billing');
  const upgradeLabel = tb('upgradeLink');
  const limitTitle = tb('staffLimitTitle');
  /** Show a failed save; a plan limit gets the friendly message and an upgrade link. */
  const fail = (error: unknown, fallback?: string) => {
    const limit = error instanceof ApiError && error.code === 'PLAN_LIMIT';
    setUpgrade(limit);
    setBanner(limit ? tb('staffLimit') : (fallback ?? errorText(error)));
  };
  const [pending, setPending] = useState<'save' | 'toggleActive' | null>(null);

  const label = member?.displayName ?? t('thisPerson');
  const activeServices = services.filter((s) => s.active);
  // Services the member already performs stay visible even if hidden since, so they can be unticked.
  const shown = services.filter((s) => s.active || serviceIds.includes(s.id));

  const focusFirstInvalid = () =>
    requestAnimationFrame(() =>
      formRef.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-form-banner]')
        ?.focus(),
    );

  const toggleService = (id: string) =>
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const name = displayName.trim();
    setBanner(undefined);
    setUpgrade(false);
    if (!name) {
      setNameError(t('errors.nameRequired'));
      focusFirstInvalid();
      return;
    }
    if (name.length > NAME_MAX) {
      setNameError(t('errors.nameTooLong', { max: NAME_MAX }));
      focusFirstInvalid();
      return;
    }
    setNameError(undefined);
    setPending('save');
    let partial: StaffMember | undefined;
    try {
      if (!member) {
        const created = await createStaff({ displayName: name, bookable, serviceIds });
        onSaved(created, true);
        return;
      }
      let saved = member;
      if (name !== member.displayName || bookable !== member.bookable) {
        saved = await updateStaff(member.id, { displayName: name, bookable });
        partial = saved;
      }
      let ids = member.serviceIds;
      if (!sameSet(serviceIds, member.serviceIds))
        ids = await setStaffServices(member.id, serviceIds);
      onSaved({ ...saved, serviceIds: ids }, false);
    } catch (error) {
      if (partial) onPartialSave(partial);
      if (invalidFields(error).includes('displayName')) setNameError(t('errors.fieldInvalid'));
      fail(error);
      focusFirstInvalid();
    } finally {
      setPending(null);
    }
  };

  const setActive = async (active: boolean) => {
    if (!member || pending) return;
    setPending('toggleActive');
    setBanner(undefined);
    setUpgrade(false);
    try {
      const saved = await updateStaff(member.id, { active });
      onSaved({ ...saved, serviceIds: member.serviceIds }, false);
    } catch (error) {
      fail(
        error,
        errorKey(error) === 'hasFutureAppointments'
          ? t('errors.hasFutureAppointments', { name: label })
          : undefined,
      );
      focusFirstInvalid();
    } finally {
      setPending(null);
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-[18px]">
      {banner ? (
        <div
          role="alert"
          tabIndex={-1}
          data-form-banner
          className="rounded-card-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {upgrade ? (
            <Callout tone="warning" icon={<Sparkles />}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <strong className="text-[15px] font-semibold">{limitTitle}</strong>
                  <span>{banner}</span>
                </div>
                <ButtonLink href="/pricing" variant="accent" className="self-start">
                  {upgradeLabel}
                </ButtonLink>
              </div>
            </Callout>
          ) : (
            <Callout tone="danger" icon={<CircleAlert />}>
              {banner}
            </Callout>
          )}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] md:items-end">
        <Input
          label={t('field.displayName')}
          name="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={nameError}
          autoComplete="off"
          maxLength={NAME_MAX + 20}
          wrapperClassName="min-w-0"
        />
        <div className="flex min-h-[52px] items-center gap-3 rounded-input bg-canvas px-3.5">
          <span className="flex-1 py-2 text-[15px] font-medium">
            {t('field.bookable', { name: member ? label : t('thisPerson') })}
          </span>
          <Switch
            checked={bookable}
            onCheckedChange={setBookable}
            label={t('field.bookableSwitch')}
          />
        </div>
      </div>

      <fieldset className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
        <legend className="mb-2.5 p-0 text-[15px] font-medium">
          {t('field.services', { name: member ? label : t('thisPerson') })}
        </legend>
        {activeServices.length === 0 && shown.length === 0 ? (
          <p className="m-0 text-sm text-muted">
            {t('noServices')}{' '}
            <Link href="/app/services" className="font-semibold text-brand">
              {t('noServicesLink')}
            </Link>
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {shown.map((service) => {
              const on = serviceIds.includes(service.id);
              return (
                <button
                  key={service.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleService(service.id)}
                  className={cn(
                    'flex min-h-11 items-center gap-1.5 rounded-btn px-4 text-[15px] transition-colors duration-200 ease-out',
                    on
                      ? 'bg-brand font-medium text-white'
                      : 'border border-line bg-surface text-ink hover:bg-canvas',
                  )}
                >
                  {on ? (
                    <Check size={16} strokeWidth={3} aria-hidden="true" className="text-accent" />
                  ) : null}
                  {service.name}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center md:justify-end">
        {member ? (
          <Button
            variant={member.active ? 'danger' : 'secondary'}
            size="lg"
            className="order-3 md:order-1 md:me-auto"
            loading={pending === 'toggleActive'}
            disabled={pending === 'save'}
            onClick={() => setActive(!member.active)}
          >
            {member.active ? t('deactivate') : t('reactivate')}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="lg"
          className="order-2"
          onClick={onCancel}
          disabled={pending !== null}
        >
          {shared.cancel}
        </Button>
        <Button
          type="submit"
          size="lg"
          loading={pending === 'save'}
          className="order-1 px-[26px] md:order-3"
        >
          {pending === 'save' ? shared.saving : member ? t('saveChanges') : t('create')}
        </Button>
      </div>
    </form>
  );
}
