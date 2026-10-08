// PickerOverlay: styles only. The overlay itself (its shadow root, pointer-events: none, and what it draws) is `createOverlay` from
// `@hachej/boring-feedback/page`; this file is the editable look, passed into that shadow root. Labels come from the privacy policy there, so
// restyling cannot change what they say. The host keeps one overlay per page and shares it between PointButton and FeedbackReport.
import { useEffect, useState } from 'react';
import { createOverlay, type PickerOverlay } from '@hachej/boring-feedback/page';

/** CSS added to the overlay's shadow root. Parts: `box`, `label`, `toolbar` (and `box-<tone>`, `label-<tone>` for hover, pinned,
 * reveal and candidate). The colors read the host's `--boring-feedback-*` variables, which inherit through the shadow boundary. */
export const pickerOverlayStyles = `
.box { border-radius: 6px; }
.box[data-tone="hover"] { border-width: 2px; }
.box[data-tone="pinned"] { box-shadow: 0 0 0 3px color-mix(in srgb, var(--boring-feedback-accent, #2563eb) 25%, transparent); }
.box[data-tone="reveal"] { animation: boring-feedback-pulse 1.2s ease-out 2; }
.label { border-radius: 6px; box-shadow: 0 2px 8px rgb(0 0 0 / 25%); }
.toolbar { box-shadow: 0 8px 24px rgb(0 0 0 / 30%); }
@keyframes boring-feedback-pulse { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--boring-feedback-reveal, #d97706) 55%, transparent); } to { box-shadow: 0 0 0 14px transparent; } }
@media (prefers-reduced-motion: reduce) { .box[data-tone="reveal"] { animation: none; } }
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
