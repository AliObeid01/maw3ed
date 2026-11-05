'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useErrorMessage } from '@/components/app/states';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import { updateContact, type AppointmentDetail } from '@/lib/api/outcomes';
import { isEmail } from '@/lib/auth/validation';

/** Same cap as the server's name field. */
const NAME_MAX = 80;

type FieldErrors = { email?: string; name?: string };

/**
 * F69-C: correct this booking's contact email and name. Pre-filled with what reminders use now. Only the fields
 * the person actually changed are sent. The client's saved record, the phone, the time, service and staff are
 * not part of this form.
 */
function ContactForm({
  appt,
  onSaved,
  onStale,
  onClose,
}: {
  appt: AppointmentDetail;
  onSaved: (next: AppointmentDetail) => void;
  /** The server said the booking can no longer be edited: reload the truth. */
  onStale: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('app.appointment.contact');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const startEmail = appt.reminderEmail ?? '';
  const startName = appt.client.name;
  const [email, setEmail] = useState(startEmail);
  const [name, setName] = useState(startName);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const publicBooking = appt.source === 'PUBLIC';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    const nextEmail = email.trim().toLowerCase();
    const nextName = name.trim();
    const found: FieldErrors = {};
    if (nextEmail === '' && publicBooking && startEmail !== '') found.email = t('emailRequired');
    else if (nextEmail !== '' && !isEmail(nextEmail)) found.email = t('emailInvalid');
    if (nextName === '') found.name = t('nameRequired');
    else if (nextName.length > NAME_MAX) found.name = t('nameTooLong', { max: NAME_MAX });
    setErrors(found);
    setFormError(undefined);
    if (found.email || found.name) return;

    const body: { contactEmail?: string | null; contactName?: string } = {};
    if (nextEmail !== startEmail.toLowerCase()) body.contactEmail = nextEmail === '' ? null : nextEmail;
    if (nextName !== startName) body.contactName = nextName;
    if (Object.keys(body).length === 0) return onClose();

    busy.current = true;
    setPending(true);
    try {
      const next = await updateContact(appt.id, body);
      toast.show(t('saved'));
      onSaved(next);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const fromServer: FieldErrors = {};
        if (error.fields.contactEmail) fromServer.email = t('emailInvalid');
        if (error.fields.contactName) fromServer.name = t('fieldInvalid');
        if (fromServer.email || fromServer.name) setErrors(fromServer);
        else setFormError(errorMessage(error));
      } else if (error instanceof ApiError && error.code === 'APPOINTMENT_NOT_EDITABLE') {
        // The booking changed under us (cancelled, started): close the form, say why, and reload the truth.
        toast.show(t('notEditable'), 'error');
        onStale();
        onClose();
      } else {
        setFormError(errorMessage(error));
        if (error instanceof ApiError && error.status === 404) onStale();
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 rounded-card-sm bg-brand-soft p-3 text-sm leading-normal text-ink">
        {t('note')}
      </p>
      <Input
        label={t('email')}
        name="contactEmail"
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        disabled={pending}
      />
      <Input
        label={t('name')}
        name="contactName"
        type="text"
        autoComplete="off"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        disabled={pending}
      />
      {formError ? (
        <p role="alert" className="m-0 text-sm font-medium text-danger">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" block loading={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
        <Button variant="secondary" size="lg" block disabled={pending} onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}

export function EditContactSheet({
  appt,
  open,
  onOpenChange,
  onSaved,
  onStale,
}: {
  appt: AppointmentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (next: AppointmentDetail) => void;
  onStale: () => void;
}) {
  const t = useTranslations('app.appointment.contact');
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('title')} closeLabel={t('close')}>
      <ContactForm
        appt={appt}
        onSaved={onSaved}
        onStale={onStale}
        onClose={() => onOpenChange(false)}
      />
    </Sheet>
  );
}
