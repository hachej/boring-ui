#!/usr/bin/env node
// The optional real check of `transcribe` (card cap-transcription AC-16). Keys come from standard input as NAME=value lines, never from an
// argument or the environment, and are printed nowhere; an empty value is a missing key and that provider is skipped:
//   { echo "MISTRAL_API_KEY=$(vault kv get -mount=secret -field=api_key agent/mistral)"; \
//     echo "OPENAI_API_KEY=$(vault kv get -mount=secret -field=api_key agent/openai)"; } | node scripts/cap-real/transcription.mjs <folder>
// The folder holds one clip from each phone's own recorder app; each is converted with ffmpeg to 16 kHz WAV, WebM/Opus and Ogg/Opus (the
// forms the kit sends), and each provider hears each form, in text and in segments. Without a folder: the 1-second tones of the fixtures.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcribe } from '@hachej/boring-agent/caps/transcription';

const input = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
const keys = Object.fromEntries(input.split('\n').map((line) => line.split('=')).filter(([k, ...v]) => /^[A-Z_]+$/.test(k ?? '') && v.join('=').trim()).map(([k, ...v]) => [k, v.join('=').trim()]));
if (!keys.MISTRAL_API_KEY && !keys.OPENAI_API_KEY) { console.log('skipped: no key'); process.exit(0); }

const folder = process.argv[2], work = mkdtempSync(join(tmpdir(), 'cap-transcription-'));
const clips = [];
if (folder) {
  for (const name of readdirSync(folder).filter((n) => /\.(m4a|mp4|ogg|webm|wav|mp3|aac)$/i.test(n))) {
    for (const [ext, codec] of [['wav', ['-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le']], ['webm', ['-c:a', 'libopus']], ['ogg', ['-c:a', 'libopus']]]) {
      const out = join(work, `${name}.${ext}`);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(folder, name), ...codec, out]);
      clips.push([`${name}.${ext}`, new Uint8Array(readFileSync(out))]);
    }
  }
} else {
  const tones = fileURLToPath(new URL('../../test/fixtures/caps/transcription/', import.meta.url));
  for (const name of readdirSync(tones).filter((n) => n.startsWith('tone.'))) clips.push([name, new Uint8Array(readFileSync(join(tones, name)))]);
}

let billed = 0, failed = 0;
const sink = { reserveRun: async () => ({ reservationId: 'r' }), recordUsage: async (i) => { billed += i.amountMicros; return { billedMicros: i.amountMicros }; }, settleRun: async () => {}, releaseRun: async () => {} };
for (const provider of ['mistral', 'openai']) {
  if (!keys[`${provider.toUpperCase()}_API_KEY`]) { console.log(`${provider}: skipped`); continue; }
  for (const [name, audio] of clips) for (const segments of [false, true]) {
    if (segments && provider === 'openai') continue;
    billed = 0;
    const started = Date.now();
    const r = await transcribe({ audio, language: 'fr', segments }, { providers: [provider], keys, fetch, timeoutMs: 120_000, meter: { sink, userId: 'real-check' } });
    const took = Date.now() - started;
    if (!r.ok) failed += 1;
    console.log(`${provider} ${name}${segments ? ' segments' : ''}: ${r.ok ? `« ${r.text} »${r.segments ? ` (${r.segments.length} segments)` : ''}` : `refused ${r.kind}`}, ${took} ms, ${billed} micros`);
  }
}
rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
