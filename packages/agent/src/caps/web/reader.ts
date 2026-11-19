// The page reader: GETs an https page itself and turns it into markdown (Readability, linkedom and turndown for HTML, unpdf for PDFs).
// It sends only the page's own request (no cookie, no credential, no referrer), follows at most 5 redirects by hand and checks each hop as a
// first request, reads at most 1.5 MB of a page (8 MB of a PDF). The libraries load on the first read, so an app that only searches never pays for them.
import type { Refusal } from '../shared.js';
import { refuse, secureUrl } from './guard.js';

export const MAX_REDIRECTS = 5;
export const MAX_BYTES = 1_500_000;
export const MAX_PDF_BYTES = 8_000_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const HEADERS = { accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.8', 'accept-language': 'en,fr;q=0.8', 'user-agent': 'boring-agent-web/1' };
type Read = { url: string; title: string; markdown: string; truncated: boolean };
const drop = (response: Response) => response.body?.cancel?.().catch(() => {});

async function get(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<{ response: Response; url: string } | Refusal> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetcher(target, { method: 'GET', redirect: 'manual', headers: HEADERS, referrerPolicy: 'no-referrer', signal });
    if (!REDIRECTS.has(response.status)) return { response, url: target };
    await drop(response);
    const next = secureUrl(new URL(response.headers.get('location') ?? '', target).href);
    if (!next) return refuse('web-redirect');
    target = next;
  }
  return refuse('web-redirect');
}
async function body(response: Response, max: number): Promise<{ bytes: Uint8Array; cut: boolean }> {
  const chunks: Uint8Array[] = [];
  let size = 0, cut = false;
  const reader = response.body?.getReader();
  for (; reader;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > max) { chunks.push(value.subarray(0, max - size)); size = max; cut = true; await reader.cancel(); break; }
    chunks.push(value); size += value.length;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  return { bytes, cut };
}
const decoder = (type: string) => { const m = /charset=["']?([\w-]+)/i.exec(type); try { return new TextDecoder(m?.[1] ?? 'utf-8'); } catch { return new TextDecoder(); } };

async function markdownOf(html: string, url: string): Promise<{ title: string; markdown: string }> {
  // @ts-expect-error turndown ships no types and this package does not add a declaration file for one import
  const turndown = import('turndown');
  const [{ parseHTML }, { Readability }, { default: Turndown }] = await Promise.all([import('linkedom'), import('@mozilla/readability'), turndown]);
  const { document } = parseHTML(html);
  document.querySelectorAll('script, style, noscript, template, iframe, form, svg, nav, footer').forEach((n: { remove(): void }) => n.remove());
  const title = (document.title ?? '').trim();
  const copy = document.cloneNode(true);
  for (const key of ['baseURI', 'documentURI']) Object.defineProperty(copy, key, { value: url, configurable: true });
  const article = new Readability(copy as never, { charThreshold: 200 }).parse();
  const root = article?.content ? parseHTML(`<!doctype html><html><body>${article.content}</body></html>`).document.body : document.body;
  if (!root) return { title, markdown: '' };
  const service = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  service.remove(['script', 'style', 'iframe', 'form']);
  const name = (article?.title || title).trim(), body = service.turndown(root as never).replace(/\n{3,}/g, '\n\n').trim();
  // Readability drops the heading that repeats the title; the markdown keeps it as its first line.
  return { title: name, markdown: name && body && !body.startsWith('#') ? `# ${name}\n\n${body}` : body };
}
async function pdfOf(bytes: Uint8Array): Promise<{ title: string; markdown: string }> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: true });
  return { title: '', markdown: String(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/** What the page says, or a refusal. A network failure throws (the shared call moves on). */
export async function readPage(url: string, fetcher: typeof fetch, signal: AbortSignal): Promise<Read | Refusal> {
  const got = await get(fetcher, url, signal);
  if ('ok' in got) return got;
  const { response, url: final } = got;
  if (!response.ok) {
    await drop(response);
    return response.status === 404 || response.status === 410 ? refuse('web-page') : response.status === 429 || response.status >= 500 ? refuse('unavailable', true) : refuse('web-page');
  }
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  const isPdf = type.includes('application/pdf') || /\.pdf$/i.test(new URL(final).pathname);
  const isHtml = /text\/html|application\/xhtml/.test(type);
  if (!isPdf && !isHtml && !type.startsWith('text/plain')) { await drop(response); return refuse('web-type'); }
  const { bytes, cut } = await body(response, isPdf ? MAX_PDF_BYTES : MAX_BYTES);
  if (isPdf) {
    if (cut) return refuse(`web-too-large:${MAX_PDF_BYTES}`);
    try { return { url: final, ...(await pdfOf(bytes)), truncated: false }; } catch { return refuse('web-unreadable'); }
  }
  const text = decoder(type).decode(bytes);
  if (!isHtml) return { url: final, title: '', markdown: text.trim(), truncated: cut };
  try { return { url: final, ...(await markdownOf(text, final)), truncated: cut }; } catch { return refuse('web-unreadable'); }
}
