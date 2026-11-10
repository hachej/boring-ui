'use client';

// D-2084: the files of the agent bar, with the meaning PiChat's `attachments` has. `upload(files, signal)` is the host's; an image result goes with the message as an
// attachment (the same `ChatAttachment` a PiChat draft carries), any other result is a path that the text mentions (`@uploads/releve.pdf`), as PiChat's `addMentions` writes it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { appendToDraft, mentionToken } from '@hachej/boring-ui-kit/chat-text';
import type { ChatAttachment } from '@hachej/boring-ui-kit/native-chat';
import type { AttachmentsConfig } from '../pi-chat/config';
import type { AttachedChip, UploadChip } from '../_shared/attachment-chips';

interface BarFile { readonly id: string; readonly name: string; readonly path?: string; readonly image?: { readonly data: string; readonly mimeType: string } }

export function useBarAttachments(config: AttachmentsConfig | undefined, failedWord: string) {
  const [pending, setPending] = useState<readonly UploadChip[]>([]);
  const [files, setFiles] = useState<readonly BarFile[]>([]);
  const ids = useRef(0);
  const live = useRef(new Set<AbortController>());
  const upload = config?.upload;
  useEffect(() => {
    const running = live.current;
    return () => { for (const abort of running) abort.abort(); running.clear(); };
  }, []);

  const add = useCallback(async (picked: readonly File[]) => {
    if (!upload || picked.length === 0) return;
    const abort = new AbortController(); live.current.add(abort);
    const mine = picked.map(() => `upload-${++ids.current}`);
    setPending(items => [...items, ...picked.map((file, index): UploadChip => ({ id: mine[index]!, name: file.name, state: 'uploading' }))]);
    try {
      const results = await upload([...picked], abort.signal);
      if (abort.signal.aborted) return;
      setFiles(items => [...items, ...results.flatMap((result): BarFile[] => result.image || result.path
        ? [{ id: `file-${++ids.current}`, name: result.name, ...(result.path ? { path: result.path } : {}), ...(result.image ? { image: result.image } : {}) }] : [])]);
      setPending(items => items.filter(item => !mine.includes(item.id)));
    } catch (cause) {
      if (abort.signal.aborted) return;
      const error = cause instanceof Error ? cause.message : failedWord;
      setPending(items => items.map(item => mine.includes(item.id) ? { ...item, state: 'failed', error } : item));
    } finally { live.current.delete(abort); }
  }, [upload, failedWord]);

  const chips: readonly AttachedChip[] = files.map(file => ({ id: file.id, name: file.name, mimeType: file.image?.mimeType ?? '', data: file.image?.data ?? '' }));
  /** The text with the uploaded paths mentioned, and the images as attachments, in the form PiChat sends them. */
  const compose = (text: string): { readonly text: string; readonly attachments: readonly ChatAttachment[] } => {
    const paths = files.flatMap(file => file.path ? [mentionToken(file.path)] : []);
    return {
      text: paths.length ? appendToDraft(text, paths.join(' ')) : text,
      attachments: files.flatMap((file): ChatAttachment[] => file.image ? [{ id: file.id, name: file.name, content: { type: 'image', data: file.image.data, mimeType: file.image.mimeType } }] : []),
    };
  };
  return {
    pending, chips, add, compose,
    count: files.length, uploading: pending.some(item => item.state === 'uploading'),
    dismiss: (id: string) => setPending(items => items.filter(item => item.id !== id)),
    remove: (id: string) => setFiles(items => items.filter(item => item.id !== id)),
    clear: () => setFiles([]),
  };
}
