'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@/lib/cn';
import { placePopover } from '@/lib/pickers/position';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { Sheet } from '../Sheet';

/**
 * The one place that decides how a picker opens, for Select, TimePicker and DatePicker alike:
 * - below `md` (phones) a bottom sheet (the shared Sheet: focus trap, Esc, backdrop, scroll lock, focus return);
 * - from `md` an anchored popover under the field (flips above when there is no room, scrolls inside when tall,
 *   closes on Esc, outside click or Tab, and hands focus back to the field).
 *
 * The popover is a non-modal Radix Dialog, so it nests correctly inside a dialog or sheet that is already open
 * (the hours editor) and Esc closes only the picker. Its position is written through the CSS object model (never an
 * inline `style=""` attribute in the HTML), so the strict nonce CSP is untouched.
 */

type Mode = 'sheet' | 'popover';
const ModeContext = createContext<Mode>('popover');
/** Panels read this to size their scroll areas differently in a sheet and in a popover. */
export const useSurfaceMode = () => useContext(ModeContext);

export type PickerSurfaceProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The field the surface belongs to: popover anchor and where focus returns to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Sheet heading and popover accessible name (the field's label). */
  title: string;
  closeLabel: string;
  /** Popover width in px, or `anchor` to match the field (never narrower than `minWidth`). */
  width?: number | 'anchor';
  minWidth?: number;
  children: ReactNode;
};

export function PickerSurface(props: PickerSurfaceProps) {
  const wide = useMediaQuery('(min-width: 768px)');
  const { open, anchorRef } = props;

  // Hand focus back to the field when the picker closes. Radix Dialog only returns focus to a `Dialog.Trigger`
  // (ours is a plain button), and its own handler cancels the default, so the sheet needs this; the popover
  // also does it in `onCloseAutoFocus` (skipped when focus already moved on, for example after Tab).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      anchorRef.current?.focus();
    }
  }, [open, anchorRef]);

  if (!props.open) return null;
  if (!wide) {
    return (
      <ModeContext.Provider value="sheet">
        <Sheet
          open
          onOpenChange={props.onOpenChange}
          title={props.title}
          closeLabel={props.closeLabel}
          // Focus lands on the picker's own keyboard host (listbox, search box, hours column, day), not on Close.
          onOpenAutoFocus={(e) => {
            const host = (e.target as HTMLElement).querySelector<HTMLElement>('[data-picker-host]');
            if (host) {
              e.preventDefault();
              host.focus({ preventScroll: true });
            }
          }}
        >
          {props.children}
        </Sheet>
      </ModeContext.Provider>
    );
  }
  return (
    <ModeContext.Provider value="popover">
      <AnchoredPopover {...props} />
    </ModeContext.Provider>
  );
}

function AnchoredPopover({
  onOpenChange,
  anchorRef,
  title,
  width = 'anchor',
  minWidth = 220,
  children,
}: PickerSurfaceProps) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  // State mirrors the ref so the effects below run once the portal content has mounted.
  const [mounted, setMounted] = useState(false);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const node = nodeRef.current;
    if (!node || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const wanted = width === 'anchor' ? Math.max(rect.width, minWidth) : width;
    // Measure the natural height on a hidden clone, never on the live node: changing the live node's max-height lets
    // its scroll area grow, and the browser then clamps the list's scrollTop (the chosen option would jump out of view).
    const clone = node.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');
    clone.setAttribute('aria-hidden', 'true');
    clone.inert = true;
    clone.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;top:-10000px;left:0;max-height:none;width:${wanted}px`;
    document.body.appendChild(clone);
    const naturalHeight = clone.getBoundingClientRect().height;
    clone.remove();
    const natural = { height: naturalHeight };
    const rtl = getComputedStyle(anchor).direction === 'rtl';
    const p = placePopover(
      rect,
      { width: wanted, height: natural.height },
      { width: document.documentElement.clientWidth, height: window.innerHeight },
      rtl,
    );
    node.style.top = `${p.top}px`;
    node.style.left = `${p.left}px`;
    node.style.width = `${p.width}px`;
    node.style.maxHeight = `${p.maxHeight}px`;
  }, [anchorRef, minWidth, width]);

  useLayoutEffect(() => {
    if (mounted) place();
  }, [mounted, place]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!mounted || !node) return;
    // The popover's own scrolling (the list, a wheel) is not a reason to move it.
    const again = (e?: Event) => {
      if (e?.target instanceof Node && node.contains(e.target)) return;
      place();
    };
    window.addEventListener('resize', again);
    // Capture: any scrolling ancestor of the field moves it.
    window.addEventListener('scroll', again, true);
    const observer = new ResizeObserver(() => again());
    observer.observe(node);
    return () => {
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
      observer.disconnect();
    };
  }, [mounted, place]);

  const onKeyDown = (e: KeyboardEvent) => {
    // Tab leaves the popover: give focus back to the field first so the browser continues from there.
    if (e.key === 'Tab') {
      anchorRef.current?.focus();
      onOpenChange(false);
    }
  };

  return (
    <Dialog.Root open modal={false} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          ref={(el) => {
            nodeRef.current = el;
            setMounted(el !== null);
          }}
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // Tab already moved focus on to the next field: leave it there.
            const active = document.activeElement;
            if (!active || active === document.body) anchorRef.current?.focus();
          }}
          onInteractOutside={(e) => {
            // The field's own click toggles the picker; do not close here and reopen there.
            if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          className={cn(
            // top / left / width / max-height are written through the CSS object model by `place()`.
            'animate-fade-in fixed z-[60] flex flex-col overflow-hidden rounded-card border border-line bg-surface p-2 shadow-[0_2px_8px_rgb(0_0_0/0.10)] outline-none',
          )}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
