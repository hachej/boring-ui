// Side-by-side board evidence: mockup on the left, build on the right, same pixel size, a caption above each. Uses ImageMagick.
import { execFileSync } from 'node:child_process';

export function sideBySide(mockup, build, out, board) {
  const left = mockup ? [mockup] : ['-size', '780x1688', 'xc:#eeeeee'];
  // Both halves at the mockup's pixel size (2×), so they compare 1:1.
  execFileSync('convert', [
    '(', ...left, '-gravity', 'north', '-background', 'white', '-splice', '0x36', '-font', 'DejaVu-Sans', '-pointsize', '22', '-annotate', '+0+6', `${board} · mockup`, ')',
    '(', build, '-gravity', 'north', '-background', 'white', '-splice', '0x36', '-font', 'DejaVu-Sans', '-pointsize', '22', '-annotate', '+0+6', `${board} · build`, ')',
    '-background', '#888888', '-splice', '0x0', '+append', out,
  ]);
}
