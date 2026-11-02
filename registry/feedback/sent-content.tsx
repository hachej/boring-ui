'use client';

// pi-chat's `sentContent` seam, filled: a sent page-comments report shows as its card instead of the raw report.
import type { SentContent } from '../pi-chat/config';
import { feedbackContent } from './feedback-content';
import { SentFeedback } from './sent-feedback';

export const sentFeedbackContent: SentContent = (text, align) => {
  const found = feedbackContent(text);
  return found && { before: found.before, after: found.after, node: <SentFeedback report={found.report} align={align} /> };
};
