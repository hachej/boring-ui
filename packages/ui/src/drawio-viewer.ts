// `@hachej/boring-ui-kit/drawio-viewer` (D-1398): the official diagrams.net viewer, vendored and pinned (scripts/vendor-drawio-viewer.mjs),
// as text. The drawing-viewer registry block imports this subpath lazily, only when a draw.io file opens, and runs the text inside its
// sandboxed frame: nothing is fetched from diagrams.net. The kit never evaluates it.
export { DRAWIO_VIEWER_SCRIPT } from './vendor/drawio-viewer-static.js';

/** The jgraph/drawio release the vendored viewer comes from. */
export const DRAWIO_VIEWER_VERSION = '32.4.1';
