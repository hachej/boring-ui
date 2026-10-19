// A tiny in-memory blob host for the workspace app (`startWorkspaceApp({ blobs: true })`): the contract of large files (blob pointers,
// `@hachej/boring-files/blob`) end to end, with fictional bytes. A real host streams to object storage; this one keeps a Map.
//  - GET /_files/<encodeURIComponent(id)>: the bytes, access checked on every request (the page's cookie or the bearer token), with
//    disposition, nosniff and a CSP.
//  - POST /_files?path=<workspace path>&name=<file name>: stores the body, then writes the pointer file `<path>.blob.json` into the
//    workspace through the provider's conditional write (the host's write, never the page's) and answers the pointer. A refusal is
//    `{ error: { code, message } }`.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BLOB_POINTER_MEDIA_TYPE, BLOB_POINTER_SUFFIX, parseBlobPointer } from '@hachej/boring-files/blob';
import { mediaTypeOf, sniffMediaType } from '@hachej/boring-files/file-types';
import { fictionalPdf } from '../../test/fixtures/fictional-pdf.mjs';
import { fictionalPng, xlsxHead } from '../../test/fixtures/blob-bytes.mjs';

export const BLOB_LIMIT = 100 * 1024 * 1024;
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
const refuse = (status, code, message) => Response.json({ error: { code, message } }, { status });

export function createBlobHost({ files, access, allowed, token }) {
  const blobs = new Map();
  const locate = path => ({ resource: { providerId: 'workspace', path }, view: { kind: 'published' } });
  /** Stores bytes and writes their pointer file: the host's own conditional write (create only, never over another file). */
  async function store(path, name, bytes, type) {
    const id = `blob-${randomUUID()}`;
    const pointer = { 'boring:blob': 1, id, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.byteLength, type, name };
    if (!parseBlobPointer(JSON.stringify(pointer))) throw new Error('invalid pointer');
    const result = await files.publication.publish({ operationId: randomUUID(), atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: locate(`${path}${BLOB_POINTER_SUFFIX}`), expected: { kind: 'absent' },
      bytes: new TextEncoder().encode(JSON.stringify(pointer, null, 2)), mediaType: BLOB_POINTER_MEDIA_TYPE }] }, access);
    if (result.kind !== 'committed') return { refused: result.kind === 'conflict' ? 'A file with this name already exists.' : 'The file could not be saved.' };
    blobs.set(id, { bytes, type, name });
    return { pointer };
  }
  return {
    /** The fictional seed: a photo, a report and a budget, as pointers. */
    seed: async () => {
      await store('harbour.png', 'harbour.png', fictionalPng(640, 400), 'image/png');
      await store('quarterly-report.pdf', 'quarterly-report.pdf', fictionalPdf([['Fictional quarterly report', 'Harbour cafe, spring', 'Revenue grew in every fictional month.'], ['Page two', 'Nothing here is real.']]), 'application/pdf');
      await store('budget.xlsx', 'budget.xlsx', xlsxHead(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      // Generated solid colour, 2 seconds, no audio: ffmpeg -f lavfi -i color=c=steelblue:s=640x360:r=10:d=2 -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an fictional-video.mp4
      await store('colour.mp4', 'colour.mp4', readFileSync(new URL('../../test/fixtures/fictional-video.mp4', import.meta.url)), 'video/mp4');
    },
    handle: async request => {
      const url = new URL(request.url);
      const cookie = request.headers.get('cookie') ?? '';
      if (!allowed(request) && !cookie.split(/;\s*/).includes(`boring-blob=${token}`)) return refuse(403, 'forbidden', 'Not allowed.');
      if (request.method === 'GET' && url.pathname.startsWith('/_files/')) {
        let id;
        try { id = decodeURIComponent(url.pathname.slice('/_files/'.length)); } catch { return refuse(400, 'invalid', 'Invalid id.'); }
        const blob = blobs.get(id);
        if (!blob) return refuse(404, 'missing', 'No such file.');
        const disposition = `${INLINE.has(blob.type) || blob.type.startsWith('video/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(blob.name)}`;
        return new Response(blob.bytes, { headers: { 'content-type': blob.type, 'content-length': String(blob.bytes.byteLength), 'content-disposition': disposition,
          'x-content-type-options': 'nosniff', 'content-security-policy': blob.type === 'application/pdf' ? "default-src 'none'; style-src 'unsafe-inline'" : "default-src 'none'; sandbox", 'cache-control': 'private, max-age=31536000, immutable' } });
      }
      if (request.method === 'POST' && url.pathname === '/_files') {
        const name = url.searchParams.get('name') ?? '', path = url.searchParams.get('path') ?? '';
        if (!name || /[/\\]/.test(name) || !path || path.startsWith('/') || path.split('/').includes('..')) return refuse(400, 'invalid', 'Invalid file name.');
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength > BLOB_LIMIT) return refuse(413, 'too_large', 'Files are limited to 100 MB.');
        const named = mediaTypeOf(name), sniffed = sniffMediaType(bytes.subarray(0, 8192));
        const saved = await store(path, name, bytes, named !== 'application/octet-stream' ? named : sniffed && sniffed !== 'text/plain' ? sniffed : 'application/octet-stream');
        return saved.pointer ? Response.json(saved.pointer) : refuse(409, 'conflict', saved.refused);
      }
      return refuse(405, 'method', 'Not allowed.');
    },
  };
}
