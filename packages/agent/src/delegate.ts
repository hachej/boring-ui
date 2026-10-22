import { AssistantEntry, configure, defineTool } from '@earendil-works/pi-durable';
import type { AgentChange, ConversationId, Extension, ToolRegistration } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';

const GUARDS: WeakSet<object> = ((globalThis as Record<symbol, WeakSet<object>>)[Symbol.for('boring.agent.guards')] ??= new WeakSet()); // approval + sandbox extensions: a delegated child inherits them
const isGuard = (extension: object): boolean => GUARDS.has(extension);

export const DELEGATE_TOOL = 'delegate';

export interface DelegateOptions {
  /**
   * The child agent, usually a `defineAgent` result (its `id` and native `agent` change). The child conversation selects exactly its
   * extensions, model and instructions: its tools are the whole toolset. Its extensions must be installed in the registry.
   */
  readonly agent: { readonly id: string; readonly agent: AgentChange };
  /** Tool name; default `delegate`. Give each delegate of one agent its own name. */
  readonly name?: string;
  readonly description?: string;
}

/**
 * Pi's subagent pattern (pi-durable README "Abort and Subagents") as a tool factory: the child is a conversation owned by the
 * calling tool task (`ownership: { kind: 'task', taskId }`), so aborting the call aborts the child and the parent is idle only
 * once the child is. Replay-safe: a rerun of the same tool task (after a crash or eviction) finds its child through the native
 * ownership index and its submission through the request id, so it never starts a second child or a second turn. Returns only the
 * child's final text. The child inherits the parent's approval and sandbox extensions (appended after its own, in the parent's order, so a
 * sandbox stays last), so a delegate cannot escape the parent's gate; `details.conversationId` names the child for a UI that shows it.
 */
export function createDelegateTool(options: DelegateOptions): ToolRegistration {
  const name = options.name ?? DELEGATE_TOOL;
  // A task-owned conversation starts as a copy of its owner's agent; reset the inherited filters so the child's own extensions are
  // its whole toolset, then apply the child agent. `cwd` stays inherited unless the child agent sets one.
  const child: AgentChange = { tools: null, modelTools: null, instructions: null, thinkingLevel: null, ...options.agent.agent };
  return defineTool({
    name,
    description: options.description ?? `Delegate a self-contained task to the ${options.agent.id} agent and get its final answer back.`,
    parameters: Type.Object({ task: Type.String({ minLength: 1, description: 'The complete task; the agent sees nothing else of this conversation.' }) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (args, api, context) => {
      const inherited = (await api.agent(context)).extensions.filter(isGuard);
      const agent = withGuards(child, inherited);
      const childId: ConversationId = await api.commit(async tx => {
        const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
        if (existing !== undefined) return existing.id;
        const created = await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } });
        await configure(tx, created.id, agent);
        return created.id;
      }, context);
      await api.details({ conversationId: childId }, context);
      const conversation = await api.conversation(childId, context);
      if (conversation === undefined) throw new Error(`Delegate conversation ${childId} is missing`);
      const submission = await conversation.submit({ type: 'input', content: args.task, requestId: `${name}:${api.taskId}` }, context);
      const settled = await submission.wait(context);
      if (settled.status !== 'done' || settled.type !== 'input') throw new Error(`The ${options.agent.id} agent did not answer: ${settled.status}`);
      const answer = await api.commit(tx => tx.entry(AssistantEntry, settled.answer), context);
      const message = answer?.model?.find(part => part.role === 'assistant');
      const text = message?.role === 'assistant' ? message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n') : '';
      return { output: [{ type: 'text', text }], details: { conversationId: childId } };
    },
  });
}

/** `change` with the parent's guard extensions appended to its extension selection (an array or `add`; an unset selection already inherits the parent's). */
function withGuards(change: AgentChange, guards: readonly Extension[]): AgentChange {
  const { extensions } = change;
  if (!guards.length || extensions === undefined || extensions === null) return change;
  if (Array.isArray(extensions)) return { ...change, extensions: [...extensions, ...guards.filter(guard => !extensions.some(own => own.name === guard.name))] };
  const selection = extensions as { readonly add?: readonly Extension[]; readonly remove?: readonly Extension[] };
  const present = selection.add ?? [];
  return { ...change, extensions: { ...selection, add: [...present, ...guards.filter(guard => !present.some(own => own.name === guard.name))] } };
}
