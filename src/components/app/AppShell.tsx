'use client';

import { useState, type ReactNode } from 'react';
import { AppSidebar, type ShellBusiness } from './AppSidebar';
import { AppTabBar } from './AppTabBar';
import { MoreSheet } from './MoreSheet';
import { NewBookingFab } from './NewBookingFab';
import { defaultHrefs, type ActiveId, type NavBadges } from './nav';

export type AppShellProps = {
  business: ShellBusiness;
  activeId: ActiveId;
  /** Counts for the red (reminders due) and amber (outcomes to mark) badges. */
  badges?: NavBadges;
  /** Override individual route targets. */
  hrefs?: Partial<Record<ActiveId, string>>;
  /** Header strip (board 22): small line above the title, usually the formatted date. */
  eyebrow?: string;
  title: string;
  /** Right side of the header on `md+` (date nav, etc.). */
  actions?: ReactNode;
  onSignOut?: () => void;
  signingOut?: boolean;
  /** Hide the Business section (setup pages are owner-only; receptionists do not see it). */
  hideBusiness?: boolean;
  children: ReactNode;
};

/**
 * Dashboard frame. `lg+`: 256 px sidebar. Below `lg`: bottom tab bar + More sheet + floating New booking.
 * Active page is marked with `aria-current="page"`.
 */
export function AppShell({
  business,
  activeId,
  badges,
  hrefs: hrefOverrides,
  eyebrow,
  title,
  actions,
  onSignOut,
  signingOut,
  hideBusiness,
  children,
}: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const hrefs = { ...defaultHrefs, ...hrefOverrides };

  return (
    <div className="flex min-h-dvh bg-canvas">
      <AppSidebar
        business={business}
        activeId={activeId}
        badges={badges}
        hrefs={hrefs}
        hideBusiness={hideBusiness}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-divider bg-surface px-4 py-3.5 md:px-8">
          <div className="flex min-w-0 flex-[1_1_auto] flex-col">
            {eyebrow ? <span className="text-[13px] text-muted">{eyebrow}</span> : null}
            <h1 className="text-[22px] leading-tight font-semibold">{title}</h1>
          </div>
          {actions}
        </header>
        <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-[18px] px-4 pt-4 pb-[calc(64px+env(safe-area-inset-bottom)+88px)] md:px-8 md:pt-6 lg:pb-8">
          {children}
          {/* Fixed-position, but kept inside the main landmark so it is not orphaned content. */}
          <NewBookingFab href={hrefs.book} active={activeId === 'book'} />
        </main>
      </div>
      <AppTabBar
        activeId={activeId}
        badges={badges}
        hrefs={hrefs}
        moreOpen={moreOpen}
        onMore={() => setMoreOpen(true)}
      />
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        activeId={activeId}
        badges={badges}
        hrefs={hrefs}
        onSignOut={onSignOut}
        signingOut={signingOut}
        hideBusiness={hideBusiness}
      />
    </div>
  );
}
