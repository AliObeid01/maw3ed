'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const HEADER_SLOT_ID = 'app-header-actions';

const noopSubscribe = () => () => undefined;

/** Lets a page put its primary action (Add service, Save settings) into the shell header, as on the boards. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(
    noopSubscribe,
    () => document.getElementById(HEADER_SLOT_ID),
    () => null,
  );
  return slot ? createPortal(children, slot) : null;
}
