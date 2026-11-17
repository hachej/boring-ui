'use client';

// The shell's file chips: a file the agent cites (`@path` in a reply, or in the folded card's row) as a small outline button that opens it in the pane,
// and the app's reply action as the same kind of button. One opener (`openFile`) for the card, the tray, the docked column and the bar.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FileTextIcon } from '../_shared/icons';
import { Button } from '@/components/ui/button';
import { cn } from '../utils/utils';
import type { AgentSpec } from './layer-context';

type Files = AgentSpec['files'];
type Kinds = AgentSpec['fileKinds'];

/** A cited path the kit can open: not an app mention (`prefix:path`) and not an upload card. */
export const isCitedFile = (path: string) => !/^[a-z][\w-]*:/i.test(path);

// Paths a provider has already answered for; only a found file is remembered (a file the agent writes later is looked up again).
const found = new WeakMap<object, Set<string>>();
const lookups = new WeakMap<object, Map<string, Promise<boolean>>>();
function exists(files: NonNullable<Files>, path: string): Promise<boolean> {
  const pending = lookups.get(files) ?? new Map<string, Promise<boolean>>();
  lookups.set(files, pending);
  let lookup = pending.get(path);
  if (!lookup) {
    lookup = (files.exists ? files.exists(path) : files.read(path).then(() => true)).catch(() => false).then(ok => { pending.delete(path); return ok; });
    pending.set(path, lookup);
  }
  return lookup;
}

/** True once the workspace has the file, false when it has not, undefined while it is asked. Without `files` the app opens it itself: true. */
export function useFileFound(files: Files, path: string): boolean | undefined {
  const known = files ? (found.get(files) ?? found.set(files, new Set()).get(files)!) : undefined;
  const [answer, setAnswer] = useState<{ readonly files: Files; readonly path: string; readonly ok: boolean }>();
  const settled = !files || known?.has(path);
  useEffect(() => {
    if (!files || !known || known.has(path)) return;
    let live = true;
    void exists(files, path).then(ok => { if (ok) known.add(path); if (live) setAnswer({ files, path, ok }); });
    return () => { live = false; };
  }, [files, known, path]);
  return settled ? true : answer?.files === files && answer.path === path ? answer.ok : undefined;
}

/** The kind's icon (the Library's: `agent.fileKinds`), else a plain file. */
export function fileIcon(kinds: Kinds, path: string): ReactNode {
  const kind = kinds?.find(candidate => { try { return candidate.match({ resource: { path } }); } catch { return false; } });
  const Icon = kind?.icon ?? FileTextIcon;
  return <span data-icon="inline-start" aria-hidden="true" className="contents"><Icon aria-hidden="true" /></span>;
}

export const basename = (path: string) => path.split('/').at(-1) || path;

/**
 * A cited file as a button: its kind's icon and its name, the full path in the tooltip. `inline` sits in a line of text (the reply, a pill);
 * otherwise it is a card button. Unfound, a card chip goes and an inline one is plain text.
 */
export function FileChip({ path, files, kinds, onOpen, label, inline = false, testid, text }: {
  readonly path: string; readonly files: Files; readonly kinds: Kinds; readonly onOpen: ((path: string) => void) | undefined; readonly label?: string;
  readonly inline?: boolean; readonly testid: string; readonly text?: string;
}) {
  const state = useFileFound(files, path);
  if (state !== true) return inline ? <span data-testid={testid} data-path={path} className="font-medium">{text ?? `@${path}`}</span> : null;
  return <Button type="button" variant="outline" size="sm" data-testid={testid} data-path={path} data-file-chip="" title={path} {...(label ? { 'aria-label': label } : {})} disabled={!onOpen} onClick={() => onOpen?.(path)}
    className={cn(inline && 'mx-0.5 inline-flex max-w-full rounded-(--radius-3xl) align-middle')}>
    {fileIcon(kinds, path)}<span className="min-w-0 truncate">{basename(path)}</span></Button>;
}

/** The app's reply action (`agent.replyAction`): an outline button with its own icon, named by its label. */
export function ReplyActionButton({ action, testid, className }: { readonly action: NonNullable<AgentSpec['replyAction']>; readonly testid: string; readonly className?: string }) {
  return <Button type="button" variant="outline" size="sm" data-testid={testid} onClick={action.onSelect} className={className}>
    {action.icon ? <span data-icon="inline-start" aria-hidden="true" className="contents">{action.icon}</span> : null}{action.label}</Button>;
}
