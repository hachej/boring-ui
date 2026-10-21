'use client';

import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export interface HoldToRecordActions {
  readonly start: () => void;
  readonly finish: () => void;
  readonly cancel: () => void;
}

/** The immediate microphone and delayed shell trigger share cancellation, but retain ownership of their own held gesture. */
export function useRecordingCancellation(cancel: () => void) {
  const latest = useRef(cancel); latest.current = cancel;
  useEffect(() => {
    const stop = () => latest.current();
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') stop(); };
    const hidden = () => { if (document.hidden) stop(); };
    window.addEventListener('keydown', escape, true); window.addEventListener('blur', stop); document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden);
      stop();
    };
  }, []);
}

/** Gesture policy shared by the chat and shell. Pointer cancellation keeps audio; deliberate slide/Escape/lost visibility discards it. */
export function useHoldToRecord(actions: HoldToRecordActions, disabled = false) {
  const ref = useRef<HTMLButtonElement>(null);
  const latest = useRef({ actions, disabled }); latest.current = { actions, disabled };
  const held = useRef<number | string | null>(null);
  const cancel = () => { if (held.current === null) return; held.current = null; latest.current.actions.cancel(); };
  useRecordingCancellation(cancel);
  useEffect(() => {
    const node = ref.current;
    const keep = (event: Event) => { if (event.cancelable) event.preventDefault(); };
    node?.addEventListener('touchstart', keep, { passive: false });
    return () => node?.removeEventListener('touchstart', keep);
  }, []);
  const release = (event: PointerEvent<HTMLButtonElement>) => {
    if (held.current !== event.pointerId) return;
    held.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    latest.current.actions.finish();
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>, down: boolean) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (down) {
      if (event.repeat || latest.current.disabled || held.current !== null) return;
      held.current = event.key; latest.current.actions.start();
    } else if (held.current === event.key) { held.current = null; latest.current.actions.finish(); }
  };
  return {
    ref,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (event.button !== 0 || latest.current.disabled || held.current !== null) return;
      held.current = event.pointerId; event.currentTarget.setPointerCapture?.(event.pointerId); latest.current.actions.start();
    },
    onPointerUp: release,
    onPointerCancel: release,
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      if (held.current !== event.pointerId) return;
      const box = event.currentTarget.getBoundingClientRect(), slack = 24;
      if (event.clientX < box.left - slack || event.clientX > box.right + slack || event.clientY < box.top - slack || event.clientY > box.bottom + slack) cancel();
    },
    onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => key(event, true),
    onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => key(event, false),
    onBlur: cancel,
  };
}
