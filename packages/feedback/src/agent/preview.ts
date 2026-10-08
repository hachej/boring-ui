import { Type } from '@earendil-works/pi-ai';
import type { Conversation, JsonObject, ToolRegistration } from '@earendil-works/pi-durable';
import type { Context } from '@earendil-works/chord';
import { answerBrowserTask, createBrowserTaskTool } from '@hachej/boring-agent/browser-task';
import { previewAnswerProblem } from '../format/index.js';

/*
 * `browser_preview` (FEEDBACK.md, "Preview"): the server-side builder asks the person's open page for a live preview of a change.
 * It is a browser task (`@hachej/boring-agent/browser-task`): the call waits durably like `ask_user`; the page picks it up from the
 * conversation, runs its preview subagent (`@hachej/boring-feedback/preview`), and answers with the approved changes or `discarded`
 * through the chat transport's authenticated answer. The answer is checked here before the model reads it.
 */

export const BROWSER_PREVIEW_TOOL = 'browser_preview';

const parameters = Type.Object({
  instructions: Type.String({ minLength: 1, maxLength: 2000, description: 'The change to preview, in the person\'s words (for example "make the Save button green").' }),
  feedback: Type.Optional(Type.String({ pattern: '^fb_[1-9A-HJ-NP-Za-km-z]{16}$', description: 'The feedback report whose pinned elements the preview starts from.' })),
}, { additionalProperties: false });

const preset = {
  name: BROWSER_PREVIEW_TOOL,
  checkAnswer: (answer: JsonObject) => previewAnswerProblem(answer),
} as const;

/** The `browser_preview` tool. Install it on the builder next to the feedback capability. */
export function createBrowserPreviewTool(options: { readonly description?: string } = {}): ToolRegistration {
  return createBrowserTaskTool({
    ...preset, parameters,
    description: options.description ?? 'Preview a change live on the person\'s open page and wait for them to approve or discard it. Nothing is saved: the result lists the approved changes (element, source file:line, property or text, from, to) or says it was discarded.',
  });
}

/** The host's answer path for `browser_preview` (wire it as the chat transport's `answer`). */
export const answerBrowserPreview = (conversation: Conversation, id: string, answer: string, context?: Context) =>
  answerBrowserTask(conversation, preset, id, answer, context);
