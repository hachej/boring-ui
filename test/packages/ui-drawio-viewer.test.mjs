// `@hachej/boring-ui-kit/drawio-viewer` (D-1398): the built subpath exports the pinned official diagrams.net viewer as text, byte for byte
// the file scripts/vendor-drawio-viewer.mjs pins, and the kit's root does not carry it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { DRAWIO_SHA256, DRAWIO_TAG } from '../../scripts/vendor-drawio-viewer.mjs';

test('the kit exports the pinned diagrams.net viewer as text, only from its own subpath', async () => {
  const viewer = await import('@hachej/boring-ui-kit/drawio-viewer');
  assert.equal(`v${viewer.DRAWIO_VIEWER_VERSION}`, DRAWIO_TAG);
  assert.equal(createHash('sha256').update(viewer.DRAWIO_VIEWER_SCRIPT, 'utf8').digest('hex'), DRAWIO_SHA256);
  assert.match(viewer.DRAWIO_VIEWER_SCRIPT, /GraphViewer\.createViewerForElement=/);
  const kit = await import('@hachej/boring-ui-kit');
  assert.equal('DRAWIO_VIEWER_SCRIPT' in kit, false);
});
