import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import type { FastifyPluginAsync } from "fastify"
import { defineServerPlugin, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { AuthStorage } from "@mariozechner/pi-coding-agent"
import { generateImages, getImageModels, getImageProviders, getEnvApiKey, type ImagesModel, type ImagesApi, type ImagesProvider } from "@earendil-works/pi-ai"
import { DIAGRAM_PLUGIN_ID, renderTargetFor } from "../shared"

interface ModelSelection {
  provider: string
  id: string
}

interface RenderModelsResponse {
  models: Array<{ provider: string; id: string; label: string; available: boolean; configured: boolean }>
  defaultModel?: ModelSelection
  authConfigured: boolean
  authHint?: string
}

interface RenderRequestBody {
  path?: string
  prompt?: string
  model?: string
  sketchPngBase64?: string
  mimeType?: string
}

interface RenderResponse {
  ok: true
  path: string
  model: string
  prompt: string
  mimeType: string
}

type RenderErrorCode =
  | "validation_error"
  | "render_auth_unconfigured"
  | "render_model_unavailable"
  | "render_generation_failed"
  | "render_output_missing"
  | "render_output_rejected"
  | "render_internal_error"

const DEFAULT_IMAGE_MODEL_KEY = "openrouter:openrouter/auto"
const MAX_PROMPT_LENGTH = 4000
const MAX_IMAGE_BASE64_LENGTH = 20 * 1024 * 1024

export default function defaultDiagramServerPlugin(
  _options: unknown,
  ctx: { workspaceRoot: string },
): WorkspaceServerPlugin {
  return createDiagramServerPlugin({ workspaceRoot: ctx.workspaceRoot })
}

export function createDiagramServerPlugin(options: { workspaceRoot: string }): WorkspaceServerPlugin {
  const authStorage = AuthStorage.create()
  const routes: FastifyPluginAsync = async (app) => {
    app.get("/api/v1/plugins/diagram/render/models", async (): Promise<RenderModelsResponse> => {
      const models = listRenderableImageModels()
      const defaultModel = resolveDefaultModel(models)
      const responseModels = await Promise.all(models.map(async (model) => {
        const configured = Boolean(await resolveImageApiKey(authStorage, model.provider))
        return {
          provider: model.provider,
          id: model.id,
          label: model.name || model.id,
          available: configured,
          configured,
        }
      }))
      const authConfigured = responseModels.some((model) => model.available)
      return {
        models: responseModels,
        defaultModel,
        authConfigured,
        ...(authConfigured ? {} : { authHint: "Configure an API key for a Pi image provider, for example OPENROUTER_API_KEY, to enable Diagram image rendering." }),
      }
    })

    app.post<{ Body: RenderRequestBody }>("/api/v1/plugins/diagram/render", async (request, reply): Promise<RenderResponse> => {
      const body = request.body ?? {}
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
      if (!prompt) return sendRenderError(reply, 400, "validation_error", "prompt is required") as never
      if (prompt.length > MAX_PROMPT_LENGTH) return sendRenderError(reply, 400, "validation_error", "prompt is too long") as never

      const sketchPngBase64 = typeof body.sketchPngBase64 === "string" ? body.sketchPngBase64 : ""
      if (!sketchPngBase64) return sendRenderError(reply, 400, "validation_error", "sketchPngBase64 is required") as never
      if (sketchPngBase64.length > MAX_IMAGE_BASE64_LENGTH) return sendRenderError(reply, 413, "validation_error", "sketch image is too large") as never

      const models = listRenderableImageModels()
      const model = resolveRequestedModel(models, body.model)
      if (!model) return sendRenderError(reply, 500, "render_model_unavailable", "no image models are available") as never
      const apiKey = await resolveImageApiKey(authStorage, model.provider)
      if (!apiKey) return sendRenderError(reply, 400, "render_auth_unconfigured", `${model.provider} image rendering is not configured`) as never

      try {
        const mimeType = body.mimeType === "image/jpeg" ? "image/jpeg" : "image/png"
        const generated = await generateImages(model, {
          input: [
            { type: "text", text: renderPrompt(prompt) },
            { type: "image", mimeType, data: sketchPngBase64 },
          ],
        }, {
          apiKey,
          timeoutMs: 120_000,
          maxRetries: 1,
        })

        if (generated.stopReason === "error") {
          return sendRenderError(reply, 502, "render_generation_failed", generated.errorMessage || "image generation failed") as never
        }
        const image = generated.output.find((item) => item.type === "image")
        if (!image || image.type !== "image") return sendRenderError(reply, 502, "render_output_missing", "image model returned no image") as never

        const outputPath = renderTargetFor(typeof body.path === "string" ? body.path : "")
        const metadata = {
          schemaVersion: 1,
          kind: "diagram.render" as const,
          sourcePath: typeof body.path === "string" ? body.path : "",
          outputPath,
          prompt: { text: prompt },
          model: { provider: model.provider, id: model.id },
          generatedAt: new Date().toISOString(),
          response: {
            id: generated.responseId,
            usage: generated.usage,
            mimeType: image.mimeType,
          },
        }
        const absoluteOutputPath = resolveWorkspaceFile(options.workspaceRoot, outputPath)
        const imageBytes = Buffer.from(image.data, "base64")
        await writeWorkspaceFileNoSymlink(options.workspaceRoot, absoluteOutputPath, withPngTextMetadata(imageBytes, {
          "boring.diagram.schema": JSON.stringify({ schemaVersion: metadata.schemaVersion, kind: metadata.kind }),
          "boring.diagram.prompt": prompt,
          "boring.diagram.metadata": JSON.stringify(metadata),
        }))
        const metadataPath = absoluteOutputPath.replace(/\.png$/i, ".json")
        await writeWorkspaceFileNoSymlink(options.workspaceRoot, metadataPath, JSON.stringify(metadata, null, 2))

        return {
          ok: true,
          path: outputPath,
          model: model.id,
          prompt,
          mimeType: image.mimeType,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "image rendering failed"
        const lower = message.toLowerCase()
        if (lower.includes("path") || lower.includes("symlink")) {
          return sendRenderError(reply, 400, "render_output_rejected", message) as never
        }
        if (lower.includes("image") || lower.includes("generation") || lower.includes("timeout")) {
          return sendRenderError(reply, 502, "render_generation_failed", message) as never
        }
        return sendRenderError(reply, 500, "render_internal_error", message) as never
      }
    })
  }

  return defineServerPlugin({
    id: DIAGRAM_PLUGIN_ID,
    label: "Diagram",
    systemPrompt: "Diagram files can be opened in the workspace UI. Use the Render control in the Diagram pane to turn diagrams into generated images when requested.",
    routes,
  })
}

function sendRenderError(reply: { code(statusCode: number): { send(payload: unknown): unknown } }, statusCode: number, code: RenderErrorCode, message: string): unknown {
  return reply.code(statusCode).send({ error: { code, message } })
}

function listRenderableImageModels(): Array<ImagesModel<ImagesApi>> {
  return getImageProviders().flatMap((provider) => getImageModels(provider).filter((model) => model.input.includes("image") && model.output.includes("image"))) as Array<ImagesModel<ImagesApi>>
}

function encodeModelKey(model: Pick<ImagesModel<ImagesApi>, "provider" | "id">): string {
  return `${model.provider}:${model.id}`
}

function resolveDefaultModel(models: Array<ImagesModel<ImagesApi>>): ModelSelection | undefined {
  const configured = process.env.BORING_DIAGRAM_RENDER_MODEL ?? process.env.BORING_EXCALIDRAW_RENDER_MODEL
  if (configured) {
    const match = models.find((model) => encodeModelKey(model) === configured || model.id === configured)
    if (match) return { provider: match.provider, id: match.id }
  }
  const preferred = models.find((model) => encodeModelKey(model) === DEFAULT_IMAGE_MODEL_KEY || model.id === "openrouter/auto")
  const model = preferred ?? models[0]
  return model ? { provider: model.provider, id: model.id } : undefined
}

function resolveRequestedModel(models: Array<ImagesModel<ImagesApi>>, requested: string | undefined): ImagesModel<ImagesApi> | undefined {
  const defaultModel = resolveDefaultModel(models)
  const requestedKey = requested || (defaultModel ? `${defaultModel.provider}:${defaultModel.id}` : undefined)
  return models.find((model) => requestedKey && (encodeModelKey(model) === requestedKey || model.id === requestedKey))
    ?? models.find((model) => encodeModelKey(model) === DEFAULT_IMAGE_MODEL_KEY)
    ?? models[0]
}

async function resolveImageApiKey(authStorage: Pick<ReturnType<typeof AuthStorage.create>, "getApiKey">, provider: ImagesProvider): Promise<string | undefined> {
  const suffix = String(provider).toUpperCase().replace(/[^A-Z0-9]+/g, "_")
  const envName = `BORING_DIAGRAM_${suffix}_API_KEY`
  const legacyEnvName = `BORING_EXCALIDRAW_${suffix}_API_KEY`
  return process.env[envName] || process.env[legacyEnvName] || await authStorage.getApiKey(provider) || getEnvApiKey(provider) || (provider === "openrouter" ? process.env.OPENROUTER_API_KEY : undefined)
}

function renderPrompt(prompt: string): string {
  return [
    "Use the attached diagram sketch as the source composition.",
    "Preserve the important spatial layout, labels, arrows, and relationships unless the prompt says otherwise.",
    "Create a polished image from it.",
    "",
    `User prompt: ${prompt}`,
  ].join("\n")
}

function withPngTextMetadata(bytes: Buffer, entries: Record<string, string>): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < signature.length + 12 || !bytes.subarray(0, signature.length).equals(signature)) return bytes
  let offset = signature.length
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii")
    const next = offset + 12 + length
    if (next > bytes.length) return bytes
    if (type === "IEND") {
      const chunks = Object.entries(entries)
        .filter(([key, value]) => /^[\x20-\x7e]{1,79}$/.test(key) && !key.includes("\0") && value.length > 0)
        .map(([key, value]) => pngChunk("iTXt", Buffer.concat([
          Buffer.from(key, "ascii"),
          Buffer.from([0, 0, 0, 0, 0]),
          Buffer.from(value, "utf8"),
        ])))
      return Buffer.concat([bytes.subarray(0, offset), ...chunks, bytes.subarray(offset)])
    }
    offset = next
  }
  return bytes
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii")
  const out = Buffer.allocUnsafe(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  typeBytes.copy(out, 4)
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return out
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function resolveWorkspaceFile(workspaceRoot: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\.\//, "").replace(/^\/+/, "")
  if (!normalized || normalized.includes("\0") || isAbsolute(normalized)) throw new Error("invalid output path")
  const root = resolve(workspaceRoot)
  const candidate = resolve(root, normalized)
  if (candidate !== root && !candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    throw new Error("output path escapes workspace")
  }
  return candidate
}

async function writeWorkspaceFileNoSymlink(workspaceRoot: string, absolutePath: string, data: string | Uint8Array): Promise<void> {
  const root = resolve(workspaceRoot)
  const relativePath = relative(root, absolutePath)
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("output path escapes workspace")
  const parent = dirname(absolutePath)
  await assertNoSymlinkAncestors(root, parent)
  await assertTargetIsNotSymlink(absolutePath)
  const handle = await open(absolutePath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o666)
  try {
    await handle.writeFile(data)
  } finally {
    await handle.close()
  }
}

async function assertNoSymlinkAncestors(root: string, targetDir: string): Promise<void> {
  const relativeDir = relative(root, targetDir)
  if (relativeDir.startsWith("..") || isAbsolute(relativeDir)) throw new Error("output path escapes workspace")
  let current = root
  if ((await lstat(current)).isSymbolicLink()) throw new Error("workspace root symlink rejected for render output")
  for (const part of relativeDir.split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, part)
    if ((await lstat(current)).isSymbolicLink()) throw new Error("render output parent symlink rejected")
  }
}

async function assertTargetIsNotSymlink(target: string): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error("render output target symlink rejected")
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return
    throw err
  }
}
