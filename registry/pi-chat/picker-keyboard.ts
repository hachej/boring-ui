'use client';

import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

/**
 * Keyboard navigation for a floating picker, ported from v2's `use-picker-keyboard`. It listens on the window in the
 * capture phase and stops handled keys, so the textarea keeps focus and Enter does not also send the message.
 */
export function usePickerKeyboard({ count, activeIdx, setActiveIdx, listRef, onSelect, onDismiss }: {
  readonly count: number;
  readonly activeIdx: number;
  readonly setActiveIdx: Dispatch<SetStateAction<number>>;
  readonly listRef: RefObject<HTMLElement | null>;
  readonly onSelect: (index: number) => void;
  readonly onDismiss: () => void;
}) {
  const select = useRef(onSelect), dismiss = useRef(onDismiss);
  select.current = onSelect; dismiss.current = onDismiss;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const handled = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.key === 'ArrowDown') { handled(); setActiveIdx(index => count === 0 ? 0 : (index + 1) % count); }
      else if (event.key === 'ArrowUp') { handled(); setActiveIdx(index => count === 0 ? 0 : (index - 1 + count) % count); }
      else if (event.key === 'Enter' || event.key === 'Tab') {
        if (count > 0) { handled(); select.current(activeIdx); }
        // Nothing to pick: close and let the key reach the textarea (Enter then sends as usual).
        else dismiss.current();
      } else if (event.key === 'Escape') { handled(); dismiss.current(); }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [count, activeIdx, setActiveIdx]);
  useEffect(() => { (listRef.current?.children[activeIdx] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' }); }, [activeIdx, listRef]);
}
