import type { FileTreeController } from '@hachej/boring-ui-kit/file-tree';
import type { UploadResult } from '../pi-chat/config';

function imageData(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

/** Successful files remain attached when another file is refused; every outcome remains visible in the shared file tree. */
export async function uploadRevisionAttachments(controller: FileTreeController, files: readonly File[], signal: AbortSignal, onPreparationFailure?: (name: string, reason: string) => void): Promise<readonly UploadResult[]> {
  const uploaded: UploadResult[] = [];
  let reason = 'No files were saved. Open Files to review the uploads.';
  for (const file of files) {
    if (signal.aborted) break;
    try {
      const path = `uploads/${file.name}`, bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await controller.upload({ path, bytes, mediaType: file.type || 'application/octet-stream', signal });
      if (upload.state.kind === 'settled' && upload.state.result.kind === 'committed') {
        uploaded.push({ path, name: file.name, ...(/^image\/(png|jpeg|gif|webp)$/.test(file.type) ? { image: { data: imageData(bytes), mimeType: file.type } } : {}) });
      } else if (upload.state.kind === 'settled' && 'reason' in upload.state.result) reason = upload.state.result.reason;
    } catch (error) { reason = error instanceof Error ? error.message : 'Upload failed'; onPreparationFailure?.(file.name, reason); }
  }
  if (!uploaded.length) throw new Error(reason);
  return uploaded;
}
