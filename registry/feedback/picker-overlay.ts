// PickerOverlay: styles only. The overlay itself (its shadow root, pointer-events: none, and what it draws) is `createOverlay` from
// `@hachej/boring-feedback/page`; this file is the editable look, passed into that shadow root. Labels come from the privacy policy there, so
// restyling cannot change what they say. The host keeps one overlay per page and shares it between PointButton and FeedbackReport.
import { useEffect, useState } from 'react';
import { createOverlay, type PickerOverlay } from '@hachej/boring-feedback/page';

/** CSS added to the overlay's shadow root, over its base styles: fonts, sizes, weights, corners and elevation read the app's
 * tokens only; tones (hover, pinned, reveal, candidate) keep the base styles' borders. Parts: `box`, `label`, `toolbar` (and `box-<tone>`, `label-<tone>` for hover, pinned,
 * reveal and candidate). The colors read the host's `--boring-feedback-*` variables, which inherit through the shadow boundary. */
export const pickerOverlayStyles = `
.box { border-radius: var(--radius-sm); }
.label { border-radius: var(--radius-sm); box-shadow: var(--shadow-sm); font-family: var(--font-sans); font-size: var(--text-xs); font-weight: var(--font-weight-medium); line-height: var(--leading-normal); }
.label[data-tone="candidate"] { font-weight: var(--font-weight-bold); }
.toolbar { border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); }
.toolbar button { border-radius: var(--radius-md); font-family: var(--font-sans); font-size: var(--text-sm); font-weight: var(--font-weight-semibold); line-height: var(--leading-tight); }
`;

/** One overlay for the page, created after mount and removed on unmount. */
export function usePickerOverlay(styles: string = pickerOverlayStyles): PickerOverlay | undefined {
  const [overlay, setOverlay] = useState<PickerOverlay>();
  useEffect(() => {
    const created = createOverlay({ document, styles });
    setOverlay(created);
    return () => { created.dispose(); };
  }, [styles]);
  return overlay;
}
