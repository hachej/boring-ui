// @hachej/boring-agent/audit: a record of what an agent's tools did, for the host's own audit store. The host owns the store (`sink`), who
// acted (`user`) and what may be kept (`redact`); this module only observes native tool calls through the `afterTool` hook.
import { ToolTask, defineExtension, hook } from '@earendil-works/pi-durable';
import type { Extension, ToolExecutionResult } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord';

/** One finished tool call. `id` is stable for the call: a call replayed by recovery reports the same `id`, so the sink can drop it. */
export interface AuditRecord {
  readonly id: string;
  /** Milliseconds since the epoch. */
  readonly at: number;
  readonly user: string;
  readonly conversationId: number;
  readonly tool: string;
  readonly isError: boolean;
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
  /** The extension's native name. Default `boring.audit`. */
  readonly name?: string;
}

const outputText = (result: ToolExecutionResult): string => (result.output ?? []).map(part => part.type === 'text' ? part.text : '').join('');

/** An opt-in native extension: select it in an agent's `extensions` or with `conversation.configure`. It brings no tools and changes no result. */
export function createAuditExtension(options: AuditExtensionOptions): Extension {
  const { sink, user, redact } = options;
  return defineExtension({
    name: options.name ?? 'boring.audit',
    hooks: [hook(ToolTask, {
      afterTool: async (call, result, api) => {
        const conversationId = Number(api.conversationId);
        let values: Pick<AuditRecord, 'arguments' | 'output' | 'redactionFailed'> = {};
        if (redact) {
          try { values = { arguments: redact(call.arguments as JsonValue, 'arguments', call.name), output: redact(outputText(result), 'output', call.name) }; }
          catch { values = { redactionFailed: true }; }
        }
        try {
          await sink({ id: `${conversationId}:${String(api.taskId)}:${call.id}`, at: Date.now(), user: typeof user === 'string' ? user : user(conversationId), conversationId, tool: call.name, isError: result.isError === true, ...values });
        } catch (error) {
          console.error(JSON.stringify({ level: 'error', event: 'audit-sink-failed', tool: call.name, name: error instanceof Error ? error.name : 'Error' }));
        }
        return undefined;
      },
    })],
  });
}
