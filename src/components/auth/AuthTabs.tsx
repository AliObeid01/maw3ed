import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

const base =
  'flex h-11 items-center justify-center rounded-chip text-[15px] font-semibold no-underline transition-colors duration-200 ease-out';

/** Sign in / Sign up switch from the boards. Two real links, so each state has its own URL; the current one has `aria-current`. */
export function AuthTabs({ active }: { active: 'login' | 'signup' }) {
  const t = useTranslations('auth.tabs');
  return (
    <nav aria-label={t('label')} className="grid grid-cols-2 gap-1 rounded-btn bg-canvas p-1">
      <Link
        href="/login"
        aria-current={active === 'login' ? 'page' : undefined}
        className={cn(
          base,
          active === 'login'
            ? 'bg-surface text-ink shadow-[0_2px_8px_rgba(11,25,56,0.12)]'
            : 'text-muted hover:text-ink',
        )}
      >
        {t('signIn')}
      </Link>
      <Link
        href="/signup"
        aria-current={active === 'signup' ? 'page' : undefined}
        className={cn(
          base,
          active === 'signup'
            ? 'bg-surface text-ink shadow-[0_2px_8px_rgba(11,25,56,0.12)]'
            : 'text-muted hover:text-ink',
        )}
      >
        {t('signUp')}
      </Link>
    </nav>
  );
}
