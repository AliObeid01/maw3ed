'use client';

import { BadgeCheck, ChevronDown, MailPlus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import {
  removeTeamMember,
  revokeTeamInvite,
  type Team,
  type TeamInvite,
  type TeamMember,
} from '@/lib/api/team';
import type { Resource } from '@/lib/api/useResource';
import { cn } from '@/lib/cn';
import { isolate } from '@/components/ui/Bidi';
import { ConfirmSheet } from '../ConfirmSheet';
import { useAppSession } from '../SessionContext';
import { useErrorMessage } from '../states';

type Target = { kind: 'member'; member: TeamMember } | { kind: 'invite'; invite: TeamInvite };

/**
 * Staff screen > Team access: who can sign in, pending invites, and the two ways to take access away.
 * Both removals update the list at once and roll back if the server refuses.
 */
export function TeamAccess({
  team,
  desktop,
  inviteDisabled,
  gateReason,
  onInvite,
}: {
  team: Resource<Team>;
  desktop: boolean;
  /** The owner has not confirmed their email yet: the button is off and `gateReason` says why. */
  inviteDisabled: boolean;
  gateReason: string;
  onInvite: () => void;
}) {
  const t = useTranslations('team');
  const format = useFormatter();
  const toast = useToast();
  const errorText = useErrorMessage();
  const { timezone } = useAppSession();
  const uid = useId();
  const [expanded, setExpanded] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState<{ name: string; count: number }>();
  // A second tap while the confirmation is opening must not replace its target.
  const ask = (next: Target) => {
    if (confirmOpen) return;
    setTarget(next);
    setConfirmOpen(true);
  };

  const data = team.data;
  const open = desktop || expanded;
  const members = data?.members ?? [];
  const invites = data?.invites ?? [];

  const failure = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'LAST_OWNER') return t('errors.lastOwner');
    if (error instanceof ApiError && error.code === 'CANNOT_REMOVE_SELF') return t('errors.self');
    return errorText(error);
  };

  const confirm = () => {
    const current = target;
    if (!current || !data) return;
    const snapshot = data;
    setConfirmOpen(false);
    // Optimistic: the row disappears now; any failure puts the previous list back.
    if (current.kind === 'member') {
      const { member } = current;
      team.setData((c) => ({
        ...(c ?? snapshot),
        members: (c ?? snapshot).members.filter((m) => m.userId !== member.userId),
      }));
      removeTeamMember(member.userId)
        .then(({ futureAppointments }) => {
          toast.show(t('removed', { name: isolate(member.name) }));
          setNote(futureAppointments > 0 ? { name: member.name, count: futureAppointments } : undefined);
        })
        .catch((error: unknown) => {
          team.setData(snapshot);
          toast.show(failure(error), 'error');
          if (error instanceof ApiError && error.status === 404) team.reload();
        });
    } else {
      const { invite } = current;
      team.setData((c) => ({
        ...(c ?? snapshot),
        invites: (c ?? snapshot).invites.filter((i) => i.id !== invite.id),
      }));
      revokeTeamInvite(invite.id)
        .then(() => toast.show(t('revoked')))
        .catch((error: unknown) => {
          team.setData(snapshot);
          toast.show(errorText(error), 'error');
          if (error instanceof ApiError && error.status === 404) team.reload();
        });
    }
  };

  const summary = data
    ? t('summary', { people: members.length, pending: invites.length })
    : t('loading');

  return (
    <Card
      as="section"
      id="team-access"
      size="sm"
      padding="compact"
      aria-labelledby={`${uid}-title`}
      className="scroll-mt-24"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
          <h2 id={`${uid}-title`} className="m-0 text-base font-semibold">
            {desktop ? (
              t('title')
            ) : (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`${uid}-body`}
                onClick={() => setExpanded((v) => !v)}
                className="-my-3 flex min-h-11 w-full items-center gap-2 text-start text-base font-semibold"
              >
                <span className="flex-1">{t('title')}</span>
                <ChevronDown
                  size={18}
                  aria-hidden="true"
                  className={cn('shrink-0 transition-transform duration-200', expanded && 'rotate-180')}
                />
              </button>
            )}
          </h2>
          <p className="m-0 text-[13px] text-muted">{t('purpose')}</p>
          <p className="m-0 text-[13px] text-muted">{summary}</p>
        </div>
        {/* The one invite button: always visible, also while the member list is collapsed on a phone. */}
        <div className="flex flex-col items-start gap-1.5">
          <Button
            id="team-access-invite"
            variant="secondary"
            disabled={inviteDisabled}
            aria-describedby={inviteDisabled ? `${uid}-gate` : undefined}
            onClick={onInvite}
          >
            <MailPlus size={18} aria-hidden="true" />
            {t('invite')}
          </Button>
          {inviteDisabled ? (
            <p id={`${uid}-gate`} className="m-0 max-w-[220px] text-[13px] text-muted">
              {gateReason}
            </p>
          ) : null}
        </div>
      </div>

      <div id={`${uid}-body`} hidden={!open}>
        {team.error && !data ? (
          <p role="alert" className="m-0 mt-3 text-[13px] text-danger">
            {t('loadFailed')}{' '}
            <button type="button" onClick={team.reload} className="min-h-11 font-semibold underline">
              {t('retry')}
            </button>
          </p>
        ) : null}

        {note ? (
          <p aria-live="polite" className="m-0 mt-3 rounded-input bg-amber-soft p-3 text-[13px] text-amber">
            {t('remainingNote', { name: isolate(note.name), count: note.count })}
          </p>
        ) : null}

        {data ? (
          <div className="mt-3 flex flex-col gap-4">
            <ul aria-label={t('membersLabel')} className="m-0 flex list-none flex-col p-0">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-row py-3 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold">
                      {m.name}
                      {m.isYou ? <span className="font-normal text-muted"> {t('you')}</span> : null}
                    </span>
                    <span dir="ltr" className="truncate text-start text-[13px] text-muted">
                      {m.email ?? ''}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Chip tone={m.role === 'OWNER' ? 'brand' : 'neutral'}>
                        {m.role === 'OWNER' ? t('role.owner') : t('role.staff')}
                      </Chip>
                      {m.emailVerified ? (
                        <Chip tone="success" className="gap-1">
                          <BadgeCheck size={13} aria-hidden="true" />
                          {t('verified')}
                        </Chip>
                      ) : (
                        <Chip tone="amber">{t('unverified')}</Chip>
                      )}
                    </span>
                  </span>
                  {m.isYou ? null : (
                    <Button
                      variant="secondary"
                      size="row"
                      disabled={confirmOpen}
                      aria-label={t('removeFor', { name: m.name })}
                      onClick={() => ask({ kind: 'member', member: m })}
                    >
                      {t('remove')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {invites.length > 0 ? (
              <div>
                <h3 className="m-0 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                  {t('pending')}
                </h3>
                <ul aria-label={t('pending')} className="m-0 flex list-none flex-col p-0">
                  {invites.map((i) => (
                    <li
                      key={i.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-row py-3 first:border-t-0"
                    >
                      <span className="flex min-w-0 flex-[1_1_180px] flex-col gap-0.5">
                        <span dir="ltr" className="truncate text-start text-[15px] font-medium">
                          {i.email}
                        </span>
                        <span className="text-[13px] text-muted">
                          {t('expires', {
                            date: format.dateTime(new Date(i.expiresAt), {
                              day: 'numeric',
                              month: 'short',
                              timeZone: timezone,
                            }),
                          })}
                        </span>
                      </span>
                      <Button
                        variant="secondary"
                        size="row"
                        disabled={confirmOpen}
                        aria-label={t('revokeFor', { email: i.email })}
                        onClick={() => ask({ kind: 'invite', invite: i })}
                      >
                        {t('revoke')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          target?.kind === 'invite'
            ? t('confirmRevoke.title')
            : t('confirmRemove.title', { name: isolate(target?.member.name ?? '') })
        }
        description={
          target?.kind === 'invite'
            ? t('confirmRevoke.body', { email: isolate(target.invite.email) })
            : t('confirmRemove.body')
        }
        confirmLabel={target?.kind === 'invite' ? t('confirmRevoke.confirm') : t('confirmRemove.confirm')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        onConfirm={confirm}
      />
    </Card>
  );
}
