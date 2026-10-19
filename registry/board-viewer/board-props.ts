import type { ResourceClient, ResourceLocator } from '@hachej/boring-files';
import type { TextBufferState } from '@hachej/boring-ui-kit/text-buffer';
import type { CanvasAssetUrls } from '@hachej/boring-ui-kit/canvas-editor';
import type { Editor } from 'tldraw';
import type { MockupComments } from '../mockup-viewer/mockup-viewer';

export interface BoardHostProps {
  readonly client: ResourceClient;
  readonly identity: TextBufferState['identity'];
  readonly assetUrls: CanvasAssetUrls;
  readonly licenseKey?: string | undefined;
  /** Existing host point-comments binding; structured board pin delivery is installed separately. */
  readonly comments?: MockupComments | undefined;
  /** The editor and its store are a disposable projection, never the saved document. */
  readonly onEditor?: ((editor: Editor | null) => void) | undefined;
}
export interface BoardViewerProps extends BoardHostProps {
  readonly target: ResourceLocator;
  readonly text: string;
  readonly revision: string;
  readonly pinned: boolean;
}
