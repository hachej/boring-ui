'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFWorker, RenderTask } from 'pdfjs-dist';
import { useViewerText } from '../viewer-frame/viewer-window';

/** Device pixels per CSS pixel are capped (3) and so is one page's canvas (about 8 megapixels) so a zoomed page stays within a phone's memory. */
const MAX_RATIO = 3;
const MAX_PIXELS = 8 * 1024 * 1024;

/**
 * pdf.js's own worker, from the package's worker entry. `new Worker(new URL(<package path>, import.meta.url))` is the form Vite and
 * webpack (Next) bundle as a worker; a host bundler that leaves the URL as is (esbuild) serves that path itself. Resolves once the
 * worker reports ready and rejects when it cannot load, so a missing worker shows the Download fallback instead of a spinner forever.
 */
function startWorker(signal: AbortSignal): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' });
    const fail = () => { worker.terminate(); reject(new Error('The PDF worker could not start.')); };
    worker.addEventListener('message', () => { signal.removeEventListener('abort', fail); resolve(worker); }, { once: true });
    worker.addEventListener('error', fail, { once: true });
    signal.addEventListener('abort', fail, { once: true });
  });
}

/** Opens the document with pdf.js (loaded on demand) in its own worker. `close` destroys the document and stops the worker. */
async function openPdf(url: string, signal: AbortSignal): Promise<{ readonly document: PDFDocumentProxy; readonly close: () => void }> {
  const started = startWorker(signal);
  let worker: PDFWorker | undefined, task: { destroy(): Promise<void> } | undefined;
  const close = () => { void task?.destroy(); worker?.destroy(); void started.then(port => port.terminate(), () => {}); };
  try {
    const [pdfjs, port] = await Promise.all([import('pdfjs-dist'), started]);
    if (signal.aborted) throw signal.reason;
    worker = pdfjs.PDFWorker.create({ port });
    const loading = pdfjs.getDocument({ url, worker, verbosity: 0 });
    task = loading;
    const document = await loading.promise;
    if (signal.aborted) throw signal.reason;
    return { document, close };
  } catch (error) { close(); throw error; }
}

export interface PdfPagesProps {
  readonly url: string;
  readonly name: string;
  /** 1 fits the page to the pane's width. */
  readonly zoom: number;
  readonly testId: string;
  readonly onLoad: (pages: number) => void;
  readonly onPage: (page: number) => void;
  readonly onError: (error: unknown) => void;
  readonly onKey?: (key: string) => void;
}

/**
 * The pages of a PDF drawn by pdf.js, for a browser without a PDF viewer of its own (phones): stacked, fit to the pane's width times
 * `zoom`, rendered only near the viewport, crisp at the device's pixel ratio. Unmounting cancels rendering and destroys the document.
 */
export function PdfPages({ url, name, zoom, testId, onLoad, onPage, onError, onKey }: PdfPagesProps) {
  const { labels } = useViewerText();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [ratio, setRatio] = useState(Math.SQRT2);
  const [width, setWidth] = useState(0);
  const latest = useRef({ onLoad, onError });
  useLayoutEffect(() => { latest.current = { onLoad, onError }; });
  useEffect(() => {
    const abort = new AbortController();
    let close: (() => void) | undefined;
    openPdf(url, abort.signal).then(async opened => {
      close = opened.close;
      if (abort.signal.aborted) { close(); return; }
      const first = (await opened.document.getPage(1)).getViewport({ scale: 1 });
      if (abort.signal.aborted) return;
      setRatio(first.height / first.width);
      setDocument(opened.document);
      latest.current.onLoad(opened.document.numPages);
    }).catch(error => { if (!abort.signal.aborted) latest.current.onError(error); });
    return () => { abort.abort(); close?.(); };
  }, [url]);
  useEffect(() => {
    const box = scroller;
    if (!box) return;
    const measure = () => setWidth(Math.max(0, box.clientWidth - 16));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [scroller]);
  const scrolled = () => {
    const box = scroller;
    if (!box) return;
    const line = box.scrollTop + box.clientHeight / 3;
    let page = 1;
    for (const element of box.querySelectorAll<HTMLElement>('[data-page]')) if (element.offsetTop <= line) page = Number(element.dataset.page);
    onPage(page);
  };
  const pageWidth = Math.floor(width * zoom);
  return <div ref={setScroller} data-testid={`${testId}-pdf-pages`} aria-label={name} role="document" tabIndex={0} onScroll={scrolled}
    onKeyDown={event => onKey?.(event.key)} className="relative min-h-0 min-w-0 flex-1 overflow-auto p-2">
    {!document ? <p role="status" className="m-0 p-6 text-center text-sm text-muted-foreground">{labels.loading}</p>
      : <div className="flex w-max min-w-full flex-col items-center gap-2">
        {Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index} document={document} number={index + 1} width={pageWidth} ratio={ratio} root={scroller} testId={testId} />)}
      </div>}
  </div>;
}

function PdfPage({ document, number, width, ratio, root, testId }: { readonly document: PDFDocumentProxy; readonly number: number; readonly width: number; readonly ratio: number; readonly root: Element | null; readonly testId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [own, setOwn] = useState<number>();
  const [rendered, setRendered] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) setNear(true); }, { root, rootMargin: '100% 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    const element = canvas.current;
    if (!near || !width || !element) return;
    let cancelled = false, task: RenderTask | undefined;
    void document.getPage(number).then(page => {
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setOwn(base.height / base.width);
      const viewport = page.getViewport({ scale: width / base.width });
      const scale = Math.min(globalThis.devicePixelRatio || 1, MAX_RATIO, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
      element.width = Math.floor(viewport.width * scale);
      element.height = Math.floor(viewport.height * scale);
      task = page.render({ canvas: element, viewport, ...(scale === 1 ? {} : { transform: [scale, 0, 0, scale, 0, 0] }) });
      return task.promise.then(() => { if (!cancelled) setRendered(true); });
    }).catch(() => {});
    return () => { cancelled = true; task?.cancel(); };
  }, [document, number, width, near]);
  return <div ref={box} data-page={number} data-testid={`${testId}-pdf-page`} data-rendered={rendered || undefined} className="relative shrink-0 bg-background outline outline-1 outline-border"
    style={{ width, height: Math.round(width * (own ?? ratio)) }}>
    <canvas ref={canvas} data-testid={`${testId}-pdf-canvas`} className="absolute inset-0 size-full" />
  </div>;
}
