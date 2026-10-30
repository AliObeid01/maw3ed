'use client';

import { Plus, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { listServices, updateService, type Service } from '@/lib/api/setup';
import { useResource } from '@/lib/api/useResource';
import { cn } from '@/lib/cn';
import { useIsDesktop } from '@/lib/useMediaQuery';
import { HeaderActions } from '../HeaderActions';
import { EmptyState, LoadError, OwnerOnly, useErrorMessage } from '../states';
import { EditorHost } from './EditorHost';
import { ServiceForm } from './ServiceForm';
import { useAppFormat } from '@/lib/useAppFormat';

const ROW_COLUMNS = 'md:grid-cols-[2fr_1fr_1fr_1fr_80px]';

function ServicesSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-start gap-5">
      <Card padding="none" className="min-w-0 flex-[999_1_480px] overflow-hidden">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="m-4 h-12 rounded-nav" />
        ))}
      </Card>
      <Skeleton className="hidden h-[430px] max-w-[380px] flex-[1_1_300px] rounded-card lg:block" />
    </div>
  );
}

function ServiceRow({
  service,
  pending,
  onEdit,
  onToggle,
}: {
  service: Service;
  pending: boolean;
  onEdit: () => void;
  onToggle: (active: boolean) => void;
}) {
  const t = useTranslations('app.services');
  const { money, duration } = useAppFormat();
  const muted = !service.active;
  return (
    <div
      role="row"
      className={cn(
        'grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 border-b border-row px-5 py-3 text-[15px] last:border-b-0 md:min-h-16 md:py-0',
        ROW_COLUMNS,
        muted && 'bg-canvas text-muted',
      )}
    >
      <div role="cell" className="min-w-0 md:row-start-1">
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('editNamed', { name: service.name })}
          className="-mx-2 flex min-h-11 max-w-full items-center rounded-nav px-2 text-start font-semibold transition-colors duration-200 ease-out hover:bg-brand-soft"
        >
          <span className="truncate">{service.name}</span>
          {muted ? <span className="ms-1.5 text-[13px] font-normal">· {t('hidden')}</span> : null}
        </button>
      </div>
      <div role="cell" className="md:col-start-5 md:row-start-1">
        <Switch
          checked={service.active}
          pending={pending}
          onCheckedChange={onToggle}
          label={t('activeSwitch', { name: service.name })}
        />
      </div>
      <div role="cell" className="col-span-2 text-sm text-muted md:hidden">
        <span className="tabular-nums">
          {duration(service.durationMin)} ·{' '}
          {t('bufferShort', { value: duration(service.bufferMin) })} · {money(service.price)}
        </span>
      </div>
      <div role="cell" className="hidden tabular-nums md:col-start-2 md:row-start-1 md:block">
        {duration(service.durationMin)}
      </div>
      <div role="cell" className="hidden tabular-nums md:col-start-3 md:row-start-1 md:block">
        {duration(service.bufferMin)}
      </div>
      <div role="cell" className="hidden tabular-nums md:col-start-4 md:row-start-1 md:block">
        {money(service.price)}
      </div>
    </div>
  );
}

export function ServicesView() {
  return (
    <OwnerOnly>
      <ServicesInner />
    </OwnerOnly>
  );
}

function ServicesInner() {
  const t = useTranslations('app.services');
  const toast = useToast();
  const errorText = useErrorMessage();
  const desktop = useIsDesktop();
  const services = useResource(listServices, 'services');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  // Bumped after a save or cancel so the always-mounted desktop panel starts empty again.
  const [resetCount, setResetCount] = useState(0);
  const closeEditor = () => {
    setEditing(null);
    setResetCount((n) => n + 1);
  };

  const list = services.data;
  const openNew = () => setEditing('new');

  const toggle = async (service: Service, active: boolean) => {
    setPendingIds((ids) => new Set(ids).add(service.id));
    try {
      const saved = await updateService(service.id, { active });
      services.setData((current) => (current ?? []).map((s) => (s.id === saved.id ? saved : s)));
      toast.show(t(active ? 'shown' : 'hiddenToast', { name: saved.name }));
    } catch (error) {
      toast.show(errorText(error), 'error');
    } finally {
      setPendingIds((ids) => {
        const next = new Set(ids);
        next.delete(service.id);
        return next;
      });
    }
  };

  const onSaved = (saved: Service, created: boolean) => {
    services.setData((current) =>
      created
        ? [...(current ?? []), saved]
        : (current ?? []).map((s) => (s.id === saved.id ? saved : s)),
    );
    closeEditor();
    toast.show(t(created ? 'created' : 'saved', { name: saved.name }));
  };

  if (services.error && !list)
    return <LoadError error={services.error} onRetry={services.reload} />;
  if (!list) return <ServicesSkeleton />;

  const editingService =
    editing && editing !== 'new' ? list.find((s) => s.id === editing) : undefined;
  const panelTitle = editingService ? t('editTitle', { name: editingService.name }) : t('newTitle');
  // On desktop the panel is always visible: with nothing selected it is the "New service" form.
  const formKey = `${editingService?.id ?? 'new'}:${resetCount}`;

  return (
    <>
      <HeaderActions>
        <Button onClick={openNew}>
          <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
          {t('add')}
        </Button>
      </HeaderActions>

      <div className="flex flex-wrap items-start gap-5">
        {list.length === 0 ? (
          <EmptyState
            className="min-w-0 flex-[999_1_480px]"
            icon={<Tag size={22} />}
            title={t('emptyTitle')}
            body={t('emptyBody')}
            action={
              desktop ? undefined : (
                <Button onClick={openNew}>
                  <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
                  {t('add')}
                </Button>
              )
            }
          />
        ) : (
          <Card
            as="section"
            padding="none"
            aria-label={t('listLabel')}
            className="min-w-0 flex-[999_1_480px] overflow-hidden"
          >
            <div role="table" aria-label={t('listLabel')}>
              <div
                role="row"
                className={cn(
                  'hidden gap-3 border-b border-row px-5 py-3.5 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase md:grid',
                  ROW_COLUMNS,
                )}
              >
                <span role="columnheader">{t('col.service')}</span>
                <span role="columnheader">{t('col.duration')}</span>
                <span role="columnheader">{t('col.buffer')}</span>
                <span role="columnheader">{t('col.price')}</span>
                <span role="columnheader">{t('col.active')}</span>
              </div>
              <div role="rowgroup">
                {list.map((service) => (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    pending={pendingIds.has(service.id)}
                    onEdit={() => setEditing(service.id)}
                    onToggle={(active) => toggle(service, active)}
                  />
                ))}
              </div>
            </div>
          </Card>
        )}

        <EditorHost
          desktop={desktop}
          open={editing !== null}
          onOpenChange={(open) => (open ? undefined : closeEditor())}
          title={panelTitle}
          closeLabel={t('close')}
          panelClassName="max-w-[380px] flex-[1_1_300px] border-2 border-brand"
        >
          <ServiceForm
            key={formKey}
            service={editingService}
            onSaved={onSaved}
            onCancel={closeEditor}
          />
        </EditorHost>
      </div>
    </>
  );
}
