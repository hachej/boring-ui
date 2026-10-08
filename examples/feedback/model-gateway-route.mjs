// The example's model gateway (`/api/llm`): browser-side Pi agents call models here with the person's session, never a key.
// `@hachej/boring-agent/model-gateway` does the work; this file is only the host's configuration:
//   - who: the session bearer token of the page (`authorize`, the person's principal id);
//   - which models: one gateway id, `fernhill-preview`, mapped to the upstream model, so the page never names a provider;
//   - how much: 20 requests a minute and 1024 output tokens per request per person (in memory, this process only);
//   - which upstream: OPENAI_API_KEY (FEEDBACK_GATEWAY_MODEL, default gpt-5-mini), else ANTHROPIC_API_KEY (default
//     claude-haiku-4-5), else the keyless scripted models: the preview subagent's (preview-script.mjs) when the request declares
//     the preview tools, else builder.mjs's, so the whole flow works offline.
// The log line is metadata only. Wire it as `url.pathname.startsWith('/api/llm/') ? await llm(request) : ...`.
import { anthropicUpstream, createModelGateway, memoryBudget, openAICompatibleUpstream, scriptedUpstream } from '@hachej/boring-agent/model-gateway';
import { scriptedStep } from './builder.mjs';
import { previewScriptedStep } from './preview-script.mjs';

export const GATEWAY_PATH = '/api/llm';
export const PREVIEW_MODEL = 'fernhill-preview';

/** The scripted reply: the preview subagent's step when the request declares its tools, else the scripted builder's text (a builder
 * tool step is described, not called: those tools live on the server). */
export const scriptedReply = (messages, { tools = [] } = {}) => {
  if (tools.includes('set_style')) return previewScriptedStep(messages);
  const step = scriptedStep(messages.map(message => ({ ...message, role: message.role === 'tool' ? 'toolResult' : message.role, content: message.content ?? '' })));
  return step.text ?? `(scripted) I would call ${step.tool} here.`;
};

/** `{ upstream, allow }` from the server's environment. Keys are read here and never leave this process. */
export function modelUpstreamFromEnv(env = process.env) {
  if (env.OPENAI_API_KEY) return { upstream: openAICompatibleUpstream({ apiKey: env.OPENAI_API_KEY }), allow: { [PREVIEW_MODEL]: env.FEEDBACK_GATEWAY_MODEL ?? 'gpt-5-mini' } };
  if (env.ANTHROPIC_API_KEY) return { upstream: anthropicUpstream({ apiKey: env.ANTHROPIC_API_KEY }), allow: { [PREVIEW_MODEL]: env.FEEDBACK_GATEWAY_MODEL ?? 'claude-haiku-4-5' } };
  return { upstream: scriptedUpstream({ reply: scriptedReply }), allow: { [PREVIEW_MODEL]: 'fernhill-builder-script' } };
}

/** The `/api/llm` Fetch handler. `authorize(request)` returns the person's id or nothing. */
export function modelGatewayHandler({ authorize, configuration = modelUpstreamFromEnv(), budget = memoryBudget({ requestsPerMinute: 20, maxTokensPerRequest: 1024 }), log = entry => console.log('llm', JSON.stringify(entry)) }) {
  return createModelGateway({ basePath: GATEWAY_PATH, upstream: configuration.upstream, allow: configuration.allow, budget, authorize, log });
}
