import { RequestGuardError, hasJsonContentType, readJsonBody } from '@hachej/boring-files/request-guard';
import type { Context } from '@earendil-works/chord';
import type { Conversation } from '@earendil-works/pi-durable';
import type { RuntimeQuestionRef } from './contracts.js';
import type { createQuestions, QuestionDecision } from './questions.js';

export interface QuestionResponseAccess {
  readonly conversation: Conversation;
  readonly questions: Pick<ReturnType<typeof createQuestions>, 'resolve'>;
  readonly ref: RuntimeQuestionRef;
  /** Carries the authenticated human to the original question's commit policy. */
  readonly context: Context;
  readonly revoked: AbortSignal;
}

export interface QuestionResponseOptions {
  /** Includes origin/CSRF checks for cookie authentication. Never install as an agent approval tool. */
  readonly authenticateHuman: (request: Request) => Promise<QuestionResponseAccess | null>;
  readonly maxBodyBytes?: number;
}

const targetFields = ['runtimeId', 'conversationId', 'taskId', 'questionId', 'scopeId', 'subjectDigest', 'policyVersion', 'expiresAt'] as const;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function reply(status: number, kind: string, decision?: QuestionDecision): Response {
  return Response.json({ schema: 'boring.question-response', version: 1, kind, ...(decision ? { decision } : {}) }, {
    status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/** Resolves original native clarification state. No separate inbox or approval authority. */
export function createQuestionResponseHandler(options: QuestionResponseOptions): (request: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? 16_384;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) throw new TypeError('A positive body byte limit is required');
  return async request => {
    if (request.method !== 'POST') return reply(405, 'method-not-supported');
    if (!hasJsonContentType(request.headers)) return reply(415, 'json-required');
    let access: QuestionResponseAccess | null;
    try { access = await options.authenticateHuman(request); }
    catch { return reply(503, 'authentication-unavailable'); }
    if (!access) return reply(401, 'authentication-required');
    const { conversation, questions, context, revoked } = access;
    const ref = { ...access.ref };
    if (ref.conversationId !== conversation.id) return reply(403, 'binding-mismatch');
    const signal = AbortSignal.any([request.signal, revoked]);
    if (signal.aborted) return reply(403, 'not-authorized');
    let input: unknown;
    try { input = await readJsonBody(request, maxBodyBytes, signal); }
    catch (error) {
      if (signal.aborted) return reply(403, 'not-authorized');
      return error instanceof RequestGuardError && error.status === 413 ? reply(413, 'body-too-large') : reply(400, 'invalid-request');
    }
    if (signal.aborted) return reply(403, 'not-authorized');
    if (!record(input) || Object.keys(input).sort().join() !== 'answer,resolutionId,schema,target,version'
      || input['schema'] !== 'boring.question-response' || input['version'] !== 1
      || typeof input['resolutionId'] !== 'string' || !input['resolutionId'] || typeof input['answer'] !== 'string') return reply(400, 'invalid-request');
    const target = input['target'];
    if (!record(target) || Object.keys(target).length !== targetFields.length || targetFields.some(key => target[key] !== ref[key])) return reply(409, 'target-mismatch');
    const resolution = { resolutionId: input['resolutionId'], answer: input['answer'] };
    const interrupted = new Error('Question response authorization changed');
    let decision: QuestionDecision;
    try {
      decision = await conversation.commit(async tx => {
        if (signal.aborted) throw interrupted;
        const result = await questions.resolve(tx, ref, resolution, context);
        if (signal.aborted) throw interrupted;
        return result;
      }, context);
    } catch {
      return reply(503, 'resolution-not-confirmed');
    }
    if (signal.aborted) return reply(503, 'resolution-not-confirmed');
    return reply(decision.kind === 'resolved' ? 200 : decision.kind === 'denied' ? 403 : 409, 'decision', decision);
  };
}
