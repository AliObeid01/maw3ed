'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ClaudeIcon } from '@/components/brand/ClaudeIcon';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import { listGrants, revokeGrant, type ConnectedApp } from '@/lib/api/oauthGrants';
import { useResource } from '@/lib/api/useResource';
import { useAppFormat } from '@/lib/useAppFormat';
import { useAppSession } from '../SessionContext';
import { LoadError } from '../states';
import { ConnectorUrl, useCopy } from './ConnectorUrl';

/**
 * Settings > "Connected apps" (OWNER only: the Settings page itself is owner-only). Lists the live connections with a
 * Revoke button each; revoking asks inside the page first, removes the row at once and puts it back if the request
 * fails. A 404 (already gone, or another business) just means it is no longer connected. Rendered only while the
 * owner connector is on.
 */
export function ConnectedApps({ url }: { url: string }) {
  const t = useTranslations('app.ownerConnector.settings');
  const grants = useResource(listGrants, 'grants');
  const { copy, copiedKey, announcer } = useCopy();
  const toast = useToast();
  const { format } = useAppFormat();
  const { timezone } = useAppSession();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { timeZone: timezone, numberingSystem: 'latn', day: 'numeric', month: 'short', year: 'numeric' });

  async function revoke(app: ConnectedApp) {
    if (pending) return;
    const before = grants.data ?? [];
    setPending(app.id);
    setFailed(false);
    grants.setData(before.filter((g) => g.id !== app.id));
    setConfirming(null);
    try {
      await revokeGrant(app.id);
      toast.show(t('revoked', { name: app.clientName }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        toast.show(t('revoked', { name: app.clientName }));
      } else {
        grants.setData(before);
        setFailed(true);
      }
    } finally {
      setPending(null);
    }
  }

  let body;
  if (grants.error && !grants.data) {
    body = <LoadError error={grants.error} onRetry={grants.reload} />;
  } else if (!grants.data) {
    body = <Skeleton aria-hidden="true" className="h-[88px] rounded-card-sm" />;
  } else if (grants.data.length === 0) {
    body = (
      <div className="flex flex-col gap-3.5" data-testid="connected-apps-empty">
        <div>
          <p className="m-0 text-[15px] font-semibold">{t('empty')}</p>
          <p className="m-0 mt-1 text-sm text-muted">{t('emptyBody')}</p>
        </div>
        <ConnectorUrl url={url} copy={copy} copiedKey={copiedKey} />
      </div>
    );
  } else {
    body = (
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {grants.data.map((app) => (
          <li key={app.id} data-testid="connected-app" className="rounded-card-sm border border-line bg-canvas p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-input bg-brand-soft text-brand">
                <ClaudeIcon size={22} />
              </span>
              <div className="flex min-w-0 flex-[1_1_180px] flex-col">
                <span className="text-[15px] font-semibold break-words">{app.clientName}</span>
                <span className="text-[13px] text-muted">{t('connectedOn', { date: date(app.createdAt) })}</span>
                <span className="text-[13px] text-muted">
                  {app.lastUsedAt ? t('lastUsed', { date: date(app.lastUsedAt) }) : t('neverUsed')}
                </span>
              </div>
              {confirming !== app.id ? (
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={t('revokeLabel', { name: app.clientName })}
                  onClick={() => setConfirming(app.id)}
                >
                  {t('revoke')}
                </Button>
              ) : null}
            </div>
            {confirming === app.id ? (
              <div role="group" aria-labelledby={`confirm-${app.id}`} className="mt-3 flex flex-col gap-2.5 border-t border-line pt-3">
                <p id={`confirm-${app.id}`} className="m-0 text-sm">
                  <span className="font-semibold">{t('confirmTitle', { name: app.clientName })}</span>{' '}
                  <span className="text-muted">{t('confirmBody')}</span>
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" variant="danger" onClick={() => revoke(app)} className="sm:w-auto">
                    {t('confirm')}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setConfirming(null)} className="sm:w-auto">
                    {t('keep')}
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card as="section" id="connected-apps" aria-labelledby="connected-apps-title" data-testid="connected-apps" className="mt-5 flex scroll-mt-4 flex-col gap-4 p-[22px]">
      <div>
        <h2 id="connected-apps-title" className="m-0 text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="m-0 mt-1 text-sm text-muted">{t('intro')}</p>
      </div>
      {failed ? (
        <div role="alert">
          <Callout tone="danger" icon={<CircleAlert />}>
            {t('revokeFailed')}
          </Callout>
        </div>
      ) : null}
      {body}
      {announcer}
    </Card>
  );
}
