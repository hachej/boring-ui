import { createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

export function installPreparationModel(models) {
  const model = { id: 'fictional-preparation-script', name: 'Fictional preparation script', provider: 'fictional-preparation', api: 'fictional-preparation-api', baseUrl: 'https://fixture.invalid',
    input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const calls = [];
  const stream = (_model, transcript) => {
    const input = JSON.parse(transcript.messages.find(message => message.role === 'user').content);
    const returned = transcript.messages.find(message => message.role === 'toolResult');
    let text;
    if (returned) {
      const source = JSON.parse(returned.content.find(part => part.type === 'text').text);
      const dossier = source.dossier;
      const output = { format: 'fictional.redaction.preparation', version: 1, instanceId: input.request.instanceId, requestId: input.request.requestId, generationId: input.generationId,
        sources: { notes: input.request.notes, dossier: input.request.dossier, config: input.request.config }, header: dossier.header, synthesis: dossier.synthesis, schedule: dossier.schedule, cards: dossier.cards };
      if (input.scenario === 'incomplete') output.cards = output.cards.slice(1);
      if (input.scenario === 'altered') output.cards[0].summary = 'Invented unsupported claim';
      text = input.scenario === 'malformed' ? 'not JSON' : JSON.stringify(output);
    }
    const content = returned ? [{ type: 'text', text }] : [{ type: 'toolCall', id: 'preparation-source', name: 'read_preparation_source', arguments: { resource: 'captured' } }];
    const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: returned ? 'stop' : 'toolUse',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    calls.push(structuredClone(transcript));
    const events = createAssistantMessageEventStream(); events.push({ type: 'start', partial: message }); events.push({ type: 'done', reason: message.stopReason, message }); events.end(message); return events;
  };
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless preparation', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { model: { provider: model.provider, modelId: model.id }, calls };
}
