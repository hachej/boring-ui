import { isHostObserved, parseFeedback } from '@hachej/boring-feedback/format';
import type { FeedbackReport } from '@hachej/boring-feedback/format';

function pageReport(text: string): FeedbackReport | undefined {
  if (!text.startsWith('---\n')) return;
  const parsed = parseFeedback(new TextEncoder().encode(text));
  if (parsed.ok && isHostObserved(parsed.report.observed) && parsed.report.notes?.some(note => note.text.trim())) return parsed.report;
}

/** Only presentation changes: the native message retains the complete report and any words around its composer fence. */
export function feedbackContent(text: string): { readonly before: string; readonly after: string; readonly report: FeedbackReport } | undefined {
  const report = pageReport(text);
  if (report) return { before: '', after: '', report };
  let open: { fence: string; start: number; body: number; report: boolean } | undefined;
  // Track other code fences too: a report quoted inside an example is still ordinary user text.
  for (const line of text.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)(?:\n|$)/gm)) {
    const fence = line[1]!, info = line[2]!;
    if (!open) {
      open = { fence, start: line.index, body: line.index + line[0].length, report: line[0].startsWith('`') && info === 'markdown' };
    } else if (fence[0] === open.fence[0] && fence.length >= open.fence.length && !info.trim()) {
      const parsed = open.report ? pageReport(text.slice(open.body, line.index)) : undefined;
      if (parsed) return { before: text.slice(0, open.start).trim(), after: text.slice(line.index + line[0].length).trim(), report: parsed };
      open = undefined;
    }
  }
}
