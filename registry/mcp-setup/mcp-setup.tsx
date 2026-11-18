'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, PlugIcon } from '../_shared/icons';
import { copyText, withDefaults } from '../utils/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** One assistant and how to add the app to it: one sentence per step, and an optional terminal command shown with its own copy button. */
export type McpClient = { readonly id: string; readonly name: string; readonly steps: readonly string[]; readonly command?: string };

export type McpSetupLabels = {
  readonly trigger: string;
  readonly title: (app: string) => string;
  readonly intro: (app: string) => string;
  readonly address: string;
  readonly copy: string;
  readonly copied: string;
  /** Shown when no clipboard route worked: the address stays selectable on screen. */
  readonly copyFailed: string;
  readonly signIn: (app: string) => string;
};

export const mcpSetupLabels: Record<'fr' | 'en', McpSetupLabels> = {
  fr: { trigger: 'Connecter un assistant', title: app => `Connecter votre assistant à ${app}`, intro: app => `Votre assistant (Claude, ChatGPT…) pourra lire et agir dans ${app} à votre place.`,
    address: 'Adresse à copier dans votre assistant', copy: 'Copier', copied: 'Copié', copyFailed: 'Sélectionnez le texte et copiez-le',
    signIn: app => `Aucune clé à copier : votre assistant vous demandera de vous connecter avec votre compte ${app}.` },
  en: { trigger: 'Connect an assistant', title: app => `Connect your assistant to ${app}`, intro: app => `Your assistant (Claude, ChatGPT…) can then read and act in ${app} for you.`,
    address: 'Address to paste into your assistant', copy: 'Copy', copied: 'Copied', copyFailed: 'Select the text and copy it',
    signIn: app => `No key to copy: your assistant will ask you to sign in with your ${app} account.` },
};

const slug = (app: string) => app.normalize('NFD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'app';

/** The default steps for Claude (claude.ai and Desktop), ChatGPT, Claude Code and any other assistant, in French or English. */
export function defaultMcpClients(app: string, address: string, locale: 'fr' | 'en' = 'fr'): McpClient[] {
  const fr = locale === 'fr';
  return [
    { id: 'claude', name: 'Claude', steps: fr
      ? ['Sur claude.ai ou dans Claude Desktop, ouvrez Paramètres › Connecteurs.', `Choisissez « Ajouter un connecteur personnalisé », nommez-le ${app} et collez l’adresse.`]
      : ['On claude.ai or in Claude Desktop, open Settings › Connectors.', `Choose "Add custom connector", name it ${app} and paste the address.`] },
    { id: 'chatgpt', name: 'ChatGPT', steps: fr
      ? ['Ouvrez Paramètres › Applis et connecteurs, puis activez le mode développeur dans les paramètres avancés.', `Choisissez « Créer », nommez-le ${app} et collez l’adresse.`]
      : ['Open Settings › Apps & Connectors, then turn on developer mode in the advanced settings.', `Choose "Create", name it ${app} and paste the address.`] },
    { id: 'claude-code', name: 'Claude Code', command: `claude mcp add --transport http ${slug(app)} ${address}`, steps: fr
      ? ['Pour Claude Code seulement : dans un terminal, lancez cette commande, puis tapez /mcp dans Claude Code.']
      : ['For Claude Code only: run this command in a terminal, then type /mcp in Claude Code.'] },
    { id: 'other', name: fr ? 'Autre' : 'Other', steps: fr
      ? ['Tout assistant qui accepte un connecteur distant : collez l’adresse dans ses réglages de connecteurs.']
      : ['Any assistant that accepts a remote connector: paste the address in its connector settings.'] },
  ];
}

function Copy({ text, labels }: { readonly text: string; readonly labels: McpSetupLabels }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => { if (state === 'idle') return; const timer = setTimeout(() => setState('idle'), 2000); return () => clearTimeout(timer); }, [state]);
  return <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => { copyText(text).then(() => setState('copied'), () => setState('failed')); }}>
    {state === 'copied' ? <CheckIcon data-icon="inline-start" aria-hidden="true" /> : <CopyIcon data-icon="inline-start" aria-hidden="true" />}
    <span aria-live="polite">{state === 'copied' ? labels.copied : state === 'failed' ? labels.copyFailed : labels.copy}</span>
  </Button>;
}

export type McpSetupProps = {
  /** The app's MCP address, exactly as an assistant must call it (`${location.origin}/mcp`). */
  readonly address: string;
  /** The app's name, as people know it. */
  readonly appName: string;
  /** The assistants and their steps. Default: `defaultMcpClients(appName, address, locale)`. */
  readonly clients?: readonly McpClient[];
  /** The sign-in sentence: on (default) when the MCP route asks the assistant to sign the person in; off for an app without sign-in. */
  readonly signIn?: boolean;
  readonly locale?: 'fr' | 'en';
  readonly labels?: Partial<McpSetupLabels>;
  /** Replaces the trigger's icon. */
  readonly icon?: ReactNode;
};

/** An icon button for the top right of an app's header; it opens a popover on how to connect a person's own assistant to the app over MCP. */
export function McpSetup({ address, appName, clients, signIn = true, locale = 'fr', labels: given, icon }: McpSetupProps) {
  const labels = withDefaults(mcpSetupLabels[locale], given);
  const list = clients ?? defaultMcpClients(appName, address, locale);
  const [chosen, setChosen] = useState(list[0]?.id);
  const client = list.find(item => item.id === chosen) ?? list[0];
  return <Popover>
    <PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={labels.trigger} title={labels.trigger} data-testid="mcp-setup-trigger" />}>
      {icon ?? <PlugIcon data-icon="inline-start" aria-hidden="true" />}
    </PopoverTrigger>
    {/* Focus goes back to the icon only after a keyboard close: after a click or a tap the icon stays a plain ghost button, without a focus ring. */}
    <PopoverContent align="end" finalFocus={type => type === 'keyboard'} aria-label={labels.title(appName)} data-testid="mcp-setup" className="w-[min(26rem,calc(100vw-2rem))] max-h-[min(36rem,80dvh)] gap-4 overflow-y-auto">
      <div className="flex flex-col gap-1">
        <p className="m-0 font-semibold">{labels.title(appName)}</p>
        <p className="m-0 text-muted-foreground">{labels.intro(appName)}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-xs text-muted-foreground">{labels.address}</p>
        <div className="flex min-w-0 items-center gap-2">
          <code data-testid="mcp-setup-address" className="min-w-0 flex-1 truncate bg-muted px-2 py-1.5 font-mono text-xs select-all" title={address}>{address}</code>
          <Copy text={address} labels={labels} />
        </div>
      </div>
      {list.length > 1 && <div role="group" aria-label={labels.trigger} className="flex flex-wrap gap-1">
        {list.map(item => <Button key={item.id} type="button" size="sm" variant={item.id === client?.id ? 'secondary' : 'ghost'} aria-pressed={item.id === client?.id} onClick={() => setChosen(item.id)}>{item.name}</Button>)}
      </div>}
      {client && <div className="flex flex-col gap-2" data-testid="mcp-setup-steps">
        <ol className="m-0 flex list-decimal flex-col gap-1.5 ps-5">{client.steps.map(step => <li key={step}>{step}</li>)}</ol>
        {client.command && <div className="flex min-w-0 items-start gap-2">
          <code className="min-w-0 flex-1 bg-muted px-2 py-1.5 font-mono text-xs break-all select-all">{client.command}</code>
          <Copy text={client.command} labels={labels} />
        </div>}
      </div>}
      {signIn && <p className="m-0 text-xs text-muted-foreground">{labels.signIn(appName)}</p>}
    </PopoverContent>
  </Popover>;
}
