'use client';

import { Copy, MessageCircle } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Bidi, isolate } from '@/components/ui/Bidi';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import {
  giveStaffLogin,
  turnOffStaffLogin,
  type StaffLoginLink,
  type StaffMember,
} from '@/lib/api/setup';
import { copyText } from '@/lib/setup/clipboard';
import { ConfirmSheet } from '../ConfirmSheet';
import { useErrorMessage } from '../states';

type Action = 'give' | 'reset' | 'off';

/**
 * Owner-only "Staff login" block inside the staff editor. The owner enters the person's phone number, taps "Send via
 * WhatsApp" (a wa.me link opened on THIS phone, no WhatsApp API) and the person chooses their own password from a
 * one-time link. No password is ever shown or sent. Hidden for the owner and receptionists (their own login).
 */
export function StaffLoginSection({
  member,
  onChanged,
}: {
  member: StaffMember;
  onChanged: (next: StaffMember) => void;
}) {
  const t = useTranslations('app.staff.login');
  const closeLabel = useTranslations('app.staff')('close');
  const errorText = useErrorMessage();
  const toast = useToast();
  const format = useFormatter();
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string>();
  const [banner, setBanner] = useState<string>();
  const [pending, setPending] = useState<Action | null>(null);
  const [link, setLink] = useState<StaffLoginLink>();
  const [confirm, setConfirm] = useState<'reset' | 'off' | null>(null);

  const status = member.loginStatus;
  if (status === null) return null;

  const name = isolate(member.displayName);
  const date = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      numberingSystem: 'latn',
    });

  const fail = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'PHONE_IN_USE')
      setPhoneError(t('errors.phoneInUse'));
    else if (error instanceof ApiError && error.code === 'LOGIN_NOT_ALLOWED')
      setBanner(t('errors.notAllowed'));
    else if (error instanceof ApiError && error.code === 'STAFF_INACTIVE')
      setBanner(t('errors.inactive'));
    else if (error instanceof ApiError && error.status === 400)
      setPhoneError(t('errors.phoneInvalid'));
    else setBanner(errorText(error));
  };

  const makeLink = async (action: 'give' | 'reset') => {
    if (pending) return;
    setBanner(undefined);
    setPhoneError(undefined);
    if (action === 'give' && !phone.trim()) {
      setPhoneError(t('errors.phoneRequired'));
      return;
    }
    setPending(action);
    try {
      const made = await giveStaffLogin(member.id, action === 'give' ? phone.trim() : undefined);
      setLink(made);
      onChanged({
        ...member,
        loginStatus: 'NOT_ACTIVATED',
        loginPhone: made.phone,
        linkExpiresAt: made.expiresAt,
      });
      setConfirm(null);
    } catch (error) {
      setConfirm(null);
      fail(error);
    } finally {
      setPending(null);
    }
  };

  const turnOff = async () => {
    if (pending) return;
    setPending('off');
    try {
      await turnOffStaffLogin(member.id);
      onChanged({ ...member, loginStatus: 'OFF', loginPhone: null, linkExpiresAt: null });
      toast.show(t('turnedOff', { name }));
    } catch (error) {
      fail(error);
    } finally {
      setPending(null);
      setConfirm(null);
    }
  };

  const chip =
    status === 'ACTIVE' ? (
      <Chip tone="success">{t('status.active')}</Chip>
    ) : status === 'NOT_ACTIVATED' ? (
      <Chip tone="warning">{t('status.notActivated')}</Chip>
    ) : status === 'OFF' ? (
      <Chip tone="neutral">{t('status.off')}</Chip>
    ) : null;

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-card-sm border border-line p-4">
      <legend className="px-1 text-sm font-semibold">{t('title')}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {chip}
        {status === 'ACTIVE' && member.loginPhone ? (
          <span className="text-sm text-muted">
            {t('activeBody')} <Bidi dir="ltr">{member.loginPhone}</Bidi>
          </span>
        ) : null}
        {status === 'NOT_ACTIVATED' && member.linkExpiresAt ? (
          <span className="text-sm text-muted">
            {t('pendingBody', { date: date(member.linkExpiresAt) })}
          </span>
        ) : null}
        {status === 'OFF' ? <span className="text-sm text-muted">{t('offBody')}</span> : null}
      </div>

      {banner ? (
        <div role="alert">
          <Callout tone="danger">{banner}</Callout>
        </div>
      ) : null}

      {status === 'NONE' || status === 'OFF' ? (
        <>
          <p className="m-0 text-sm text-muted">{t('intro', { name })}</p>
          <Input
            label={t('phone')}
            name="loginPhone"
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="off"
            placeholder={t('phonePlaceholder')}
            hint={t('phoneHint')}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneError(undefined);
            }}
            error={phoneError}
          />
          <Button
            type="button"
            size="lg"
            loading={pending === 'give'}
            onClick={() => makeLink('give')}
          >
            {t('give')}
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          {status === 'NOT_ACTIVATED' ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              loading={pending === 'reset'}
              onClick={() => makeLink('reset')}
            >
              {t('newLink')}
            </Button>
          ) : (
            <Button type="button" variant="secondary" size="lg" onClick={() => setConfirm('reset')}>
              {t('reset')}
            </Button>
          )}
          <Button type="button" variant="danger" size="lg" onClick={() => setConfirm('off')}>
            {t('turnOff')}
          </Button>
        </div>
      )}
      {status === 'NOT_ACTIVATED' && !link ? (
        <p className="m-0 text-sm text-muted">{t('linkHidden')}</p>
      ) : null}

      <Sheet
        open={Boolean(link)}
        onOpenChange={(open) => (open ? undefined : setLink(undefined))}
        title={t('send.title')}
        description={t('send.body', {
          name,
          phone: link?.phone ?? '',
          date: link ? date(link.expiresAt) : '',
        })}
        closeLabel={closeLabel}
      >
        {link ? (
          <div className="flex flex-col gap-3 pt-2">
            {link.reset ? (
              <Callout tone="brand">
                <span role="status">{t('send.resetNote', { name })}</span>
              </Callout>
            ) : null}
            <ButtonLink
              href={link.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="lg"
              block
            >
              <MessageCircle size={18} aria-hidden="true" />
              {t('send.whatsapp')}
            </ButtonLink>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              block
              onClick={async () => {
                const ok = await copyText(link.url);
                toast.show(ok ? t('send.copied') : t('send.copyFailed'), ok ? 'success' : 'error');
              }}
            >
              <Copy size={18} aria-hidden="true" />
              {t('send.copy')}
            </Button>
            <p className="m-0 text-sm text-muted">{t('send.once')}</p>
          </div>
        ) : null}
      </Sheet>

      <ConfirmSheet
        open={confirm !== null}
        onOpenChange={(open) => (open ? undefined : setConfirm(null))}
        title={confirm === 'off' ? t('confirmOff.title') : t('confirmReset.title')}
        description={
          confirm === 'off' ? t('confirmOff.body', { name }) : t('confirmReset.body', { name })
        }
        confirmLabel={confirm === 'off' ? t('confirmOff.confirm') : t('confirmReset.confirm')}
        cancelLabel={t('keep')}
        closeLabel={closeLabel}
        pending={pending === 'off' || pending === 'reset'}
        confirmVariant={confirm === 'off' ? 'danger' : 'primary'}
        onConfirm={() => (confirm === 'off' ? turnOff() : makeLink('reset'))}
      />
    </fieldset>
  );
}
