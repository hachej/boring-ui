import { useRef, useState, type ComponentProps, type DragEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '../utils/utils';

/** Why a file was not delivered: `type` (not in `accept`), `size` (over `maxSize`), `count` (a second file while `multiple` is off). The app renders the words. */
export type FilePickRefusalReason = 'type' | 'size' | 'count';
export type FilePickRefusal = { file: File; reason: FilePickRefusalReason };

export type FilePickLabels = { dropHint: string; dropHintMore: string };
export const filePickLabels: FilePickLabels = { dropHint: 'or drop a file here', dropHintMore: 'or drop files here' };

export type FilePickProps = {
  /** The accepted files, after every check. Not called when nothing was accepted. */
  onFiles: (files: File[]) => void;
  /** The refused files, one entry each with a reason code. Not called when nothing was refused. Picks and drops are checked the same way. */
  onRefused?: (refused: FilePickRefusal[]) => void;
  /** The native `accept` list: `image/*`, `application/pdf`, `.csv`, comma-separated. Also applied to what is picked or dropped, since a browser's picker can be switched to "all files". Empty: any file. */
  accept?: string;
  /** Several files at once. Off: only the first accepted file is delivered and the others are refused as `count`. */
  multiple?: boolean;
  /** Largest file in bytes; a larger one is refused as `size`. */
  maxSize?: number;
  disabled?: boolean;
  /** Working: the Button shows the kit's spinner and neither a pick nor a drop is taken. */
  busy?: boolean;
  /** The Button's own variant and size, passed through. */
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  /** Draws a dashed drop strip with the Button inside. Without it, the Button alone. */
  drop?: boolean;
  /** The line under the Button in drop mode; replaces `labels.dropHint`. */
  hint?: ReactNode;
  labels?: Partial<FilePickLabels>;
  /** The Button's label, and its accessible name. */
  children: ReactNode;
  className?: string;
};

/** Does `file` match an `accept` list: `.ext` (any case), `type/*` and an exact MIME type. */
export function acceptsFile(file: File, accept?: string): boolean {
  const tokens = (accept ?? '').split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
  if (tokens.length === 0) return true;
  const name = file.name.toLowerCase(); const type = file.type.toLowerCase();
  return tokens.some(token => token.startsWith('.') ? name.endsWith(token) : token.endsWith('/*') ? type.startsWith(token.slice(0, -1)) : type === token);
}

/** Splits what came in into accepted and refused. A file failing both type and size is refused as `type`. */
export function sortFiles(files: readonly File[], { accept, multiple, maxSize }: Pick<FilePickProps, 'accept' | 'multiple' | 'maxSize'>): { accepted: File[]; refused: FilePickRefusal[] } {
  const accepted: File[] = []; const refused: FilePickRefusal[] = [];
  for (const file of files) {
    if (!acceptsFile(file, accept)) refused.push({ file, reason: 'type' });
    else if (maxSize !== undefined && file.size > maxSize) refused.push({ file, reason: 'size' });
    else if (!multiple && accepted.length > 0) refused.push({ file, reason: 'count' });
    else accepted.push(file);
  }
  return { accepted, refused };
}

/** A hidden file input behind a Button, optionally inside a dashed drop strip. The Button is the one control (keyboard, touch, accessible name); the strip is a drop target only. The input is reset after every pick, so the same file can be picked twice. */
export function FilePick({ onFiles, onRefused, accept, multiple = false, maxSize, disabled = false, busy = false, variant, size, drop = false, hint, labels, children, className }: FilePickProps) {
  const t = { ...filePickLabels, ...labels };
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const idle = !disabled && !busy;
  const deliver = (files: readonly File[]) => {
    const { accepted, refused } = sortFiles(files, { accept, multiple, maxSize });
    if (accepted.length > 0) onFiles(accepted);
    if (refused.length > 0) onRefused?.(refused);
  };
  const button = (
    <Button type="button" variant={variant} size={size} disabled={!idle} aria-busy={busy || undefined} className={drop ? undefined : className} onClick={() => input.current?.click()}>
      {busy ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
      {children}
    </Button>
  );
  // The span clips the input: Input's own width and height classes would otherwise beat `sr-only` and widen the page.
  const field = (
    <span className="sr-only" aria-hidden="true">
      <Input ref={input} type="file" accept={accept} multiple={multiple} disabled={!idle} tabIndex={-1} aria-hidden="true" data-testid="file-pick-input"
        onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (idle) deliver(files); }} />
    </span>
  );
  if (!drop) return <>{button}{field}</>;
  const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  return (
    <div data-boring="file-pick-drop" data-drag-over={over} aria-busy={busy || undefined}
      className={cn('flex w-full min-w-0 flex-col items-center gap-2 p-4 text-center', className)}
      onDragEnter={event => { if (idle && carriesFiles(event)) { event.preventDefault(); setOver(true); } }}
      onDragOver={event => { if (carriesFiles(event)) { event.preventDefault(); if (idle) setOver(true); } }}
      onDragLeave={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setOver(false); }}
      onDrop={event => { if (!carriesFiles(event)) return; event.preventDefault(); setOver(false); if (idle) deliver(Array.from(event.dataTransfer.files)); }}>
      {button}
      <span className="text-xs text-muted-foreground">{hint ?? (multiple ? t.dropHintMore : t.dropHint)}</span>
      {field}
    </div>
  );
}
