'use client';

import { CircleAlert, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { errorKey } from '@/lib/setup/errors';
import { cn } from '@/lib/cn';
import { useAppSession } from './SessionContext';

/** Translated message for an error key, for banners and toasts. */
export function useErrorMessage() {
  const t = useTranslations('app.errors');
  return (error: unknown) => t(errorKey(error));
}

/** Common button labels (cancel, save, saving, done). Returned as plain strings so JSX stays free of literals. */
export function useSharedText() {
  const t = useTranslations('app.shared');
  return { cancel: t('cancel'), save: t('save'), saving: t('saving'), done: t('done') };
}

/** Friendly "Only the owner can change this" (a receptionist, or an API 403). */
export function ForbiddenState({ className }: { className?: string }) {
  const t = useTranslations('app.errors');
  return (
    <Card
      role="status"
      className={cn('flex flex-col items-center gap-3 py-10 text-center', className)}
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-pill bg-brand-soft text-brand"
      >
        <Lock size={22} />
      </span>
      <h2 className="m-0 text-lg font-semibold">{t('ownerOnlyTitle')}</h2>
      <p className="m-0 max-w-sm text-sm text-muted">{t('ownerOnlyBody')}</p>
    </Card>
  );
}

/** Wraps owner-only pages: receptionists see the friendly state without any request being made. */
export function OwnerOnly({ children }: { children: ReactNode }) {
  const { role } = useAppSession();
  return role === 'OWNER' ? children : <ForbiddenState />;
}

/** Error with a retry button. A 403 becomes the owner-only state; a 401 sends the user to sign in. */
export function LoadError({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('app.errors');
  const router = useRouter();
  const key = errorKey(error);
  useEffect(() => {
    if (key === 'unauthorized') router.replace('/login');
  }, [key, router]);
  if (key === 'forbidden') return <ForbiddenState className={className} />;
  return (
    <Card
      role="alert"
      className={cn('flex flex-col items-center gap-3 py-10 text-center', className)}
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-pill bg-danger-soft text-danger"
      >
        <CircleAlert size={22} />
      </span>
      <h2 className="m-0 text-lg font-semibold">{t('loadTitle')}</h2>
      <p className="m-0 max-w-sm text-sm text-muted">{t(key)}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {t('retry')}
        </Button>
      ) : null}
    </Card>
  );
}

/** Empty list with one line of explanation and one action. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col items-center gap-3 py-10 text-center', className)}>
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-pill bg-brand-soft text-brand"
      >
        {icon}
      </span>
      <h2 className="m-0 text-lg font-semibold">{title}</h2>
      <p className="m-0 max-w-sm text-sm text-muted">{body}</p>
      {action}
    </Card>
  );
}
