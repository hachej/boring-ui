/**
 * toolArtifactBridge — Maps tool call results to Surface artifacts.
 *
 * Given a tool name, its arguments, and its result, determines whether
 * the tool result should open an artifact in the Surface and, if so,
 * produces a SurfaceArtifact descriptor ready for useArtifactController.open().
 *
 * Rules:
 *   write_file  -> shouldOpen: true,  kind: 'code', canonicalKey: args.path
 *   edit_file   -> shouldOpen: true,  kind: 'code', canonicalKey: args.path
 *   open_file   -> shouldOpen: true,  kind: 'code', canonicalKey: args.path
 *   read_file   -> shouldOpen: false  (read-only, just show in chat)
 *   bash        -> shouldOpen: false
 *   search_files -> shouldOpen: false
 *   unknown     -> shouldOpen: false
 *
 * Usage:
 *   import { bridgeToolResultToArtifact } from '../shell/toolArtifactBridge'
 *   const { shouldOpen, artifact } = bridgeToolResultToArtifact(toolName, args, result, activeSessionId)
 *   if (shouldOpen && artifact) {
 *     artifactController.open(artifact)
 *   }
 */

// Tools that produce artifacts which should open in the Surface
const ARTIFACT_PRODUCING_TOOLS = new Set([
  'write_file',
  'edit_file',
  'open_file',
])

/**
 * Extract the filename from a file path.
 * @param {string} filePath
 * @returns {string}
 */
function basename(filePath) {
  if (!filePath) return 'untitled'
  const parts = filePath.split('/')
  return parts[parts.length - 1] || 'untitled'
}

/**
 * Generate a unique artifact ID.
 * @returns {string}
 */
function generateArtifactId() {
  return `art-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create a SurfaceArtifact from a file-producing tool result.
 * @param {string} filePath - The canonical file path
 * @param {string} activeSessionId - The current session ID
 * @returns {object} SurfaceArtifact
 */
function createCodeArtifact(filePath, activeSessionId) {
  return {
    id: generateArtifactId(),
    canonicalKey: filePath,
    kind: 'code',
    title: basename(filePath),
    source: 'tool',
    sourceSessionId: activeSessionId,
    rendererKey: null,
    params: {},
    status: 'ready',
    dirty: false,
    createdAt: Date.now(),
  }
}

/**
 * Bridge a tool call result to a Surface artifact descriptor.
 *
 * @param {string} toolName - The name of the tool that was called
 * @param {object} args - The tool's input arguments
 * @param {object} result - The tool's output result
 * @param {string} activeSessionId - The current session ID
 * @returns {{ shouldOpen: boolean, artifact: object | null }}
 */
export function bridgeToolResultToArtifact(toolName, args, result, activeSessionId) {
  if (!ARTIFACT_PRODUCING_TOOLS.has(toolName)) {
    return { shouldOpen: false, artifact: null }
  }

  const filePath = args?.path
  if (!filePath) {
    return { shouldOpen: false, artifact: null }
  }

  return {
    shouldOpen: true,
    artifact: createCodeArtifact(filePath, activeSessionId),
  }
}
