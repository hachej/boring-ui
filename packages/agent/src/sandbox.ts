import { defineExtension, hook, ToolTask } from '@earendil-works/pi-durable';
import type { Extension, ToolRegistration, Wrap } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord';

/** Key under a recorded call's result details: `{ simulated: true, tool, arguments }`. A caller reads it back with `simulatedCalls`. */
export const SANDBOX_DETAILS = 'boring.sandbox';

/** What the host declares about one tool. An unset field is not declared: a call is recorded unless the host declares it safe. */
export interface SandboxFlags {
  readonly mutates?: boolean;
  readonly writes?: boolean;
  readonly sandboxSafe?: boolean;
}

export interface SandboxOptions {
  /** Native extension name. Default `boring.sandbox`. */
  readonly name?: string;
  /** Every tool this sandbox covers. A call to any other name is blocked, including a tool added to the run later. */
  readonly tools: readonly string[];
  /** Host flags per tool name (for example the app's tools.json). */
  readonly flags?: Readonly<Record<string, SandboxFlags>>;
  /** The text the model receives for a recorded call. Default: `defaultAck`. */
  readonly simulate?: (toolName: string, args: JsonValue) => string;
}

/** The acknowledgement a recorded call returns when the host does not supply its own. */
export const defaultAck = (toolName: string): string => `Simulated: ${toolName} was recorded and not run. Nothing was changed.`;

/** `run` only when the host declares the tool safe (`sandboxSafe`, or `mutates: false` / `writes: false`). Any mutating flag records. */
export function sandboxDecision(flags: SandboxFlags | undefined): 'run' | 'record' {
  if (flags?.mutates === true || flags?.writes === true) return 'record';
  return flags?.sandboxSafe === true || flags?.mutates === false || flags?.writes === false ? 'run' : 'record';
}

/** One call the sandbox recorded instead of running. */
export interface SimulatedCall { readonly toolCallId: string; readonly toolName: string; readonly arguments: JsonValue }

/** The recorded calls among a conversation's tool results, in order (the results' `details` carry the record). */
export function simulatedCalls(results: readonly { readonly toolCallId: string; readonly toolName: string; readonly details?: unknown }[]): SimulatedCall[] {
  return results.flatMap(result => {
    const record = (result.details as Record<string, Record<string, JsonValue>> | undefined)?.[SANDBOX_DETAILS];
    return record?.simulated === true ? [{ toolCallId: result.toolCallId, toolName: result.toolName, arguments: record.arguments ?? null }] : [];
  });
}

/** A tool that never runs: it returns the acknowledgement and records the call in its result details. Replay-safe, as nothing executes. */
const recorded = (tool: ToolRegistration, simulate: (toolName: string, args: JsonValue) => string): ToolRegistration => ({
  ...tool,
  replay: 'safe',
  execute: async (args: unknown) => ({
    content: [{ type: 'text', text: simulate(tool.name, args as JsonValue) }],
    details: { [SANDBOX_DETAILS]: { simulated: true, tool: tool.name, arguments: args as JsonValue } },
  }),
}) as ToolRegistration;

/**
 * A native extension that makes the named tools fail closed in a sandbox. Its wraps replace each tool the host flags as
 * mutating (or does not declare safe) with a recorder, so the call is never executed and the model gets an acknowledgement.
 * Its `beforeTool` hook blocks every call whose name is not in `tools`, so a tool added mid-run (or another extension's)
 * cannot run unnamed. It brings no tools and changes nothing unless a conversation selects it:
 * `conversation.configure({ extensions: { add: [sandbox] } })`. Install it after an approval gate in the same conversation,
 * so the sandbox wraps outermost and no person is asked inside a sandbox.
 */
export function createSandboxExtension(options: SandboxOptions): Extension {
  const covered = new Set(options.tools);
  const simulate = options.simulate ?? ((toolName: string) => defaultAck(toolName));
  const wraps: Wrap[] = options.tools
    .filter(name => sandboxDecision(options.flags?.[name]) === 'record')
    .map(name => ({ tool: name, wrap: (tool: ToolRegistration) => recorded(tool, simulate) }));
  return defineExtension({
    name: options.name ?? 'boring.sandbox',
    wraps,
    hooks: [hook(ToolTask, {
      beforeTool: call => covered.has(call.name) ? undefined : { block: `Not run: ${call.name} is not covered by the sandbox.` },
    })],
  });
}
