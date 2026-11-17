#!/usr/bin/env node
// The optional real check of `readFields` (card cap-extraction AC-17). The key comes from standard input, never from an argument or the
// environment, and is printed nowhere; an empty value is a missing key:
//   vault kv get -mount=secret -field=api_key agent/mistral | node scripts/cap-real/extraction.mjs [<folder of your own fictional invoices>]
// It reads the 5 fictional invoices of test/fixtures/caps/extraction/invoices.mjs as PDFs and as photos, prints per file the fields found,
// the fields « À revoir », the pages charged and the time, then compares the shape of one live answer with the test double's.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFields } from '@hachej/boring-agent/caps/extraction';
import { mistralDouble, pdf } from '../../test/fixtures/caps/extraction/documents.mjs';
import { INVOICES, SCHEMA } from '../../test/fixtures/caps/extraction/invoices.mjs';

const key = process.stdin.isTTY ? '' : readFileSync(0, 'utf8').trim();
if (!key) { console.log('skipped: no key'); process.exit(0); }

const images = new URL('../../test/fixtures/caps/extraction/images/', import.meta.url);
const files = INVOICES.flatMap((inv) => [[`${inv.id}.pdf`, pdf([inv.lines]), inv.expect], [`${inv.id}.jpg`, new Uint8Array(readFileSync(new URL(`${inv.id}.jpg`, images))), inv.expect]]);
const own = process.argv[2];
if (own) for (const name of readdirSync(own).filter((n) => /\.(pdf|png|jpe?g|webp)$/i.test(n))) files.push([name, new Uint8Array(readFileSync(join(own, name))), null]);

let charged = 0, live;
const sink = { reserveRun: async () => ({ reservationId: 'r' }), recordUsage: async (i) => { charged += i.amountMicros; return { billedMicros: i.amountMicros }; }, settleRun: async () => {}, releaseRun: async () => {} };
const recording = async (url, init) => { const response = await fetch(url, init); live ??= response.ok ? await response.clone().json().catch(() => undefined) : undefined; return response; };
let right = 0;
for (const [name, bytes, expect] of files) {
  charged = 0;
  const started = Date.now();
  const r = await readFields({ bytes }, SCHEMA, { providers: ['mistral'], keys: { MISTRAL_API_KEY: key }, fetch: recording, meter: { sink, userId: 'real-check' } });
  const took = Date.now() - started;
  if (!r.ok) { console.log(`${name}: refused ${r.kind}, ${took} ms`); continue; }
  const found = r.fields.filter((f) => f.value !== null).map((f) => `${f.name}=${f.value}`), review = r.fields.filter((f) => f.value === null).map((f) => f.name);
  const good = expect && r.fields.every((f) => f.value === null || f.value === expect[f.name]);
  if (good && !review.length) right += 1;
  console.log(`${name}: ${found.join(', ') || 'nothing'}; À revoir: ${review.join(', ') || 'none'}; ${charged / 3000} page(s) charged; ${took} ms${expect && !good ? '; WRONG VALUE' : ''}`);
}
const shape = (a) => a && { top: Object.keys(a).sort(), page: Object.keys(a.pages?.[0] ?? {}).sort(), confidence: Object.keys(a.pages?.[0]?.confidence_scores ?? {}).sort() };
const double = mistralDouble(), sample = shape(await (await double.fetch('https://api.mistral.ai/v1/ocr', { method: 'POST', body: JSON.stringify({ document_annotation_format: {} }) })).json());
const real = shape(live), differ = real ? Object.keys(sample).flatMap((k) => (JSON.stringify(sample[k]) === JSON.stringify(real[k]) ? [] : [`${k}: double ${sample[k]} / live ${real[k]}`])) : ['no live answer'];
console.log(differ.length ? `double differs: ${differ.join('; ')}` : 'double matches');
console.log(`${right}/${INVOICES.length * 2} fictional files fully right`);
process.exit(right === INVOICES.length * 2 && !differ.length ? 0 : 1);
