'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RevisionProvider } from '@hachej/boring-files/revision';
import { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
import type { FileTreeController } from '@hachej/boring-ui-kit/file-tree';
import type { AttachmentsConfig } from '../pi-chat/config';
import { uploadRevisionAttachments } from './revision-files';

export interface RevisionAttachmentsOptions {
  /** The workspace the files are saved in, under `uploads/`. Absent: no attachments. */
  readonly revisionProvider?: RevisionProvider | undefined;
  /**
   * The tree controller to save through. `AgentWorkspace` passes its Library's, so the page keeps one per workspace. Absent: the hook makes
   * one from `revisionProvider` and disposes it with the binding.
   */
  readonly fileTree?: FileTreeController | undefined;
  /** The picker's MIME/extension list (`image/*,.pdf`). Other types are refused. Any file when omitted. */
  readonly accept?: string | undefined;
  /** The host's size limit in bytes: a larger file is refused before it is read, with `tooLarge` as its reason. No limit when omitted. */
  readonly maxBytes?: number | undefined;
  readonly tooLarge?: string | undefined;
  /** Send a png, jpeg, gif or webp as a native image in the message too (off by default: the message carries only the `@path`). */
  readonly inlineImages?: boolean | undefined;
  /** A file that could not be saved, with its reason. Partial failures are reported here; an upload that saves nothing rejects with the reason. */
  readonly onPreparationFailure?: ((name: string, reason: string) => void) | undefined;
}

/**
 * The `attachments` config `PiChat` takes, saved through a revision provider: each file is written under `uploads/` with a short random suffix
 * (`uploadRevisionAttachments`), refused when it is over `maxBytes` or not in `accept`. Works for a bare `PiChat` as well as `AgentWorkspace`,
 * which passes its own `fileTree`. Returns `undefined` until there is a tree to save through.
 */
export function useRevisionAttachments({ revisionProvider, fileTree, accept, maxBytes, tooLarge, inlineImages = false, onPreparationFailure }: RevisionAttachmentsOptions): AttachmentsConfig | undefined {
  const [binding, setBinding] = useState<{ readonly provider: RevisionProvider; readonly tree: FileTreeController }>();
  useEffect(() => {
    if (fileTree || !revisionProvider) return;
    const tree = createFileTreeController({ revisionProvider });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this effect owns the disposable tree (created and disposed here, StrictMode-safe); state only publishes it
    setBinding({ provider: revisionProvider, tree });
    return () => tree.dispose();
  }, [fileTree, revisionProvider]);
  const tree = fileTree ?? (binding?.provider === revisionProvider ? binding?.tree : undefined);
  // The failure callback is read when an upload starts, so a new callback does not rebuild the config, and a late failure of an upload
  // reports to the workspace it was started in (not the one selected since).
  const failure = useRef(onPreparationFailure);
  useLayoutEffect(() => { failure.current = onPreparationFailure; });
  return useMemo<AttachmentsConfig | undefined>(() => tree ? {
    ...(accept !== undefined ? { accept } : {}),
    upload: (files: File[], signal: AbortSignal) => {
      const report = failure.current;
      return uploadRevisionAttachments(tree, files, signal, (name, reason) => report?.(name, reason),
        { inlineImages, ...(maxBytes !== undefined ? { maxBytes, tooLarge } : {}), ...(accept ? { accept } : {}) });
    },
  } : undefined, [tree, accept, inlineImages, maxBytes, tooLarge]);
}
