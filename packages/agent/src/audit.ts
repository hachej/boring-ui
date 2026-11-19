// @hachej/boring-agent/audit: a record of what an agent's tools did, for the host's own audit store. The host owns the store (`sink`), who
// acted (`user`) and what may be kept (`redact`); this module only observes native tool calls through the `beforeTool` and `afterTool` hooks.
import { createHash } from 'node:crypto';
import { ToolTask, defineExtension, hook } from '@earendil-works/pi-durable';
import type { Extension, ToolExecutionResult } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord/json';

/** One finished tool call. `id` is stable for the call: a call replayed by recovery reports the same `id`, so the sink can drop it. */
export interface AuditRecord {
  readonly id: string;
  /** Milliseconds since the epoch. */
  readonly at: number;
  readonly user: string;
  readonly conversationId: number;
  readonly tool: string;
  readonly isError: boolean;
  /** Wall time of the call in milliseconds, from `beforeTool` to `afterTool`. Absent when this process did not see the start (a call replayed by recovery). */
  readonly durationMs?: number;
  /** Hex sha-256 of the canonical JSON (keys sorted) of the arguments the call ran with, taken before `redact`. Always present: it proves what ran without carrying a value. */
  readonly argumentsSha256: string;
  /** What the host's `resource` option named as touched by the call (a path, a file id). Absent without the option, when it returned no string, or when it threw. */
  readonly resourceId?: string;
  /** Why the call failed: the first 200 characters of its error text, through `redact(..., 'output')`. Only when `isError` and `redact` is set and did not throw. */
  readonly reason?: string;
  /** What `redact` kept of the call's arguments. Absent without `redact`, or when it threw. */
  readonly arguments?: JsonValue;
  /** What `redact` kept of the result's text. Absent without `redact`, or when it threw. */
  readonly output?: JsonValue;
  /** `redact` threw: the values were dropped, the call is still recorded. */
  readonly redactionFailed?: true;
}

export interface AuditExtensionOptions {
  /** The host's audit store. The tool's result waits for it; a sink that fails never fails the tool. */
  readonly sink: (record: AuditRecord) => void | Promise<void>;
  /** Who acts: a fixed id, or read per conversation for a harness shared by several people. */
  readonly user: string | ((conversationId: number) => string);
  /** Called once for the arguments and once for the output. Without it no value is recorded, only which tool ran and how it ended. */
  readonly redact?: (value: JsonValue, field: 'arguments' | 'output', tool: string) => JsonValue;
  /** The resource a call touched (a path, a file id), or `undefined`. Recorded as `resourceId`; a throw drops it and never fails the tool. */
  readonly resource?: (call: { readonly name: string; readonly arguments: JsonValue }) => string | undefined;
  /** The extension's native name. Default `boring.audit`. */
  readonly name?: string;
}

const outputText = (result: ToolExecutionResult): string => (result.output ?? []).map(part => part.type === 'text' ? part.text : '').join('');

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const sha256 = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

/** An opt-in native extension: select it in an agent's `extensions` or with `conversation.configure`. It brings no tools and changes no result. */
export function createAuditExtension(options: AuditExtensionOptions): Extension {
  const { sink, user, redact, resource } = options;
  // The hook API gives no start time, so the start is the time `beforeTool` ran for the call id in this process. A call that never passed
  // `beforeTool` here (replayed after a restart) has no start: its record carries no duration rather than a bogus one.
  const started = new Map<string, number>();
  return defineExtension({
    name: options.name ?? 'boring.audit',
    hooks: [hook(ToolTask, {
      beforeTool: call => { started.set(call.id, Date.now()); return undefined; },
      afterTool: async (call, result, api) => {
        const conversationId = Number(api.conversationId);
        const end = Date.now(), begin = started.get(call.id);
        started.delete(call.id);
        const argumentsSha256 = sha256(call.arguments);
        let resourceId: string | undefined;
        if (resource) {
          try { const found = resource({ name: call.name, arguments: call.arguments as JsonValue }); if (typeof found === 'string') resourceId = found; } catch { /* dropped: never fails the tool */ }
        }
        let values: Pick<AuditRecord, 'arguments' | 'output' | 'redactionFailed'> = {};
        let reason: string | undefined;
        if (redact) {
          try { values = { arguments: redact(call.arguments as JsonValue, 'arguments', call.name), output: redact(outputText(result), 'output', call.name) }; }
          catch { values = { redactionFailed: true }; }
          if (result.isError === true && !values.redactionFailed) {
            try { const kept = redact(outputText(result).slice(0, 200), 'output', call.name); if (typeof kept === 'string') reason = kept; } catch { /* dropped */ }
          }
        }
        try {
          await sink({
            id: `${conversationId}:${String(api.taskId)}:${call.id}`, at: end, user: typeof user === 'string' ? user : user(conversationId), conversationId, tool: call.name,
            isError: result.isError === true, argumentsSha256,
            ...(begin === undefined ? {} : { durationMs: Math.max(0, end - begin) }),
            ...(resourceId === undefined ? {} : { resourceId }),
            ...(reason === undefined ? {} : { reason }),
            ...values,
          });
        } catch (error) {
          console.error(JSON.stringify({ level: 'error', event: 'audit-sink-failed', tool: call.name, name: error instanceof Error ? error.name : 'Error' }));
        }
        return undefined;
      },
    })],
  });
}
