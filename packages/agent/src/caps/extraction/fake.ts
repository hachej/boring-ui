// The fake extraction provider: tests and previews. Nothing leaves. It answers from the readings the app gives, keyed by the document's
// sha256 (hex); any other document reads as one blank uncertain page with every field null, so a preview shows an uncertain result and
// never invents a value. Ported from boring-factory services/extract/adapters/fake.
import type { Page, Said } from './port.js';

/** A recorded reading of one fictional document: its pages and, for `readFields`, what was said of each field. */
export type Reading = { pages: Page[]; said?: Said[] };
export type Readings = Readonly<Record<string, Reading>>;

const hex = (digest: Awaited<ReturnType<SubtleCrypto['digest']>>) => [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256Of = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bytes as never));

export async function fake(bytes: Uint8Array, readings: Readings = {}): Promise<Reading> {
  const sha = await sha256Of(bytes);
  return Object.hasOwn(readings, sha) ? readings[sha]! : { pages: [{ n: 1, text: '', confidence: 0 }], said: [] };
}
