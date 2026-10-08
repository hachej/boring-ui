// `feedback@1` (FEEDBACK.md, "The report" and "Storage"): schema, strict parser, canonical serializer, body rendering,
// report paths and the single-file publication request builders. Pure: no I/O, no platform API, no Node module.
export {
  FEEDBACK_FORMAT, FEEDBACK_MEDIA_TYPE, UNTRUSTED_PREFACE, FEEDBACK_LIMITS, FEEDBACK_ID, ANCHOR_KIND, OBSERVED_KIND,
  FeedbackFormatError, isHostObserved, isResourceObserved, escapeMarkdown, renderReport, parseFeedback, checkFeedback,
  feedbackText, serializeFeedback, titleOf, reportTitle, draftProblems, draftReport, draftBody,
} from './report.js';
export type {
  JsonValue, JsonObject, Extensions, FeedbackStatus, HostObserved, ResourceObserved, OtherObserved, Observed, FeedbackAnchor,
  FeedbackAuthor, FeedbackResolution, FeedbackNote, FeedbackStep, FeedbackReport, FeedbackDraft, FeedbackProblemCode, FeedbackProblem, FeedbackParseResult,
} from './report.js';
export { subjectKeyOf, listItemOf, reportPath, reportLocator, createRequest, resolveRequest } from './requests.js';
export type { FeedbackListItem, FeedbackRoot, FeedbackChange } from './requests.js';
export { readableElement, type ReadableElement } from './readable.js';
export { previewAnswerProblem, PREVIEW_LIMITS, type PreviewAnswer, type PreviewChange } from './preview.js';
