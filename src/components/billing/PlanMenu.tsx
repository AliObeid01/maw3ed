'use client';

import { ChevronDown, CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { TitleExtra } from '@/components/app/HeaderActions';
import { useErrorMessage } from '@/components/app/states';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { Chip } from '@/components/ui/Chip';
import { PickerSurface } from '@/components/ui/pickers/PickerSurface';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api/auth';
import { downgradeToFree, getBilling, type Billing } from '@/lib/api/billing';
import { useResource } from '@/lib/api/useResource';
import { PLANS_HREF, PRO_CHECKOUT_HREF } from '@/lib/links';

/** Numbers from a PLAN_LIMIT error's `data`, or null when the payload is not as expected. */
function planLimitData(data: unknown): { limit: number; current: number } | null {
  if (typeof data !== 'object' || data === null) return null;
  const { limit, current } = data as Record<string, unknown>;
  return typeof limit === 'number' && typeof current === 'number' ? { limit, current } : null;
}

/**
 * Mounts with the open menu: puts focus on the first item (the popover would otherwise focus its own frame).
 * It finds the item by `data-testid="plan-menu"` and DOM order, so keep the first `role="menuitem"` first in the
 * markup below (`data-picker-host` marks it for the phone sheet, which looks for that attribute). Radix cannot do this
 * for us: PickerSurface keeps Tab for closing, and the popover would otherwise focus its own frame.
 */
function FocusFirst() {
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-testid="plan-menu"] [role="menuitem"]')?.focus(),
    );
    return () => cancelAnimationFrame(id);
  }, []);
  return null;
}

const ITEM =
  'flex min-h-11 w-full items-center rounded-nav px-3 text-start text-[15px] font-semibold text-ink no-underline hover:bg-canvas focus-visible:bg-canvas';

/**
 * Settings plan control (PR-13): a compact chip next to the page title ("Pro" or "Free", plus the TEST MODE tag from
 * `sm` up) that opens a small menu: the bookable-staff usage, Compare plans, and Upgrade to Pro (Free) or Switch back
 * to Free (Pro, with the same confirmation sheet as before). The popover is the project's PickerSurface (anchored
 * popover from `md`, bottom sheet on phones: Escape, outside click and focus return come from it). Inside, the
 * WAI-ARIA menu pattern: the first item is focused on open, arrows move, Escape closes, Tab leaves.
 */
export function PlanMenu() {
  const t = useTranslations('billing');
  const toast = useToast();
  const errorText = useErrorMessage();
  const billing = useResource(getBilling, 'billing');
  const [menuOpen, setMenuOpen] = useState(false);
  const [downOpen, setDownOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const chipRef = useRef<HTMLButtonElement>(null);

  if (billing.error && !billing.data)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <p className="m-0 text-sm text-danger">{t('loadFailed')}</p>
        <Button variant="secondary" onClick={billing.reload}>
          {t('retry')}
        </Button>
      </div>
    );
  if (!billing.data) return null;

  const data: Billing = billing.data;
  const pro = data.plan === 'PRO';
  const limit = data.limits.bookableStaff;
  const name = pro ? t('pro') : t('free');

  const downgrade = async () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      billing.setData(await downgradeToFree());
      toast.show(t('downgraded'));
    } catch (e) {
      const counts = e instanceof ApiError && e.code === 'PLAN_LIMIT' ? planLimitData(e.data) : null;
      setError(counts ? t('downgradeBlocked', counts) : errorText(e));
    } finally {
      setDownOpen(false);
      setPending(false);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(-1);
  };

  return (
    <>
      <TitleExtra>
        <button
          ref={chipRef}
          type="button"
          data-testid="plan-chip"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="motion-press inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill border border-line bg-surface ps-3.5 pe-2.5 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-canvas aria-expanded:border-brand motion-reduce:transition-none"
        >
          <span className="sr-only">{t('label')}: </span>
          <span>{name}</span>
          {data.testMode ? <Chip tone="neutral" className="max-sm:hidden">{t('testBadge')}</Chip> : null}
          <ChevronDown size={16} aria-hidden="true" className="text-muted" />
        </button>
      </TitleExtra>

      {error ? (
        <div role="alert" className="lg:col-span-2">
          <Callout tone="danger" icon={<CircleAlert />}>
            {error}
          </Callout>
        </div>
      ) : null}

      <PickerSurface
        open={menuOpen}
        onOpenChange={setMenuOpen}
        anchorRef={chipRef}
        title={t('label')}
        closeLabel={t('close')}
        width={280}
      >
        <div className="flex flex-col gap-1 p-1" data-testid="plan-menu">
          <FocusFirst />
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm text-muted">
            <span>
              {limit === null
                ? t('usageUnlimited', { current: data.usage.bookableStaff })
                : t('usage', { current: data.usage.bookableStaff, limit })}
            </span>
            {data.testMode ? <Chip tone="neutral" className="sm:hidden">{t('testBadge')}</Chip> : null}
          </p>
          <div role="menu" aria-label={t('label')} onKeyDown={onMenuKeyDown} className="flex flex-col">
            {pro ? null : (
              <Link role="menuitem" href={PRO_CHECKOUT_HREF} data-picker-host tabIndex={0} className={ITEM}>
                {t('upgradeCta')}
              </Link>
            )}
            <Link
              role="menuitem"
              href={PLANS_HREF}
              {...(pro ? { 'data-picker-host': '', tabIndex: 0 } : { tabIndex: -1 })}
              className={ITEM}
            >
              {t('comparePlans')}
            </Link>
            {pro ? (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={pending}
                onClick={() => {
                  setMenuOpen(false);
                  setDownOpen(true);
                }}
                className={`${ITEM} cursor-pointer text-muted disabled:opacity-60`}
              >
                {t('downgradeLink')}
              </button>
            ) : null}
          </div>
        </div>
      </PickerSurface>

      <Sheet
        open={downOpen}
        onOpenChange={(open) => (pending ? undefined : setDownOpen(open))}
        title={t('downgradeConfirmTitle')}
        description={t('downgradeConfirmBody')}
        closeLabel={t('close')}
      >
        <div className="flex flex-col gap-3">
          <Button variant="danger" size="lg" block loading={pending} onClick={downgrade}>
            {t('downgradeConfirmCta')}
          </Button>
          <Button variant="secondary" block disabled={pending} onClick={() => setDownOpen(false)}>
            {t('cancel')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
