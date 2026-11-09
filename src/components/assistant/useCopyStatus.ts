'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/setup/clipboard';

export type CopyState = { key: string; ok: boolean } | null;

/**
 * Copy text and remember WHICH item was copied for a moment (so one live region can announce it and one button
 * can show "Copied"). `ok: false` means neither the Clipboard API nor the fallback worked.
 */
export function useCopyStatus(resetMs = 2500) {
  const [state, setState] = useState<CopyState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (key: string, text: string, fallback?: () => void) => {
      const ok = await copyText(text);
      if (!ok) fallback?.();
      setState({ key, ok });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState(null), resetMs);
      return ok;
    },
    [resetMs],
  );

  return { state, copy };
}
