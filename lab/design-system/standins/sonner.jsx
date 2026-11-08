// Stand-in for sonner (an app dependency, not the kit's). The kit's own shadcn/ui/sonner.tsx is bundled for real and renders this Toaster, so its
// icons, token variables and offsets are the kit's. Only the toast renderer is small and local: a store, and a list in place of sonner's stack.
import { useSyncExternalStore } from 'react';

let toasts = [];
let counter = 0;
const listeners = new Set();
const emit = () => { toasts = [...toasts]; for (const listener of listeners) listener(); };

function push(type, message, options = {}) {
  counter += 1;
  toasts.push({ id: counter, type, message, description: options.description });
  if (toasts.length > 3) toasts.shift();
  emit();
  return counter;
}

export const toast = Object.assign((message, options) => push('default', message, options), {
  success: (message, options) => push('success', message, options),
  info: (message, options) => push('info', message, options),
  warning: (message, options) => push('warning', message, options),
  error: (message, options) => push('error', message, options),
  loading: (message, options) => push('loading', message, options),
  dismiss: () => { toasts = []; emit(); },
});

const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };

export function Toaster({ className, style, icons = {}, offset, toastOptions }) {
  const list = useSyncExternalStore(subscribe, () => toasts);
  const bottom = (offset && typeof offset === 'object' ? offset.bottom : offset) ?? 24;
  return (
    <ol
      data-sonner-toaster=""
      data-y-position="bottom"
      data-x-position="right"
      className={`${className ?? ''} flex flex-col gap-2`}
      style={{ position: 'fixed', right: 16, bottom, margin: 0, padding: 0, listStyle: 'none', width: 356, maxWidth: 'calc(100% - 32px)', ...style }}
    >
      {list.map(item => (
        <li
          key={item.id}
          data-sonner-toast=""
          data-type={item.type}
          className={`${toastOptions?.classNames?.toast ?? ''} flex items-start gap-3 border p-4 text-sm shadow-lg`}
          style={{ background: 'var(--normal-bg)', color: 'var(--normal-text)', borderColor: 'var(--normal-border)', borderRadius: 'var(--border-radius)' }}
        >
          {icons[item.type]}
          <div className="flex flex-col gap-0.5"><span className="font-medium">{item.message}</span>{item.description ? <span>{item.description}</span> : null}</div>
        </li>
      ))}
    </ol>
  );
}
