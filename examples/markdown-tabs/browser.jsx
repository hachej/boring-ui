// One fictional Markdown note in the real editor, over the HTTP resource endpoint the journey serves. Several tabs of one browser
// open the same note, so the editor's BroadcastChannel poke is the real one. No Pi, harness or server filesystem code is bundled.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { randomUUID } from '@hachej/boring-files/platform';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { MarkdownEditor, MARKDOWN_RICH_SIZE_LIMIT } from '@hachej/boring-ui-kit/markdown-editor';

const identity = { principalId: 'fictional-editor', scopeId: 'fictional-notes-project', initiatorId: 'fictional-person' };
const params = new URLSearchParams(location.search);
const target = { resource: { providerId: 'fictional-notes', path: params.get('note') }, view: { kind: 'published' } };
const client = createResourceClient({ identity, endpoint: new URL('/resource', location.href), publication: true, reconciliation: true, fetch: request => fetch(request) });
const read = await client.read({ target, revision: { kind: 'latest' } });
if (read.kind !== 'available') throw new Error(`Fictional note unavailable: ${read.kind}`);
const controller = createMarkdownController({ identity, client, source: { kind: 'saved', snapshot: read.snapshot }, instanceId: randomUUID(), epoch: 'page' });
// A `rich` page asks for the formatted editor and leaves the size limit to choose; the others ask for source.
const props = params.has('rich') ? {} : { initialMode: 'source' };
createRoot(document.getElementById('root')).render(<main><MarkdownEditor controller={controller} title="Notes" autosave={false} {...props} /></main>);
window.md = { controller, limit: MARKDOWN_RICH_SIZE_LIMIT, ready: true };
