'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import { logout } from '@/lib/api/auth';
import { errorKey } from '@/lib/setup/errors';

/** Sign out of this device and go to the sign-in page. Shared by the shell, the account sheet and the Account page. */
export function useSignOut() {
  const router = useRouter();
  const t = useTranslations('app.frame');
  const toast = useToast();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      router.replace('/login');
    } catch (error) {
      // An expired session is already signed out: go to the sign-in page either way.
      if (errorKey(error) === 'unauthorized') router.replace('/login');
      else toast.show(t('signOutFailed'), 'error');
      setSigningOut(false);
    }
  };
  return { signOut, signingOut };
}
