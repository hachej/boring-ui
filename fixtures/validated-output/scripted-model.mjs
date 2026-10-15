import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

const id = 'fictional-validation-model';
const model = { id, name: 'Fictional validation script', provider: 'fictional-validation', api: 'fictional-validation-api',
  baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

export function createScriptedValidationModel() {
  const calls = [];
  const stream = (_selected, transcript) => {
    const history = JSON.stringify(transcript);
    const repair = history.includes('Correct the fictional number to 4');
    const toolsReturned = history.includes('toolResult');
    const content = repair ? [{ type: 'text', text: JSON.stringify({ number: 4, label: 'Fictional answer' }) }]
      : toolsReturned ? [{ type: 'text', text: JSON.stringify({ number: 7, label: 'Fictional answer' }) }]
        : [{ type: 'toolCall', id: 'source-call', name: 'read_fictional_source', arguments: { resource: 'fictional-source' } },
          { type: 'toolCall', id: 'calculation-call', name: 'calculate_fictional', arguments: { left: 2, right: 2 } }];
    const stopReason = toolsReturned || repair ? 'stop' : 'toolUse';
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
  return { models, model: { provider: model.provider, modelId: id }, calls };
}
