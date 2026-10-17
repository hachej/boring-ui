import type { ComponentPropsWithRef, ComponentType, PropsWithChildren } from 'react';

/** Host presentation for the document renderers. Bindings must forward refs and native input events. */
export interface ViewerComponents {
  readonly button: ComponentType<ComponentPropsWithRef<'button'>>;
  readonly input: ComponentType<ComponentPropsWithRef<'input'>>;
  readonly textarea: ComponentType<ComponentPropsWithRef<'textarea'>>;
  readonly bubble?: ComponentType<PropsWithChildren>;
  /** The host's separator: vertical between toolbar groups, horizontal above the phone formatting bar. */
  readonly separator?: ComponentType<{ readonly orientation?: 'horizontal' | 'vertical'; readonly className?: string }>;
}
