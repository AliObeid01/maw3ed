'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const HEADER_SLOT_ID = 'app-header-actions';
/** Right after the page title, inside the shell header (the plan chip on Settings). */
export const TITLE_SLOT_ID = 'app-header-title-extra';

const noopSubscribe = () => () => undefined;

function useSlot(id: string) {
  return useSyncExternalStore(
    noopSubscribe,
    () => document.getElementById(id),
    () => null,
  );
}

/** Lets a page put its primary action (Add service, Save settings) into the shell header, as on the boards. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useSlot(HEADER_SLOT_ID);
  return slot ? createPortal(children, slot) : null;
}

/** Lets a page put a small control next to the title in the shell header (Settings: the plan chip). */
export function TitleExtra({ children }: { children: ReactNode }) {
  const slot = useSlot(TITLE_SLOT_ID);
  return slot ? createPortal(children, slot) : null;
}
