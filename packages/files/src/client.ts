import type { ResourceRead, ReadResult, PublicationRequest, PublicationResult, PublicationLookupResult, ResourceRenameRequest, ResourceDeleteRequest } from './contracts.js';

/** Authenticated host/client binding. No ResourceAccess, approval authority or
 * trusted request digest is accepted from the browser. A request still requires
 * real server validation. Uncertain saves can use optional reconciliation.
 */
export interface ResourceClient {
  readonly read: (request: ResourceRead, signal?: AbortSignal) => Promise<ReadResult>;
  /** PublicationNotDispatchedError describes this call only; reconcile any earlier uncertain attempt separately. */
  readonly publish?: (request: PublicationRequest, signal?: AbortSignal) => Promise<PublicationResult>;
  readonly lookup?: (operationId: string, signal?: AbortSignal) => Promise<PublicationLookupResult>;
  readonly rename?: (request: ResourceRenameRequest, signal?: AbortSignal) => Promise<PublicationResult>;
  readonly delete?: (request: ResourceDeleteRequest, signal?: AbortSignal) => Promise<PublicationResult>;
}
