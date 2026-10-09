// @hachej/boring-agent/session-affinity: Workers AI keeps a prompt's prefix cache on one replica, so the wrapper pins stream calls to one
// `sessionId` unless the call names its own. In-process fakes only. Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { withSessionAffinity } from '@hachej/boring-agent/session-affinity';

/** A provider that records what each stream call received, with a property and a method that read its own state. */
function fakeProvider() {
  const calls = [];
  const provider = {
    id: 'fictional-workers-ai',
    calls,
    stream(model, context, options) { calls.push({ method: 'stream', model, context, options }); return 'stream-result'; },
    streamSimple(model, context, options) { calls.push({ method: 'streamSimple', model, context, options }); return 'simple-result'; },
    describe() { return `provider ${this.id}`; },
  };
  return provider;
}

test('stream and streamSimple send the scope key as sessionId when the call names none', () => {
  const target = fakeProvider();
  const provider = withSessionAffinity(target, 'recipe');
  assert.equal(provider.stream('model-a', 'context-a'), 'stream-result');
  assert.equal(provider.streamSimple('model-b', 'context-b', { maxTokens: 64 }), 'simple-result');
  assert.deepEqual(target.calls, [
    { method: 'stream', model: 'model-a', context: 'context-a', options: { sessionId: 'recipe' } },
    { method: 'streamSimple', model: 'model-b', context: 'context-b', options: { maxTokens: 64, sessionId: 'recipe' } },
  ]);
});

test('an explicit sessionId and the other options of the call are kept', () => {
  const target = fakeProvider();
  const provider = withSessionAffinity(target, 'recipe');
  provider.stream('m', 'c', { sessionId: 'turn-7', temperature: 0.2 });
  provider.streamSimple('m', 'c', { sessionId: 'turn-8' });
  assert.deepEqual(target.calls.map(call => call.options), [{ sessionId: 'turn-7', temperature: 0.2 }, { sessionId: 'turn-8' }]);
});

test('other properties and methods pass through, bound to the target', () => {
  const target = fakeProvider();
  const provider = withSessionAffinity(target, 'recipe');
  assert.equal(provider.id, 'fictional-workers-ai');
  assert.equal(provider.calls, target.calls);
  assert.equal(provider.describe(), 'provider fictional-workers-ai');
  assert.equal('missing' in provider, false);
  assert.equal(provider.missing, undefined);
  assert.equal(target.calls.length, 0);
});
