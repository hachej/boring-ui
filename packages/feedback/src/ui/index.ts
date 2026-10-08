// @hachej/boring-feedback/ui (WP6): framework-light annotate state, Copy, draft operation ids for Save, list and report data, and Show.
// Browser code over `./page` and `./format`; no store, agent or view-layer import. Each state exposes `subscribe`/`getSnapshot`.
export { createState, type ExternalState, type WritableState } from './state.js';
export {
  captureAnnotation, createAnnotation, observePage,
  type AnnotateHost, type AnnotationCapture, type Annotation, type AnnotationOptions, type AnnotationSnapshot, type CopyState, type SaveState,
} from './annotate.js';
export {
  fetchSaveEndpoint, saveResultOf, parseSaveRequest, saveResponseOf,
  type SaveRequest, type SaveResult, type SaveEndpoint, type StoreCreateResult,
} from './save.js';
export { showAnchor, type ShowOutcome, type ShowCandidate, type ShowOptions } from './show.js';
export {
  protectionNotice, ageOf, subjectLabel, listRows, reportView,
  type FeedbackProtection, type FeedbackRow, type ReportView, type ReportAnchorView,
} from './report.js';
export {
  createFeedbackSession, pinMark,
  type FeedbackSession, type FeedbackSessionOptions, type FeedbackSessionSnapshot, type FeedbackAttachment, type SessionPhase, type SessionNote,
  type SessionBubble, type SendState, type VoiceState, type Transcribe, type TranscribeResult,
} from './session.js';
