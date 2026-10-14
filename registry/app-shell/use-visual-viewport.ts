import { useEffect, useState } from 'react';

export interface VisualViewportBox { readonly top: number; readonly height: number }

/**
 * The visual viewport (what is left above the software keyboard), updated on its `resize` and `scroll`. Null where the browser has none.
 * While the page is pinch-zoomed (`scale > 1.01`) the last value is kept, so zooming never resizes a layer.
 */
export function useVisualViewport(): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const read = () => {
      if (viewport.scale > 1.01) return;
      const next = { top: viewport.offsetTop, height: viewport.height };
      setBox(previous => previous && previous.top === next.top && previous.height === next.height ? previous : next);
    };
    read();
    viewport.addEventListener('resize', read);
    viewport.addEventListener('scroll', read);
    return () => { viewport.removeEventListener('resize', read); viewport.removeEventListener('scroll', read); };
  }, []);
  return box;
}
