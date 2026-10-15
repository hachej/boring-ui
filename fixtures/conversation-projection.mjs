import { Harness, MemoryStorage, createRegistry, UserEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createConversationProjectionHandler } from '@hachej/boring-agent/projection';

const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: createModels() }, context);
const revoked = new AbortController();
try {
  const conversation = await harness.root(context);
  await conversation.commit(tx => tx.appendEntry(UserEntry, conversation.id, {
    model: [{ role: 'user', content: 'Fictional report ready for review.', timestamp: 1 }],
  }), context);
  const handler = createConversationProjectionHandler({ authenticate: async request => {
    if (request.headers.get('authorization') !== 'Bearer fictional-demo-token') return null;
    return { runtimeId: 'fictional-runtime', scopeId: 'fictional-project', principalId: 'fictional-reader',
      conversation, context, revoked: revoked.signal, authorize: async () => !revoked.signal.aborted,
      allowEntry: (_identity, entry) => entry.kind === UserEntry.kind };
  } });
  const response = await handler(new Request('https://fixture.invalid/conversation?version=2', {
    headers: { authorization: 'Bearer fictional-demo-token' },
  }));
  const reader = response.body.getReader();
  console.log(JSON.parse(new TextDecoder().decode((await reader.read()).value)));
  revoked.abort();
  console.log({ observationEndedAfterRevocation: (await reader.read()).done });
} finally { revoked.abort(); await harness.close(context); }
