'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The error summary above the Pay button (declined card, expired link, network). It is the one live region
 * (`role="alert"`, announced once when it mounts), it takes focus when it appears so a keyboard or screen reader user
 * lands on the problem, and it fades in (a colour change, never a shake). It only mounts for a new problem: while a
 * payment is in flight the caller removes it.
 */
export function PaymentProblem({ testId, children }: { testId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      data-testid={testId}
      className="motion-fade-in rounded-card-sm"
    >
      {children}
    </div>
  );
}
