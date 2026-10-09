/** Optional document adapter contracts. Importing the headless UI root does
 * not require this file or @hachej/boring-files. No native Pi type dependency here.
 */
import type { ResourceRead, ResourceExpectation, ResourceRef, PublicationReceipt, PublicationResult } from '@hachej/boring-files';
import type { ViewerController, ViewerDescriptor, ViewerTarget } from './contracts.js';

export interface ResourceViewerDescriptor extends ViewerDescriptor {
  readonly source: ResourceRead;
}

/** An acknowledged selection includes editor incarnation and buffer version.
 * An absent target represents create-if-absent: no fabricated saved revision.
 */
export interface SaveSelection {
  readonly target: ViewerTarget<{
    readonly scopeId: string;
    readonly base: ResourceExpectation;
    readonly bufferVersion: number;
  }>;
}

export type SaveResult =
  | {
      readonly kind: 'saved';
      readonly selection: SaveSelection;
      /** Actual resulting revision, also present in the checked receipt. */
      readonly ref: ResourceRef;
      readonly receipt: PublicationReceipt;
    }
  | Exclude<PublicationResult, { readonly kind: 'committed' }>;

export interface EditableViewerController<State, Actions, Tools = unknown> extends ViewerController<State, Actions, Tools> {
  /** Acknowledge only this selection or fail; prior/partial/unknown effects
   * remain explicit. Merely loading or rendering a document never saves it.
   */
  readonly flush: (selection: SaveSelection, signal?: AbortSignal) => Promise<SaveResult>;
}
