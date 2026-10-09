// The browser preview subagent (FEEDBACK.md, "Preview"): a small tool-calling loop on Pi's model layer, in the page. The host gives
// it native Pi `Models` whose provider is its model gateway (`gatewayProvider` from `@hachej/boring-agent/gateway-provider`), so the page
// holds no key; this module never builds a provider itself. Tool calls are validated by Pi (`validateToolCall`) and executed by the
// preview page tools (./page.ts) only: there is no other tool, so a call to anything else is an error result. The loop is in memory
// on purpose: a preview is not saved, and a reload reverts the page anyway; the durable part is the server's `browser_preview` wait.
import { Type, validateToolCall } from '@earendil-works/pi-ai';
import type { Api, AssistantMessage, Message, Model, Models, Tool, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { PreviewOutcome, PreviewPage } from './page.js';
import { PREVIEW_LIMITS, type PreviewAnswer } from '../format/index.js';

export const PREVIEW_SYSTEM_PROMPT = `You preview a requested change on a live web page, for a person who will approve or discard it. Nothing you do is saved.
Use only the tools. Reference elements by the pinned ids (p1, p2...) or by ids from inspect (e1, e2...). Call inspect when you need to see the page.
Prefer the smallest change that does what was asked, on the pinned elements. set_style takes plain CSS declarations ("background-color: #2f9e44; color: #ffffff").
Text shown as masked is private: never guess or rewrite it. When the change is done, answer with one short sentence saying what you changed.`;

const element = Type.String({ minLength: 1, maxLength: 20, description: 'A pin id (p1...) or an id from inspect (e1...).' });
/** The page tools, as Pi tool declarations. */
export const PREVIEW_TOOLS: readonly Tool[] = Object.freeze([
  { name: 'inspect', description: 'The masked outline of the application page with element ids, the pinned elements first, and a few computed styles.', parameters: Type.Object({}, { additionalProperties: false }) },
  { name: 'set_style', description: 'Set inline CSS properties on one element (colors, borders, spacing, fonts, sizes, display). No url(), no !important.', parameters: Type.Object({ element, css: Type.String({ minLength: 1, maxLength: 600 }) }, { additionalProperties: false }) },
  { name: 'set_text', description: 'Replace the visible text of one text-only element (a button label, a heading...).', parameters: Type.Object({ element, text: Type.String({ minLength: 1, maxLength: 200 }) }, { additionalProperties: false }) },
  { name: 'hide', description: 'Hide one element.', parameters: Type.Object({ element }, { additionalProperties: false }) },
  { name: 'show', description: 'Show again an element this preview hid.', parameters: Type.Object({ element }, { additionalProperties: false }) },
]);

export interface PreviewAgentOptions {
  readonly models: Models;
  readonly model: Model<Api>;
  readonly page: PreviewPage;
  /** What to preview, from the server's `browser_preview` call. */
  readonly instructions: string;
  /** Model turns per `say`, tool calls included. Default 8. */
  readonly maxSteps?: number;
}

export interface PreviewAgent {
  /** Runs the loop on the first instructions (`say()` with no text) or on a follow-up ("darker"). Resolves with the final sentence. */
  readonly say: (text?: string, signal?: AbortSignal) => Promise<{ readonly text: string } | { readonly error: string }>;
  /** Everything sent to and received from the model, in order. */
  readonly messages: () => readonly Message[];
  /** The approved answer from the current page changes and the last sentence. */
  readonly approve: () => PreviewAnswer;
  /** Reverts the page and returns the discarded answer. */
  readonly discard: () => PreviewAnswer;
}

const textOf = (message: AssistantMessage): string => message.content.filter(part => part.type === 'text').map(part => part.text).join('').trim();

function run(page: PreviewPage, call: ToolCall): PreviewOutcome {
  const args = validateToolCall([...PREVIEW_TOOLS], call) as Record<string, string>;
  switch (call.name) {
    case 'inspect': return { ok: true, message: page.inspect() };
    case 'set_style': return page.setStyle(args['element'] ?? '', args['css'] ?? '');
    case 'set_text': return page.setText(args['element'] ?? '', args['text'] ?? '');
    case 'hide': return page.hide(args['element'] ?? '');
    case 'show': return page.show(args['element'] ?? '');
    default: return { ok: false, reason: `unknown tool ${call.name}` };
  }
}

/** The first message: the instructions and the pinned elements as the privacy policy names them. */
export function previewBrief(instructions: string, page: PreviewPage): string {
  const pins = page.pins.map(pin => `- ${pin.id}: ${pin.fallback}${pin.source ? ` [source ${pin.source}]` : ''}${pin.unplaced ? ` (not usable: ${pin.unplaced})` : ''}`);
  return `Preview this change: ${instructions}\nPinned elements:\n${pins.join('\n') || '- none: call inspect to find the element'}`;
}

/** A preview subagent over one page. Several `say` calls continue the same conversation; they must not overlap. */
export function createPreviewAgent(options: PreviewAgentOptions): PreviewAgent {
  const { models, model, page } = options;
  const maxSteps = options.maxSteps ?? 8;
  const messages: Message[] = [];
  let summary = '';
  let running = false;
  const say = async (text?: string, signal?: AbortSignal) => {
    if (running) return { error: 'The preview is still working.' };
    running = true;
    try {
      const content = messages.length === 0 ? previewBrief(options.instructions, page) + (text ? `\n${text}` : '') : text?.trim();
      if (!content) return { error: 'Say what to change.' };
      messages.push({ role: 'user', content, timestamp: Date.now() });
      for (let step = 0; step < maxSteps; step++) {
        if (signal?.aborted) return { error: 'Stopped.' };
        const reply = await models.complete(model, { systemPrompt: PREVIEW_SYSTEM_PROMPT, messages: [...messages], tools: [...PREVIEW_TOOLS] }, signal ? { signal } : {});
        messages.push(reply);
        if (reply.stopReason === 'error' || reply.stopReason === 'aborted') return { error: reply.errorMessage ?? 'The model could not answer.' };
        const calls = reply.content.filter((part): part is ToolCall => part.type === 'toolCall');
        if (!calls.length) { summary = textOf(reply).slice(0, PREVIEW_LIMITS.summary); return { text: summary }; }
        for (const call of calls) {
          let outcome: PreviewOutcome;
          try { outcome = run(page, call); } catch (error) { outcome = { ok: false, reason: error instanceof Error ? error.message : 'invalid call' }; }
          const result: ToolResultMessage = { role: 'toolResult', toolCallId: call.id, toolName: call.name, isError: !outcome.ok,
            content: [{ type: 'text', text: outcome.ok ? outcome.message : `Refused: ${outcome.reason}` }], timestamp: Date.now() };
          messages.push(result);
        }
      }
      return { error: `The preview stopped after ${maxSteps} steps.` };
    } finally { running = false; }
  };
  return Object.freeze({
    say,
    messages: () => [...messages],
    approve: (): PreviewAnswer => ({ kind: 'approved', summary: summary || 'Previewed on the page.', changes: page.changes().slice(0, PREVIEW_LIMITS.changes) }),
    discard: (): PreviewAnswer => { page.revert(); return { kind: 'discarded' }; },
  });
}
