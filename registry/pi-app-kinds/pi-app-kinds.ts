'use client';

// The default artifact kinds of the pi-app item (D-257), in its resolution order: the domain kinds (maquette, diagram, mock-up, records),
// then the document kinds (Markdown, HTML, SVG, CSV, image, PDF). `AgentWorkspace` and `ViewerOptions` resolve kinds only from the list a
// host passes; pass `defaultKinds()` for these, put an app's own kinds before them, or pass a list of your own. Each kind module is cheap
// (match, label, icon, loader); its view loads the first time an artifact of that kind opens, so no viewer is in the page's first bundle.
import { createMaquetteKind } from '../maquette-viewer/maquette-kind';
import type { MaquetteComments } from '../maquette-viewer/maquette-viewer';
import { createDiagramKind } from '../diagram-viewer/diagram-kind';
import { createMockupKind } from '../mockup-viewer/mockup-kind';
import type { MockupComments } from '../mockup-viewer/mockup-viewer';
import { createRecordsKind } from '../record-viewer/records-kind';
import { markdownKind } from '../viewer-markdown/markdown-kind';
import { htmlKind } from '../viewer-html/html-kind';
import { csvKind, svgKind } from '../viewer-code/code-kinds';
import { imageKind } from '../viewer-image/image-kind';
import { pdfKind } from '../viewer-pdf/pdf-kind';
import type { PanelKind } from '../pi-app/viewer-kinds';

/** The document kinds: each is a host's default for its type, so a `viewers` entry for that type wins over it. */
export const documentKinds: readonly PanelKind[] = [markdownKind, htmlKind, svgKind, csvKind, imageKind, pdfKind];

export interface DefaultKindsOptions {
  /** The language of the domain kinds' names and viewers (a `.maquette.json` card says « Maquette » in French). Default English. */
  readonly locale?: 'en' | 'fr' | undefined;
  /** Comment pins on mock-ups and maquettes: the registry `feedback` item's `usePointComments(session)`. Omit it and no comment icon shows. */
  readonly comments?: (MaquetteComments & Pick<MockupComments, 'pick' | 'picking' | 'reposition'>) | undefined;
}

/**
 * The default kinds, in order (the first match wins): maquette, diagram, mock-up and records, then Markdown, HTML, SVG, CSV, image and
 * PDF. A fresh list each call: build it once (a module constant, or `useMemo` on `locale` and `comments`) and pass it as `artifactKinds`.
 */
export function defaultKinds({ locale, comments }: DefaultKindsOptions = {}): readonly PanelKind[] {
  return [createMaquetteKind({ locale, comments }), createDiagramKind({ locale }), createMockupKind({ locale, comments }), createRecordsKind({ locale }), ...documentKinds];
}
