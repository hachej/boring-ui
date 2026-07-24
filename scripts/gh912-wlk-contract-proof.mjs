#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EVIDENCE_DIR = resolve(REPO_ROOT, 'docs/issues/912/spikes/whisperlivekit')
const ATTESTATION_PATH = resolve(EVIDENCE_DIR, 'attestation.json')
const PATCH_PATH = resolve(EVIDENCE_DIR, 'cpu-diart-compat.patch')
const LOCK_PATH = resolve(EVIDENCE_DIR, 'cpu-v0-requirements.lock')

const EXPECTED_COMMIT = '362d709a376b0717a3970fe6d59f184902d08639'
const EXPECTED_DIART_COMMIT = '392d53a1b0cd67701ecc20b683bb10614df2f7fc'
const EXPECTED_PATCH_HASH = 'a40f720273eddc5702bfa9a95e204d07dba2b11cd9f17b5abff609bcdf722985'
const EXPECTED_LOCK_HASH = '0373dc91cde73485ddc473d0eda2ff725b1ae355ffee4243a785c95637cf76ad'

const EXPECTED_SOURCE_FILES = {
  'whisperlivekit/basic_server.py': 'ae89062f8f7146a130e48b973187cd81f6451a672d93bc04e9ec1fcbb28fe78f',
  'whisperlivekit/audio_processor.py': 'c22c9e6c31268083e841ec1ee31f7543cb41ef24f1262385766768bfd5cc9baf',
  'whisperlivekit/core.py': '70b123ec69659f8f98c225b12106730aa837032b7a899ed2f6f4cfe73ac72ecd',
  'whisperlivekit/diarization/diart_backend.py': 'c69fdf7155262f176b51e4d08edd0f535674aeb9cb08e6d253349b3901e5968a',
  'whisperlivekit/diarization/utils.py': '8d14eb1ef67844904fdcaf8caf728ed337f5b7453d655b53924eac9c2f838dfb',
  'whisperlivekit/simul_whisper/backend.py': '11d4aef93ae67766b7c581b02ae71060fa8ad56ed30fb516dce547d2af1917ac',
  'docs/API.md': '759bd16e93ec33677bb5ffacec0d006811d10a3ada50d245699f86b75ea048e0',
  'pyproject.toml': '8b88329aa53a093d894c4c3d442a2c5c1fb956a16ea8df3dab0b75a145aade6f',
  'uv.lock': '06750b16caa60432e7d1a9427cd2196e6bf926f20fc15d3c77cba78469e99ec1',
}

const EXPECTED_TINY_FILES = {
  'config.json': 'a73a28cdfe1c43ccc7202fa333d1f89c202477271407ae9a7f19afa52039cac8',
  'model.bin': 'dcb76c6586fc06cbdac6dd21f14cfd129cc4cdd9dce19bf4ffa62e59cbe6e6d1',
  'tokenizer.json': 'fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab',
  'vocabulary.txt': '34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913',
}

const EXPECTED_DIART_FILES = {
  'assets/models/embedding_uint8.onnx': 'a18f844ac553c6bebc1108e0f9d042d12acbc0f45513be46e12612ee235adafc',
  'assets/models/segmentation_uint8.onnx': 'b09476b580a5ed3c2b53d1abc44c3ec29f4e87fdf0eb6e8ec1274cb610ece612',
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2))
  process.exit(1)
}

function check(condition, message) {
  if (!condition) fail(message)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function checkFiles(root, files) {
  for (const [relativePath, expectedHash] of Object.entries(files)) {
    const actualHash = sha256(resolve(root, relativePath))
    check(actualHash === expectedHash, `${relativePath} hash mismatch: ${actualHash}`)
  }
}

function gitCommit(root, label) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    fail(`${label} is not a Git checkout: ${root}`)
  }
}

const [sourceArg, tinyArg, diartArg] = process.argv.slice(2)
check(sourceArg && tinyArg && diartArg,
  'usage: node scripts/gh912-wlk-contract-proof.mjs <WhisperLiveKit checkout> <faster-whisper-tiny snapshot> <diart checkout>')

const sourceDir = resolve(sourceArg)
const tinyModelDir = resolve(tinyArg)
const diartDir = resolve(diartArg)
const sourceCommit = gitCommit(sourceDir, 'WhisperLiveKit source')
const diartCommit = gitCommit(diartDir, 'Diart source')
check(sourceCommit === EXPECTED_COMMIT, `expected WhisperLiveKit ${EXPECTED_COMMIT}, received ${sourceCommit}`)
check(diartCommit === EXPECTED_DIART_COMMIT, `expected Diart ${EXPECTED_DIART_COMMIT}, received ${diartCommit}`)
checkFiles(sourceDir, EXPECTED_SOURCE_FILES)
checkFiles(tinyModelDir, EXPECTED_TINY_FILES)
checkFiles(diartDir, EXPECTED_DIART_FILES)
check(sha256(PATCH_PATH) === EXPECTED_PATCH_HASH, 'CPU/Diart compatibility patch hash mismatch')
check(sha256(LOCK_PATH) === EXPECTED_LOCK_HASH, 'CPU V0 package manifest hash mismatch')

try {
  execFileSync('git', ['-C', sourceDir, 'apply', '--check', PATCH_PATH], { stdio: 'pipe' })
} catch {
  fail('CPU/Diart compatibility patch no longer applies cleanly to the pinned source')
}

const readSource = (path) => readFileSync(resolve(sourceDir, path), 'utf8')
const server = readSource('whisperlivekit/basic_server.py')
const processor = readSource('whisperlivekit/audio_processor.py')
const core = readSource('whisperlivekit/core.py')
const diart = readSource('whisperlivekit/diarization/diart_backend.py')
const api = readSource('docs/API.md')
const project = readSource('pyproject.toml')
const patch = readFileSync(PATCH_PATH, 'utf8')
const lock = readFileSync(LOCK_PATH, 'utf8')
const attestation = JSON.parse(readFileSync(ATTESTATION_PATH, 'utf8'))

check(server.includes('@app.websocket("/asr")'), 'native /asr WebSocket route not found')
check(server.includes('receive_bytes()'), 'binary WebSocket audio receive path not found')
check(server.includes('websocket.query_params.get("mode", "full")'), 'full snapshot default changed')
check(processor.includes('pcm_chunk.copy()'), 'independent in-memory diarization audio queue path not found')
check(processor.includes('SENTINEL'), 'terminal queue sentinel cleanup path not found')
check(core.includes('segmentation_model=config.segmentation_model'), 'expected pre-patch Diart constructor call changed')
check(diart.includes('speaker=speaker,'), 'expected pre-patch Diart speaker boundary changed')
check(diart.includes('from whisperlivekit.diarization.utils import extract_number'), 'numeric speaker helper missing')
check(!/(diarization_audio\.wav|soundfile|wavfile|write_wav|audio_buffer)/i.test(diart),
  'active Diart backend gained an audio-file/debug accumulation path')
check(patch.includes('segmentation_model_name=config.segmentation_model'), 'constructor compatibility change missing')
check(patch.includes('speaker=extract_number(speaker)'), 'speaker normalization change missing')
check(api.includes('"speaker": 1'), 'speaker-tagged output fixture not found')
check(api.includes('remaining_time_diarization'), 'diarization backlog field not found')
check(project.includes('version = "0.2.24"'), 'unexpected WhisperLiveKit package version')
check(lock.includes('faster-whisper==1.2.1'), 'Faster-Whisper runtime pin missing')
check(lock.includes('diart==0.9.2'), 'Diart runtime pin missing')
check(lock.includes('matplotlib==3.10.9'), 'compatible matplotlib pin missing')
check(lock.includes('huggingface-hub==0.36.2'), 'compatible Hugging Face Hub pin missing')

check(attestation.schemaVersion === 2, 'unexpected attestation schema')
check(attestation.status === 'local-cpu-v0-runtime-passed', 'CPU V0 attestation is not passed')
check(attestation.models.asr.revision === 'd90ca5fe260221311c53c58e660288d3deb8d356', 'tiny revision drift')
check(attestation.models.diarization.revision === EXPECTED_DIART_COMMIT, 'Diart revision drift')
check(attestation.compatibilityPatch.sha256 === `sha256:${EXPECTED_PATCH_HASH}` ||
  attestation.compatibilityPatch.sha256 === EXPECTED_PATCH_HASH, 'attested patch hash drift')
check(attestation.runtime.packageManifest.sha256 === `sha256:${EXPECTED_LOCK_HASH}` ||
  attestation.runtime.packageManifest.sha256 === EXPECTED_LOCK_HASH, 'attested package manifest hash drift')
check(attestation.wireContract.path === '/asr?language=fr&mode=full', 'V0 wire mode is not full snapshot')
check(attestation.runtime.nativeDependencies.libportaudio2, 'libportaudio2 native dependency is not attested')

console.log(JSON.stringify({
  ok: true,
  scope: 'local-cpu-v0-source-model-runtime-contract',
  upstream: { repository: 'https://github.com/QuentinFuxa/WhisperLiveKit', commit: sourceCommit, version: '0.2.24' },
  models: {
    asr: { repository: 'Systran/faster-whisper-tiny', revision: attestation.models.asr.revision },
    diarization: { repository: 'juanmc2005/diart', revision: diartCommit },
  },
  checks: {
    binaryPcmWebSocket: true,
    fullSnapshotMode: true,
    speakerTaggedOutput: true,
    inMemoryFanout: true,
    activeDiartHasNoAudioFileWritePath: true,
    compatibilityPatchApplies: true,
    pinnedSourceModelAndOnnxHashes: true,
    pinnedCpuPackageManifest: true,
  },
  runtimeObservation: attestation.cpuSmoke,
  notProven: ['production authentication', 'atomic Workspace CAS', 'French WER/DER', 'host-wide non-retention'],
}, null, 2))
