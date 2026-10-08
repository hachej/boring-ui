// A local, keyless model for the journey: it answers from what the request actually contains, so the journey proves
// what reached the model (for example a fact that is only in the <memory> view) without a network or an API key.
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';

const MODEL = { id: 'scripted', name: 'Scripted', provider: 'scripted', api: 'scripted-api', baseUrl: 'https://fixture.invalid',
  input: ['text'], reasoning: false, contextWindow: 200000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const textOf = message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');

/** `decide(messages, request)` returns { text } or { tool: { name, arguments } } for each request. */
export function createScriptedModel(decide) {
  const requests = [];
  const stream = (_model, request) => {
    requests.push(structuredClone(request));
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, timestamp: Date.now(), stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    // Answer on a later tick, like a provider, so the browser sees a live run.
    setTimeout(() => {
      events.push({ type: 'start', partial: message });
      const answer = decide(request.messages.filter(item => item.role !== 'system'), request);
      if (answer.tool) {
        const toolCall = { type: 'toolCall', id: `call-${requests.length}`, name: answer.tool.name, arguments: answer.tool.arguments };
        message.content.push(toolCall); message.stopReason = 'toolUse';
        events.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
        events.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
        events.push({ type: 'done', reason: 'toolUse', message });
      } else {
        message.content.push({ type: 'text', text: '' });
        events.push({ type: 'text_start', contentIndex: 0, partial: message });
        message.content[0].text = answer.text;
        events.push({ type: 'text_delta', contentIndex: 0, delta: answer.text, partial: message });
        events.push({ type: 'text_end', contentIndex: 0, content: answer.text, partial: message });
        events.push({ type: 'done', reason: 'stop', message });
      }
      events.end(message);
    }, 30);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: MODEL.provider, models: [MODEL], auth: { apiKey: { name: 'keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { models, model: { provider: MODEL.provider, modelId: MODEL.id }, requests, textOf };
}
