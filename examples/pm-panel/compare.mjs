// Side-by-side board evidence: mockup on the left, build on the right, same pixel size, a caption above each. Uses ImageMagick.
import { execFileSync } from 'node:child_process';

/** Boards whose PNG still shows the strip's pause and ×, both changed on purpose (spec 1 §2, Julien 2026-10-28). */
const STRIP_CHANGED = new Set(['C3', 'C4', 'C5', 'D7', 'D7b']);
const STRIP_NOTE = 'Changed on purpose (spec 1 §2, Julien 2026-10-28): no pause button,\nand × became the « ✓ Terminer » / "Done" pill. The mockup predates this.';

export function sideBySide(mockup, build, out, board) {
  const left = mockup ? [mockup] : ['-size', '780x1688', 'xc:#eeeeee'];
  // Both halves at the mockup's pixel size (2×), so they compare 1:1.
  execFileSync('convert', [
    '(', ...left, '-gravity', 'north', '-background', 'white', '-splice', '0x36', '-font', 'DejaVu-Sans', '-pointsize', '22', '-annotate', '+0+6', `${board} · mockup`, ')',
    '(', build, '-gravity', 'north', '-background', 'white', '-splice', '0x36', '-font', 'DejaVu-Sans', '-pointsize', '22', '-annotate', '+0+6', `${board} · build`, ')',
    '-background', '#888888', '-splice', '0x0', '+append',
    ...(STRIP_CHANGED.has(board) ? ['-gravity', 'south', '-background', '#fff4c2', '-splice', '0x76', '-gravity', 'southwest', '-font', 'DejaVu-Sans', '-pointsize', '22', '-fill', '#5c4a00', '-annotate', '+16+10', STRIP_NOTE] : []),
    '+repage', out,
  ]);
}
