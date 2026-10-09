// @hachej/boring-feedback/agent (FEEDBACK.md, "Activating it on an agent"): the opt-in native Pi extension with the `feedback`
// tool, and `browser_preview`, a browser task answered by the page's preview subagent. Imports `./format`, `./store` types, the Pi
// peers and `@hachej/boring-agent/browser-task`; never `./page`, `./ui` or `./source`.
export { createFeedbackCapability, FEEDBACK_TOOL, FEEDBACK_EXTENSION, FEEDBACK_TOOL_ACTIONS, CHECKED_IN_THE_PAGE } from './capability.js';
export type { FeedbackCapability, FeedbackCapabilityOptions, FeedbackResolution, FeedbackSnapshot, FeedbackToolAction } from './capability.js';
export { createBrowserPreviewTool, answerBrowserPreview, BROWSER_PREVIEW_TOOL } from './preview.js';
