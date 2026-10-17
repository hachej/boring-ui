import type { ComponentPropsWithRef, ComponentType } from 'react';

/** Host presentation for the document renderers. Bindings must forward refs and native input events. */
export interface ViewerComponents {
  readonly button: ComponentType<ComponentPropsWithRef<'button'>>;
  readonly input: ComponentType<ComponentPropsWithRef<'input'>>;
  readonly textarea: ComponentType<ComponentPropsWithRef<'textarea'>>;
}
