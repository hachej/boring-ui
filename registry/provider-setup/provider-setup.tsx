'use client';

import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { CheckIcon, ChevronDownIcon, SettingsIcon } from 'lucide-react';
import { cn } from '../utils/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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

/** Only http(s) addresses become links; any other scheme is shown as text. */
function isWebLink(uri: string): boolean {
  try { return /^https?:$/.test(new URL(uri).protocol); } catch { return false; }
}

/** Popover for choosing a provider and model and giving access to it. Transport-agnostic: props in, callbacks out. */
export function ProviderSetup({ providers, value, onSave, onLogin, loginState = { state: 'idle' }, gatewayPlaceholder = 'https://…/gateway', showGateway = true,
  trigger, label = 'Model', side = 'bottom', align = 'end', defaultOpen = false, className }: ProviderSetupProps) {
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

  return <Popover defaultOpen={defaultOpen}>
    <PopoverTrigger render={<Button variant="ghost" data-testid="provider-setup-trigger" data-boring="provider-setup" className={cn(trigger ? 'contents' : 'max-w-56', className)} />}>
      {trigger ?? <><SettingsIcon data-icon="inline-start" aria-hidden="true" /><span className="truncate">{current ? `${current.name} · ${value.modelId}` : label}</span><ChevronDownIcon data-icon="inline-end" aria-hidden="true" /></>}
    </PopoverTrigger>
    <PopoverContent side={side} align={align} aria-label="Model access" data-testid="provider-setup-panel" className="pi-chat w-[min(24rem,calc(100vw-2rem))]">
      <form onSubmit={save} className="flex flex-col gap-3">
        <Label className="flex-col items-stretch">Provider
          <NativeSelect data-testid="provider-select" value={chosen.id} className="w-full"
            onChange={event => { const next = providers.find(item => item.id === event.target.value); if (!next) return; setProvider(next.id); setModelId(next.models[0]?.id ?? ''); setApiKey(''); setSaved(false); }}>
            {providers.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.name}{item.configured ? ' ✓' : ''}</NativeSelectOption>)}
          </NativeSelect></Label>
        <Label className="flex-col items-stretch">Model
          <NativeSelect data-testid="model-select" value={modelId} className="w-full" onChange={event => { setModelId(event.target.value); setSaved(false); }}>
            {models.map(model => <NativeSelectOption key={model.id} value={model.id}>{model.name ?? model.id}</NativeSelectOption>)}
          </NativeSelect></Label>

        {canKey && <Label className="flex-col items-stretch">
          <span className="flex items-center justify-between">API key{chosen.configured && <span data-testid="key-saved" className="inline-flex items-center gap-1 text-muted-foreground"><CheckIcon className="size-3" aria-hidden="true" />saved</span>}</span>
          <Input data-testid="api-key-input" type="password" autoComplete="off" spellCheck={false} value={apiKey}
            placeholder={chosen.configured ? '•••••••• (type to replace)' : 'Paste your key'} onChange={event => { setApiKey(event.target.value); setSaved(false); }} />
        </Label>}

        {canLogin && <div className="flex flex-col gap-2">
          <Button variant="outline" data-testid="provider-login" disabled={loginState.state === 'starting' || loginState.state === 'pending'} onClick={() => { void onLogin?.(chosen.id); }}>{chosen.loginLabel ?? `Sign in with ${chosen.name}`}{chosen.auth.includes('oauth') && chosen.configured && loginState.state === 'idle' ? ' again' : ''}</Button>
          {loginState.state === 'starting' && <p role="status" className="m-0 text-xs text-muted-foreground">Requesting a sign-in code…</p>}
          {loginState.state === 'pending' && <p role="status" data-testid="login-pending" className="m-0 text-sm">Open {isWebLink(loginState.verificationUri) ? <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 [overflow-wrap:anywhere]">{loginState.verificationUri}</a> : <span data-testid="login-uri" className="[overflow-wrap:anywhere]">{loginState.verificationUri}</span>} and enter
            <code data-testid="device-code" className="ms-1 bg-muted px-1.5 py-0.5 font-mono tracking-wider">{loginState.userCode}</code>
            <span className="mt-1 block text-xs text-muted-foreground">Waiting for you to approve…</span></p>}
          {loginState.state === 'done' && <p role="status" data-testid="login-done" className="m-0 inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckIcon className="size-3" aria-hidden="true" />Signed in</p>}
          {loginState.state === 'failed' && <p role="alert" data-testid="login-failed" className="m-0 text-xs text-destructive">{loginState.message}</p>}
        </div>}

        {showGateway && <Label className="flex-col items-stretch">Gateway (optional)
          <Input data-testid="gateway-input" value={gateway} placeholder={gatewayPlaceholder} onChange={event => { setGateway(event.target.value); setSaved(false); }} /></Label>}
        {chosen.needsGateway && <p data-testid="gateway-note" className={cn('m-0 text-xs', gatewayMissing ? 'text-foreground' : 'text-muted-foreground')}>
          {chosen.name} refuses model calls made directly from a web page. Set a gateway: a pass-through that adds no secrets.</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" data-testid="provider-save" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          {saved && <span role="status" data-testid="provider-saved" className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckIcon className="size-3" aria-hidden="true" />Saved</span>}
        </div>
        {error && <p role="alert" data-testid="provider-error" className="m-0 text-xs text-destructive">{error}</p>}
      </form>
    </PopoverContent>
  </Popover>;
}
