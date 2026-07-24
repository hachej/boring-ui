#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const EXPECTED_COMMIT = '362d709a376b0717a3970fe6d59f184902d08639'
const EXPECTED_FILES = {
  'whisperlivekit/basic_server.py': 'ae89062f8f7146a130e48b973187cd81f6451a672d93bc04e9ec1fcbb28fe78f',
  'whisperlivekit/audio_processor.py': 'c22c9e6c31268083e841ec1ee31f7543cb41ef24f1262385766768bfd5cc9baf',
  'whisperlivekit/diarization/sortformer_backend.py': '6be10add6fe198171fc23551feec39d94e92e7f48917d954ddce8aa12a38db11',
  'whisperlivekit/simul_whisper/backend.py': '11d4aef93ae67766b7c581b02ae71060fa8ad56ed30fb516dce547d2af1917ac',
  'docs/API.md': '759bd16e93ec33677bb5ffacec0d006811d10a3ada50d245699f86b75ea048e0',
  'benchmarks/h100_scatter/bench_scatter_fr_aware.json': '2c0135c69f412591658a026e41c4dbfb2aa3e6a6d54d9dd30db3c18ec548ddf3',
  'pyproject.toml': '8b88329aa53a093d894c4c3d442a2c5c1fb956a16ea8df3dab0b75a145aade6f',
  'uv.lock': '06750b16caa60432e7d1a9427cd2196e6bf926f20fc15d3c77cba78469e99ec1',
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2))
  process.exit(1)
}

function check(condition, message) {
  if (!condition) fail(message)
}

const sourceDir = resolve(process.argv[2] ?? process.env.WLK_SOURCE_DIR ?? '')
check(sourceDir !== resolve(''), 'usage: node scripts/gh912-wlk-contract-proof.mjs <pinned WhisperLiveKit checkout>')

let commit
try {
  commit = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  fail(`not a Git checkout: ${sourceDir}`)
}
check(commit === EXPECTED_COMMIT, `expected WhisperLiveKit ${EXPECTED_COMMIT}, received ${commit}`)

for (const [relativePath, expectedHash] of Object.entries(EXPECTED_FILES)) {
  const bytes = readFileSync(resolve(sourceDir, relativePath))
  const actualHash = createHash('sha256').update(bytes).digest('hex')
  check(actualHash === expectedHash, `${relativePath} hash mismatch: ${actualHash}`)
}

const read = (path) => readFileSync(resolve(sourceDir, path), 'utf8')
const server = read('whisperlivekit/basic_server.py')
const processor = read('whisperlivekit/audio_processor.py')
const sortformer = read('whisperlivekit/diarization/sortformer_backend.py')
const api = read('docs/API.md')
const benchmark = JSON.parse(read('benchmarks/h100_scatter/bench_scatter_fr_aware.json'))
const project = read('pyproject.toml')

check(server.includes('@app.websocket("/asr")'), 'native /asr WebSocket route not found')
check(server.includes('receive_bytes()'), 'binary WebSocket audio receive path not found')
check(processor.includes('pcm_chunk.copy()'), 'independent in-memory diarization audio queue path not found')
check(processor.includes('SENTINEL'), 'terminal queue sentinel cleanup path not found')
check(sortformer.includes('self.debug = False'), 'Sortformer debug audio capture is not default-off')
check(sortformer.includes('if self.debug:\n            self.audio_buffer.append(pcm_array.copy())'), 'debug-only audio retention guard changed')
check(sortformer.includes('if self.debug:\n            concatenated_audio = np.concatenate(self.audio_buffer)'), 'debug-only WAV write guard changed')
check(api.includes('"speaker": 1'), 'speaker-tagged output fixture not found')
check(api.includes('remaining_time_diarization'), 'diarization alignment state not found')
check(project.includes('version = "0.2.24"'), 'unexpected WhisperLiveKit package version')

const frenchResult = benchmark.results.find((entry) => entry.label === 'fw SS turbo')
check(frenchResult, 'French large-v3-turbo SimulStreaming benchmark result missing')
check(frenchResult.wer_pct === 5.2, `unexpected French benchmark WER: ${frenchResult.wer_pct}`)
check(frenchResult.rtf === 0.1328, `unexpected French benchmark RTF: ${frenchResult.rtf}`)

console.log(JSON.stringify({
  ok: true,
  scope: 'source-contract-only',
  upstream: { repository: 'https://github.com/QuentinFuxa/WhisperLiveKit', commit, version: '0.2.24' },
  checks: {
    binaryWebSocketAudio: true,
    speakerTaggedOutput: true,
    inMemoryFanout: true,
    terminalSentinel: true,
    debugAudioWriteDefaultOff: true,
    pinnedSourceHashes: true,
  },
  frenchPublishedBenchmark: {
    dataset: 'four bundled public audiobook samples (390 seconds total)',
    backend: frenchResult.label,
    werPercent: frenchResult.wer_pct,
    realTimeFactor: frenchResult.rtf,
    hardware: benchmark.system_info.gpu,
    limitation: 'Upstream self-report on read speech; not a French multi-speaker meeting acceptance result.',
  },
  notProven: ['CUDA runtime', 'French multi-speaker DER', 'combined GPU capacity', 'container non-retention', 'browser terminal-close behavior'],
}, null, 2))
