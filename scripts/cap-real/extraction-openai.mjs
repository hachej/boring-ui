#!/usr/bin/env node
// The optional real check of OpenAI as the second extraction provider (card cap-extraction-ocr AC-6). Keys come from standard input as
// NAME=value lines, never from an argument or the environment, and are printed nowhere; an empty value is a missing key (that provider is
// skipped):
//   { echo "OPENAI_API_KEY=$(vault kv get -mount=secret -field=api_key agent/openai)"; \
//     echo "MISTRAL_API_KEY=$(vault kv get -mount=secret -field=api_key agent/mistral)"; } | node scripts/cap-real/extraction-openai.mjs
// It reads test/fixtures/caps/extraction-openai/scan-1.pdf to scan-3.pdf through the unchanged read_pdf, once per provider, and prints per
// page the provider, the first line, the page number the provider gave, the charge and the time.
import { readFileSync } from 'node:fs';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { documentTools } from '@hachej/boring-agent/documents';
import { ocrFor } from '@hachej/boring-agent/caps/extraction';

const input = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
const keys = Object.fromEntries(input.split('\n').map((line) => line.split('=')).filter(([k, ...v]) => /^[A-Z_]+$/.test(k ?? '') && v.join('=').trim()).map(([k, ...v]) => [k, v.join('=').trim()]));
if (!keys.MISTRAL_API_KEY && !keys.OPENAI_API_KEY) { console.log('skipped: no key'); process.exit(0); }

let charged = 0, failed = 0;
const sink = { reserveRun: async () => ({ reservationId: 'r' }), recordUsage: async (i) => { charged += i.amountMicros; return { billedMicros: i.amountMicros }; }, settleRun: async () => {}, releaseRun: async () => {} };
for (const provider of ['mistral', 'openai']) {
  if (!keys[`${provider.toUpperCase()}_API_KEY`]) { console.log(`${provider}: skipped`); continue; }
  const [readPdf] = documentTools({ readBytes: (name) => new Uint8Array(readFileSync(new URL(`../../test/fixtures/caps/extraction-openai/${name}`, import.meta.url))),
    ocr: ocrFor({ providers: [provider], keys, fetch, timeoutMs: 120_000, meter: { sink, userId: 'real-check' } }) });
  for (const name of ['scan-1.pdf', 'scan-2.pdf', 'scan-3.pdf']) {
    charged = 0;
    const started = Date.now();
    const out = JSON.parse((await readPdf.execute({ path: name }, {}, context)).output[0].text);
    const took = Date.now() - started;
    if (!(out.pages ?? []).some((p) => p.ocr)) failed += 1;
    for (const p of out.pages ?? []) console.log(`${provider} ${name} page ${p.n}${p.ocr ? '' : ' (not read by OCR)'}: « ${String(p.text).split('\n').find((l) => l.trim()) ?? ''} », ${charged} micros, ${took} ms`);
    if (out.note && !out.note.startsWith('Scanned pages read')) console.log(`${provider} ${name}: ${out.note}`);
  }
}
process.exit(failed ? 1 : 0);
