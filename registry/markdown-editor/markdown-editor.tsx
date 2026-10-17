'use client';

import { MarkdownEditor as RuntimeMarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';
import type { MarkdownEditorProps } from '@hachej/boring-ui-kit/markdown-editor';
import { editorControls } from '../button/editor-controls';

export type { MarkdownEditorProps } from '@hachej/boring-ui-kit/markdown-editor';

export function MarkdownEditor({ className, ...props }: MarkdownEditorProps) {
  return <RuntimeMarkdownEditor components={editorControls} {...props} className={['boring-markdown-recipe', className].filter(Boolean).join(' ')} />;
}
