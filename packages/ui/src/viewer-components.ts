import type { ComponentPropsWithRef, ComponentType, PropsWithChildren } from 'react';

export interface MarkdownEditorMenuLabels {
  readonly moreActions: string;
  readonly editorMode: string;
  readonly formatted: string;
  readonly markdown: string;
  readonly showFormattingBar: string;
  readonly showOutline: string;
}

/** Presentation-only choices; none edits or publishes the document. */
export interface MarkdownEditorMenuProps {
  readonly labels: MarkdownEditorMenuLabels;
  readonly mode: 'rich' | 'source';
  readonly onModeChange: (mode: 'rich' | 'source') => void;
  readonly richDisabledReason?: string | undefined;
  readonly formattingToolbar: 'selection' | 'pinned';
  readonly onFormattingToolbarChange: (toolbar: 'selection' | 'pinned') => void;
  readonly outline?: { readonly shown: boolean; readonly onChange: (shown: boolean) => void } | undefined;
  readonly testId?: string | undefined;
}

/** Host presentation for the document renderers. Bindings must forward refs and native input events. */
export interface ViewerComponents {
  readonly button: ComponentType<ComponentPropsWithRef<'button'>>;
  readonly input: ComponentType<ComponentPropsWithRef<'input'>>;
  readonly textarea: ComponentType<ComponentPropsWithRef<'textarea'>>;
  readonly bubble?: ComponentType<PropsWithChildren>;
  readonly markdownMenu?: ComponentType<MarkdownEditorMenuProps>;
  /** The host's separator: vertical between toolbar groups, horizontal above the phone formatting bar. */
  readonly separator?: ComponentType<{ readonly orientation?: 'horizontal' | 'vertical'; readonly className?: string }>;
}
