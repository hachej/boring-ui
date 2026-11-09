'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';

interface Open { readonly close: () => void; /** The phone nav sheet itself. */ readonly nav: boolean }
const opened = new Set<Open>();

/** True inside the phone nav sheet's content: a sheet opened from there is nested (it stacks on the nav sheet, whose subtree it lives in) and does not close it. */
export const InsideNavSheet = createContext(false);

/** While `open`, this sheet is the only one: every other open sheet is asked to close when it opens, except the nav sheet a nested sheet lives in. `nav` marks the phone nav sheet's own registration. */
export function useExclusiveSheet(open: boolean, close: () => void, nav = false): void {
  const latest = useRef(close);
  const nested = useContext(InsideNavSheet);
  useLayoutEffect(() => { latest.current = close; });
  useEffect(() => {
    if (!open) return;
    const mine: Open = { close: () => latest.current(), nav };
    for (const other of [...opened]) if (!(nested && other.nav)) other.close();
    opened.add(mine);
    return () => { opened.delete(mine); };
  }, [open, nested, nav]);
}
