// PointButton: enters pick mode on the application root. Picking itself (events captured and stopped, keys, touch, labels) is
// `createPicker` from `@hachej/boring-feedback/page`; this file is the button and the hint people see while they point.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPicker, type Picker, type PickerOverlay, type PickerState, type PrivacyPolicy } from '@hachej/boring-feedback/page';

export interface PointButtonProps {
  /** The application root; only elements inside it can be picked. */
  readonly root: () => Element | null;
  readonly policy: PrivacyPolicy;
  /** The page's shared overlay (`usePickerOverlay`). */
  readonly overlay: PickerOverlay | undefined;
  /** Called with the pinned elements; the overlay still shows them. */
  readonly onPinned: (elements: readonly Element[]) => void;
  readonly onCancel?: () => void;
  /** Shift-click pins several elements. Default true. */
  readonly multiple?: boolean;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function PointButton({ root, policy, overlay, onPinned, onCancel, multiple = true, children = 'Point', className }: PointButtonProps) {
  const picker = useRef<Picker | null>(null);
  const [state, setState] = useState<PickerState | null>(null);
  const callbacks = useRef({ onPinned, onCancel });
  callbacks.current = { onPinned, onCancel };
  useEffect(() => () => { picker.current?.dispose(); picker.current = null; }, []);

  const picking = state?.mode === 'picking';
  const toggle = (): void => {
    if (picking) { picker.current?.cancel(); return; }
    const element = root();
    if (!element || !overlay) return;
    picker.current?.dispose();
    const created = createPicker({ root: element, policy, overlay, multiple, onChange: setState });
    picker.current = created;
    void created.start().then(result => {
      if (result.kind === 'pinned') callbacks.current.onPinned(result.elements);
      else callbacks.current.onCancel?.();
    });
  };

  return <span data-boring="feedback" data-feedback-ignore="" className={['boring-feedback-point', className].filter(Boolean).join(' ')}>
    <button type="button" data-testid="feedback-point" aria-pressed={picking} disabled={!overlay} onClick={toggle} className="boring-feedback-button">
      {picking ? 'Cancel' : children}
    </button>
    {picking && <span role="status" aria-live="polite" data-testid="feedback-point-hint" className="boring-feedback-hint">
      {state?.label ?? state?.refusal ?? 'Point at an element'}
      <span className="boring-feedback-keys"> · Click to pin{multiple ? ', Shift-click for several' : ''} · ↑ parent ↓ child · Esc</span>
    </span>}
  </span>;
}
