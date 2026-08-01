import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const matrixUrl = new URL('../docs/issues/1029/route-consumer-matrix.json', import.meta.url)
const schemaUrl = new URL('../docs/issues/1029/route-consumer-matrix.schema.json', import.meta.url)
const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'))
const schema = JSON.parse(await readFile(schemaUrl, 'utf8'))
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)

if (!validate(matrix)) {
  throw new Error(`invalid #1029 final route matrix:\n${validate.errors?.map((error) =>
    `${error.instancePath || '/'} ${error.message}`).join('\n')}`)
}

const fail = (message) => { throw new Error(`invalid #1029 final route matrix: ${message}`) }
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const ids = new Set()
const historicalRoutes = new Map()
const finalRoutes = new Map()
for (const route of matrix.routes) {
  if (ids.has(route.id)) fail(`duplicate id ${route.id}`)
  ids.add(route.id)
  if (route.disposition === 'delete' && route.final !== null) fail(`${route.id} delete must have final=null`)
  if (route.disposition !== 'delete' && (!route.final || route.final.length === 0)) {
    fail(`${route.id} ${route.disposition} must have final routes`)
  }
  for (const contract of route.current) {
    const owner = historicalRoutes.get(contract)
    if (owner && owner !== route.id) fail(`historical route ${contract} appears in both ${owner} and ${route.id}`)
    historicalRoutes.set(contract, route.id)
  }
  for (const contract of (route.final ?? [])) {
    const owner = finalRoutes.get(contract)
    if (owner) fail(`route ${contract} appears in both ${owner} and ${route.id}`)
    finalRoutes.set(contract, route.id)
  }
  if (route.auth === 'public' && (route.owner !== 'app-core' || !['health', 'app-readiness'].includes(route.id))) {
    fail(`${route.id} is unexpectedly public`)
  }
  if (route.owner === 'agent-host' && route.auth === 'public') {
    fail(`${route.id} Host route must require authorization`)
  }
}

const deletionRow = matrix.routes.find((route) => route.id === 'old-agent-chat')
if (!deletionRow || deletionRow.disposition !== 'delete' || deletionRow.final !== null || deletionRow.slice !== 6) {
  fail('old-agent-chat deletion history row is missing or incomplete')
}
const historicalLegacyContracts = [...historicalRoutes.keys()].filter((contract) => !finalRoutes.has(contract))
if (historicalLegacyContracts.length === 0) fail('legacy deletion history is empty')
for (const contract of historicalLegacyContracts) {
  if (finalRoutes.has(contract)) fail(`historical legacy route remains final: ${contract}`)
}

const canonicalQueueClear = 'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/queue/clear'
const deletedQueueClearAlias = 'POST /api/v1/agents/:agentTypeId/sessions/:sessionId/queue-clear'
if (!finalRoutes.has(canonicalQueueClear)) fail(`missing canonical queue clear ${canonicalQueueClear}`)
if (finalRoutes.has(deletedQueueClearAlias)) fail(`deleted queue-clear alias remains: ${deletedQueueClearAlias}`)
for (const contract of [
  'GET /api/v1/agents',
  'GET /api/v1/agents/:agentTypeId/sessions/:sessionId/attachments/:messageId/:index',
  'POST /api/v1/agents/:agentTypeId/reload',
  'GET /api/v1/agents/:agentTypeId/models',
  'GET /api/v1/agents/:agentTypeId/skills',
  'GET /api/v1/agents/:agentTypeId/commands',
  'POST /api/v1/agents/:agentTypeId/commands/execute',
  'GET /api/v1/agents/:agentTypeId/tools',
  'GET /api/v1/agents/:agentTypeId/ready-status',
]) {
  if (!finalRoutes.has(contract)) fail(`missing required direct Host route ${contract}`)
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
for (const sourceRoot of sourceRoots) await walk(join(repositoryRoot, sourceRoot))

const normalize = (path) => path
  .split('?', 1)[0]
  .replace(/\/\$\{[^}]+\}/g, '/:value')
  .replace(/\$\{[^}]+\}/g, '')
  .replace(/:[^/]+/g, ':value')
const classified = [...finalRoutes.keys()].map((contract) => normalize(contract.slice(contract.indexOf(' ') + 1)))
const isClassified = (path) => {
  const candidate = normalize(path)
  if (candidate.endsWith('/') && classified.some((value) => value.startsWith(candidate))) return true
  const candidateSegments = candidate.split('/').filter(Boolean)
  return classified.some((value) => {
    const segments = value.split('/').filter(Boolean)
    return segments.length === candidateSegments.length && segments.every((segment, index) =>
      segment === ':value' || candidateSegments[index] === ':value' || candidateSegments[index] === segment)
  })
}
const unclassified = []
const routeLiteral = /["'`](\/api\/v1\/agents?(?=\/|["'`])[^"'`\s]*)["'`]/g
for (const path of sourcePaths) {
  const source = await readFile(path, 'utf8')
  for (const match of source.matchAll(routeLiteral)) {
    if (!isClassified(match[1])) unclassified.push(`${relative(repositoryRoot, path)}: ${match[1]}`)
  }
}
if (unclassified.length > 0) fail(`unclassified Agent route literals:\n${unclassified.sort().join('\n')}`)

const compositionIds = new Set()
for (const root of matrix.finalGate.compositionRoots) {
  if (compositionIds.has(root.id)) fail(`duplicate composition root ${root.id}`)
  compositionIds.add(root.id)
  const source = await readFile(join(repositoryRoot, root.source), 'utf8').catch(() => undefined)
  if (source === undefined) fail(`missing composition source ${root.source}`)
  await readFile(join(repositoryRoot, root.proof), 'utf8').catch(() => fail(`missing composition proof ${root.proof}`))
  if (!root.proof.startsWith(`${root.packageRoot}/`)) fail(`${root.id} proof must live below packageRoot`)
  for (const routeId of root.applicableRouteIds) {
    const route = matrix.routes.find((candidate) => candidate.id === routeId)
    if (!route || route.final === null) fail(`${root.id} has unknown/deleted applicable route ${routeId}`)
  }
  for (const route of matrix.routes.filter((candidate) => candidate.owner === 'agent-host')) {
    if (!root.applicableRouteIds.includes(route.id)) fail(`${root.id} omits canonical Host route ${route.id}`)
  }
}
for (const required of ['core', 'workspace', 'cli-folder', 'cli-workspaces', 'agent-playground', 'standalone', 'direct-agent-host']) {
  if (!compositionIds.has(required)) fail(`missing composition root ${required}`)
}

const inventories = matrix.finalGate.sourceInventories
const forbiddenMatches = []
for (const path of sourcePaths) {
  const sourcePath = relative(repositoryRoot, path)
  const source = await readFile(path, 'utf8')
  for (const pattern of inventories.forbiddenReferences.patterns) {
    if (source.includes(pattern)) forbiddenMatches.push(`${sourcePath}: ${pattern}`)
  }
}
if (forbiddenMatches.length !== inventories.forbiddenReferences.count) {
  fail(`forbidden compatibility references remain:\n${forbiddenMatches.sort().join('\n')}`)
}
if (inventories.forbiddenReferences.files.length !== 0) fail('forbidden reference file inventory must remain empty')

const publicBarrel = await readFile(join(repositoryRoot, inventories.publicServerExports.source), 'utf8')
if (/export\s*\{[^}]*\bcreateAgent\b[^}]*\}\s*from\s*['"]\.\/createAgent['"]/s.test(publicBarrel)) {
  fail('server public barrel must not export the Host-internal createAgent facade')
}
const exportedSymbols = [...publicBarrel.matchAll(/export(?:\s+type)?\s*\{([^}]+)\}/gs)]
  .flatMap((match) => match[1].split(','))
  .map((entry) => entry.trim().split(/\s+as\s+/)[1] ?? entry.trim().split(/\s+as\s+/)[0])
  .filter((symbol) => /AgentHost|AgentRequestLedger/.test(symbol))
  .sort()
if (JSON.stringify(exportedSymbols) !== JSON.stringify([...inventories.publicServerExports.symbols].sort())) {
  fail(`public Agent Host export inventory changed; expected ${JSON.stringify(inventories.publicServerExports.symbols)}, found ${JSON.stringify(exportedSymbols)}`)
}

const addressedGenerators = []
for (const path of sourcePaths.filter((path) => !path.includes('/__tests__/') && !/\.(?:test|spec)\.[^.]+$/.test(path))) {
  const source = await readFile(path, 'utf8')
  if (/\/api\/v1\/agents\/(?:default|\$\{[^}]+\})\/sessions\/\$\{[^}]+\}\/attachments\//.test(source)) {
    addressedGenerators.push(relative(repositoryRoot, path))
  }
}
addressedGenerators.sort()
if (JSON.stringify(addressedGenerators) !== JSON.stringify([...inventories.generatedAttachmentUrls.addressed].sort())) {
  fail(`addressed attachment URL generator inventory changed; found ${JSON.stringify(addressedGenerators)}`)
}
const authorizationProof = await readFile(join(repositoryRoot, inventories.authorizationProof), 'utf8')
if (!/AGENT_SCOPE_DENIED[\s\S]*statusCode\)\.toBe\(403\)/.test(authorizationProof)) {
  fail('authorization proof no longer asserts an addressed Host denial as HTTP 403')
}

const bridgeAuthority = inventories.runtimeBridgeAuthority
if (bridgeAuthority.disposition !== 'standalone-core-only') {
  fail(`unexpected createAgent runtime bridge disposition: ${bridgeAuthority.disposition}`)
}
const productionSourcePaths = sourcePaths.filter((path) =>
  !path.includes('/__tests__/') && !/\.(?:test|spec)\.[^.]+$/.test(path) && !path.includes('/scripts/'))
const runtimeBridgeCallers = []
const liveBufferConstructors = []
for (const path of productionSourcePaths) {
  const sourcePath = relative(repositoryRoot, path)
  const source = await readFile(path, 'utf8')
  if (/\bcreateAgentRuntimeBridge\s*\(/.test(source)
    && sourcePath !== bridgeAuthority.implementation
    && sourcePath !== 'packages/agent/src/server/createAgent.ts') {
    runtimeBridgeCallers.push(sourcePath)
  }
  if (/\bnew\s+AgentLiveEventBuffer\s*\(/.test(source)) liveBufferConstructors.push(sourcePath)
}
if (JSON.stringify(runtimeBridgeCallers.sort()) !== JSON.stringify(bridgeAuthority.hostProductionCallers)) {
  fail(`createAgentRuntimeBridge production callers changed: ${JSON.stringify(runtimeBridgeCallers.sort())}`)
}
if (JSON.stringify(liveBufferConstructors.sort()) !== JSON.stringify(['packages/agent/src/core/createAgent.ts'])) {
  fail(`AgentLiveEventBuffer authority changed: ${JSON.stringify(liveBufferConstructors.sort())}`)
}

console.log(`#1029 final matrix valid: ${matrix.routes.length} rows, ${finalRoutes.size} final routes, ${historicalLegacyContracts.length} deleted historical routes, zero forbidden compatibility references`)
