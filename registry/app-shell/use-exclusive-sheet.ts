'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

interface Open { readonly close: () => void }
const opened = new Set<Open>();

/** While `open`, this sheet is the only one: every other open sheet is asked to close when it opens. */
export function useExclusiveSheet(open: boolean, close: () => void): void {
  const latest = useRef(close);
  useLayoutEffect(() => { latest.current = close; });
  useEffect(() => {
    if (!open) return;
    const mine: Open = { close: () => latest.current() };
    for (const other of [...opened]) other.close();
    opened.add(mine);
    return () => { opened.delete(mine); };
  }, [open]);
}
