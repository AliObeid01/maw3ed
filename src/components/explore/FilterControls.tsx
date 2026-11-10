'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, type ReactNode } from 'react';
import { Bidi } from '@/components/ui/Bidi';
import { DatePickerControl } from '@/components/ui/DatePicker';
import { Select, type SelectOption } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useCategoryLabel } from '@/components/public/categoryLabel';
import { useAreaLabel } from '@/components/public/areaLabel';
import { getCategoriesCached } from '@/lib/api/home';
import { useResource } from '@/lib/api/useResource';
import { AREA_KEYS, CATEGORY_KEYS } from '@/lib/business/profile';
import { cn } from '@/lib/cn';
import { whenRange, type ExploreFilters } from '@/lib/directory/explore';
import { addDaysYmd } from '@/lib/pickers/monthGrid';
import { FilterPill } from './FilterPill';

export type FilterPatch = Partial<ExploreFilters>;

/**
 * Area, When, Category and Service: the controls the inline bar (md and up) and the phone sheet share. The text box
 * lives outside (it applies on submit). `onChange` receives a patch; the caller decides when it takes effect (the bar:
 * at once, the sheet: on Apply).
 */
export function FilterControls({
  value,
  onChange,
  today,
  idPrefix,
  variant,
  leading,
  footer,
}: {
  value: ExploreFilters;
  onChange: (patch: FilterPatch) => void;
  /** Today in the VIEWER's calendar (yyyy-MM-dd). */
  today: string;
  idPrefix: string;
  /** `bar`: the inline grid from md; `sheet`: one column. */
  variant: 'bar' | 'sheet';
  /** First grid item of the bar (the search form). */
  leading?: ReactNode;
  /** Bar only: sits directly under the When hint (the Clear button), so it never floats below a tall Service column. */
  footer?: ReactNode;
}) {
  const t = useTranslations('directory.explore');
  const categoryLabel = useCategoryLabel();
  const areaLabel = useAreaLabel();
  const whenId = useId();
  const range = whenRange(today);
  const tomorrow = addDaysYmd(today, 1);

  const areaOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('areaAll') },
      ...AREA_KEYS.filter((key) => key !== 'other').map((key) => ({
        value: key,
        label: areaLabel(key) ?? key,
      })),
    ],
    [areaLabel, t],
  );
  const categoryOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('categoryAll') },
      // A legacy free-text value in the URL stays selectable so the closed field shows what is applied.
      ...(value.category && !(CATEGORY_KEYS as readonly string[]).includes(value.category)
        ? [{ value: value.category, label: categoryLabel(value.category) ?? value.category }]
        : []),
      ...CATEGORY_KEYS.filter((key) => key !== 'other').map((key) => ({
        value: key,
        label: categoryLabel(key) ?? key,
      })),
    ],
    [categoryLabel, t, value.category],
  );

  const customDay = value.when && value.when !== today && value.when !== tomorrow ? value.when : '';

  return (
    <div className={cn('grid gap-4', variant === 'bar' && 'md:grid-cols-2 lg:grid-cols-3')}>
      {leading ? <div className="md:col-span-2 lg:col-span-1">{leading}</div> : null}
      <Select
        id={`${idPrefix}-area`}
        label={t('area')}
        value={value.area}
        options={areaOptions}
        onChange={(area) => onChange({ area })}
      />
      <Select
        id={`${idPrefix}-category`}
        label={t('category')}
        value={value.category}
        options={categoryOptions}
        onChange={(category) => onChange({ category, service: '' })}
      />

      <div
        role="group"
        aria-labelledby={`${whenId}-label`}
        className={cn('grid content-start gap-2', variant === 'bar' && 'self-start md:col-span-2')}
      >
        <span id={`${whenId}-label`} className="text-sm font-medium">
          {t('when')}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill pressed={value.when === ''} onClick={() => onChange({ when: '' })}>
            {t('whenAny')}
          </FilterPill>
          <FilterPill pressed={value.when === today} onClick={() => onChange({ when: today })}>
            {t('whenToday')}
          </FilterPill>
          <FilterPill
            pressed={value.when === tomorrow}
            onClick={() => onChange({ when: tomorrow })}
          >
            {t('whenTomorrow')}
          </FilterPill>
          <div className="w-[176px] max-w-full">
            <DatePickerControl
              id={`${idPrefix}-day`}
              label={t('whenPickAria')}
              placeholder={t('whenPick')}
              value={customDay}
              min={range.min}
              max={range.max}
              today={today}
              clearable
              onChange={(when) => onChange({ when })}
              className={cn(customDay && 'border-brand')}
            />
          </div>
        </div>
        <p className="m-0 text-[13px] text-muted">{t('whenHint')}</p>
        {variant === 'bar' ? footer : null}
      </div>

      <ServiceChips
        className={variant === 'bar' ? 'md:col-span-2 lg:col-span-1' : undefined}
        category={value.category}
        area={value.area}
        service={value.service}
        onChange={(service) => onChange({ service })}
      />
    </div>
  );
}

/**
 * Quick service filter: the popular services of the chosen category (from the cached categories request), or the
 * free-text `service` from a shared link as a removable chip. Hidden when there is nothing to show.
 */
function ServiceChips({
  className,
  category,
  area,
  service,
  onChange,
}: {
  className?: string;
  category: string;
  area: string;
  service: string;
  onChange: (service: string) => void;
}) {
  const t = useTranslations('directory.explore');
  const labelId = useId();
  const enabled = Boolean(category);
  const cats = useResource(
    () => (enabled ? getCategoriesCached(area) : Promise.resolve(null)),
    `chips:${enabled ? area : '-'}`,
  );
  const popular =
    cats.data?.categories
      .find((c) => c.category === category)
      ?.popularServices.map((s) => s.name) ?? [];
  const known = popular.some((name) => name.toLowerCase() === service.toLowerCase());
  const loading = enabled && cats.loading;
  if (!loading && popular.length === 0 && !service) return null;

  return (
    <div
      role="group"
      aria-labelledby={`${labelId}-label`}
      className={cn('grid content-start gap-2', className)}
    >
      <span id={`${labelId}-label`} className="text-sm font-medium">
        {t('service')}
      </span>
      <div className="flex flex-wrap gap-2">
        {loading ? (
          <>
            <Skeleton className="h-11 w-24 rounded-pill" />
            <Skeleton className="h-11 w-28 rounded-pill" />
            <Skeleton className="h-11 w-20 rounded-pill" />
          </>
        ) : (
          <>
            {popular.map((name) => (
              <FilterPill
                key={name}
                pressed={name.toLowerCase() === service.toLowerCase()}
                onClick={() => onChange(name.toLowerCase() === service.toLowerCase() ? '' : name)}
              >
                <Bidi>{name}</Bidi>
              </FilterPill>
            ))}
            {service && !known ? (
              <FilterPill
                pressed
                aria-label={t('serviceChosen', { service })}
                onClick={() => onChange('')}
              >
                <Bidi>{service}</Bidi>
                <X size={16} aria-hidden="true" />
              </FilterPill>
            ) : null}
          </>
        )}
      </div>
      {enabled && popular.length > 0 ? (
        <p className="m-0 text-[13px] text-muted">{t('serviceHint')}</p>
      ) : null}
    </div>
  );
}
