# Transcription (cap-transcription)

A plain import any app can call, with no Effect, no host and no framework: a recording becomes its text (and timed segments when asked), through Mistral then OpenAI in the app's order. A route the app mounts itself serves the kit's microphone. The text is marked `untrusted`: evidence from a recording, never instructions or consent.

## Sub-features

- `transcription-call` `transcribe({ audio, language?, segments? }, options)` from `@hachej/boring-agent/caps/transcription`: `audio` is bytes or a Blob; the type sent and its file name come from the leading bytes (WAV, WebM, Ogg, MP4/M4A, MP3), never from `type`; a result `{ ok: true, text, segments?, untrusted: true, provider, region, counted }` or a refusal, never a throw. `packages/agent/src/caps/transcription/index.ts`.
- `transcription-providers` `mistral` (Voxtral, EU, segments, `MISTRAL_API_KEY`), `openai` (gpt-transcribe, US, no timings, `OPENAI_API_KEY`), `fake`; each one HTTP call through `options.fetch` only. With `segments: true` a provider without timings is dropped from the list. `providers.ts`.
- `transcription-handler` `transcribeHandler(options | (request) => options | Response)`: POST `audio/*` (else 415), `?language=fr&segments=true`; the app's function answers 401 before the body is read; 25 MiB never buffered past; every refusal its status (413, 415, 400, 402 meter, 503, 502, 500, 499). `handler.ts`.
- `transcription-client` `transcribeClient(url)` from `@hachej/boring-agent/caps/transcription-client`: the kit's `DictationOptions["transcribe"]`; imports nothing. `client.ts`.
- `transcription-tool` `transcriptionTool({ ...options, readBytes })`: the pi-durable tool `transcribe`, closed parameters `{ path, language?, segments? }`, replay safe.

## How to get to it (user POV)

- A person holds the microphone in the kit's bar, speaks, and the text lands in the field without being sent.

## Driving it with the example journeys

Preconditions: `npm run build`; no network and no key needed.

```ts
if (url.pathname === "/api/transcribe") return transcribeHandler(async (req) => {
  const who = await signedIn(req, env); if (!who) return new Response(null, { status: 401 });
  return { providers: ["mistral", "openai"], keys: env, fetch, meter: { sink: ledgerOf(env), userId: who.id } };
})(request);
// the page: <AgentBar transcribe={transcribeClient("/api/transcribe?language=fr")} … />
```

- **Calls.** `transcription-call`, `transcription-providers`, `transcription-handler`: `node --test test/packages/agent-caps-transcription.test.mjs` (provider doubles behind `fetch`; 1-second tones in `test/fixtures/caps/transcription/`).
- **Kit microphone.** `transcription-client`: `node --test test/packages/ui-chat-react-voice.test.mjs` (the `transcription kit` test of the spawned file).
- **Tool.** `transcription-tool`: the "transcription tool" tests run it through a pi-durable Harness.
- **Real voices.** `{ echo "MISTRAL_API_KEY=…"; echo "OPENAI_API_KEY=…"; } | node scripts/cap-real/transcription.mjs <folder>` (keys from Vault, see the script's header): each clip converted by ffmpeg to WAV, WebM and Ogg, each heard by each provider.

## Gotchas

- `fetch` is required for a real provider (`transcription-fetch` otherwise). The client posts with the page's own `fetch` to the app's route.
- Charged at the billed seconds (Mistral 0.003, OpenAI 0.006 USD a minute, the card's figures); a provider that bills none is charged the recording's length (a WAV's header, else bytes ÷ 4,000 per second).
- A key or a recording refused by every listed provider ends `transcription-failed`; busy or unreachable ends `unavailable`. A body that is not the provider's JSON stops the call: the recording is never re-sent.
- `segments: true` with only `openai` listed leaves no provider: `unconfigured`.
