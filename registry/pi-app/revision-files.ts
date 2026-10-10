import { randomUUID } from '@hachej/boring-files/platform';
import type { FileTreeController } from '@hachej/boring-ui-kit/file-tree';
import type { UploadResult } from '../pi-chat/config';

function imageData(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

/**
 * What a chat upload may do. `inlineImages` also sends a png, jpeg, gif or webp as a native image in the message (off by default: the
 * file is saved and the message carries only its `@path`, which the agent reads with a tool, so no base64 rides along in every later
 * turn). `maxBytes` refuses a larger file before it is read or uploaded, with `tooLarge` as the reason shown beside the other failures.
 */
export interface AttachmentPolicy { readonly inlineImages?: boolean | undefined; readonly maxBytes?: number | undefined; readonly tooLarge?: string | undefined }

/**
 * Where a chat attachment is saved: its name with a short random suffix, so a second `image.png` (every pasted screenshot has that
 * name) or the same file attached again is a new file beside the first instead of a refused overwrite. The name has no whitespace,
 * because a chat mention ends at a space: each run of whitespace becomes `_`.
 */
export function attachmentPath(name: string): string {
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const safe = (part: string) => part.replace(/\s+/g, '_');
  return `uploads/${safe(stem)}-${randomUUID().slice(0, 8)}${safe(extension)}`;
}

/** Successful files remain attached when another file is refused; every outcome remains visible in the shared file tree. */
export async function uploadRevisionAttachments(controller: FileTreeController, files: readonly File[], signal: AbortSignal, onPreparationFailure?: (name: string, reason: string) => void, policy: AttachmentPolicy = {}): Promise<readonly UploadResult[]> {
  const uploaded: UploadResult[] = [];
  let reason = 'No files were saved. Open Files to review the uploads.';
  for (const file of files) {
    if (signal.aborted) break;
    if (policy.maxBytes !== undefined && file.size > policy.maxBytes) { reason = policy.tooLarge ?? 'The file is too large to attach.'; onPreparationFailure?.(file.name, reason); continue; }
    try {
      const path = attachmentPath(file.name), bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await controller.upload({ path, bytes, mediaType: file.type || 'application/octet-stream', signal });
      if (upload.state.kind === 'settled' && upload.state.result.kind === 'committed') {
        uploaded.push({ path, name: file.name, ...(policy.inlineImages && /^image\/(png|jpeg|gif|webp)$/.test(file.type) ? { image: { data: imageData(bytes), mimeType: file.type } } : {}) });
      } else if (upload.state.kind === 'settled' && 'reason' in upload.state.result) reason = upload.state.result.reason;
    } catch (error) { reason = error instanceof Error ? error.message : 'Upload failed'; onPreparationFailure?.(file.name, reason); }
  }
  if (!uploaded.length) throw new Error(reason);
  return uploaded;
}
