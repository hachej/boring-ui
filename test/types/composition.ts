import type { PresentationCommand, ViewerDescriptor, ViewerFeature, ViewerController, ViewerRenderer, ValueSchema, ViewerTarget } from '@hachej/boring-ui-kit';
import type { WorkspaceProvider, RecoverableWorkspaceProvider, ExecutionEnv } from '@hachej/boring-execution';
import type { ResourcePublisher, PublicationLookup, ResourceClient, PublicationRequest, ResourceChange, ResourceAccess, ResourceRef } from '@hachej/boring-files';
import type { AttachmentInput, BorrowedAttachment } from '@hachej/boring-agent';
import type { Harness, Registry } from '@hachej/boring-agent/native';

interface InlineDescriptor extends ViewerDescriptor {
  readonly kind: 'counter'; readonly version: 1; readonly initial: number;
}
interface Actions { readonly increment: () => void; }
declare const schema: ValueSchema<InlineDescriptor>;
declare const create: (descriptor: InlineDescriptor) => ViewerController<number, Actions, {}>;

/** Headless + inline: no renderer, fake file, resource client or native agent. */
export const inlineFeature: ViewerFeature<InlineDescriptor, ViewerController<number, Actions, {}>> = {
  kind: 'counter', version: 1, descriptor: schema, createController: create,
};
export const plainRenderer: ViewerRenderer<ReturnType<typeof create>, string> = controller => String(controller.getSnapshot());

// @ts-expect-error A specialized feature cannot safely consume every descriptor.
const incorrectlyWidenedFeature: ViewerFeature<ViewerDescriptor, ViewerController<number, Actions, {}>> = inlineFeature;
void incorrectlyWidenedFeature;

interface Subject { readonly recordId: string; }
declare const textCommand: PresentationCommand<{ readonly text: string }, void, Subject>;
// @ts-expect-error Method bivariance must not admit an incompatible command input.
const tooBroad: PresentationCommand<unknown, void, Subject> = textCommand;
void tooBroad;
// @ts-expect-error Target types cannot be silently widened either.
const wrongTarget: PresentationCommand<{ readonly text: string }, void, unknown> = textCommand;
void wrongTarget;
export const recordTarget: ViewerTarget<Subject> = { instanceId: 'panel', epoch: 'mount-1', subject: { recordId: 'r1' } };

interface GitInput { readonly repository: string; readonly commit: string; readonly vendorCpu: number; }
declare const acquire: WorkspaceProvider<GitInput, ExecutionEnv>['acquire'];
/** Git/vendor input and an ephemeral provider require no ResourceRef/reattach. */
export const ephemeral: WorkspaceProvider<GitInput, ExecutionEnv> = { providerId: 'sandbox', acquire };
// @ts-expect-error Durable recovery cannot be inferred from acquire alone.
const cannotRecover: RecoverableWorkspaceProvider<GitInput, ExecutionEnv> = ephemeral;
void cannotRecover;
// @ts-expect-error Narrow acquisition inputs cannot advertise arbitrary inputs.
const wrongInput: WorkspaceProvider<unknown, ExecutionEnv> = ephemeral;
void wrongInput;

declare const publish: ResourcePublisher['publish'];
export const writer: ResourcePublisher = { publish };
// @ts-expect-error A writer without reconciliation cannot claim lookup.
const cannotReconcile: ResourcePublisher & PublicationLookup = writer;
void cannotReconcile;

declare const change: ResourceChange;
export const oneWrite: PublicationRequest = { operationId: 'request-1', changes: [change], atomicity: 'all-or-nothing' };
// @ts-expect-error The caller does not choose its trusted canonical digest.
const forgedDigest: PublicationRequest = { ...oneWrite, argumentDigest: 'not-the-body' };
void forgedDigest;
// @ts-expect-error Approval authority is not accepted in a publication payload.
const forgedGrant: PublicationRequest = { ...oneWrite, authorizationRef: 'admin' };
void forgedGrant;
// @ts-expect-error Multi-change failure semantics cannot be left implicit.
const missingAtomicity: PublicationRequest = { operationId: 'request-2', changes: [change] };
void missingAtomicity;

declare const client: ResourceClient;
declare const trusted: ResourceAccess;
// @ts-expect-error Browser client does not accept server authentication context.
void client.publish?.(oneWrite, trusted);

export interface HostHarness extends Harness { readonly hostMarker: 'preserved'; }
declare const harness: HostHarness;
export const passive: AttachmentInput<HostHarness> = { harness };
declare const registry: Registry;
// @ts-expect-error Passive attachment cannot pair an unrelated writable registry.
const mismatched: AttachmentInput = { harness, registry };
void mismatched;
declare const attachment: BorrowedAttachment<HostHarness>;
export const preserved: 'preserved' = attachment.harness.hostMarker;

/** Host-only provenance can accompany actual provider calls, not UI intent. */
export const authorized: ResourceAccess = { principalId: 'person', scopeId: 'app', initiatorId: 'person', authorizationRef: 'verified-by-host' };

declare const ref: ResourceRef;
export const dependency: PublicationRequest = { ...oneWrite, preconditions: [{ kind: 'revision', target: ref }] };
