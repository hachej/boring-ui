// @hachej/boring-feedback/store (FEEDBACK.md, "Storage"): the server-side store over injected resource contracts, its operation
// admission and reconciliation, and the mention reader. Imports `./format` and `@hachej/boring-files/platform` only.
export { createFeedbackStore, feedbackId, FEEDBACK_PAGE_SIZE, FEEDBACK_LIST_LIMIT } from './store.js';
export type {
  FeedbackProtection, FeedbackPermission, FeedbackAction, FeedbackSubject, FeedbackOperation, FeedbackStoreOptions, FeedbackStore,
  FeedbackDenied, FeedbackUnavailable, FeedbackMissing, FeedbackConflict, FeedbackUnknown, FeedbackRefusal, FeedbackStored,
  FeedbackApplied, FeedbackCreateResult, FeedbackResolveResult, FeedbackReadResult,
  FeedbackListItem, FeedbackListResult, FeedbackListQuery, FeedbackResolveInput,
} from './store.js';
export { feedbackMentionReader } from './mentions.js';
export type { FeedbackMentionFile, FeedbackMentionReader } from './mentions.js';
