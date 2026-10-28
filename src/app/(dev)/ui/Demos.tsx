'use client';

import type { ComponentProps, ReactNode } from 'react';
import { AppShell } from '@/components/app/AppShell';
import { StepRail } from '@/components/public/StepRail';

/** Client wrappers so the dev pages (Server Components) can pass event handlers. */
export function ShellDemo({
  children,
  ...props
}: Omit<ComponentProps<typeof AppShell>, 'onSignOut' | 'signingOut'> & { children: ReactNode }) {
  return (
    <AppShell {...props} onSignOut={() => {}}>
      {children}
    </AppShell>
  );
}

export function StepRailDemo(props: Omit<ComponentProps<typeof StepRail>, 'onBack'>) {
  return <StepRail {...props} onBack={() => {}} />;
}
