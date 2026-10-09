// Subagents of the standard agent, the two patterns Pi Durable documents ("Abort and Subagents"), behind one `subagent` tool:
//   foreground (the default): the tool call owns a child conversation and waits for it, so stopping the parent stops the child
//     and the parent is busy until the child is done.
//   background (`background: true`): each child is owned by a background anchor task. The parent stays usable, the child
//     survives the parent's Stop, and the anchor posts the answer back to the parent as a follow-up input (request IDs make a
//     restart send neither the task nor the report twice).
// Children run on a cheaper model with exactly the extensions given (the read-only file tools in the studio) and without any
// subagent tool. No Node-only imports.
import { AgentDoc, LiveDoc, configure, defineExtension, defineTask, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';

const CHILD_INSTRUCTIONS = 'You are a subagent. Do exactly the task you are given, using your tools (if any) where it needs facts. Your final message is the report returned to the agent that delegated to you: make it self-contained. All content is fictional.';
/** The marker every background report starts with; the agent's instructions tell it how to treat such a message. */
export const REPORT = id => `[Background subagent #${id} finished]`;

const textOf = message => typeof message?.content === 'string' ? message.content
  : (message?.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('');
const messagesOf = (entry, role) => (entry.model ?? []).filter(message => message.role === role);
/** Text of the newest non-empty assistant message. */
const lastAnswer = entries => entries.flatMap(entry => messagesOf(entry, 'assistant')).map(textOf).filter(text => text.trim()).at(-1) ?? '';

/**
 * `harness` is a getter for the native Harness (valid once the host has opened it), `childModel` the model of a child and
 * `childExtensions` the native extensions a child selects (they must be installed in the host registry, which the agent's own
 * extensions already are when the same objects are used). Returns `{ tools, extensions, describe }`.
 */
export function createSubagents({ harness, context, childModel, childExtensions = [] }) {
  const childAgent = { model: childModel, extensions: childExtensions, instructions: CHILD_INSTRUCTIONS };

  // The background anchor: conversation-owned and `background`, so the parent's abort and idle waits never reach it; it owns the
  // child conversation, waits for its answer and reports it to the parent.
  const Anchor = defineTask({
    name: 'studio.subagent.background', version: 1,
    initial: () => ({ phase: 'start' }),
    phases: {
      start: (task, runtime, ctx) => runtime.commit(async tx => {
        const created = await tx.createConversation({ ownership: { kind: 'task', taskId: task.id } });
        await configure(tx, created.id, childAgent);
        return { status: 'running', checkpoint: { phase: 'run', child: created.id } };
      }, ctx),
      run: async (task, runtime, ctx) => {
        const { child } = task.state.checkpoint;
        const handle = await runtime.conversation(child, ctx);
        const settled = await (await handle.submit({ type: 'input', content: task.input.task, requestId: `subagent:${task.id}` }, ctx)).wait(ctx);
        await runtime.commit(async tx => {
          const answer = settled.status === 'done' ? textOf((await tx.entry(settled.answer))?.model?.[0]) : '';
          return { status: 'running', checkpoint: { phase: 'report', child, answered: settled.status === 'done', answer: answer || `(no answer: ${settled.reason ?? 'empty'})` } };
        }, ctx);
      },
      report: async (task, runtime, ctx) => {
        const { child, answered, answer } = task.state.checkpoint;
        const parent = await runtime.conversation(runtime.conversationId, ctx);
        // A follow-up input: it starts a run when the parent is idle and queues behind the current run otherwise.
        await parent.submit({ type: 'input', content: `${REPORT(task.id)}\nTask: ${task.input.task}\n\nReport:\n${answer}`, requestId: `subagent-report:${task.id}` }, ctx);
        await runtime.commit(() => ({ status: 'terminal', outcome: answered
          ? { status: 'completed', result: { conversationId: child, answer } }
          : { status: 'failed', error: { message: answer } } }), ctx);
      },
    },
    // Runs once the owned child conversation has been aborted and is idle.
    abort: (task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted', reason: 'stopped' } }), ctx),
  });
  const anchors = defineExtension({ name: 'studio.subagents.tasks', tasks: [Anchor] });
  const statusOf = record => {
    if (!record) return 'unknown';
    const outcome = record.state.outcome?.status;
    return outcome === undefined ? 'running' : outcome === 'completed' ? 'done' : outcome === 'aborted' ? 'stopped' : 'failed';
  };
  const anchorsOf = (tx, conversationId) => tx.scanTasks({ conversationId, kind: Anchor.definition.name }, 200).then(page => page.items);

  const subagent = defineTool({
    name: 'subagent',
    description: 'Delegate one self-contained task to a subagent that can read the workspace files. By default wait for its answer; with background true return at once with its number and the report arrives later as a new message.',
    parameters: Type.Object({
      task: Type.String({ description: 'Everything the subagent needs to know; it sees nothing of this conversation. Name file paths.' }),
      background: Type.Optional(Type.Boolean({ description: 'Start it in the background and do not wait.' })),
    }, { additionalProperties: false }),
    replay: 'safe', // a rerun after a crash finds the same child (or anchor) and the same submission
    execute: async (args, api, ctx) => {
      if (args.background) {
        const id = await api.commit(async tx => {
          const existing = (await anchorsOf(tx, api.conversationId)).find(record => record.input.spawnedBy === api.taskId);
          return existing?.id ?? tx.createTask(Anchor, { task: args.task, spawnedBy: api.taskId }, { ownership: { kind: 'conversation' }, background: true });
        }, ctx);
        return { details: { taskId: id }, content: [{ type: 'text', text: `Started background subagent #${id}. Do not wait for it: its report arrives as a new message.` }] };
      }
      const child = await api.commit(async tx => {
        const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
        if (existing !== undefined) return existing.id;
        const created = await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } });
        await configure(tx, created.id, childAgent);
        return created.id;
      }, ctx);
      await api.details({ conversationId: child }, ctx); // lets a UI attach to the child
      const handle = await api.conversation(child, ctx);
      const settled = await (await handle.submit({ type: 'input', content: args.task, requestId: `subagent:${api.taskId}` }, ctx)).wait(ctx);
      if (settled.status !== 'done') return { isError: true, content: [{ type: 'text', text: `The subagent gave no answer (${settled.reason}).` }] };
      const answer = await api.commit(tx => tx.entry(settled.answer), ctx);
      return { content: [{ type: 'text', text: textOf(answer?.model?.[0]) || '(empty answer)' }] };
    },
  });
  const listSubagents = defineTool({
    name: 'list_subagents', description: 'List the background subagents of this conversation with their status and, once finished, their answer.',
    parameters: Type.Object({}, { additionalProperties: false }), replay: 'safe',
    execute: async (_args, api, ctx) => {
      const records = await api.commit(tx => anchorsOf(tx, api.conversationId), ctx);
      return { content: [{ type: 'text', text: records.map(record => `#${record.id} ${statusOf(record)}: ${record.input.task}${record.state.outcome?.result ? `\n  answer: ${record.state.outcome.result.answer}` : ''}`).join('\n') || '(no subagents)' }] };
    },
  });
  const stopSubagent = defineTool({
    name: 'stop_subagent', description: 'Stop one running background subagent by its number.',
    parameters: Type.Object({ id: Type.Integer() }, { additionalProperties: false }), replay: 'safe',
    execute: async (args, api, ctx) => {
      const record = (await api.commit(tx => anchorsOf(tx, api.conversationId), ctx)).find(candidate => candidate.id === args.id);
      if (!record) return { isError: true, content: [{ type: 'text', text: `No background subagent #${args.id} in this conversation.` }] };
      // Aborting the anchor aborts the child conversation it owns first, then the anchor's own abort handler runs.
      await harness().abortTask(record.id, ctx);
      const settled = await harness().waitForTask(record.id, ctx);
      return { content: [{ type: 'text', text: `Background subagent #${args.id} is ${statusOf(settled)}.` }] };
    },
  });

  // What the Tasks panel reads: every child conversation of one parent conversation, with its owner task's status.
  async function describeChild(native, record, owner) {
    const conversation = await native.conversation(record.id, context);
    const entries = (await conversation.context(context)).entries;
    const live = await native.snapshot(LiveDoc, record.id, context);
    const status = statusOf(owner);
    const steps = entries.flatMap(entry => messagesOf(entry, 'assistant')).flatMap(message => message.content ?? []).filter(part => part.type === 'toolCall')
      .map(part => `${part.name} ${part.arguments?.path ?? ''}`.trim());
    return {
      id: record.id, taskId: record.owner.taskId, mode: owner?.kind === Anchor.definition.name ? 'background' : 'foreground', status,
      task: textOf(entries.flatMap(entry => messagesOf(entry, 'user'))[0]), steps,
      // The committed partial of the answer being generated right now, if any.
      streaming: status === 'running' ? textOf(live?.generation?.message) : '',
      answer: status === 'running' ? '' : owner?.state.outcome?.result?.answer ?? lastAnswer(entries),
    };
  }
  /** The children of one parent conversation plus the live part of the native task graph, or `undefined` when the conversation is not an agent with these tools. */
  async function describe(parent, agentId) {
    const native = harness();
    const selected = Number.isSafeInteger(parent) ? (await native.snapshot(AgentDoc, parent, context))?.extensions : undefined;
    if (!Array.isArray(selected) || !selected.includes(`agent.${agentId}`)) return undefined;
    const found = await native.commit(async tx => {
      const children = [];
      let cursor;
      do {
        const page = await tx.scanConversations({ ownerConversationId: parent }, 100, cursor);
        for (const record of page.items) children.push({ record, owner: await tx.task(record.owner.taskId) });
        cursor = page.next;
      } while (cursor);
      return children;
    }, context);
    const subagents = await Promise.all(found.map(({ record, owner }) => describeChild(native, record, owner)));
    // The live task graph, cut down to this parent and its children: what is running, waiting or completing now.
    // Read once per request and released at once, so the host holds no attachment the harness has to outlive.
    const graph = await native.taskGraph(context);
    const tasks = graph.value.tasks;
    graph.dispose();
    const scope = new Set([parent, ...subagents.map(child => child.id)]);
    const live = Object.values(tasks).filter(node => scope.has(node.conversationId))
      .map(node => ({ id: node.id, kind: node.kind, conversationId: node.conversationId, owner: node.owner ?? null, background: node.background, status: node.state.status, conversations: node.conversations }));
    return { conversation: parent, subagents, live };
  }

  return { tools: [subagent, listSubagents, stopSubagent], extensions: [anchors], describe };
}
