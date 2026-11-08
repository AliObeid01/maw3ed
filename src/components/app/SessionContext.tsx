'use client';

import { createContext, useContext } from 'react';

/** What every dashboard page needs to know about the signed-in user and their business. */
export type AppSession = {
  userName: string;
  email: string | null;
  phone?: string | null;
  /** False until the owner confirms their address: shows the banner and disables inviting and listing. */
  emailVerified: boolean;
  role: 'OWNER' | 'STAFF' | 'PRACTITIONER';
  businessName: string;
  slug: string;
  /** Versioned public logo url; null shows the initials. Updated in place after an upload (ShellLogoContext). */
  logoUrl?: string | null;
  timezone: string;
};

const SessionContext = createContext<AppSession | null>(null);

/**
 * The business logo shown in the sidebar chip. Lives beside the session so an upload or removal in Settings
 * updates the chip at once, without a reload. The initial value is the server-rendered session's logoUrl.
 */
export type ShellLogo = { logoUrl: string | null; setLogoUrl: (url: string | null) => void };
const ShellLogoContext = createContext<ShellLogo>({ logoUrl: null, setLogoUrl: () => undefined });
export const ShellLogoProvider = ShellLogoContext.Provider;
export const useShellLogo = () => useContext(ShellLogoContext);

export const SessionProvider = SessionContext.Provider;

export function useAppSession(): AppSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useAppSession must be used inside the dashboard layout');
  return session;
}
