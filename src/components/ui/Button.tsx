'use client';

import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles';

export { buttonClasses, type ButtonSize, type ButtonVariant };

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
      className={cn('animate-spin motion-reduce:animate-none', className)}
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width. */
  block?: boolean;
  /** Pending mutation: shows a spinner, sets aria-busy and blocks double submit. */
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading = false,
  className,
  type = 'button',
  disabled,
  children,
  onClick,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={buttonClasses({ variant, size, block, className })}
      // Plain `disabled` is native. While loading we keep the button focusable (aria-disabled) so a
      // keyboard user does not lose their place, and swallow clicks to block a double submit.
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

export function ButtonLink({
  variant,
  size,
  block,
  className,
  onClick,
  ...props
}: ButtonLinkProps) {
  const disabled = props['aria-disabled'] === true || props['aria-disabled'] === 'true';
  return (
    <Link
      {...props}
      className={buttonClasses({ variant, size, block, className })}
      // A disabled link must not navigate or be tabbable.
      tabIndex={disabled ? -1 : props.tabIndex}
      onClick={disabled ? (e) => e.preventDefault() : onClick}
    />
  );
}
