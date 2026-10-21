import { Harness, MemoryStorage, AssistantEntry, configure, createRegistry, defineDoc, defineEntry, defineExtension, defineTask, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createScriptedModel } from '@hachej/boring-testing/model';

const StageEntry = defineEntry('fictional.triage.stage');
const binding = defineDoc({ kind: 'fictional.triage.binding', version: 1, scope: 'task', initial: () => ({ stageTask: null }) });
const reader = defineDoc({ kind: 'fictional.triage.reader', version: 1, scope: 'conversation', initial: () => ({ seen: [], offers: 0 }) });
const textOf = message => message?.content.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '';

/** Demo-only host input metadata on Pi's public InputSubmissionDraft.entry seam; model/user text stays untouched. */
export function withDemoFailure(conversation, failure) {
  return new Proxy(conversation, { get(target, key) {
    if (key === 'submit') return (draft, ctx) => target.submit(draft.type === 'input' ? { ...draft, entry: { kind: 'fictional.triage.question', data: { failAt: failure() } } } : draft, ctx);
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

/** Host orchestration on public native tasks/tools. No kit workflow or duplicate transcript. */
export async function createStagedHost({ settings } = {}) {
  const scripted = createScriptedModel({ timed: true, fallback: turn => {
    if (turn.user.startsWith('STAGE ')) {
      const number = Number(turn.user.slice(6));
      return { text: `## Étape ${number}\n${['Note de triage fictive : vérifier le contexte avant toute décision.', 'Contrôle fictif : aucune dose ni recommandation médicale dans cette démonstration.', 'Synthèse fictive : proposer une relecture de la note.'][number - 1]}\n::meta {"stage":${number},"offer":true}\n`, delay: number === 2 ? 1200 : 180 };
    }
    if (turn.last?.isError) return { error: 'La prochaine étape a échoué.' };
    if (turn.results.length === 3) return '';
    return { tools: [{ name: 'triage_stage', args: { stage: turn.results.length + 1 } }] };
  } });
  const registry = createRegistry();
  let harness;
  const stageTask = defineTask({ name: 'fictional.triage.stage-task', version: 1, initial: () => ({ phase: 'start' }), phases: {
    start: async (running, runtime, ctx) => runtime.commit(async tx => {
      const child = await tx.createConversation({ ownership: { kind: 'task', taskId: runtime.taskId } });
      await configure(tx, child.id, { tools: null, modelTools: null, model: scripted.model, instructions: 'Write only a fictional demonstration note. No medical recommendations.' });
      await tx.appendEntry(StageEntry, runtime.conversationId, { data: { stage: running.input.stage, state: 'running', taskId: runtime.taskId } });
      return { status: 'running', checkpoint: { phase: 'generate', child: child.id } };
    }, ctx),
    generate: async (running, runtime, ctx) => {
      const child = await runtime.conversation(running.state.checkpoint.child, ctx);
      const submission = await child.submit({ type: 'input', requestId: `stage:${runtime.taskId}`, content: `STAGE ${running.input.stage}` }, ctx);
      const settled = await submission.wait(ctx);
      const generated = settled.status === 'done' ? await runtime.context(child.id, ctx, { at: settled.answer }) : undefined;
      const answer = generated?.entries.find(entry => entry.id === settled.answer);
      const message = answer?.model?.find(value => value.role === 'assistant');
      // This host's validation policy is deliberately small and fictional; it runs before any answer is published.
      const valid = textOf(message).startsWith(`## Étape ${running.input.stage}\n`) && running.input.failAt !== running.input.stage;
      await runtime.commit(async tx => {
        const published = valid ? await tx.appendEntry(AssistantEntry, runtime.conversationId, { model: [message] }) : undefined;
        // Keep the validated note in the raw transcript, not the coordinator's model context: it is not that agent's final round.
        await tx.appendEntry(StageEntry, runtime.conversationId, { data: { stage: running.input.stage, state: valid ? 'validated' : 'failed', durationMs: message?.durationMs ?? 0, taskId: runtime.taskId },
          ...(published ? { edits: [{ target: published.id, action: 'omit' }] } : {}) });
        return { status: 'terminal', outcome: valid ? { status: 'completed', result: { stage: running.input.stage } } : { status: 'failed', error: { message: 'Fictional stage validation failed' } } };
      }, ctx);
    },
  }, abort: async (_running, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
  const stageTool = defineTool({ name: 'triage_stage', description: 'Generate and validate one fictional stage, in order.', replay: 'safe',
    parameters: Type.Object({ stage: Type.Integer({ minimum: 1, maximum: 3 }) }, { additionalProperties: false }),
    execute: async (args, api, ctx) => {
      const conversation = await harness.conversation(api.conversationId, ctx);
      const input = (await conversation.context(ctx)).entries.findLast(entry => entry.model?.some(message => message.role === 'user'));
      const failAt = [1, 2].includes(input?.data?.failAt) ? input.data.failAt : 0;
      const taskId = await api.commit(async tx => {
        const doc = await tx.doc(binding, api.taskId);
        if (doc.stageTask === null) doc.stageTask = await tx.createTask(stageTask, { ...args, failAt }, { conversationId: api.conversationId, ownership: { kind: 'task', taskId: api.taskId } });
        return doc.stageTask;
      }, ctx);
      const task = await api.waitForTask(taskId, ctx);
      const ok = task.state.outcome.status === 'completed';
      return { isError: !ok, output: [{ type: 'text', text: ok ? `Étape ${args.stage} validée.` : 'La prochaine étape a échoué.' }] };
    } });
  registry.install(defineExtension({ name: 'fictional.triage', tasks: [stageTask], tools: [stageTool] }));
  harness = await Harness.open(new MemoryStorage(), { registry, models: scripted.models, ...(settings ? { settings } : {}) }, context);
  const threads = {};
  for (const name of ['Questions', 'Senior']) threads[name] = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: scripted.model, tools: [stageTool], instructions: 'Run stages 1, 2, 3 sequentially. Each stage validates its output. Stop on failure.' } }, context);
  const readerState = async name => threads[name].commit(async tx => JSON.parse(JSON.stringify(await tx.doc(reader, threads[name].id))), context);
  return { harness, threads, context, readerState,
    act: async (name, action, key) => threads[name].commit(async tx => { const doc = await tx.doc(reader, threads[name].id); if (action === 'seen' && !doc.seen.includes(key)) doc.seen.push(key); if (action === 'offer') doc.offers++; return JSON.parse(JSON.stringify(doc)); }, context),
    close: () => harness.close(context) };
}
