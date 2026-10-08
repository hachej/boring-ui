// Browser side of the model gateway proof: a native Pi `Models` whose one provider is the host's `/api/llm` gateway. The page
// session is the only credential (no model key exists in the page); the gateway decides the upstream model behind
// `fernhill-preview`. The future in-page preview subagent runs on these models.
import { createModels } from '@earendil-works/pi-ai/models';
import { GATEWAY_PROVIDER, gatewayProvider } from '@hachej/boring-agent/gateway-provider';

export const PREVIEW_MODEL = 'fernhill-preview';

/** `getAuth` returns the session headers, for example `() => ({ authorization: \`Bearer ${token}\` })`. */
export function previewModels({ getAuth, baseUrl = '/api/llm' }) {
  const models = createModels();
  models.setProvider(gatewayProvider({ baseUrl, models: [{ id: PREVIEW_MODEL, name: 'Fernhill preview (gateway)', maxTokens: 1024 }], getAuth }));
  return models;
}

/** One completion through the gateway: `{ text, stopReason, error? }` (Pi reports failures as a message, not a throw). */
export async function previewComplete(models, text) {
  const message = await models.complete(models.getModel(GATEWAY_PROVIDER, PREVIEW_MODEL), { messages: [{ role: 'user', content: text, timestamp: Date.now() }] });
  return {
    text: message.content.filter(part => part.type === 'text').map(part => part.text).join(''), stopReason: message.stopReason,
    ...(message.errorMessage ? { error: message.errorMessage } : {}),
  };
}
