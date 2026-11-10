'use client';

import type { ComponentProps, ReactNode } from 'react';
import { AlertCircleIcon, FileTextIcon, Loader2Icon, XIcon } from './icons';
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentMedia, AttachmentTitle } from '@/components/ui/attachment';

// The chips above a composer's text, shared by the `Composer` of `pi-chat` and the `AgentBar` of `agent-bar` (D-2084): one source for how an upload on its way,
// a failed one and an attached file look and are removed. The words come from the caller (`ChipWords`), so each surface keeps its own labels.

const SAFE_IMAGE = /^image\/(png|jpe?g|gif|webp)$/;
const BASE64 = /^[A-Za-z0-9+/=\s]+$/;
/** A data URL for a thumbnail, only for common image types and well-formed base64. */
export function thumbnail(mimeType: string, data: string): string | undefined {
  return SAFE_IMAGE.test(mimeType) && BASE64.test(data) ? `data:${mimeType};base64,${data}` : undefined;
}

/** What the lists below say; `pi-chat` passes its `labels`, `agent-bar` its own. */
export interface ChipWords {
  readonly uploads: string;
  readonly attachments: string;
  readonly uploading: (name: string) => string;
  readonly uploadFailed: (name: string, error?: string) => string;
  readonly restorePaste: string;
  readonly dismiss: (name: string) => string;
  readonly remove: (name: string) => string;
}
export interface UploadChip {
  readonly id: string; readonly name: string; readonly state: 'uploading' | 'failed'; readonly error?: string;
  readonly cancel?: (() => void) | undefined;
}
export interface AttachedChip { readonly id: string; readonly name: string; readonly mimeType: string; readonly data: string }

/**
 * One chip above the text (a mention, an upload, an attachment or the notes count) as the host's shadcn Attachment. The remove
 * buttons keep a 44px touch target on coarse pointers; negative margins let it extend beyond the chip instead of growing it.
 */
export function Chip({ media, image = false, label, actions, ...props }: ComponentProps<typeof Attachment> & { readonly media: ReactNode; readonly image?: boolean; readonly label: ReactNode; readonly actions?: ReactNode }) {
  return <Attachment size="xs" role="listitem" {...props}>
    <AttachmentMedia variant={image ? 'image' : 'icon'}>{media}</AttachmentMedia>
    <AttachmentContent><AttachmentTitle>{label}</AttachmentTitle></AttachmentContent>
    {actions && <AttachmentActions className="max-md:-my-2.5 pointer-coarse:-my-2.5">{actions}</AttachmentActions>}
  </Attachment>;
}

export function RemoveChip({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return <AttachmentAction aria-label={label} title={label} onClick={onClick}><XIcon aria-hidden="true" /></AttachmentAction>;
}

/** Uploads on their way or failed: a spinner or an alert, a cancel for a pasted text, a dismiss for a failure. */
export function UploadChips({ items, words, onDismiss }: { readonly items: readonly UploadChip[]; readonly words: ChipWords; readonly onDismiss?: ((id: string) => void) | undefined }) {
  if (items.length === 0) return null;
  return <div role="list" data-testid="uploads" aria-label={words.uploads} className="contents">
    {items.map(item => <Chip key={item.id} data-testid="upload-chip" state={item.state === 'failed' ? 'error' : 'uploading'} data-state={item.state} title={item.error ?? item.name} className="max-w-full md:max-w-[20rem]"
      media={item.state === 'failed' ? <AlertCircleIcon className="text-destructive" aria-hidden="true" /> : <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      label={item.state === 'failed' ? words.uploadFailed(item.name, item.error) : words.uploading(item.name)}
      actions={<>
        {item.cancel && <RemoveChip label={words.restorePaste} onClick={() => item.cancel!()} />}
        {item.state === 'failed' && <RemoveChip label={words.dismiss(item.name)} onClick={() => onDismiss?.(item.id)} />}
      </>} />)}
  </div>;
}

/** Files attached to the next message: a thumbnail for a safe image, a file icon otherwise, and a remove button. */
export function AttachmentChips({ items, words, onRemove }: { readonly items: readonly AttachedChip[]; readonly words: ChipWords; readonly onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return <div role="list" data-testid="attachments" aria-label={words.attachments} className="contents">
    {items.map(attachment => {
      const src = thumbnail(attachment.mimeType, attachment.data);
      return <Chip key={attachment.id} data-testid="attachment" className="max-w-full md:max-w-[14rem]" image={!!src}
        media={src ? <img src={src} alt="" /> : <FileTextIcon aria-hidden="true" />} label={attachment.name}
        actions={<RemoveChip label={words.remove(attachment.name)} onClick={() => onRemove(attachment.id)} />} />;
    })}
  </div>;
}
