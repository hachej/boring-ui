import type { ViewerFeature } from '@hachej/boring-ui-kit';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import type { HtmlController } from '@hachej/boring-ui-kit/html';
import { createCanvasController } from '@hachej/boring-ui-kit/canvas';
import type { ExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';
import type { TextDraftActions, TextDraftChoiceSelection, TextDraftRecoveryState } from '@hachej/boring-ui-kit/text-buffer';
import type { SaveResult } from '@hachej/boring-ui-kit/resources';

declare const markdown: ViewerFeature<{ kind: 'markdown'; version: 1 }, MarkdownController>;
declare const html: HtmlController;
declare const canvas: ReturnType<typeof createCanvasController>;
declare const experience: ExperienceDocumentController;
declare const choice: TextDraftChoiceSelection;

const editor = markdown.createController({ kind: 'markdown', version: 1 });
for (const controller of [editor, html, canvas, experience]) {
  const actions: TextDraftActions = controller.actions;
  const recovery: TextDraftRecoveryState = controller.getSnapshot().recovery;
  const save: Promise<SaveResult> = controller.flush(controller.actions.selection());
  void actions.restoreDraft(choice);
  void actions.discardDraft(choice);
  void actions.checkpointDraft();
  void recovery;
  void save;
}
void editor.actions.propose(editor.actions.selection(), [{ find: 'before', replace: 'after' }]);
void canvas.tools.inspect.invoke(canvas.actions.selection().target, { expiresAt: Date.now() + 1000 });
void experience.actions.pin(experience.actions.selection());
