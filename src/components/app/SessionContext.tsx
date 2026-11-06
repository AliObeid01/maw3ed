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
  timezone: string;
};

const SessionContext = createContext<AppSession | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useAppSession(): AppSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useAppSession must be used inside the dashboard layout');
  return session;
}
