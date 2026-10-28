import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';

/** The 440 px white card of boards 3.1 to 3.3 (radius 28, soft lift). */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card
      as="section"
      className={cn(
        'animate-rise-in flex w-full max-w-[440px] flex-col gap-[22px] rounded-[28px] p-5 shadow-[0_24px_60px_rgba(37,45,45,0.08)] motion-reduce:animate-none sm:p-6',
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
