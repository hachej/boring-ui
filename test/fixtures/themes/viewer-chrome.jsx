import { useEffect, useState } from 'react';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import { MarkdownPane } from '../../../registry/viewers/markdown-pane';
import { HtmlPane } from '../../../registry/viewers/html-pane';
import { ImagePane } from '../../../registry/viewers/image-pane';
import { PdfPane } from '../../../registry/viewers/pdf-pane';
import { ViewerFrame } from '../../../registry/viewers/viewer-frame';
import { MarkdownEditor } from '../../../registry/markdown-editor/markdown-editor';
import { HtmlViewer } from '../../../registry/html-viewer/html-viewer';
import { fictionalPdf } from '../fictional-pdf.mjs';

const markdown = '# Cedar Works\n\nA fictional picnic plan.\n\n- Bring a blanket\n- Pack some sandwiches\n';
const html = '<h1>Cedar Works</h1><p>A fictional picnic plan.</p>';
const image = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><title>Fictional picnic map</title><rect width="640" height="400" fill="white"/><text x="40" y="80">Cedar Works picnic</text></svg>');
// Two pages drawn by pdf.js (`inline={false}`, as on a phone); a damaged file falls back to Download.
const pdf = fictionalPdf([['Cedar Works', 'A fictional picnic plan.', '', 'Bring a blanket.'], ['Page two', 'Pack some sandwiches.']]);
const damagedPdf = new TextEncoder().encode('%PDF-1.4\n% Fictional damaged fixture\n%%EOF');

// Real controllers and renderers over the example's authenticated fictional workspace.
export function ViewerChromeControls({ surface, fetch: authorized }) {
  const [controllers, setControllers] = useState();
  useEffect(() => {
    let closed = false, owned;
    connectRevisionProvider({ endpoint: new URL('/api/resources', location.href), fetch: authorized }).then(provider => {
      if (closed) return;
      const options = { identity: provider.identity, client: provider, instanceId: 'fictional-chrome', epoch: 'fixture' };
      owned = {
        markdown: createMarkdownController({ ...options, source: { kind: 'new', target: provider.locate('fixtures/chrome.md'), text: surface === 'unsafe' ? '---\ntitle: Fictional\n---\n\n<div>Literal HTML</div>\n' : markdown } }),
        html: createHtmlController({ ...options, source: { kind: 'new', target: provider.locate('fixtures/chrome.html'), text: html } }),
      };
      if (surface === 'proposal') owned.markdown.actions.propose(owned.markdown.actions.selection(), [{ find: 'some sandwiches', replace: 'lunch for everyone' }], 'Fictional lunch suggestion');
      setControllers(owned);
    });
    return () => { closed = true; owned?.markdown.dispose(); owned?.html.dispose(); };
  }, [surface, authorized]);
  if (!controllers) return <p role="status">Loading fictional viewers</p>;
  const common = { testId: 'fixture-viewer', onClose() {}, onShare: () => 'copied' };
  return <main data-testid="viewer-chrome-fixture" data-surface={surface} className="boring-viewer flex h-full min-h-0 flex-col">
    {['markdown', 'source', 'selection', 'pinned', 'menu', 'unsafe', 'proposal'].includes(surface) && <MarkdownPane {...common} controller={controllers.markdown} title="Cedar Works.md" initialMode={surface === 'source' ? 'source' : 'rich'} {...(surface === 'pinned' ? { formattingToolbar: 'pinned' } : {})} autosave={false} />}
    {['html', 'html-source'].includes(surface) && <HtmlPane {...common} controller={controllers.html} title="Cedar Works.html" initialMode={surface === 'html-source' ? 'source' : 'preview'} />}
    {surface === 'standalone-markdown' && <MarkdownEditor controller={controllers.markdown} title="Cedar Works.md" autosave={false} />}
    {surface === 'standalone-html' && <HtmlViewer controller={controllers.html} title="Cedar Works.html" />}
    {surface === 'image' && <ImagePane {...common} name="Cedar Works.svg" mediaType="image/svg+xml" bytes={image} />}
    {surface === 'pdf' && <PdfPane {...common} name="Cedar Works.pdf" bytes={pdf} inline={false} />}
    {surface === 'pdf-damaged' && <PdfPane {...common} name="Cedar Works.pdf" bytes={damagedPdf} inline={false} />}
    {surface === 'pdf-native' && <PdfPane {...common} name="Cedar Works.pdf" bytes={pdf} inline />}
    {surface === 'manual' && <ViewerFrame {...common} title="Cedar Works" onCopy={() => { throw Object.assign(new Error('Manual copy'), { name: 'ManualCopyError', text: markdown }); }}><p>Fictional copy fallback</p></ViewerFrame>}
  </main>;
}
