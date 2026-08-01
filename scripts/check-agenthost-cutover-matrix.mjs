import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const matrixUrl = new URL('../docs/issues/1029/route-consumer-matrix.json', import.meta.url)
const schemaUrl = new URL('../docs/issues/1029/route-consumer-matrix.schema.json', import.meta.url)
const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'))
const schema = JSON.parse(await readFile(schemaUrl, 'utf8'))
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)

if (!validate(matrix)) {
  throw new Error(`invalid #1029 route matrix:\n${validate.errors?.map((error) =>
    `${error.instancePath || '/'} ${error.message}`).join('\n')}`)
}

const fail = (message) => { throw new Error(`invalid #1029 route matrix: ${message}`) }
const ids = new Set()
const current = new Map()
const final = new Map()
for (const route of matrix.routes) {
  if (ids.has(route.id)) fail(`duplicate id ${route.id}`)
  ids.add(route.id)
  if (route.current.length === 0) fail(`${route.id} has no current route`)
  if (route.disposition === 'delete' && route.final !== null) fail(`${route.id} delete must have final=null`)
  if (route.disposition !== 'delete' && (!route.final || route.final.length === 0)) {
    fail(`${route.id} ${route.disposition} must have final routes`)
  }
  for (const contract of route.current) {
    const owner = current.get(contract)
    if (owner && owner !== route.id) fail(`current route ${contract} appears in ${owner} and ${route.id}`)
    current.set(contract, route.id)
  }
  for (const contract of route.final ?? []) {
    const owner = final.get(contract)
    if (owner && owner !== route.id) fail(`final route ${contract} appears in ${owner} and ${route.id}`)
    final.set(contract, route.id)
  }
}

const canonicalQueueClear = 'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/queue/clear'
const deletedQueueClearAlias = 'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/queue-clear'
if (!final.has(canonicalQueueClear)) fail(`missing canonical queue clear ${canonicalQueueClear}`)
if (final.has(deletedQueueClearAlias)) fail(`deleted queue-clear alias remains final: ${deletedQueueClearAlias}`)

const requiredSliceOneRoutes = [
  'GET /api/v1/agents',
  'GET /api/v1/agents/:agentTypeId/sessions/:sessionId/attachments/:messageId/:index',
  'POST /api/v1/agents/:agentTypeId/reload',
  'GET /api/v1/agents/:agentTypeId/models',
  'GET /api/v1/agents/:agentTypeId/skills',
  'GET /api/v1/agents/:agentTypeId/commands',
  'POST /api/v1/agents/:agentTypeId/commands/execute',
  'GET /api/v1/agents/:agentTypeId/tools',
  'GET /api/v1/agents/:agentTypeId/ready-status',
]
for (const contract of requiredSliceOneRoutes) {
  if (!final.has(contract)) fail(`missing required direct Host route ${contract}`)
}

const plannedLegacyContracts = [...current.keys()]
  .filter((contract) => !final.has(contract))
  .sort()
if (plannedLegacyContracts.length === 0) fail('planned legacy-contract inventory is empty')

for (const route of matrix.routes) {
  if (route.auth === 'public' && (route.owner !== 'app-core' || route.id !== 'health')) {
    fail(`${route.id} is unexpectedly public`)
  }
  if (route.owner === 'agent-host' && route.auth === 'public') {
    fail(`${route.id} Host route must require authorization`)
  }
  for (const contract of route.final ?? []) {
    const path = contract.slice(contract.indexOf(' ') + 1)
    if (path.startsWith('/api/v1/agents') && !['authorized-scope', 'app-policy'].includes(route.auth)) {
      fail(`${route.id} addressed Agent route has invalid auth policy ${route.auth}`)
    }
  }
}

const sourceRoots = ['packages', 'apps', 'plugins', 'scripts']
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.mjs', '.json'])
const ignoredSegments = new Set(['dist', 'node_modules', '.git', '.turbo', 'coverage'])
const sourcePaths = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (sourceExtensions.has(extname(entry.name))) sourcePaths.push(path)
  }
}
for (const sourceRoot of sourceRoots) await walk(fileURLToPath(new URL(`../${sourceRoot}/`, import.meta.url)))

const classifiedPaths = [...current.keys(), ...final.keys()].map((contract) => contract.slice(contract.indexOf(' ') + 1))
const normalize = (path) => path
  .split('?', 1)[0]
  .replace(/\/\$\{[^}]+\}/g, '/:value')
  .replace(/\$\{[^}]+\}/g, '')
  .replace(/:[^/]+/g, ':value')
const classifiedNormalized = classifiedPaths.map(normalize)
const isClassified = (path) => {
  const candidate = normalize(path)
  if (candidate.endsWith('/') && classifiedNormalized.some((classified) => classified.startsWith(candidate))) {
    return true
  }
  if (candidate.startsWith('/api/v1/agent/chat/') && current.has('POST /api/v1/agent/chat')) {
    return true
  }
  const candidateSegments = candidate.split('/').filter(Boolean)
  return classifiedNormalized.some((classified) => {
    const classifiedSegments = classified.split('/').filter(Boolean)
    if (candidateSegments.length !== classifiedSegments.length) return false
    return classifiedSegments.every((segment, index) =>
      segment === ':value'
      || candidateSegments[index] === ':value'
      || candidateSegments[index] === segment)
  })
}
const unclassified = []
const routeLiteral = /["'`](\/api\/v1\/agents?(?=\/|["'`])[^"'`\s]*)["'`]/g
for (const path of sourcePaths) {
  const source = await readFile(path, 'utf8')
  for (const match of source.matchAll(routeLiteral)) {
    if (!isClassified(match[1])) {
      unclassified.push(`${relative(fileURLToPath(new URL('../', import.meta.url)), path)}: ${match[1]}`)
    }
  }
}
if (unclassified.length > 0) {
  fail(`unclassified Agent route literals:\n${unclassified.sort().join('\n')}`)
}

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const compositionIds = new Set()
for (const root of matrix.slice1Gate.compositionRoots) {
  if (compositionIds.has(root.id)) fail(`duplicate Slice 1 composition root ${root.id}`)
  compositionIds.add(root.id)
  const source = await readFile(join(repositoryRoot, root.source), 'utf8').catch(() => undefined)
  if (source === undefined) fail(`missing composition source ${root.source}`)
  const proof = await readFile(join(repositoryRoot, root.proof), 'utf8').catch(() => fail(`missing composition proof ${root.proof}`))
  if (!root.proof.startsWith(`${root.packageRoot}/`)) {
    fail(`${root.id} proof must live below its declared packageRoot`)
  }
  if (!proof.includes(root.testName)) {
    fail(`${root.id} proof does not contain its matrix-declared executable testName`)
  }
  if (root.projection === 'direct' && !source.includes('registerDirectRoutes')) {
    fail(`${root.id} direct composition source does not expose registerDirectRoutes`)
  }
  if (root.projection === 'compatibility'
    && !/(registerAgentRoutes|AgentHostLegacyRoutePolicy|createAgentHost)/.test(source)) {
    fail(`${root.id} compatibility composition source has no checked Host mount`)
  }
  if (root.projection === 'delegates-to-workspace' && !/createWorkspaceAgentServer/.test(source)) {
    fail(`${root.id} does not statically delegate to the Workspace composition`)
  }
}
for (const required of ['core', 'workspace', 'cli-folder', 'cli-workspaces', 'agent-playground', 'standalone', 'direct-agent-host']) {
  if (!compositionIds.has(required)) fail(`missing named Slice 1 composition root ${required}`)
}

const inventories = matrix.slice1Gate.sourceInventories
const publicBarrel = await readFile(join(repositoryRoot, inventories.publicServerExports.source), 'utf8')
const exportedSymbols = [...publicBarrel.matchAll(/export(?:\s+type)?\s*\{([^}]+)\}/gs)]
  .flatMap((match) => match[1].split(','))
  .map((entry) => entry.trim().split(/\s+as\s+/)[1] ?? entry.trim().split(/\s+as\s+/)[0])
  .filter((symbol) => /AgentHost|AgentRequestLedger/.test(symbol))
  .sort()
if (JSON.stringify(exportedSymbols) !== JSON.stringify([...inventories.publicServerExports.symbols].sort())) {
  fail(`public Agent Host export inventory changed; expected ${JSON.stringify(inventories.publicServerExports.symbols)}, found ${JSON.stringify(exportedSymbols)}`)
}
const packageManifest = await readFile(join(repositoryRoot, 'packages/agent/package.json'), 'utf8')
if (!packageManifest.includes('./server')) fail('Agent package export map no longer exposes the checked server barrel')

const productionSourcePaths = sourcePaths.filter((path) =>
  !path.includes('/__tests__/') && !/\.(?:test|spec)\.[^.]+$/.test(path) && !path.includes('/scripts/'))
const legacyConsumerFiles = []
const addressedGenerators = []
const compatibilityGenerators = []
for (const path of productionSourcePaths) {
  const source = await readFile(path, 'utf8')
  const sourcePath = relative(repositoryRoot, path)
  if (/\/api\/v1\/agent\/pi-chat|registerAgentRoutes|AgentHostLegacy/.test(source)) {
    legacyConsumerFiles.push(sourcePath)
  }
  if (/\/api\/v1\/agents\/\$\{[^}]+\}\/sessions\/\$\{[^}]+\}\/attachments\//.test(source)) {
    addressedGenerators.push(relative(repositoryRoot, path))
  }
  if (/\/api\/v1\/agent\/pi-chat\/\$\{[^}]+\}\/attachments\//.test(source)) {
    compatibilityGenerators.push(relative(repositoryRoot, path))
  }
}
legacyConsumerFiles.sort()
addressedGenerators.sort()
compatibilityGenerators.sort()
const createAgentAppConsumers = []
for (const path of sourcePaths) {
  const sourcePath = relative(repositoryRoot, path)
  if (sourcePath.includes('/__tests__/') || /\.(?:test|spec)\.[^.]+$/.test(sourcePath)) continue
  if (
    sourcePath === 'packages/agent/src/server/createAgentApp.ts'
    || sourcePath === 'packages/agent/src/server/index.ts'
    || sourcePath === 'scripts/check-agenthost-cutover-matrix.mjs'
  ) continue
  const source = await readFile(path, 'utf8')
  if (/import[^\n]*\bcreateAgentApp\b/.test(source) || /\.createAgentApp\s*\(/.test(source)) {
    createAgentAppConsumers.push(sourcePath)
  }
}
createAgentAppConsumers.sort()
if (createAgentAppConsumers.length > 0) {
  fail(`createAgentApp still has production consumers:\n${createAgentAppConsumers.join('\n')}`)
}
const legacyDigest = createHash('sha256').update(JSON.stringify(legacyConsumerFiles)).digest('hex')
if (legacyConsumerFiles.length !== inventories.legacyReferences.count
  || legacyDigest !== inventories.legacyReferences.sha256) {
  fail(`legacy reference inventory changed; found count=${legacyConsumerFiles.length} sha256=${legacyDigest}`)
}
const reviewedLegacyFiles = inventories.legacyReferences.files.map((entry) => entry.source).sort()
if (JSON.stringify(legacyConsumerFiles) !== JSON.stringify(reviewedLegacyFiles)) {
  fail(`reviewed legacy reference files changed; found ${JSON.stringify(legacyConsumerFiles)}`)
}

const legacyServerTestAllowlist = new Set([
  'packages/agent/src/server/__tests__/createAgentApp.test.ts',
  'packages/agent/src/server/__tests__/registerAgentRoutes.lifecycle.test.ts',
  'packages/agent/src/server/__tests__/registerAgentRoutes.test.ts',
  'packages/agent/src/server/agent-host/__tests__/httpProjection.test.ts',
  'packages/agent/src/server/agent-host/__tests__/legacyTranscriptCompatibility.test.ts',
  'packages/agent/src/server/agent-host/__tests__/lifecycle.test.ts',
  'packages/agent/src/server/harness/pi-coding-agent/__tests__/sessions.load.test.ts',
  'packages/agent/src/server/http/routes/__tests__/piChat.test.ts',
  'packages/agent/src/server/pi-chat/__tests__/piChatHistory.test.ts',
])
const forbiddenLegacyPiChatRoute = '/api/v1/agent/' + 'pi-chat'
const forbiddenLegacyClientReferences = []
for (const path of sourcePaths) {
  const sourcePath = relative(repositoryRoot, path)
  const isTest = sourcePath.includes('/__tests__/') || /\.(?:test|spec)\.[^.]+$/.test(sourcePath)
  const isTargetedSurface = isTest
    || sourcePath.startsWith('plugins/')
    || sourcePath.includes('/e2e/')
    || sourcePath.includes('/src/front/')
    || sourcePath.includes('/src/eval/')
    || sourcePath.includes('/src/bin/')
    || /(?:^|\/)[^/]*(?:eval|smoke|e2e)[^/]*\.(?:ts|tsx|mts|mjs)$/.test(sourcePath)
    || sourcePath.startsWith('packages/plugin-cli/')
  if (!isTargetedSurface || legacyServerTestAllowlist.has(sourcePath)) continue
  const source = await readFile(path, 'utf8')
  if (source.includes(forbiddenLegacyPiChatRoute)) forbiddenLegacyClientReferences.push(sourcePath)
}
if (forbiddenLegacyClientReferences.length > 0) {
  fail(`legacy pi-chat route remains in migrated client/eval/bin/plugin/smoke/E2E surfaces:\n${forbiddenLegacyClientReferences.sort().join('\n')}`)
}
if (JSON.stringify(addressedGenerators) !== JSON.stringify([...inventories.generatedAttachmentUrls.addressed].sort())) {
  fail(`addressed attachment URL generator inventory changed; found ${JSON.stringify(addressedGenerators)}`)
}
if (JSON.stringify(compatibilityGenerators) !== JSON.stringify([...inventories.generatedAttachmentUrls.compatibility].sort())) {
  fail(`compatibility attachment URL generator inventory changed; found ${JSON.stringify(compatibilityGenerators)}`)
}
const authorizationProof = await readFile(join(repositoryRoot, inventories.authorizationProof), 'utf8')
if (!/AGENT_SCOPE_DENIED[\s\S]*statusCode\)\.toBe\(403\)/.test(authorizationProof)) {
  fail('authorization proof no longer asserts an addressed Host denial as HTTP 403')
}

console.log(`#1029 Slice 1 matrix valid: ${matrix.routes.length} rows, ${final.size} final routes, ${plannedLegacyContracts.length} planned legacy contracts, ${legacyConsumerFiles.length} exact legacy-reference source files`)
