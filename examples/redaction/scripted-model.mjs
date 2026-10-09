import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

const model = { id: 'fictional-redaction-script', name: 'Fictional redaction script',
  provider: 'fictional-redaction', api: 'fictional-redaction-api', baseUrl: 'https://fixture.invalid',
  input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

export function createScriptedRedactionModel() {
  const calls = [];
  const stream = (_selected, transcript) => {
    const messages = transcript.messages;
    const request = messages.find(message => message.role === 'user' && typeof message.content === 'string');
    const input = JSON.parse(request.content);
    const history = JSON.stringify(messages);
    const returned = history.includes('toolResult');
    const repaired = input.settings.proposal.scenario !== 'exhausted' && history.includes('Correct the fictional calculation to 4');
    const items = input.settings.proposal.order.map(kind => ({ kind,
      text: kind === 'source' ? input.text : repaired ? '4' : '7' }));
    const content = returned ? [{ type: 'text', text: JSON.stringify({ items }) }]
      : [{ type: 'toolCall', id: 'source-call', name: 'read_fictional_source', arguments: { resource: 'original' } },
        { type: 'toolCall', id: 'calculation-call', name: 'calculate_fictional', arguments: { left: 2, right: 2 } }];
    const stopReason = returned ? 'stop' : 'toolUse';
    const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
      timestamp: 1, stopReason, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    calls.push({ history: structuredClone(transcript), content: structuredClone(content) });
    const events = createAssistantMessageEventStream();
    events.push({ type: 'start', partial: message });
    events.push({ type: 'done', reason: stopReason, message });
    events.end(message);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } },
    api: { stream, streamSimple: stream } }));
  return { models, model: { provider: model.provider, modelId: model.id }, calls };
}
