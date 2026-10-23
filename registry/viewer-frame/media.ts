import { useEffect, useMemo, useState } from 'react';

/** What a read-only media viewer shows: bytes or a Blob (the viewer owns the object URL it makes) or a URL the host owns. */
export interface MediaSource {
  readonly bytes?: Uint8Array | ArrayBuffer;
  readonly blob?: Blob;
  readonly url?: string;
}

/** A Blob for the source, or `undefined` when the host gave a URL (or nothing). */
export function mediaBlob(source: MediaSource, mediaType: string): Blob | undefined {
  if (source.blob) return source.blob;
  if (source.bytes) return new Blob([source.bytes as BlobPart], { type: mediaType });
  return undefined;
}

/** An object URL for the source, revoked when the source changes or the viewer unmounts. A host `url` is passed through untouched. */
export function useMediaUrl(source: MediaSource, mediaType: string): { url: string | undefined; size: number | undefined; blob: Blob | undefined } {
  const blob = useMemo(() => mediaBlob(source, mediaType), [source.blob, source.bytes, mediaType]); // eslint-disable-line react-hooks/exhaustive-deps
  const [made, setMade] = useState<string>();
  useEffect(() => {
    if (!blob) { setMade(undefined); return; }
    const url = URL.createObjectURL(blob);
    setMade(url);
    return () => { URL.revokeObjectURL(url); setMade(current => current === url ? undefined : current); };
  }, [blob]);
  return { url: blob ? made : source.url, size: blob?.size, blob };
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
