import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const fake = createFakeChatModel();
const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
const controller = createNativeChatController({ conversation, context,
  identity: { runtimeId: 'fictional-local', scopeId: 'fictional-project', principalId: 'fictional-person' } });
try {
  await controller.connect();
  controller.setText('Describe the fictional document.');
  const submission = await controller.send();
  const generation = await fake.nextCall();
  generation.append('The fictional document ');
  generation.respond('contains no private records.');
  await submission.wait(context); await conversation.waitForIdle(context);
  const messages = (await conversation.context(context)).entries.flatMap(entry => entry.model ?? []);
  console.log(JSON.stringify({ admission: controller.getSnapshot().send.kind, draft: controller.getSnapshot().draft.text,
    response: messages.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(part => part.type === 'text').map(part => part.text)) }, null, 2));
} finally { await controller.dispose(); await harness.close(context); }
