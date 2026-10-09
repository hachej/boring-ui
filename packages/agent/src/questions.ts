import { ReadAfterWrite, defineDocFamily, defineExtension, defineTask } from '@earendil-works/pi-durable';
import type { TaskOptions, Tx } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import type { RuntimeQuestionRef } from './contracts.js';

type QuestionRef = { [Key in keyof RuntimeQuestionRef]: RuntimeQuestionRef[Key] };
export type ChoiceQuestion = Omit<QuestionRef, 'runtimeId' | 'taskId'> & {
  readonly prompt: string;
  readonly choices: readonly string[];
};
type Resolution = { resolutionId: string; answer: string; responderId: string; consumedBy: string | null };
export type QuestionState = { kind: 'pending' } | { kind: 'resolved'; resolution: Resolution }
  | { kind: 'expired' | 'cancelled' };
type QuestionRecord = { ref: QuestionRef; prompt: string; choices: string[]; state: QuestionState };
type QuestionDocument = { question: QuestionRecord | null };
export type QuestionOutcome = { kind: 'resolved'; answer: string; resolutionId: string }
  | { kind: 'expired' | 'cancelled' | 'unavailable' };
export type QuestionDecision = QuestionOutcome | { kind: 'denied' | 'conflict' | 'pending' };

export interface QuestionOptions {
  readonly runtimeId: string;
  /** Synchronous host authentication/policy at the native commit boundary. IDs are not grants. */
  readonly authorize: (ref: RuntimeQuestionRef, action: 'admit' | 'resolve' | 'consume', context: Context) => { readonly principalId: string; readonly scopeId: string } | undefined;
  /** Recheck the bound subject digest and policy version, including at consumption. */
  readonly isCurrent: (ref: RuntimeQuestionRef, context: Context) => boolean;
  readonly now?: () => number;
}

function sameRef(left: RuntimeQuestionRef, right: RuntimeQuestionRef): boolean {
  return left.runtimeId === right.runtimeId && left.conversationId === right.conversationId
    && left.taskId === right.taskId && left.questionId === right.questionId && left.scopeId === right.scopeId
    && left.subjectDigest === right.subjectDigest && left.policyVersion === right.policyVersion && left.expiresAt === right.expiresAt;
}

/** Single-choice clarification. The native result is information, never approval or a publication grant. */
export function createQuestions(options: QuestionOptions) {
  const runtimeId = options.runtimeId;
  if (!runtimeId) throw new TypeError('A stable runtime identity is required');
  const now = options.now ?? Date.now;
  const documents = defineDocFamily<QuestionDocument, null>({
    kind: 'boring.questions.record', version: 1, scope: 'session', family: true,
    initial: () => ({ question: null }),
  });
  const key = (ref: Pick<RuntimeQuestionRef, 'scopeId' | 'questionId'>): string => JSON.stringify([runtimeId, ref.scopeId, ref.questionId]);
  const allowed = (ref: RuntimeQuestionRef, action: 'admit' | 'resolve' | 'consume', context: Context) => {
    if (ref.runtimeId !== runtimeId) return undefined;
    const actor = options.authorize({ ...ref }, action, context);
    return typeof actor?.principalId === 'string' && actor.principalId.length > 0 && actor.scopeId === ref.scopeId ? actor : undefined;
  };
  const current = (ref: RuntimeQuestionRef, context: Context): boolean => options.isCurrent({ ...ref }, context) === true;
  const expired = (ref: RuntimeQuestionRef): boolean => now() >= Date.parse(ref.expiresAt);

  const task = defineTask<{ key: string; runtimeId: string }, { phase: 'wait' }, QuestionOutcome>({
    name: 'boring.questions.wait', version: 1, initial: () => ({ phase: 'wait' }),
    phases: {
      wait: async (running, runtime, context) => {
        if (running.input.runtimeId !== runtimeId) {
          await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: { kind: 'unavailable' } } }), context);
          return;
        }
        const watch = await runtime.watchDoc(documents, running.input.key, context);
        if (!watch?.value?.question || watch.value.question.ref.taskId !== runtime.taskId) throw new Error('Native question record is missing or misbound');
        try {
          if (watch.value.question.state.kind === 'pending') {
            const changed = new Promise<void>(resolve => {
              watch.start(async value => { if (value?.question?.state.kind !== 'pending') resolve(); });
            });
            await Promise.race([
              changed,
              runtime.sleep(Date.parse(watch.value.question.ref.expiresAt), context),
              watch.closed.then(() => { throw new Error('Question observation closed'); }),
            ]);
          }
          await runtime.commit(async tx => {
            const doc = await tx.doc(documents, running.input.key, null);
            const question = doc.question;
            if (!question) throw new Error('Question retired while waiting');
            if (question.state.kind === 'pending') question.state = { kind: 'expired' };
            const result: QuestionOutcome = question.state.kind === 'resolved'
              ? { kind: 'resolved', answer: question.state.resolution.answer, resolutionId: question.state.resolution.resolutionId }
              : { kind: question.state.kind };
            return { status: 'terminal', outcome: { status: 'completed', result } };
          }, context);
        } finally { await watch.stop(); }
      },
    },
    abort: async (running, runtime, context) => {
      await runtime.commit(async tx => {
        const doc = await tx.doc(documents, running.input.key, null);
        if (doc.question?.state.kind === 'pending') doc.question.state = { kind: 'cancelled' };
        return { status: 'terminal', outcome: { status: 'aborted' } };
      }, context);
    },
  });

  async function admit(tx: Tx, input: ChoiceQuestion, ownership: TaskOptions['ownership'], context: Context): Promise<QuestionRef> {
    const captured = structuredClone(input);
    for (const value of [captured.questionId, captured.scopeId, captured.subjectDigest, captured.policyVersion, captured.prompt]) {
      if (typeof value !== 'string' || !value) throw new TypeError('Question identity, subject, policy and prompt are required');
    }
    if (!Number.isFinite(Date.parse(captured.expiresAt)) || Date.parse(captured.expiresAt) <= now()) throw new TypeError('Question expiry must be in the future');
    if (!Array.isArray(captured.choices) || !captured.choices.length || captured.choices.some(choice => typeof choice !== 'string' || !choice)
      || new Set(captured.choices).size !== captured.choices.length) throw new TypeError('Distinct nonempty choices are required');
    const doc = await tx.doc(documents, key(captured), null);
    if (doc.question) {
      const existing = doc.question;
      if (!allowed(existing.ref, 'admit', context) || !current(existing.ref, context)) throw new Error('Question admission denied');
      if (existing.ref.conversationId !== captured.conversationId || existing.ref.subjectDigest !== captured.subjectDigest
        || existing.ref.policyVersion !== captured.policyVersion || existing.ref.expiresAt !== captured.expiresAt
        || existing.prompt !== captured.prompt || JSON.stringify(existing.choices) !== JSON.stringify(captured.choices)) throw new Error('Question identity already binds different input');
      return { ...existing.ref };
    }
    const taskId = await tx.createTask(task, { key: key(captured), runtimeId }, { conversationId: captured.conversationId, ownership });
    const ref: QuestionRef = { runtimeId, taskId, conversationId: captured.conversationId, questionId: captured.questionId,
      scopeId: captured.scopeId, subjectDigest: captured.subjectDigest, policyVersion: captured.policyVersion, expiresAt: captured.expiresAt };
    if (!allowed(ref, 'admit', context) || !current(ref, context)) throw new Error('Question admission denied');
    doc.question = { ref, prompt: captured.prompt, choices: [...captured.choices], state: { kind: 'pending' } };
    return structuredClone(ref);
  }

  /** A prior table write prevents the native task check; refuse rather than bypass cancellation. */
  async function taskState(tx: Tx, ref: RuntimeQuestionRef): Promise<'known' | 'unknown' | 'aborted'> {
    let record;
    try { record = await tx.task(ref.taskId); } catch (error) { if (error instanceof ReadAfterWrite) return 'unknown'; throw error; }
    const known = record?.kind === task.definition.name && record.conversationId === ref.conversationId
      && record.input !== null && typeof record.input === 'object' && !Array.isArray(record.input)
      && record.input['runtimeId'] === runtimeId && record.input['key'] === key(ref);
    return !known || !record ? 'unknown' : record.abortRequested ? 'aborted' : 'known';
  }

  /** Resolve before native table writes in this Tx; an unreadable task returns conflict. */
  async function resolve(tx: Tx, reference: RuntimeQuestionRef, input: { readonly resolutionId: string; readonly answer: string }, context: Context): Promise<QuestionDecision> {
    const ref = structuredClone(reference);
    const { resolutionId, answer } = input;
    if (!allowed(ref, 'resolve', context)) return { kind: 'denied' };
    const bound = await taskState(tx, ref);
    if (bound === 'unknown') return { kind: 'conflict' };
    const doc = await tx.doc(documents, key(ref), null);
    const question = doc.question;
    if (!question) throw new Error('Native question evidence is missing');
    if (!sameRef(question.ref, ref)) return { kind: 'conflict' };
    if (bound === 'aborted') {
      if (question.state.kind === 'pending') question.state = { kind: 'cancelled' };
      return { kind: 'cancelled' };
    }
    const actor = allowed(ref, 'resolve', context);
    if (!actor) return { kind: 'denied' };
    if (!current(ref, context)) return { kind: 'conflict' };
    if (typeof resolutionId !== 'string' || !resolutionId || typeof answer !== 'string' || !question.choices.includes(answer)) return { kind: 'conflict' };
    if (question.state.kind === 'resolved') {
      const prior = question.state.resolution;
      return prior.resolutionId === resolutionId && prior.answer === answer && prior.responderId === actor.principalId
        ? { kind: 'resolved', answer, resolutionId } : { kind: 'conflict' };
    }
    if (question.state.kind !== 'pending') return { kind: question.state.kind };
    if (expired(ref)) { question.state = { kind: 'expired' }; return { kind: 'expired' }; }
    question.state = { kind: 'resolved', resolution: { resolutionId, answer, responderId: actor.principalId, consumedBy: null } };
    return { kind: 'resolved', answer, resolutionId };
  }

  /** Consume before native host table writes in this Tx. Recheck external publication policy separately. */
  async function consume(tx: Tx, reference: RuntimeQuestionRef, resolutionId: string, consumerId: string, context: Context): Promise<QuestionDecision> {
    const ref = structuredClone(reference);
    if (!allowed(ref, 'consume', context)) return { kind: 'denied' };
    const bound = await taskState(tx, ref);
    if (bound === 'unknown') return { kind: 'conflict' };
    const doc = await tx.doc(documents, key(ref), null);
    const question = doc.question;
    if (!question) throw new Error('Native question evidence is missing');
    if (!allowed(ref, 'consume', context)) return { kind: 'denied' };
    if (!sameRef(question.ref, ref) || !current(ref, context)) return { kind: 'conflict' };
    if (bound === 'aborted') {
      if (question.state.kind === 'pending') question.state = { kind: 'cancelled' };
      return { kind: 'cancelled' };
    }
    if (expired(ref)) {
      if (question.state.kind === 'pending') question.state = { kind: 'expired' };
      return { kind: question.state.kind === 'cancelled' ? 'cancelled' : 'expired' };
    }
    if (question.state.kind !== 'resolved') return { kind: question.state.kind };
    const resolution = question.state.resolution;
    if (typeof consumerId !== 'string' || !consumerId || resolution.resolutionId !== resolutionId || (resolution.consumedBy !== null && resolution.consumedBy !== consumerId)) return { kind: 'conflict' };
    resolution.consumedBy = consumerId;
    return { kind: 'resolved', answer: resolution.answer, resolutionId };
  }

  return { task, documents, extension: defineExtension({ name: 'boring.questions', tasks: [task] }), admit, resolve, consume,
    documentKey: (ref: Pick<RuntimeQuestionRef, 'scopeId' | 'questionId'>): string => key(ref) };
}
