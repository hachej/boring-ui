'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, KeyRoundIcon, SettingsIcon } from 'lucide-react';
import { cn } from '../utils/utils';

/** One model a provider offers. */
export interface ProviderModel { readonly id: string; readonly name?: string }

/** One model provider the host has registered. The host decides the list; this component only displays it. */
export interface ProviderOption {
  readonly id: string;
  readonly name: string;
  readonly models: readonly ProviderModel[];
  /** How the person can authorize this provider: an API key, a subscription sign-in (device code), both or neither. */
  readonly auth: readonly ('api_key' | 'oauth')[];
  /** Credentials are already stored for this provider. */
  readonly configured: boolean;
  /** Browsers cannot call this provider directly; a gateway must be set. */
  readonly needsGateway?: boolean;
  /** Button text for the sign-in, such as "Sign in with ChatGPT". */
  readonly loginLabel?: string;
}

/** The current choice. */
export interface ProviderSetupValue { readonly provider: string; readonly modelId: string; readonly gateway?: string }

/** What the person asked to save. `apiKey` is present only when they typed one. */
export interface ProviderSetupChange { readonly provider: string; readonly modelId: string; readonly gateway: string; readonly apiKey?: string }

/** Progress of a device-code sign-in the host runs. */
export type ProviderLoginState =
  | { readonly state: 'idle' }
  | { readonly state: 'starting' }
  | { readonly state: 'pending'; readonly userCode: string; readonly verificationUri: string }
  | { readonly state: 'done' }
  | { readonly state: 'failed'; readonly message: string };

export interface ProviderSetupProps {
  readonly providers: readonly ProviderOption[];
  readonly value: ProviderSetupValue;
  /** Save the choice (and the key, when typed). Throw or reject with an Error to show its message. The component never fetches. */
  readonly onSave: (change: ProviderSetupChange) => void | Promise<void>;
  /** Start a subscription sign-in for one provider. Without it the sign-in button is hidden. */
  readonly onLogin?: (providerId: string) => void | Promise<void>;
  readonly loginState?: ProviderLoginState;
  /** Shown as the gateway field's placeholder. */
  readonly gatewayPlaceholder?: string;
  /** Hide the gateway field when the host has no gateway. */
  readonly showGateway?: boolean;
  /** Replaces the default trigger button. The popover anchors to it. */
  readonly trigger?: ReactNode;
  readonly label?: string;
  /** Where the panel opens relative to the trigger. */
  readonly side?: 'bottom' | 'top';
  readonly align?: 'start' | 'end';
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

const field = 'h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-base outline-none sm:text-sm placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:h-11 pointer-coarse:h-11';
const button = 'inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-45 max-sm:h-11 pointer-coarse:h-11';

/** Popover for choosing a provider and model and giving access to it. Transport-agnostic: props in, callbacks out. */
export function ProviderSetup({ providers, value, onSave, onLogin, loginState = { state: 'idle' }, gatewayPlaceholder = 'https://…/gateway', showGateway = true,
  trigger, label = 'Model', side = 'bottom', align = 'end', defaultOpen = false, className }: ProviderSetupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = providers.find(item => item.id === value.provider);
  const [provider, setProvider] = useState(value.provider);
  const [modelId, setModelId] = useState(value.modelId);
  const [gateway, setGateway] = useState(value.gateway ?? '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const chosen = providers.find(item => item.id === provider) ?? providers[0];

  // A new value from the host (after a save or a sign-in) replaces the form's draft.
  useEffect(() => { setProvider(value.provider); setModelId(value.modelId); setGateway(value.gateway ?? ''); }, [value.provider, value.modelId, value.gateway]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  if (!chosen) return null;
  const models = chosen.models.some(model => model.id === modelId) || !modelId ? chosen.models : [{ id: modelId }, ...chosen.models];
  const canKey = chosen.auth.includes('api_key'), canLogin = chosen.auth.includes('oauth') && onLogin !== undefined;
  const gatewayMissing = chosen.needsGateway === true && !gateway.trim();

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(undefined); setSaved(false);
    try {
      await onSave({ provider: chosen!.id, modelId, gateway: gateway.trim(), ...(apiKey ? { apiKey } : {}) });
      setApiKey(''); setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save.'); }
    finally { setSaving(false); }
  }

  return <div ref={root} data-boring="provider-setup" className={cn('provider-setup relative inline-block text-foreground', className)}>
    <button type="button" data-testid="provider-setup-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(!open)}
      className={trigger ? 'contents' : cn(button, 'border border-border bg-background hover:bg-muted max-w-56 truncate')}>
      {trigger ?? <><SettingsIcon className="size-3.5" aria-hidden="true" /><span className="truncate">{current ? `${current.name} · ${value.modelId}` : label}</span><ChevronDownIcon className="size-3.5" aria-hidden="true" /></>}
    </button>
    {open && <form id={`${id}-panel`} role="dialog" aria-label="Model access" data-testid="provider-setup-panel" onSubmit={save}
      className={cn('absolute z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg',
        side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2', align === 'end' ? 'right-0' : 'left-0')}>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Provider
        <select data-testid="provider-select" value={chosen.id} className={field}
          onChange={event => { const next = providers.find(item => item.id === event.target.value); if (!next) return; setProvider(next.id); setModelId(next.models[0]?.id ?? ''); setApiKey(''); setSaved(false); }}>
          {providers.map(item => <option key={item.id} value={item.id}>{item.name}{item.configured ? ' ✓' : ''}</option>)}
        </select></label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Model
        <select data-testid="model-select" value={modelId} className={field} onChange={event => { setModelId(event.target.value); setSaved(false); }}>
          {models.map(model => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}
        </select></label>

      {canKey && <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        <span className="flex items-center justify-between">API key{chosen.configured && <span data-testid="key-saved" className="inline-flex items-center gap-1 font-normal text-emerald-600 dark:text-emerald-400"><CheckIcon className="size-3" aria-hidden="true" />saved</span>}</span>
        <span className="relative flex items-center"><KeyRoundIcon className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
          <input data-testid="api-key-input" type="password" autoComplete="off" spellCheck={false} value={apiKey} className={cn(field, 'pl-8')}
            placeholder={chosen.configured ? '•••••••• (type to replace)' : 'Paste your key'} onChange={event => { setApiKey(event.target.value); setSaved(false); }} /></span>
      </label>}

      {canLogin && <div className="flex flex-col gap-2">
        <button type="button" data-testid="provider-login" disabled={loginState.state === 'starting' || loginState.state === 'pending'} onClick={() => { void onLogin?.(chosen.id); }}
          className={cn(button, 'border border-border bg-background hover:bg-muted')}>{chosen.loginLabel ?? `Sign in with ${chosen.name}`}{chosen.auth.includes('oauth') && chosen.configured && loginState.state === 'idle' ? ' again' : ''}</button>
        {loginState.state === 'starting' && <p role="status" className="m-0 text-xs text-muted-foreground">Requesting a sign-in code…</p>}
        {loginState.state === 'pending' && <p role="status" data-testid="login-pending" className="m-0 text-sm">Open <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 [overflow-wrap:anywhere]">{loginState.verificationUri}</a> and enter
          <strong data-testid="device-code" className="ms-1 rounded-md bg-muted px-1.5 py-0.5 font-mono tracking-wider">{loginState.userCode}</strong>
          <span className="mt-1 block text-xs text-muted-foreground">Waiting for you to approve…</span></p>}
        {loginState.state === 'done' && <p role="status" data-testid="login-done" className="m-0 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckIcon className="size-3" aria-hidden="true" />Signed in</p>}
        {loginState.state === 'failed' && <p role="alert" data-testid="login-failed" className="m-0 text-xs text-destructive">{loginState.message}</p>}
      </div>}

      {showGateway && <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">Gateway (optional)
        <input data-testid="gateway-input" value={gateway} placeholder={gatewayPlaceholder} className={field} onChange={event => { setGateway(event.target.value); setSaved(false); }} /></label>}
      {chosen.needsGateway && <p data-testid="gateway-note" className={cn('m-0 text-xs', gatewayMissing ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
        {chosen.name} refuses model calls made directly from a web page. Set a gateway: a pass-through that adds no secrets.</p>}

      <div className="flex items-center gap-3">
        <button type="submit" data-testid="provider-save" disabled={saving} className={cn(button, 'bg-primary text-primary-foreground hover:bg-primary/90')}>{saving ? 'Saving…' : 'Save'}</button>
        {saved && <span role="status" data-testid="provider-saved" className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckIcon className="size-3" aria-hidden="true" />Saved</span>}
      </div>
      {error && <p role="alert" data-testid="provider-error" className="m-0 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
    </form>}
  </div>;
}
