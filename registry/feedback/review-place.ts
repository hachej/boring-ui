// Where the feedback review opens against the chip it hangs from. Pure geometry, kept apart from the component so a host (and a test) can read the rule.

/** The room the review wants above its chip (px): less than this above the chip (a chip anchored at the top of the window) and the review opens below it. */
export const REVIEW_ROOM = 320;

/**
 * Where the review sits against its chip: above it (the chip is at the foot of the window), or below it when the chip is anchored near the top and there is not room above (the review would
 * leave the window). `chip` is the chip's rectangle and `window` the viewport's size; the result is the vertical place the review is drawn at.
 */
export function reviewSide(chip: { readonly top: number; readonly bottom: number }, window: { readonly height: number }): { readonly side: 'above' | 'below'; readonly room: number } {
  const above = chip.top - 8, below = window.height - chip.bottom - 8;
  const side = above >= Math.min(REVIEW_ROOM, below) || above >= below ? 'above' : 'below';
  return { side, room: Math.max(120, (side === 'above' ? above : below) - 12) };
}
