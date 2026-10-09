import { defineDocFamily, defineExtension, defineTask } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { actorSnapshot, equal, paths } from './bindings.mjs';
import { domainPaths, requestId, expectation, expected, readable, change, checkedPublication } from './adoption-bindings.mjs';

const adoptions = defineDocFamily({ kind: 'fixture.redaction.adoptions', version: 1, scope: 'session', family: true, initial: () => ({ binding: null }) });
const key = request => JSON.stringify([request.instanceId, request.subject, request.requestId]);
const access = actor => ({ ...actor, authorizationRef: 'fictional.redaction.adopt.v1' });
const denied = () => ({ kind: 'denied', reason: 'Adoption access denied' });

export function createAdoption({ provider, harness, conversation, instanceId, allowed, getProposal, readCorrection,
  beforeAdoptionPublish, afterAdoptionCommit }) {
  const visible = (request, actor) => allowed(actor, 'adopt') && [paths(instanceId, request.subject).source, paths(instanceId, request.subject).config, request.proposal.guard, request.proposal.reservation,
    request.record.target, request.letter.target, ...request.corrections.map(item => item.expected.target)]
    .every(target => allowed(actor, 'read', target));
  const publication = input => ({ operationId: input.operationId, atomicity: 'all-or-nothing',
    preconditions: [{ kind: 'revision', target: input.source }, { kind: 'revision', target: input.config },
      { kind: 'revision', target: input.request.proposal.guard }, ...input.request.corrections.map(item => item.expected)],
    changes: [change(input.request.record, { format: 'fictional.redaction.record', version: 1,
      subject: input.request.subject, proposal: input.request.proposal.validation, items: input.items }, 'application/json'),
    change(input.request.letter, `# Fictional ${input.request.subject}\n${input.items.map(item => item.text).join('\n')}`, 'text/markdown')] });
  const reconcile = async input => {
    const found = await provider.reconciliation.lookup(input.operationId, access(input.actor));
    return found.kind === 'not-found' ? found : checkedPublication(found, publication(input), input.actor);
  };
  const task = defineTask({ name: 'fixture.redaction.adopt', version: 1, initial: () => ({ phase: 'publish' }), phases: {
    publish: async (running, runtime, ctx) => {
      const input = running.input;
      const attempted = await runtime.memo('fictional.redaction.adoption.attempted.v1', ctx);
      const unknown = reason => ({ kind: 'unknown', operationId: input.operationId, reason });
      let result, dispatched = false;
      try {
        if (!visible(input.request, input.actor)) result = attempted ? unknown('Current access does not permit reconciliation') : denied();
        else {
          const found = await reconcile(input);
          if (found.kind !== 'not-found') result = found;
          else {
            await beforeAdoptionPublish(structuredClone(input));
            if (!visible(input.request, input.actor)) result = attempted ? unknown('Current access does not permit reconciliation') : denied();
            else {
              await runtime.memo('fictional.redaction.adoption.attempted.v1', true, ctx);
              dispatched = true;
              result = await checkedPublication(await provider.publication.publish(publication(input), { ...access(input.actor), signal: runtime.signal }), publication(input), input.actor);
              if (result.kind === 'committed') await afterAdoptionCommit(structuredClone(result));
            }
          }
        }
      } catch { result = attempted || dispatched ? unknown('Adoption acknowledgement unavailable')
        : { kind: 'unavailable', reason: 'Adoption lookup unavailable' }; }
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result } }), ctx);
    },
  }, abort: async (_running, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });

  const choicesSnapshot = choices => {
    if (!Array.isArray(choices) || choices.length < 1 || choices.length > 2) throw new TypeError('Select one or two items');
    const result = choices.map(item => {
      if (!item || !['corrected', 'proposed'].includes(item.kind) || typeof item.itemId !== 'string'
        || Object.keys(item).sort().join(',') !== 'itemId,kind') throw new TypeError('Invalid choice');
      return { itemId: item.itemId, kind: item.kind };
    });
    if (new Set(result.map(item => item.itemId)).size !== result.length) throw new TypeError('Duplicate choice');
    return result;
  };
  const requestSnapshot = value => {
    const request = structuredClone(value);
    if (request.instanceId !== instanceId || request.proposal.instanceId !== instanceId || request.subject !== request.proposal.subject) throw new TypeError('Wrong proposal');
    requestId(request.requestId);
    const targets = domainPaths(instanceId, request.subject);
    const choices = choicesSnapshot(request.choices);
    if (!Array.isArray(request.corrections) || request.corrections.length !== choices.length) throw new TypeError('Missing correction guards');
    const corrections = choices.map((choice, i) => {
      const correction = request.corrections[i];
      if (correction.itemId !== choice.itemId) throw new TypeError('Wrong correction guard');
      return { itemId: choice.itemId, expected: expectation(correction.expected, domainPaths(instanceId, request.subject, choice.itemId).correction) };
    });
    return { instanceId, subject: request.subject, requestId: request.requestId, proposal: request.proposal,
      choices, corrections, record: expectation(request.record, targets.record), letter: expectation(request.letter, targets.letter) };
  };
  const captureAdoption = async (value, selected, id, identity) => {
    let ref, choices, actor;
    try { ref = structuredClone(value); choices = choicesSnapshot(selected); requestId(id); actor = actorSnapshot(identity); }
    catch { return denied(); }
    if (!allowed(actor, 'adopt')) return denied();
    const proposal = await getProposal(ref, actor);
    if (proposal.kind !== 'ready') return proposal;
    try {
      const corrections = [];
      for (const choice of choices) {
        if (!Object.values(proposal.catalog).includes(choice.itemId)) return denied();
        const correction = await readCorrection(ref.subject, choice.itemId, actor);
        if (choice.kind === 'corrected' ? !correction.value : !proposal.value.items.some(item => item.itemId === choice.itemId)) return { kind: 'unavailable' };
        corrections.push({ itemId: choice.itemId, expected: correction.expected });
      }
      const targets = domainPaths(instanceId, ref.subject);
      const [record, letter] = await Promise.all([targets.record, targets.letter].map(target => provider.read({ target, revision: { kind: 'latest' } }, actor)));
      if (![record, letter].every(readable)) return { kind: 'unavailable' };
      const request = { instanceId, subject: ref.subject, requestId: id, proposal: ref, choices, corrections,
        record: expected(record, targets.record), letter: expected(letter, targets.letter) };
      return visible(request, actor) ? { kind: 'captured', request } : denied();
    } catch { return { kind: 'unavailable' }; }
  };
  const adopt = async (value, identity) => {
    let request, actor;
    try { request = requestSnapshot(value); actor = actorSnapshot(identity); } catch { return denied(); }
    if (!visible(request, actor)) return denied();
    const prior = await harness.snapshot(adoptions, key(request), context);
    if (!visible(request, actor)) return denied();
    if (prior?.binding) return equal(prior.binding.request, request) && equal(prior.binding.ref.actor, actor)
      ? { kind: 'admitted', ref: structuredClone(prior.binding.ref) } : { kind: 'conflict' };
    const proposal = await getProposal(request.proposal, actor);
    if (proposal.kind !== 'ready') return proposal;
    let items;
    try {
      items = await Promise.all(request.choices.map(async (choice, index) => {
        if (!Object.values(proposal.catalog).includes(choice.itemId)) throw new TypeError('Unknown item');
        const guard = request.corrections[index].expected;
        const item = choice.kind === 'proposed' ? proposal.value.items.find(item => item.itemId === choice.itemId)
          : guard.kind === 'revision' ? (await readCorrection(request.subject, choice.itemId, actor, guard)).value : null;
        if (!item) throw new TypeError('Selected item unavailable');
        return { itemId: choice.itemId, text: item.text, kind: choice.kind };
      }));
    } catch { return { kind: 'unavailable' }; }
    if (!visible(request, actor)) return denied();
    const operationId = JSON.stringify(['fictional.redaction.adopt.v1', instanceId, request.subject, request.requestId]);
    let committed = false;
    const revoked = new Error('Adoption admission revoked');
    try {
      const result = await conversation.commit(async tx => {
        const doc = await tx.doc(adoptions, key(request), null);
        if (!visible(request, actor)) return denied();
        if (doc.binding) return equal(doc.binding.request, request) && equal(doc.binding.ref.actor, actor)
          ? { kind: 'admitted', ref: JSON.parse(JSON.stringify(doc.binding.ref)) } : { kind: 'conflict' };
        const taskId = await tx.createTask(task, { request, actor, operationId, items, source: proposal.request.source, config: proposal.request.config }, { ownership: { kind: 'conversation' } });
        const ref = { instanceId, subject: request.subject, requestId: request.requestId, taskId, operationId, actor };
        doc.binding = { request, ref };
        if (!visible(request, actor)) throw revoked;
        return { kind: 'admitted', ref: structuredClone(ref) };
      }, context);
      committed = result.kind === 'admitted';
      harness.resume();
      return visible(request, actor) ? result : committed ? { kind: 'unknown' } : denied();
    } catch (error) { return error === revoked ? denied() : { kind: 'unknown' }; }
  };
  const adoptionResult = async (value, identity) => {
    let ref, actor;
    try { ref = structuredClone(value); actor = actorSnapshot(identity); } catch { return denied(); }
    if (ref.instanceId !== instanceId || !allowed(actor, 'adopt')) return denied();
    const doc = await harness.snapshot(adoptions, key(ref), context);
    if (!doc?.binding || !equal(doc.binding.ref, ref) || !equal(actor, ref.actor) || !visible(doc.binding.request, actor)) return denied();
    const running = await harness.getTask(ref.taskId, context);
    if (!running || running.kind !== task.definition.name) return { kind: 'unavailable' };
    const found = await reconcile(running.input);
    if (!visible(doc.binding.request, actor)) return denied();
    if (found.kind !== 'not-found') return found;
    if (running.state.status !== 'terminal') return { kind: 'pending' };
    return running.state.outcome.status === 'completed' ? structuredClone(running.state.outcome.result)
      : { kind: 'unknown', operationId: ref.operationId, reason: 'Native adoption ended without a confirmed publication result' };
  };
  return { extension: defineExtension({ name: 'fixture.redaction.adoption', tasks: [task] }), captureAdoption, adopt, adoptionResult };
}
