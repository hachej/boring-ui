// PickerOverlay: styles only. The overlay itself (its shadow root, pointer-events: none, and what it draws) is `createOverlay` from
// `@hachej/boring-feedback/page`; this file is the editable look, passed into that shadow root. Labels come from the privacy policy there, so
// restyling cannot change what they say. The host keeps one overlay per page and shares it between PointButton and FeedbackReport.
import { useEffect, useState } from 'react';
import { createOverlay, type PickerOverlay } from '@hachej/boring-feedback/page';

/** CSS added to the overlay's shadow root, over its base styles: fonts, sizes, weights and corners read the app's tokens (with the
 * shadcn defaults as fallbacks). Parts: `box`, `label`, `toolbar` (and `box-<tone>`, `label-<tone>` for hover, pinned,
 * reveal and candidate). The colors read the host's `--boring-feedback-*` variables, which inherit through the shadow boundary. */
export const pickerOverlayStyles = `
.box { border-radius: var(--radius-sm, calc(var(--radius, 0.625rem) * 0.6)); }
.box[data-tone="hover"] { border-width: 2px; }
.box[data-tone="pinned"] { box-shadow: 0 0 0 3px color-mix(in srgb, var(--boring-feedback-accent, var(--primary)) 25%, transparent); }
.box[data-tone="reveal"] { animation: boring-feedback-pulse 1.2s var(--ease-standard, cubic-bezier(0.4, 0, 0.2, 1)) 2; }
.label { border-radius: var(--radius-sm, calc(var(--radius, 0.625rem) * 0.6)); box-shadow: var(--shadow-sm, 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)); font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif); font-size: var(--text-xs, 0.75rem); font-weight: var(--font-weight-medium, 500); line-height: var(--leading-normal, 1.5); }
.label[data-tone="candidate"] { font-weight: var(--font-weight-bold, 700); }
.toolbar { border-radius: var(--radius-xl, calc(var(--radius, 0.625rem) * 1.4)); box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)); }
.toolbar button { border-radius: var(--radius-md, calc(var(--radius, 0.625rem) * 0.8)); font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif); font-size: var(--text-sm, 0.875rem); font-weight: var(--font-weight-semibold, 600); line-height: var(--leading-tight, 1.25); }
@keyframes boring-feedback-pulse { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--boring-feedback-reveal, var(--ring)) 55%, transparent); } to { box-shadow: 0 0 0 14px transparent; } }
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
