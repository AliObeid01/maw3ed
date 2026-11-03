'use client';

import { MetaLine } from '@/components/ui/Bidi';
import { Plus, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { listServices, listStaff, type StaffMember } from '@/lib/api/setup';
import { listTeam } from '@/lib/api/team';
import { useResource } from '@/lib/api/useResource';
import { cn } from '@/lib/cn';
import { useIsDesktop } from '@/lib/useMediaQuery';
import { HeaderActions } from '../HeaderActions';
import { useAppSession } from '../SessionContext';
import { EmptyState, LoadError, OwnerOnly } from '../states';
import { EditorHost } from './EditorHost';
import { InviteSheet } from './InviteSheet';
import { StaffForm } from './StaffForm';
import { TeamAccess } from './TeamAccess';

/** Avatar tints from the board: teal, green, amber, neutral (inactive). */
const AVATAR_TINTS = [
  'bg-brand-avatar text-brand',
  'bg-success-soft text-success',
  'bg-amber-soft text-amber',
];

function StaffSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-5">
      <div className="flex flex-[1_1_320px] flex-col gap-2.5 lg:max-w-[420px]">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[76px] rounded-card-sm" />
        ))}
      </div>
      <Skeleton className="hidden h-[360px] flex-[999_1_420px] rounded-card lg:block" />
    </div>
  );
}

function StaffCard({
  member,
  index,
  selected,
  onSelect,
}: {
  member: StaffMember;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations('app.staff');
  const tint = member.active && member.bookable ? AVATAR_TINTS[index % 3] : 'bg-divider text-muted';
  const role =
    member.role === 'OWNER' ? t('role.owner') : member.role === 'STAFF' ? t('role.login') : null;
  const services = t('serviceCount', { count: member.serviceIds.length });
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      className={cn(
        'flex min-h-[76px] w-full items-center gap-3 rounded-card-sm bg-surface text-start transition-colors duration-200 ease-out hover:bg-canvas',
        selected ? 'border-2 border-brand px-[15px] py-[13px]' : 'border border-line px-4 py-3.5',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-pill text-base font-semibold',
          tint,
        )}
      >
        {member.displayName.trim().charAt(0).toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="truncate text-base font-semibold">{member.displayName}</span>
        <span className="text-[13px] text-muted"><MetaLine items={[role, services]} /></span>
      </span>
      {!member.active ? (
        <Chip tone="neutral">{t('status.inactive')}</Chip>
      ) : member.bookable ? (
        <Chip tone="success">{t('status.bookable')}</Chip>
      ) : (
        <Chip tone="neutral">{t('status.notBookable')}</Chip>
      )}
    </button>
  );
}

export function StaffView() {
  return (
    <OwnerOnly>
      <StaffInner />
    </OwnerOnly>
  );
}

function StaffInner() {
  const t = useTranslations('app.staff');
  const gateReason = useTranslations('verify')('gate.invite');
  const { emailVerified } = useAppSession();
  const toast = useToast();
  const desktop = useIsDesktop();
  const staff = useResource(listStaff, 'staff');
  const services = useResource(listServices, 'services');
  const team = useResource(listTeam, 'team');
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const closeEditor = () => {
    setSelected(null);
    setResetCount((n) => n + 1);
  };

  const list = staff.data;
  const serviceList = services.data;
  const ready = Boolean(list && serviceList);

  // The setup step links to /app/staff#team-access. The card only exists once the lists have loaded, so the browser's
  // own hash scroll finds nothing: scroll to it here and put keyboard focus on its invite button (only with the hash).
  useEffect(() => {
    if (!ready || window.location.hash !== '#team-access') return;
    document.getElementById('team-access')?.scrollIntoView({ block: 'start' });
    document.getElementById('team-access-invite')?.focus({ preventScroll: true });
  }, [ready]);

  if (staff.error && !list) return <LoadError error={staff.error} onRetry={staff.reload} />;
  if (services.error && !serviceList)
    return <LoadError error={services.error} onRetry={services.reload} />;
  if (!list || !serviceList) return <StaffSkeleton />;

  // On desktop the panel is always visible: with nothing chosen it shows the first person.
  const currentId = selected ?? (desktop ? (list[0]?.id ?? 'new') : null);
  const member =
    currentId && currentId !== 'new' ? list.find((m) => m.id === currentId) : undefined;
  const panelTitle = member ? t('editTitle', { name: member.displayName }) : t('newTitle');

  const onSaved = (saved: StaffMember, created: boolean) => {
    staff.setData((current) =>
      created
        ? [...(current ?? []), saved]
        : (current ?? []).map((m) => (m.id === saved.id ? saved : m)),
    );
    setSelected(created ? saved.id : desktop ? saved.id : null);
    toast.show(t(created ? 'created' : 'saved', { name: saved.displayName }));
  };

  return (
    <>
      <HeaderActions>
        <Button onClick={() => setSelected('new')}>
          <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
          {t('add')}
        </Button>
      </HeaderActions>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex w-full flex-[1_1_320px] flex-col gap-3.5 lg:max-w-[420px]">
          {list.length === 0 ? (
            <EmptyState
              icon={<User size={22} />}
              title={t('emptyTitle')}
              body={t('emptyBody')}
              action={
                <Button onClick={() => setSelected('new')}>
                  <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
                  {t('add')}
                </Button>
              }
            />
          ) : (
            <ul aria-label={t('listLabel')} className="m-0 flex list-none flex-col gap-2.5 p-0">
              {list.map((m, index) => (
                <li key={m.id}>
                  <StaffCard
                    member={m}
                    index={index}
                    selected={m.id === currentId}
                    onSelect={() => setSelected(m.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          <TeamAccess
            team={team}
            desktop={desktop}
            inviteDisabled={!emailVerified}
            gateReason={gateReason}
            onInvite={() => setInviteOpen(true)}
          />
        </div>

        <EditorHost
          desktop={desktop}
          open={currentId !== null}
          onOpenChange={(open) => (open ? undefined : closeEditor())}
          title={panelTitle}
          closeLabel={t('close')}
          panelClassName="min-w-0 flex-[999_1_420px] border border-line p-6"
        >
          <StaffForm
            key={`${member?.id ?? 'new'}:${resetCount}`}
            member={member}
            services={serviceList}
            onSaved={onSaved}
            onPartialSave={(saved) =>
              staff.setData((current) =>
                (current ?? []).map((m) => (m.id === saved.id ? saved : m)),
              )
            }
            onCancel={closeEditor}
          />
        </EditorHost>
      </div>

      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} onCreated={team.reload} />
    </>
  );
}
