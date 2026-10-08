import type { FileSystem, Shell, ExecutionEnv, ShellExecOptions, EnvironmentFactory } from '@hachej/boring-execution';
import type { FileSystem as PiFileSystem, Shell as PiShell, ExecutionEnv as PiEnvironment, ShellExecOptions as PiExecOptions } from '@earendil-works/pi-durable/env';
import type { Harness, ConversationView, ToolRegistration, ToolExecutionApi, ToolExecutionResult } from '@hachej/boring-agent/native';
import type { Harness as PiHarness, HarnessOptions, ConversationView as PiView, ConversationWatch, ToolRegistration as PiTool, ToolExecutionApi as PiToolApi, ToolExecutionResult as PiToolResult } from '@earendil-works/pi-durable';
import type { CodingWorkspaceLease, WorkspaceLease } from '@hachej/boring-execution';
import type { ResourceChange, ResourceProvider, PublicationRequest, PublicationResult, CommittedChange } from '@hachej/boring-files';
import type { PresentationResult } from '@hachej/boring-ui-kit';
import type { ChatSource } from '@hachej/boring-ui-kit/pi';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type NativeParity = [
  Assert<Equal<FileSystem, PiFileSystem>>, Assert<Equal<Shell, PiShell>>,
  Assert<Equal<ExecutionEnv, PiEnvironment>>, Assert<Equal<ShellExecOptions, PiExecOptions>>,
  Assert<Equal<Harness, PiHarness>>, Assert<Equal<ConversationView, PiView>>,
  Assert<Equal<EnvironmentFactory, NonNullable<HarnessOptions['env']>>>,
  Assert<Equal<ToolRegistration, PiTool>>, Assert<Equal<ToolExecutionApi, PiToolApi>>,
  Assert<Equal<ToolExecutionResult, PiToolResult>>,
  Assert<Equal<Awaited<ReturnType<ChatSource['open']>>, ConversationWatch>>,
];

export function fileOnlyDoesNotImplyCoding(lease: WorkspaceLease): void {
  // @ts-expect-error File-only acquisition must not imply native execution.
  const coding: CodingWorkspaceLease = lease;
  void coding;
}

export function resourceHasNoExecution(provider: ResourceProvider): void {
  // @ts-expect-error Resources are not native execution environments.
  provider.exec('pwd');
}

// @ts-expect-error Replacing an existing resource requires its observed revision.
const blindReplace: ResourceChange = { kind: 'replace', target: { resource: { providerId: 'docs', path: '/note' }, view: { kind: 'published' } }, bytes: new Uint8Array(), mediaType: 'text/plain' };
void blindReplace;

// @ts-expect-error A presentation acknowledgement cannot assert a backend commit.
const falseCommit: PresentationResult<void> = { kind: 'committed' };
void falseCommit;

// @ts-expect-error Empty publication cannot pretend to commit a meaningful change.
const empty: PublicationRequest = { operationId: 'x', atomicity: 'all-or-nothing', changes: [] };
void empty;

// @ts-expect-error A committed change cannot have no before and no after value.
const impossible: CommittedChange = { kind: 'replace', before: null, after: null };
void impossible;

export async function nativeChat(source: ChatSource): Promise<PiView> {
  const watch = await source.open();
  const initial = watch.value;
  const terminal = watch.closed;
  await watch.stop();
  await terminal;
  return initial;
}

export function requireActualCommit(result: PublicationResult): string | undefined {
  return result.kind === 'committed' ? result.receipt.evidenceRef : undefined;
}
