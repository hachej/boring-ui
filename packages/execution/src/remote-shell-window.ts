// Pi's `ShellExecOptions.window`: the caller keeps only the tail of the output, so an environment may omit the rest and report it as
// `skipped`. The remote handler applies the window itself, so a worker that ignores it (Pi's Node environment) still transfers only
// the tail. A worker that windows already sends `skipped`; its counts are merged, never recomputed.
import type { ShellOutputInfo, ShellOutputSkip, ShellOutputWindow } from '@earendil-works/pi-durable/env';

export interface WindowedOutput { readonly text: string; readonly stream: 'stdout' | 'stderr'; readonly skipped?: ShellOutputSkip }
const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;
const newlines = (text: string): number => { let count = 0; for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count++; return count; };

/** Index where the remainder holds more than `maxBytes` UTF-8 bytes (the shortest such suffix), or -1 when the text is not longer. */
function byteCut(text: string, maxBytes: number): number {
  let bytes = 0, index = text.length;
  while (index > 0) {
    const point = index >= 2 && text.charCodeAt(index - 1) >= 0xdc00 && text.charCodeAt(index - 1) <= 0xdfff && text.charCodeAt(index - 2) >= 0xd800 && text.charCodeAt(index - 2) <= 0xdbff ? 2 : 1;
    index -= point; bytes += byteLength(text.slice(index, index + point));
    if (bytes > maxBytes) return index === 0 ? -1 : index;
  }
  return -1;
}
/** Index where the remainder holds more than `maxLines` newlines (the shortest such suffix), or -1. */
function lineCut(text: string, maxLines: number): number {
  let at = text.length;
  for (let count = 0; count <= maxLines; count++) { at = text.lastIndexOf('\n', at - 1); if (at <= 0) return -1; }
  return at;
}

/** Collects output, drops what the window cannot keep, and flushes no faster than `minIntervalMs`. */
export function windowedOutput(window: ShellOutputWindow, emit: (chunk: WindowedOutput) => void) {
  let text = '', stream: 'stdout' | 'stderr' = 'stdout', skip: ShellOutputSkip | undefined, last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const omit = (omitted: string): void => {
    if (omitted === '') return;
    skip = { bytes: (skip?.bytes ?? 0) + byteLength(omitted), newlines: (skip?.newlines ?? 0) + newlines(omitted), endsWithNewline: omitted.endsWith('\n') };
  };
  const trim = (): void => {
    const cuts = [byteCut(text, window.maxBytes), lineCut(text, window.maxLines)].filter(cut => cut > 0);
    if (cuts.length === 0) return;
    const cut = Math.max(...cuts);
    omit(text.slice(0, cut)); text = text.slice(cut);
  };
  const flush = (): void => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    trim();
    if (text === '' && skip === undefined) return;
    const chunk: WindowedOutput = { text, stream, ...(skip === undefined ? {} : { skipped: skip }) };
    text = ''; skip = undefined; last = Date.now();
    emit(chunk);
  };
  return {
    push(chunk: string, info: ShellOutputInfo): void {
      if (info.skipped !== undefined) { omit(text); text = ''; skip = { bytes: (skip?.bytes ?? 0) + info.skipped.bytes, newlines: (skip?.newlines ?? 0) + info.skipped.newlines, endsWithNewline: info.skipped.endsWithNewline }; }
      text += chunk; stream = info.stream;
      trim();
      const wait = last + window.minIntervalMs - Date.now();
      if (wait <= 0) flush(); else timer ??= setTimeout(() => { timer = undefined; try { flush(); } catch { /* the transport closed */ } }, wait);
    },
    /** Deliver what is buffered before the terminal result. */
    finish: flush,
    cancel(): void { if (timer !== undefined) clearTimeout(timer); timer = undefined; text = ''; skip = undefined; },
  };
}
