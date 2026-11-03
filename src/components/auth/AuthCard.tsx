import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

/** The white auth card of boards 3.1 to 3.3 (440 px; the sign up page widens it at md and up), flat with a neutral lift. */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card
      as="section"
      className={cn(
        'animate-rise-in flex w-full max-w-[440px] flex-col gap-4 rounded-card p-5 shadow-[0_1px_2px_rgb(0_0_0/0.08),0_4px_12px_rgb(0_0_0/0.08)] motion-reduce:animate-none sm:p-6',
        className,
      )}
    >
      {children}
    </Card>
  );
}

export function AuthHeading({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="m-0 text-2xl font-semibold md:text-[26px]">{title}</h1>
      {subtitle ? <p className="m-0 text-[15px] text-muted">{subtitle}</p> : null}
    </div>
  );
}
