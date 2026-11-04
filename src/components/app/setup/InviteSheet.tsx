'use client';

import { CircleAlert, CircleCheck, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { createInvite, type CreatedInvite } from '@/lib/api/setup';
import { INVITE_TTL_DAYS } from '@/lib/invites/ttl';
import { copyText } from '@/lib/setup/clipboard';
import { invalidFields } from '@/lib/setup/errors';
import { useErrorMessage, useSharedText } from '../states';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function InviteForm({ onDone, onCreated }: { onDone: () => void; onCreated: () => void }) {
  const t = useTranslations('app.staff.invite');
  const shared = useSharedText();
  const errorText = useErrorMessage();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [banner, setBanner] = useState<string>();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<CreatedInvite>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const value = email.trim();
    setBanner(undefined);
    if (!EMAIL.test(value)) {
      setEmailError(t('emailInvalid'));
      return;
    }
    setEmailError(undefined);
    setPending(true);
    try {
      const created = await createInvite({ email: value, role: 'STAFF' });
      setSent(created);
      onCreated();
    } catch (error) {
      if (invalidFields(error).includes('email')) setEmailError(t('emailInvalid'));
      else setBanner(errorText(error));
    } finally {
      setPending(false);
    }
  };

  if (sent) {
    const url = sent.acceptUrl;
    return (
      <div className="flex flex-col gap-4">
        <Callout tone="brand" icon={<CircleCheck />}>
          <span role="status">{t('sent', { email: sent.email })}</span>
        </Callout>
        {url ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('devLink')}</span>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="min-w-0 flex-1 truncate rounded-input bg-canvas px-3 py-3 text-start text-[13px]"
              >
                {url}
              </code>
              <Button
                variant="secondary"
                aria-label={t('copyLink')}
                onClick={async () => {
                  const ok = await copyText(url);
                  toast.show(ok ? t('copied') : t('copyFailed'), ok ? 'success' : 'error');
                }}
              >
                <Copy size={18} aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
        <Button size="lg" block onClick={onDone}>
          {shared.done}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {banner ? (
        <div role="alert">
          <Callout tone="danger" icon={<CircleAlert />}>
            {banner}
          </Callout>
        </div>
      ) : null}
      <Input
        label={t('email')}
        name="email"
        type="email"
        dir="ltr"
        autoComplete="off"
        inputMode="email"
        placeholder={t('emailPlaceholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={emailError}
        hint={t('hint', { days: INVITE_TTL_DAYS })}
      />
      <Button type="submit" size="lg" block loading={pending}>
        {t('send')}
      </Button>
    </form>
  );
}

/** "Invite receptionist": sends a Staff invite. The accept link is shown only when the API returns it (dev). */
export function InviteSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations('app.staff.invite');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('description')}
      closeLabel={t('close')}
    >
      <InviteForm onDone={() => onOpenChange(false)} onCreated={onCreated} />
    </Sheet>
  );
}
