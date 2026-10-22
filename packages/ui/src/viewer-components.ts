import type { ComponentPropsWithRef, ComponentType, PropsWithChildren } from 'react';

export interface MarkdownEditorMenuLabels {
  readonly moreActions: string;
  readonly editorMode: string;
  readonly formatted: string;
  readonly markdown: string;
  readonly showOutline: string;
}

/** Presentation-only choices; none edits or publishes the document. */
export interface MarkdownEditorMenuProps {
  readonly labels: MarkdownEditorMenuLabels;
  readonly mode: 'rich' | 'source';
  readonly onModeChange: (mode: 'rich' | 'source') => void;
  readonly richDisabledReason?: string | undefined;
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
  /** Header formatting toggle: a ghost icon button with native aria-pressed semantics. */
  readonly formattingControl?: ComponentType<ComponentPropsWithRef<'button'>>;
  /** The host's separator: vertical between toolbar groups, horizontal above the phone formatting bar. */
  readonly separator?: ComponentType<{ readonly orientation?: 'horizontal' | 'vertical'; readonly className?: string }>;
}
