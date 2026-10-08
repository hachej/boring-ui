/** Headless presentation contracts; no Pi, files, agent or React imports.
 * Services are closed over by the host. An interface does not install code or
 * confer authority, and a feature preserves its concrete controller type.
 */
export interface ValueSchema<Value> {
  readonly jsonSchema: Readonly<Record<string, unknown>>;
  readonly parse: (value: unknown) => Value;
}

export interface ViewerDescriptor {
  readonly kind: string;
  readonly version: number;
  readonly title?: string;
}

export interface ViewerController<State, Actions, Tools = unknown> {
  /** Pure cached snapshot. Without a change, return the same value/object.
   * Do not mutate an already published snapshot or perform I/O while reading.
   */
  readonly getSnapshot: () => State;
  /** Synchronous subscription and unsubscription. Change notification occurs
   * after snapshot publication. This callback is not an async execution queue.
   */
  readonly subscribe: (listener: () => void) => () => void;
  readonly actions: Actions;
  readonly tools: Tools;
  /** Explicit owner teardown can be asynchronous. Await/handle its result.
   * Releasing this controller must not dispose a borrowed provider or task.
   * React unsubscription stays synchronous; owner teardown is a separate step.
   */
  readonly dispose: () => void | Promise<void>;
}

/** Preserve the whole concrete controller, including flush, custom methods,
 * server-rendering snapshots and other host extensions. Do not reconstruct a
 * base controller from State/Actions/Tools and silently erase its capabilities.
 */
export interface ViewerFeature<
  Descriptor extends ViewerDescriptor,
  Controller extends ViewerController<unknown, unknown, unknown>,
> {
  readonly kind: Descriptor['kind'];
  readonly version: Descriptor['version'];
  readonly descriptor: ValueSchema<Descriptor>;
  readonly createController: (descriptor: Descriptor) => Controller;
}

export type ViewerRenderer<Controller, Rendered> = (controller: Controller) => Rendered;

export interface ViewerTarget<Subject = unknown> {
  readonly instanceId: string;
  readonly epoch: string;
  readonly subject: Subject;
}

export type PresentationResult<Output, Subject = unknown> =
  | { readonly kind: 'applied'; readonly value: Output }
  | { readonly kind: 'proposed'; readonly proposalId: string; readonly base: ViewerTarget<Subject> }
  | { readonly kind: 'stale' | 'conflict' | 'denied' | 'unavailable'; readonly reason: string }
  | { readonly kind: 'unknown'; readonly reason: string };

/** Function properties retain strict input/target variance. Native tool
 * adapters bind this metadata through Pi; this is not another tool engine.
 */
export interface PresentationCommand<Input, Output, Subject = unknown> {
  readonly name: string;
  readonly input: ValueSchema<Input>;
  readonly invoke: (target: ViewerTarget<Subject>, input: Input, signal?: AbortSignal) => Promise<PresentationResult<Output, Subject>>;
}

/** Anchors: data a feature keeps to point into a viewer's subject (FEEDBACK.md).
 * `kind` is `<viewer>.<type>@<version>`; `fallback` is a human-readable
 * description that never needs the viewer. Type-only: a viewer implements the
 * two halves below without importing any feature that stores anchors.
 */
export interface Anchor {
  readonly kind: `${string}.${string}@${number}`;
  readonly fallback: string;
}

/** Where an anchor lands in one explicit snapshot. `evaluated` names that
 * snapshot. Only `exact` and `moved` are unique matches; `ambiguous` needs a
 * person's choice even with one candidate.
 */
export type Placement<Range> =
  | { readonly kind: 'exact' | 'moved'; readonly range: Range; readonly evaluated: string }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly Range[]; readonly evaluated: string }
  | { readonly kind: 'partial'; readonly range: Range; readonly missing: readonly string[]; readonly evaluated: string }
  | { readonly kind: 'missing' | 'unsupported'; readonly evaluated: string };

/** Pure half: no DOM, no I/O, a function of the anchor and one snapshot. */
export interface AnchorResolution<A extends Anchor, Snapshot, Range> {
  readonly kind: A['kind'];
  readonly schema: ValueSchema<A>;
  readonly resolve: (anchor: A, snapshot: Snapshot, evaluated: string) => Placement<Range>;
  readonly fallback: (anchor: A) => string;
}

/** Mounted half: browser only, bound to a live viewer. */
export interface AnchorCapture<A extends Anchor, Selection, Subject = unknown> {
  readonly anchorOf: (selection: Selection) => { readonly kind: 'captured'; readonly anchor: A } | { readonly kind: 'refused'; readonly reason: string };
  readonly reveal: PresentationCommand<{ readonly anchor: A; readonly range: unknown }, void, Subject>;
}

/** Declared beside a viewer feature; no registry and no required member. */
export interface ViewerAnchors<A extends Anchor, Snapshot, Range, Selection, Subject = unknown> {
  readonly resolution: AnchorResolution<A, Snapshot, Range>;
  readonly capture?: AnchorCapture<A, Selection, Subject>;
}
