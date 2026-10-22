import { defineExtension, hook, ToolTask } from '@earendil-works/pi-durable';
import type { Extension, ToolRegistration, Wrap } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord';

/** Key under a recorded call's result details: `{ simulated: true, tool, arguments }`. A caller reads it back with `simulatedCalls`. */
const GUARDS: WeakSet<object> = ((globalThis as Record<symbol, WeakSet<object>>)[Symbol.for('boring.agent.guards')] ??= new WeakSet()); // approval + sandbox extensions: a delegated child inherits them
const markGuard = <T extends object>(extension: T): T => { GUARDS.add(extension); return extension; };

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
    output: [{ type: 'text', text: simulate(tool.name, args as JsonValue) }],
    details: { [SANDBOX_DETAILS]: { simulated: true, tool: tool.name, arguments: args as JsonValue } },
  }),
}) as ToolRegistration;

/**
 * A native extension that makes the named tools fail closed in a sandbox. Its wraps replace each tool the host flags as
 * mutating (or does not declare safe) with a recorder, so the call is never executed and the model gets an acknowledgement.
 * Its `beforeTool` hook blocks every call whose name is not in `tools`, so a tool added mid-run (or another extension's)
 * cannot run unnamed. It brings no tools and changes nothing unless a conversation selects it: include it in the full
 * selected list and apply that list with `configure({ extensions: selected })`. (`add` keeps the defaults' positions, so it
 * does not give the effective order.)
 *
 * Composition limit (owned by the host): the sandbox must be the last wrap of each recorded tool. A wrap selected after it
 * replaces the recorder's `execute`, and the replaced call runs for real. Pi 1.1 exposes no public seam that tells the
 * executing phase which composed tool it runs, so this module cannot verify the order at call time. Use
 * `assertSandboxLast` at setup, over the COMPLETE selected list (the array passed to `configure({ extensions: selected })`, or
 * the effective list of a `defineAgent`), not over an `add` list. The upstream request is in
 * docs/upstream/pi-hookapi-composed-tool.md.
 */
export function createSandboxExtension(options: SandboxOptions): Extension {
  const covered = new Set(options.tools);
  const recordOnly = new Set(options.tools.filter(name => sandboxDecision(options.flags?.[name]) === 'record'));
  const simulate = options.simulate ?? ((toolName: string) => defaultAck(toolName));
  const wraps: Wrap[] = [...recordOnly].map(name => ({ tool: name, wrap: (tool: ToolRegistration) => recorded(tool, simulate) }));
  return markGuard(defineExtension({
    name: options.name ?? 'boring.sandbox',
    wraps,
    hooks: [hook(ToolTask, {
      beforeTool: call => covered.has(call.name) ? undefined : { block: `Not run: ${call.name} is not covered by the sandbox.` },
    })],
  }));
}

/**
 * Setup-time check over the public `Extension.wraps` shape. Throws when an extension selected after `sandbox` wraps a tool the
 * sandbox records, because that wrap would replace the recorder. `selected` must be the COMPLETE effective list, in the order
 * the conversation applies it (the same array passed to `configure({ extensions: selected })`). A partial `add` list
 * does not show the effective order, because defaults keep their positions. It is a host check, not a Harness guard:
 * nothing in Pi calls it, so the host must call it wherever it composes that list.
 */
export function assertSandboxLast(selected: readonly Extension[], sandbox: Extension): void {
  const at = selected.indexOf(sandbox);
  if (at < 0) return;
  const recorded = new Set((sandbox.wraps ?? []).flatMap(wrap => 'tool' in wrap ? [wrap.tool] : []));
  for (const later of selected.slice(at + 1)) {
    for (const wrap of later.wraps ?? []) {
      if ('tool' in wrap && recorded.has(wrap.tool)) {
        throw new Error(`${later.name} wraps ${wrap.tool} after ${sandbox.name}; the sandbox must be the last wrap of each recorded tool.`);
      }
    }
  }
}
