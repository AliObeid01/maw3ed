import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Loading placeholder. Give it the final element's size so nothing shifts when data arrives. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-input bg-divider motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
