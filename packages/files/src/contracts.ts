/** Application resource/publication contracts, not Pi working-filesystem
 * methods. Types constrain shape; host authorization and provider guarantees
 * still require runtime validation and qualification.
 */
export type NonEmpty<Value> = readonly [Value, ...Value[]];

export interface ResourceId {
  readonly providerId: string;
  readonly path: string;
}

export type ResourceView =
  | { readonly kind: 'published' }
  | {
      readonly kind: 'working';
      /** Opaque provider-scoped view identity. The provider binds it to the
       * actual backing/incarnation; never reuse it for a different view.
       * A resource view need not be a native workspace or remote machine.
       */
      readonly viewId: string;
    };

export interface ResourceLocator {
  readonly resource: ResourceId;
  readonly view: ResourceView;
}

export interface ResourceRef extends ResourceLocator {
  readonly revision: string;
}

export interface ResourceRead {
  readonly target: ResourceLocator;
  readonly revision: { readonly kind: 'latest' } | { readonly kind: 'exact'; readonly value: string };
}

/** Trusted server context, never model/browser request authority. */
export interface ResourceAccess {
  readonly principalId: string;
  readonly scopeId: string;
  readonly initiatorId: string;
  readonly signal?: AbortSignal;
  /** Host-resolved approval/policy binding, not a caller-provided grant. */
  readonly authorizationRef?: string;
}

export interface ResourceSnapshot {
  readonly ref: ResourceRef;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

export type ReadResult =
  | { readonly kind: 'available'; readonly snapshot: ResourceSnapshot }
  | { readonly kind: 'missing' }
  | { readonly kind: 'denied'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** Reused for publication dependencies and a new/existing editor's save base. */
export type ResourceExpectation =
  | { readonly kind: 'absent'; readonly target: ResourceLocator }
  | { readonly kind: 'revision'; readonly target: ResourceRef };

export type ResourceChange =
  | { readonly kind: 'create'; readonly target: ResourceLocator; readonly expected: { readonly kind: 'absent' }; readonly bytes: Uint8Array; readonly mediaType: string }
  | { readonly kind: 'replace'; readonly target: ResourceRef; readonly bytes: Uint8Array; readonly mediaType: string }
  | { readonly kind: 'delete'; readonly target: ResourceRef };

/** Caller expresses intent. The trusted boundary snapshots mutable bytes,
 * validates the request and computes its canonical digest; the caller cannot
 * assert that two different payloads have the same trusted digest.
 */
export interface PublicationRequest {
  readonly operationId: string;
  readonly changes: NonEmpty<ResourceChange>;
  readonly atomicity: 'all-or-nothing' | 'per-change';
  /** Extra exact-content/absence dependencies, in addition to change targets.
   * Search/listing predicate evidence needs its separately qualified provider
   * integration; this minimal contract does not pretend to implement it.
   */
  readonly preconditions?: readonly ResourceExpectation[];
}

export type CommittedChange =
  | { readonly kind: 'create'; readonly before: null; readonly after: ResourceRef }
  | { readonly kind: 'replace'; readonly before: ResourceRef; readonly after: ResourceRef }
  | { readonly kind: 'delete'; readonly before: ResourceRef; readonly after: null };

export interface PublicationReceipt {
  readonly operationId: string;
  /** Computed/checked by the trusted boundary, retained for reconciliation. */
  readonly argumentDigest: string;
  readonly principalId: string;
  readonly scopeId: string;
  readonly initiatorId: string;
  readonly changes: NonEmpty<CommittedChange>;
  readonly evidenceRef: string;
}

/** These are known no-commit refusals, not substitutes for an uncertain effect. */
export type PublicationRefusal =
  | { readonly kind: 'conflict'; readonly current: readonly ResourceRef[]; readonly reason: string }
  | { readonly kind: 'denied'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type PublicationOutcome =
  | { readonly kind: 'committed'; readonly receipt: PublicationReceipt }
  | PublicationRefusal
  | { readonly kind: 'unknown'; readonly operationId: string; readonly reason: string };

/** Result association survives multiple changes/views and lost responses.
 * Providers validate index coverage/uniqueness and target/receipt agreement.
 */
export interface PublicationItem {
  readonly changeIndex: number;
  readonly target: ResourceLocator;
  readonly outcome: PublicationOutcome;
}

export type PublicationResult = PublicationOutcome | {
  readonly kind: 'partial';
  readonly operationId: string;
  readonly items: NonEmpty<PublicationItem>;
};

export interface ProviderGuarantees {
  readonly pinnedReads: boolean;
  readonly conditionalPublication: boolean;
  readonly atomicMutationAndReceipt: boolean;
  readonly atomicBatch: boolean;
  readonly operationLookup: boolean;
  readonly revocationFencing: boolean;
}

export interface ResourceCapabilities {
  readonly supported: readonly ('read' | 'create' | 'replace' | 'delete' | 'lookup')[];
  readonly effective: readonly ('read' | 'create' | 'replace' | 'delete' | 'lookup')[];
  readonly availability: 'available' | 'unavailable' | 'unknown';
  readonly observedAt: string;
  readonly guarantees: ProviderGuarantees;
}

/** Independently injectable read, publication and reconciliation capabilities. */
export interface ResourceReader {
  readonly read: (request: ResourceRead, access: ResourceAccess) => Promise<ReadResult>;
}

export interface ResourcePublisher {
  readonly publish: (request: PublicationRequest, access: ResourceAccess) => Promise<PublicationResult>;
}

export type PublicationLookupResult = PublicationResult | { readonly kind: 'not-found' };

export interface PublicationLookup {
  /** Namespace includes the trusted caller/scope. Not-found means no retained
   * receipt, not proof that a timed-out operation had no effect. No blind retry.
   */
  readonly lookup: (operationId: string, access: ResourceAccess) => Promise<PublicationLookupResult>;
}

export interface ResourceProvider extends ResourceReader {
  readonly providerId: string;
  readonly capabilities: (target: ResourceLocator, access: ResourceAccess) => Promise<ResourceCapabilities>;
  readonly publication?: ResourcePublisher;
  readonly reconciliation?: PublicationLookup;
}
