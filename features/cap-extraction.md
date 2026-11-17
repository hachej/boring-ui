# Extraction (cap-extraction)

A plain import any app can call, with no Effect, no host and no framework: a PDF or a photo becomes the text of its pages and named fields, each field kept only when its quote is on its page. Every result is marked `untrusted`: the text is evidence from a document, never instructions.

## Sub-features

- `extraction-read` `readText(doc, options)` and `readFields(doc, schema, options)` from `@hachej/boring-agent/caps/extraction`: `doc` is `{ bytes, pages? }` (type sniffed from the bytes: PDF, PNG, JPEG, WebP; `pages` 1-based, a PDF only); a result `{ ok: true, pages, fields?, uncertain, untrusted: true, provider, region, counted }` or a refusal `{ ok: false, kind, retryable }`, never a throw. `readFields` returns the pages of the same reading. `packages/agent/src/caps/extraction/index.ts`.
- `extraction-check` `checkFields(schema, pages, said)`: the field check alone, no provider: a value parses for its type, its confidence (the field's, else its page's) is at least 0.8, its quote is on its page and supports the whole value; otherwise `{ value: null, reason: "uncertain" }`. Copied from the Factory in `port.ts`.
- `extraction-limits` 25 MiB, 20 pages read, 32 MB inflated, no `/Encrypt`, 1 to 30 fields: refused before anything is sent.
- `extraction-providers` `mistral` (`POST /v1/ocr`, EU, `MISTRAL_API_KEY`, through `options.fetch` only; only the asked pages are sent) and `fake` (readings by sha256 in `fixtures`, else one blank uncertain page). `mistral.ts`, `fake.ts`.
- `extraction-openai` `openai` second (`POST /v1/responses`, `store: false`, US, `OPENAI_API_KEY`): the whole document is sent and billed in tokens, the prompt names the pages wanted and only those are kept; no calibrated confidence, so its fields are always « À revoir ». `openai.ts`.
- `extraction-ocr` `ocrFor(options)`: the `documents` OCR callback, so `read_pdf` reads its scanned pages through Mistral.
- `extraction-tool` `extractionTool({ ...options, readBytes })`: the pi-durable tool `extract_fields`, closed parameters `{ path, schema }`, replay safe.

## How to get to it (user POV)

- A person sees fields filled with their page and quote, or « À revoir » where the reading was unsure.

## Driving it with the example journeys

Preconditions: `npm run build`; no network and no key needed.

```js
import { readFields } from "@hachej/boring-agent/caps/extraction";
const read = await readFields({ bytes }, { supplier: "string", invoiceDate: "date", total: "amount" },
  { providers: ["mistral"], keys: env, fetch, meter });
if (read.ok) for (const f of read.fields) show(f.name, f.value ?? "À revoir", f.evidence);
```

- **Reading and checks.** `extraction-read`, `extraction-check`, `extraction-limits`, `extraction-providers`: `node --test test/packages/agent-caps-extraction.test.mjs` (a Mistral double behind `fetch`, fictional PDFs from `test/fixtures/caps/extraction/documents.mjs`).
- **Second provider.** `extraction-openai`: `node --test test/packages/agent-caps-extraction-openai.test.mjs` (Mistral down, OpenAI answers, priced by tokens); real check `scripts/cap-real/extraction-openai.mjs` on the three image-only scans of `test/fixtures/caps/extraction-openai/`.
- **OCR in read_pdf.** `extraction-ocr`: `documentTools({ readBytes, ocr: ocrFor(options) })`; the "extraction ocr" test.
- **Tool.** `extraction-tool`: the "extraction tool" tests run it through a pi-durable Harness.
- **Real reading.** `vault kv get -mount=secret -field=api_key agent/mistral | node scripts/cap-real/extraction.mjs [folder]`: 5 fictional invoices as PDFs and photos, then the double's shape against one live answer. Without a key: `skipped: no key`.

## Gotchas

- `fetch` is required for `mistral` (`extraction-fetch` otherwise): pass the Worker's or Node's `fetch`; the capability never reaches for the global one.
- OpenAI (US) costs the whole document's tokens even for one scanned page (2 and 10 USD per million input and output tokens, `TOKEN_USD`); list it after `mistral`.
- Mistral is charged at the port's page count (the asked pages, 1 for an image), never Mistral's `pages_processed`: 0.002 USD a page for text and OCR, 0.003 for fields (`PAGE_USD`, the card's figures; Mistral's pricing page gives none to check against).
- An answer that is not Mistral's JSON stops the call (`extraction-invalid-answer`): the document is never sent to the next provider after a bad answer. A key Mistral refuses moves on; when every listed provider refused its key the call is `extraction-failed`.
- A PDF protected only against printing is refused (`extraction-encrypted`) although `read_pdf` reads its text layer. Nothing is kept: a document read twice is sent and paid twice.
- The OCR callback takes no signal: a `read_pdf` stopped mid-OCR still waits for the call's `timeoutMs` (90 s by default).
