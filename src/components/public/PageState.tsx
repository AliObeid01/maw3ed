import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

/** Centred card for "not found", "expired" and "couldn't load" on the public pages. */
export function PageState({
  icon,
  title,
  body,
  action,
  tone = 'brand',
  role,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
  tone?: 'brand' | 'warning';
  role?: 'alert' | 'status';
  className?: string;
}) {
  return (
    <main id="main-content" className="mx-auto flex w-full max-w-[1240px] flex-1 items-start justify-center px-4 py-10 md:px-8 md:py-16">
      <Card
        role={role}
        className={cn('flex w-full max-w-md flex-col items-center gap-4 text-center', className)}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-14 items-center justify-center rounded-[18px]',
            tone === 'brand' ? 'bg-brand-soft text-brand' : 'bg-warning-soft text-warning',
          )}
        >
          {icon}
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-xl font-semibold">{title}</h1>
          <p className="m-0 text-[15px] text-muted">{body}</p>
        </div>
        {action}
      </Card>
    </main>
  );
}
