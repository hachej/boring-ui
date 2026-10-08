import { defineExtension } from '@earendil-works/pi-durable';
import type { ConversationId, Extension, ToolExecutionResult, ToolRegistration, Wrap } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord';
import type { Static, TSchema } from '@earendil-works/pi-ai';
import { askPerson } from './ask-user.js';

/** The two answers an approval question accepts. A chat answers with exactly these strings through `answerUserQuestion`. */
export const APPROVE = 'Approve';
export const DENY = 'Deny';
/** A denied call's result text starts with this, so a viewer can tell a denial from a failure. */
export const DENIED_PREFIX = 'Denied by the person.';
/** A call whose question was cancelled (the run was stopped) before the person answered: it did not run. */
export const CANCELLED_PREFIX = 'Not run: the approval question was cancelled.';

/**
 * Key under a gated call's running details (then, unless the tool returns its own `details`, its result details) that holds
 * `{ summary, decision? }`: the one-line text `summarize` returned and, once made, `approved`, `denied` or `cancelled`. A chat view carries it, so an approval card can show the summary
 * without reading the question document. The card in `registry/pi-chat` repeats this key (a contract test keeps them equal).
 */
export const APPROVAL_DETAILS = 'boring.approval';

const MEMO = 'boring.approval.started';
const GATED = new WeakSet<object>();

/** The call a rule is asked about: which conversation it runs in (a host can name the site or project it maps to) and its ID. */
export interface ApprovalCall { readonly conversationId: ConversationId; readonly callId: string; readonly toolName: string }

export interface RequireApprovalOptions<TParameters extends TSchema = TSchema> {
  /** One line about what the call would change, from its arguments. It is stored with the question; the model never writes it. */
  readonly summarize: (args: Static<TParameters>, call: ApprovalCall) => string;
  /** Ask only when this returns true (for example any HTTP method but GET); other calls run at once. Default: always ask. */
  readonly when?: (args: Static<TParameters>, call: ApprovalCall) => boolean;
}

const text = (value: string, isError: boolean) => ({ isError, content: [{ type: 'text' as const, text: value }] });

/**
 * Wrap a native tool so the person must approve each call before it executes. The tool keeps its name, schema and
 * description. Before `execute`, the call asks "Approve / Deny" through the ask-user mechanism (a conversation document
 * keyed by the tool call ID, answered with `answerUserQuestion` over the chat transport's `answer` operation, shown by
 * pi-chat's approval card). The check runs in host code inside the tool's own execution, so the model cannot skip it.
 *
 * - While it waits, the summary is published as running details under `APPROVAL_DETAILS` for the card.
 * - Deny returns an error result starting `DENIED_PREFIX` and `execute` never runs. A question cancelled while the call
 *   itself keeps running returns one starting `CANCELLED_PREFIX`; when the call is being stopped, Pi records the stop.
 * - A pending approval survives a restart: the wrapper is replay-safe, and replay re-attaches to the stored question.
 * - Execution happens at most once per call. The wrapper retains a native memo before running the inner tool; if the
 *   process dies after that and the inner tool is not itself `replay: 'safe'`, recovery returns an error saying the
 *   outcome is unknown instead of repeating a change that may have happened.
 *
 * Code mode: gated tools are native tools. Do not expose them to a code-mode sandbox (its nested calls cannot reach a
 * person), and filter with `isApprovalGated`. Give `run_code` the read tools only; changes go through the gated native tool.
 */
export function requireApproval<TParameters extends TSchema, TDetails extends JsonValue>(
  tool: ToolRegistration<TParameters, TDetails>, options: RequireApprovalOptions<TParameters>): ToolRegistration<TParameters, JsonValue> {
  if (GATED.has(tool)) return tool as ToolRegistration<TParameters, JsonValue>; // already gated: never ask twice
  // The gated tool's details are the inner tool's, with the approval record merged in under APPROVAL_DETAILS, so a view keeps the
  // summary and decision even when the inner tool publishes details of its own (non-object details are kept as they are).
  const gated: ToolRegistration<TParameters, JsonValue> = {
    ...(tool as unknown as ToolRegistration<TParameters, JsonValue>),
    replay: 'safe',
    execute: async (args, outerApi, context): Promise<ToolExecutionResult<JsonValue>> => {
      let record: { summary: string; decision?: 'approved' | 'denied' | 'cancelled' } | undefined;
      const withRecord = (value: JsonValue | undefined): JsonValue | undefined => !record ? value
        : value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value)) ? { ...(value ?? {}), [APPROVAL_DETAILS]: record } : value;
      const publish = (next: typeof record) => { record = next; return outerApi.details(withRecord(undefined)!, context); };
      const api = { ...outerApi, details: (value: TDetails, inner: typeof context) => outerApi.details(withRecord(value)!, inner) } as unknown as Parameters<typeof tool.execute>[1];
      // The wrapper is replay-safe so a pending question survives a restart; an inner tool that is not keeps its
      // at-most-once guarantee through a native memo, whether or not this call asked the person.
      const run = async (): Promise<ToolExecutionResult<JsonValue>> => {
        if (tool.replay !== 'safe') {
          if (await outerApi.memo(MEMO, context) !== undefined) return text(`${tool.name} started, but the process stopped while it ran. Whether the change was applied is unknown; check before retrying.`, true);
          await outerApi.memo(MEMO, true, context);
        }
        const result = await tool.execute(args, api, context) as ToolExecutionResult<JsonValue>;
        return result.details === undefined ? result : { ...result, details: withRecord(result.details)! };
      };
      let ask = true;
      const call: ApprovalCall = { conversationId: outerApi.conversationId, callId: outerApi.callId, toolName: tool.name };
      try { ask = options.when ? options.when(args, call) : true; } catch { ask = true; } // a broken rule asks rather than skipping the person
      if (!ask) return run();
      let summary: string;
      try { summary = options.summarize(args, call); } catch { summary = JSON.stringify(args); }
      summary = summary.slice(0, 500);
      await publish({ summary });
      const prompt = `Allow ${tool.name}? ${summary}`.slice(0, 1000);
      // The decision joins the summary in the call's details, so a view tells approved, denied and never-answered apart.
      const decided = (decision: 'approved' | 'denied' | 'cancelled') => publish({ summary, decision });
      let answer: string;
      try { answer = await askPerson(outerApi, context, { prompt, options: [APPROVE, DENY] }); }
      catch (error) {
        if (context.abortSignal?.aborted) throw error; // the call itself is being stopped: Pi records that, and no decision was made
        await decided('cancelled');
        return text(`${CANCELLED_PREFIX} ${tool.name} was not run and nothing was changed.`, true);
      }
      if (answer !== APPROVE) { await decided('denied'); return text(`${DENIED_PREFIX} ${tool.name} was not run and nothing was changed.`, true); }
      await decided('approved');
      return run();
    },
  };
  GATED.add(gated);
  return gated;
}

/** Whether `tool` came from `requireApproval`. Use it to keep gated tools out of a code-mode sandbox's tool list. */
export function isApprovalGated(tool: object): boolean { return GATED.has(tool); }

/** How one tool is gated by `createApprovalExtension`: `true` uses a default summary and always asks. */
export type ApprovalRule = true | {
  readonly summarize?: (args: Record<string, unknown>, call: ApprovalCall) => string;
  readonly when?: (args: Record<string, unknown>, call: ApprovalCall) => boolean;
};

export interface ApprovalExtensionOptions {
  /** Native extension name. Default `boring.approval`; use another name to compose several rule sets. */
  readonly name?: string;
  /** Tool names to gate, with their rule. Any native tool works, including Pi's stock `bash`, `write` and `edit`. */
  readonly tools: Readonly<Record<string, ApprovalRule>>;
}

const defaultSummary = (name: string) => (args: Record<string, unknown>): string => `${name} ${JSON.stringify(args)}`.slice(0, 300);

/**
 * The approval gate as an opt-in native extension. It brings no tools: it wraps the named tools (native `wraps`, Pi's own
 * decorator by tool name) with `requireApproval`, so whatever tool of that name wins in a conversation waits for the
 * person there. Pi applies wraps only in conversations that select the extension, so it is opt-in per conversation:
 * `conversation.configure({ extensions: { add: [approvals] } })` turns it on and `remove` turns it off from the next call.
 * Several approval extensions (different `name`s) compose; a tool already gated is never asked twice.
 *
 * It gates native tool calls only. A code-mode sandbox or any host code that offers the same capability another way is
 * not covered: keep such capabilities out of the sandbox (see `isApprovalGated`).
 */
export function createApprovalExtension(options: ApprovalExtensionOptions): Extension {
  const wraps: Wrap[] = Object.entries(options.tools).map(([name, rule]) => ({
    tool: name,
    wrap: (tool: ToolRegistration) => requireApproval(tool, {
      summarize: (rule !== true && rule.summarize) || defaultSummary(name),
      ...(rule !== true && rule.when ? { when: rule.when } : {}),
    } as RequireApprovalOptions),
  }));
  return defineExtension({ name: options.name ?? 'boring.approval', wraps });
}
