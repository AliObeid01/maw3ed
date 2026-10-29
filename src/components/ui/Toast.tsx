'use client';

import { CircleAlert, CircleCheck } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error';
type ToastState = { id: number; tone: ToastTone; message: string };
type ToastApi = { show: (message: string, tone?: ToastTone) => void };

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export const useToast = () => useContext(ToastContext);

const VISIBLE_MS = 4000;

/**
 * One toast at a time, announced politely. Bottom-centre above the tab bar and the floating button on phones,
 * bottom-centre of the content at `lg`.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((message: string, tone: ToastTone = 'success') => {
    clearTimeout(timer.current);
    counter.current += 1;
    setToast({ id: counter.current, tone, message });
    timer.current = setTimeout(() => setToast(null), VISIBLE_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  const api = useMemo(() => ({ show }), [show]);
  const Icon = toast?.tone === 'error' ? CircleAlert : CircleCheck;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(64px+env(safe-area-inset-bottom)+88px)] z-[60] flex justify-center lg:bottom-6"
      >
        {toast ? (
          <div
            key={toast.id}
            className={cn(
              'animate-rise-in pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium shadow-[0_1px_3px_rgb(0_0_0/0.06),0_8px_24px_rgb(0_0_0/0.14)]',
              toast.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-white',
            )}
          >
            <Icon size={18} aria-hidden="true" className="shrink-0" />
            <span>{toast.message}</span>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
