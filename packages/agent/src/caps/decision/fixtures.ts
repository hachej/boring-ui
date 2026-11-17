// The fake decision provider: a pi-ai classifier (createProvider's `classifiers` seam) that sends nothing anywhere and answers
// without conviction (a choice's first option, a score's middle level, a yes/no "no", each at 0.5), unless a scripted row matches.
// The rows and their matching are boring-factory's templates/runtime/src/decide-fixtures.mjs, given per call as `fixtures`.
import type { ClassifierAnswer, ClassifierContext, ClassifierModel, ClassifierQuestion } from '@earendil-works/pi-ai';
import { createProvider } from '@earendil-works/pi-ai/models';

/** `match.state`: a text the state (as JSON) contains, or fields whose text values contain, or other values equal, the given ones. `answer: null` leaves the question unanswered. */
export type FixtureRow = {
  readonly match?: { readonly question?: string; readonly state?: string | Readonly<Record<string, unknown>> };
  readonly answer: { readonly choice: string; readonly confidence: number } | { readonly score: number; readonly confidence: number } | { readonly yes: boolean; readonly confidence: number } | null;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function stateMatches(pattern: string | Readonly<Record<string, unknown>> | undefined, state: Readonly<Record<string, unknown>>) {
  if (pattern === undefined) return true;
  if (typeof pattern === 'string') return JSON.stringify(state ?? {}).includes(pattern);
  return Object.entries(pattern).every(([k, v]) => (typeof v === 'string' ? typeof state?.[k] === 'string' && (state[k] as string).includes(v) : same(state?.[k], v)));
}
/** Whether a row's answer is one the question could get: an option it offers, a level it has, or a yes/no for a yes/no. */
function fits(a: FixtureRow['answer'], q: ClassifierQuestion) {
  if (a === null) return true;
  if ('choice' in a) return q.type === 'choice' && Object.hasOwn(q.criteria, a.choice);
  if ('score' in a) return q.type === 'score' && a.score < q.criteria.length;
  return q.type === 'bool';
}
function scripted(a: NonNullable<FixtureRow['answer']>): ClassifierAnswer {
  if ('choice' in a) return { type: 'choice', choice: a.choice, probabilities: { [a.choice]: a.confidence }, confidence: a.confidence };
  if ('score' in a) return { type: 'score', score: a.score, confidence: a.confidence };
  return { type: 'bool', probability: a.yes ? a.confidence : 1 - a.confidence };
}
function unsure(q: ClassifierQuestion): ClassifierAnswer {
  if (q.type === 'choice') { const first = Object.keys(q.criteria)[0]!; return { type: 'choice', choice: first, probabilities: { [first]: 0.5 }, confidence: 0.5 }; }
  if (q.type === 'score') return { type: 'score', score: Math.floor((q.criteria.length - 1) / 2), confidence: 0.5 };
  return { type: 'bool', probability: 0.5 };
}

/** The pi-ai provider `fake` with one classifier `fake`, answering from `rows` first. */
export function fakeProvider(rows: readonly FixtureRow[] = []) {
  const classify = async (model: ClassifierModel<string>, context: ClassifierContext) => {
    const answers: Record<string, ClassifierAnswer> = {};
    for (const [key, q] of Object.entries(context.questions)) {
      const row = rows.find((r) => (r.match?.question === undefined || r.match.question === key) && stateMatches(r.match?.state, context.state) && fits(r.answer, q));
      if (!row) answers[key] = unsure(q);
      else if (row.answer) answers[key] = scripted(row.answer);
    }
    return { api: model.api, provider: model.provider, model: model.id, answers, stopReason: 'stop' as const, timestamp: Date.now() };
  };
  return createProvider({
    id: 'fake', auth: { apiKey: { name: 'none', resolve: async () => ({ auth: {} }) } }, classifiers: { fake: { classify } },
    models: [{ type: 'classifier', id: 'fake', name: 'fake', api: 'fake', provider: 'fake', baseUrl: '', input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 64_000 }],
  });
}
