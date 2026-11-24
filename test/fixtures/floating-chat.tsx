// Test helper: the one floating composer (`FloatingComposer`) opened on its conversation, taking a chat's props (`controller` and everything `PiChat` takes) plus the window-content
// props a host page adds (`artifactPanel`, `artifacts`, `artifactTarget`, `headerTools`, `headerActions`, `onDock`, `onOpenFull`, `onFeedback`, `embedded`). Fictional host.
import { FloatingComposer } from '../../registry/app-shell/floating-composer';
import { FLOATING_COMPOSER_PRESET } from '../../registry/app-shell/composer-config';
import type { FloatingComposerProps } from '../../registry/app-shell/floating-composer';
import type { AgentSpec } from '../../registry/app-shell/layer-context';

const OPEN = { ...FLOATING_COMPOSER_PRESET, defaultLevel: 'open', at: { remember: false } } as const;

export function FloatingChat({ controller, artifactPanel, artifacts, artifactTarget, headerTools, headerActions, onDock, onOpenFull, onFeedback, embedded, ...chatProps }: { readonly controller: AgentSpec['controller'] } & Partial<FloatingComposerProps> & Record<string, unknown>) {
  const host = { artifactPanel, artifacts, artifactTarget, headerTools, headerActions, onDock, onOpenFull, onFeedback, embedded };
  return <FloatingComposer agent={{ controller, chatProps: chatProps as AgentSpec['chatProps'] }} appId="fictional" composer={OPEN} {...host} />;
}
