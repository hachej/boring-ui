import type {
  BoringChatMessage,
  BoringChatPart,
  PiChatEvent,
} from '../../../shared/chat'

export function mergeToolResultPart(
  part: Extract<BoringChatPart, { type: 'tool-call' }>,
  event: Extract<PiChatEvent, { type: 'tool-result' }>,
): Extract<BoringChatPart, { type: 'tool-call' }> {
  if (part.state === 'aborted') return { ...part, ui: mergeToolUiMetadata(part.ui, event.ui) }
  if (part.state === 'output-error') {
    if (!event.isError) return { ...part, ui: mergeToolUiMetadata(part.ui, event.ui) }
    return {
      ...part,
      output: chooseMergedToolValue(part.output, event.output, false),
      errorText: chooseMergedToolValue(part.errorText, event.errorText, false),
      ui: mergeToolUiMetadata(part.ui, event.ui),
    }
  }
  if (part.state === 'output-available' && event.isError) return { ...part, ui: mergeToolUiMetadata(part.ui, event.ui) }
  return {
    ...part,
    state: event.isError ? 'output-error' : 'output-available',
    output: chooseMergedToolValue(part.output, event.output, false),
    errorText: event.isError ? chooseMergedToolValue(part.errorText, event.errorText, false) : part.errorText,
    ui: mergeToolUiMetadata(part.ui, event.ui),
  }
}

export function preservedFinalMessageStatus(
  final: BoringChatMessage,
  existing: BoringChatMessage | undefined,
  parts: BoringChatPart[],
): BoringChatMessage['status'] {
  if (existing?.status === 'aborted' || existing?.status === 'error') return existing.status
  return shouldKeepFinalMessageStreaming(final, parts) ? 'streaming' : final.status
}

export type FinalTextMergeMode = 'preserve-existing' | 'replace-covered-existing'

export function mergeFinalMessageParts(
  existingParts: BoringChatPart[],
  finalParts: BoringChatPart[],
  options: { textMode?: FinalTextMergeMode; preserveCoveredTextPartKeys?: ReadonlySet<string> } = {},
): BoringChatPart[] {
  // Merge per-type so streaming and final parts reconcile by identity, then
  // restore the original emitted sequence. A turn legitimately interleaves
  // text and tools (tool call → text comment → more tool calls); bucketing by
  // type would collapse that to "all tools, then all text" and make later
  // tool calls render in the group above the preceding message.
  const merged = [
    ...mergeReasoningParts(existingParts.filter(isReasoningPart), finalParts.filter(isReasoningPart)),
    ...mergeToolParts(existingParts.filter(isToolPart), finalParts.filter(isToolPart)),
    ...mergeTextParts(existingParts.filter(isTextPart), finalParts.filter(isTextPart), options),
    ...dedupePartsByIdentity([...existingParts.filter(isNoticePart), ...finalParts.filter(isNoticePart)]),
    ...dedupePartsByIdentity([...existingParts.filter(isFilePart), ...finalParts.filter(isFilePart)]),
  ]
  return orderPartsBySourceSequence(merged, existingParts, finalParts)
}

export function shouldKeepFinalMessageStreaming(final: BoringChatMessage, parts: BoringChatPart[]): boolean {
  return (final.status === undefined || final.status === 'done') && parts.some((part) => part.type === 'tool-call' && isToolPending(part))
}

function mergeReasoningParts(
  existingParts: Array<Extract<BoringChatPart, { type: 'reasoning' }>>,
  finalParts: Array<Extract<BoringChatPart, { type: 'reasoning' }>>,
): BoringChatPart[] {
  const rankedFinalParts = rankReasoningPartsById(finalParts)
  const merged: BoringChatPart[] = []
  const usedFinalIndexes = new Set<number>()
  const unmatchedExisting: Array<Extract<BoringChatPart, { type: 'reasoning' }>> = []

  for (const existingPart of existingParts) {
    const matchingFinalIndex = rankedFinalParts.findIndex((part, index) => !usedFinalIndexes.has(index) && samePartIdentity(part, existingPart))
    if (matchingFinalIndex >= 0) {
      merged.push(mergeReasoningPart(existingPart, rankedFinalParts[matchingFinalIndex]!))
      usedFinalIndexes.add(matchingFinalIndex)
    } else {
      unmatchedExisting.push(existingPart)
    }
  }

  for (const existingPart of unmatchedExisting) {
    const finalIndex = rankedFinalParts.findIndex((part, index) => !usedFinalIndexes.has(index) && reasoningTextsOverlap(existingPart.text, part.text))
    if (finalIndex >= 0) {
      merged.push(mergeReasoningPart(existingPart, rankedFinalParts[finalIndex]!))
      usedFinalIndexes.add(finalIndex)
    } else if (!reasoningTextCovered(merged, existingPart.text)) {
      merged.push(finalizePreservedPart(existingPart))
    }
  }

  for (let index = 0; index < rankedFinalParts.length; index += 1) {
    const finalPart = rankedFinalParts[index]
    if (!finalPart || usedFinalIndexes.has(index) || reasoningTextCovered(merged, finalPart.text)) continue
    merged.push(finalPart)
  }

  return merged
}

function rankReasoningPartsById(
  parts: Array<Extract<BoringChatPart, { type: 'reasoning' }>>,
): Array<Extract<BoringChatPart, { type: 'reasoning' }>> {
  const ranked = new Map<string, Extract<BoringChatPart, { type: 'reasoning' }>>()
  for (const part of parts) {
    const current = ranked.get(part.id)
    if (!current || part.text.length >= current.text.length) ranked.set(part.id, part)
  }
  return [...ranked.values()]
}

function mergeReasoningPart(
  existingPart: Extract<BoringChatPart, { type: 'reasoning' }>,
  finalPart: Extract<BoringChatPart, { type: 'reasoning' }>,
): BoringChatPart {
  if (finalPart.text.length >= existingPart.text.length) return finalPart
  return finalizePreservedPart(existingPart)
}

function reasoningTextCovered(parts: BoringChatPart[], text: string): boolean {
  return parts.some((part) => part.type === 'reasoning' && (part.text === text || part.text.includes(text)))
}

export function reasoningTextsOverlap(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left)
}

function mergeToolParts(
  existingParts: Array<Extract<BoringChatPart, { type: 'tool-call' }>>,
  finalParts: Array<Extract<BoringChatPart, { type: 'tool-call' }>>,
): BoringChatPart[] {
  const rankedFinalParts = mergeToolPartsById(finalParts)
  const merged: BoringChatPart[] = []
  const usedFinalIndexes = new Set<number>()
  const emittedToolIds = new Set<string>()

  for (const existingPart of existingParts) {
    const matchingFinalIndex = rankedFinalParts.findIndex((part, index) => !usedFinalIndexes.has(index) && part.id === existingPart.id)
    if (matchingFinalIndex >= 0) {
      merged.push(mergeMatchingFinalPart(existingPart, rankedFinalParts[matchingFinalIndex]!))
      usedFinalIndexes.add(matchingFinalIndex)
    } else {
      merged.push(existingPart)
    }
    emittedToolIds.add(existingPart.id)
  }

  for (let index = 0; index < rankedFinalParts.length; index += 1) {
    const finalPart = rankedFinalParts[index]
    if (!finalPart || usedFinalIndexes.has(index) || emittedToolIds.has(finalPart.id)) continue
    merged.push(finalPart)
    emittedToolIds.add(finalPart.id)
  }

  return merged
}

function mergeToolPartsById(
  parts: Array<Extract<BoringChatPart, { type: 'tool-call' }>>,
): Array<Extract<BoringChatPart, { type: 'tool-call' }>> {
  const merged = new Map<string, Extract<BoringChatPart, { type: 'tool-call' }>>()
  for (const part of parts) {
    const current = merged.get(part.id)
    const nextPart = current ? mergeMatchingFinalPart(current, part) : part
    if (nextPart.type === 'tool-call') merged.set(part.id, nextPart)
  }
  return [...merged.values()]
}

function mergeTextParts(
  existingParts: Array<Extract<BoringChatPart, { type: 'text' }>>,
  finalParts: Array<Extract<BoringChatPart, { type: 'text' }>>,
  options: { textMode?: FinalTextMergeMode; preserveCoveredTextPartKeys?: ReadonlySet<string> },
): BoringChatPart[] {
  const mode = options.textMode ?? 'preserve-existing'
  const rankedFinalParts = mergeTextPartsById(finalParts)
  if (rankedFinalParts.length === 0) return existingParts
  const merged: Array<Extract<BoringChatPart, { type: 'text' }>> = []
  const usedFinalIndexes = new Set<number>()
  const usedExistingIndexes = new Set<number>()
  for (let existingIndex = 0; existingIndex < existingParts.length; existingIndex += 1) {
    const existingPart = existingParts[existingIndex]!
    if (shouldPreserveCoveredExistingText(existingPart, options)) {
      merged.push(preserveExistingTextPartIdentity(existingPart, rankedFinalParts))
      usedExistingIndexes.add(existingIndex)
      continue
    }
    const finalIndex = existingPart.id === undefined ? -1 : rankedFinalParts.findIndex((part, index) => !usedFinalIndexes.has(index) && part.id === existingPart.id)
    if (finalIndex >= 0) {
      merged.push(rankedFinalParts[finalIndex]!)
      usedFinalIndexes.add(finalIndex)
      usedExistingIndexes.add(existingIndex)
    }
  }
  for (let existingIndex = 0; existingIndex < existingParts.length; existingIndex += 1) {
    if (usedExistingIndexes.has(existingIndex)) continue
    const existingPart = existingParts[existingIndex]!
    if (existingPart.id !== undefined && merged.some((part) => part.id === existingPart.id)) continue
    if (!textCoveredByFinal(rankedFinalParts, existingPart, options)) merged.push(existingPart)
  }
  for (let index = 0; index < rankedFinalParts.length; index += 1) {
    const finalPart = rankedFinalParts[index]
    if (!finalPart || usedFinalIndexes.has(index)) continue
    if (!textCoveredByExisting(merged, finalPart.text, options)) merged.push(finalPart)
  }
  return merged
}

function mergeTextPartsById(
  parts: Array<Extract<BoringChatPart, { type: 'text' }>>,
): Array<Extract<BoringChatPart, { type: 'text' }>> {
  const merged = new Map<string, Extract<BoringChatPart, { type: 'text' }>>()
  const withoutId: Array<Extract<BoringChatPart, { type: 'text' }>> = []
  for (const part of parts) {
    if (part.id === undefined) {
      withoutId.push(part)
      continue
    }
    const current = merged.get(part.id)
    merged.set(part.id, !current || part.text.length >= current.text.length ? part : current)
  }
  return [...merged.values(), ...withoutId]
}

function textCoveredByFinal(
  parts: Array<Extract<BoringChatPart, { type: 'text' }>>,
  existingPart: Extract<BoringChatPart, { type: 'text' }>,
  options: { textMode?: FinalTextMergeMode; preserveCoveredTextPartKeys?: ReadonlySet<string> },
): boolean {
  if ((options.textMode ?? 'preserve-existing') === 'replace-covered-existing' && canReplaceCoveredExistingText(existingPart, options)) {
    return parts.some((part) => part.text === existingPart.text || part.text.includes(existingPart.text))
  }
  return textExactlyCovered(parts, existingPart.text)
}

function textCoveredByExisting(
  parts: Array<Extract<BoringChatPart, { type: 'text' }>>,
  text: string,
  options: { textMode?: FinalTextMergeMode; preserveCoveredTextPartKeys?: ReadonlySet<string> },
): boolean {
  if ((options.textMode ?? 'preserve-existing') === 'replace-covered-existing') {
    return parts.some((part) => canReplaceCoveredExistingText(part, options) && (part.text === text || part.text.includes(text)))
  }
  return textExactlyCovered(parts, text)
}

function canReplaceCoveredExistingText(
  part: Extract<BoringChatPart, { type: 'text' }>,
  options: { preserveCoveredTextPartKeys?: ReadonlySet<string> },
): boolean {
  return !shouldPreserveCoveredExistingText(part, options)
}

function shouldPreserveCoveredExistingText(
  part: Extract<BoringChatPart, { type: 'text' }>,
  options: { preserveCoveredTextPartKeys?: ReadonlySet<string> },
): boolean {
  return Boolean(options.preserveCoveredTextPartKeys?.has(textPartPreservationKey(part)))
}

function preserveExistingTextPartIdentity(
  part: Extract<BoringChatPart, { type: 'text' }>,
  finalParts: Array<Extract<BoringChatPart, { type: 'text' }>>,
): Extract<BoringChatPart, { type: 'text' }> {
  if (!part.id || !finalParts.some((finalPart) => finalPart.id === part.id)) return part
  return { type: 'text', text: part.text }
}

export function collectTextPartPreservationKeys(parts: BoringChatPart[]): Set<string> {
  return new Set(parts.filter(isTextPart).map(textPartPreservationKey))
}

export function markTextPartsPreservedForFold(parts: BoringChatPart[]): BoringChatPart[] {
  return parts.map((part) => {
    if (part.type !== 'text' || part.id === undefined) return part
    return { type: 'text', text: part.text }
  })
}

function textPartPreservationKey(part: Extract<BoringChatPart, { type: 'text' }>): string {
  return part.id ?? `text:${part.text}`
}

function textExactlyCovered(parts: Array<Extract<BoringChatPart, { type: 'text' }>>, text: string): boolean {
  return parts.some((part) => part.text === text)
}

function dedupePartsByIdentity(parts: BoringChatPart[]): BoringChatPart[] {
  const seen = new Set<string>()
  const deduped: BoringChatPart[] = []
  for (const part of parts) {
    const key = `${part.type}:${partIdentity(part) ?? JSON.stringify(part)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(part)
  }
  return deduped
}

/**
 * Reorders the type-merged parts back into their emitted sequence so reasoning,
 * tools and text interleave exactly as the model produced them (think → call →
 * think → call stays interleaved; it is not collapsed into one reasoning block
 * and one tool group).
 *
 * The final snapshot is the authoritative emitted order, and merged parts carry
 * the final part's id, so positions come from the snapshot. Streaming-only parts
 * absent from the snapshot (e.g. a tool whose result hasn't landed yet, or any
 * part mid-stream before a snapshot exists) are interpolated just after the most
 * recent preceding part that IS in the snapshot, preserving their streaming order.
 */
function orderPartsBySourceSequence(
  merged: BoringChatPart[],
  existingParts: BoringChatPart[],
  finalParts: BoringChatPart[],
): BoringChatPart[] {
  const finalPositionById = new Map<string, number>()
  const finalPositionByRef = new Map<BoringChatPart, number>()
  finalParts.forEach((part, index) => {
    finalPositionByRef.set(part, index)
    if (part.id !== undefined && !finalPositionById.has(part.id)) finalPositionById.set(part.id, index)
  })

  // Interpolated keys for streaming parts not represented in the snapshot:
  // anchored just after the latest preceding streamed part that IS in the
  // snapshot, sub-ordered by streaming position so their relative order holds.
  const streamKeyByRef = new Map<BoringChatPart, number>()
  const streamKeyById = new Map<string, number>()
  const span = existingParts.length + 1
  let anchor = -1
  let sub = 0
  existingParts.forEach((part) => {
    const finalPos = part.id !== undefined ? finalPositionById.get(part.id) : undefined
    if (finalPos !== undefined) {
      anchor = finalPos
      sub = 0
    } else {
      sub += 1
    }
    const key = finalPos !== undefined ? finalPos : anchor + sub / span
    streamKeyByRef.set(part, key)
    if (part.id !== undefined && !streamKeyById.has(part.id)) streamKeyById.set(part.id, key)
  })

  const orderKey = (part: BoringChatPart): number | undefined => {
    if (part.id !== undefined && finalPositionById.has(part.id)) return finalPositionById.get(part.id)
    if (finalPositionByRef.has(part)) return finalPositionByRef.get(part)
    if (streamKeyByRef.has(part)) return streamKeyByRef.get(part)
    if (part.id !== undefined && streamKeyById.has(part.id)) return streamKeyById.get(part.id)
    return undefined
  }

  return merged
    .map((part, index) => ({ part, index }))
    .sort((left, right) => {
      const leftKey = orderKey(left.part)
      const rightKey = orderKey(right.part)
      if (leftKey !== undefined && rightKey !== undefined) {
        return leftKey === rightKey ? left.index - right.index : leftKey - rightKey
      }
      // Parts with a known source position sort before unknown ones; ties and
      // unknown/unknown fall back to the stable merged order.
      if (leftKey !== undefined) return -1
      if (rightKey !== undefined) return 1
      return left.index - right.index
    })
    .map(({ part }) => part)
}

function mergeMatchingFinalPart(existingPart: BoringChatPart, finalPart: BoringChatPart): BoringChatPart {
  if (existingPart.type === 'reasoning' && finalPart.type === 'reasoning') {
    return mergeReasoningPart(existingPart, finalPart)
  }
  if (existingPart.type !== 'tool-call' || finalPart.type !== 'tool-call') return finalPart
  const mergeToolMetadata = (preserveExisting: boolean): Extract<BoringChatPart, { type: 'tool-call' }> => ({
    ...finalPart,
    toolName: chooseMergedToolName(existingPart.toolName, finalPart.toolName),
    input: chooseMergedToolValue(existingPart.input, finalPart.input, false),
    output: chooseMergedToolValue(existingPart.output, finalPart.output, preserveExisting),
    errorText: chooseMergedToolValue(existingPart.errorText, finalPart.errorText, preserveExisting),
    ui: mergeToolUiMetadata(existingPart.ui, finalPart.ui),
  })
  if (isToolPending(existingPart)) return mergeToolMetadata(false)
  if (!isToolPending(existingPart)) {
    const existingHasResultPayload = existingPart.output !== undefined || existingPart.errorText !== undefined
    const finalHasResultPayload = finalPart.output !== undefined || finalPart.errorText !== undefined
    const shouldPreserveExistingResult = isToolPending(finalPart) ||
      finalPart.state !== existingPart.state ||
      (existingHasResultPayload && !finalHasResultPayload)
    return {
      ...mergeToolMetadata(shouldPreserveExistingResult),
      state: shouldPreserveExistingResult ? existingPart.state : finalPart.state,
    }
  }
  return finalPart
}

function samePartIdentity(left: BoringChatPart, right: BoringChatPart): boolean {
  return left.type === right.type && partIdentity(left) === partIdentity(right)
}

function chooseMergedToolValue<T>(existingValue: T | undefined, finalValue: T | undefined, preserveExisting: boolean): T | undefined {
  if (preserveExisting) return existingValue
  if (existingValue === undefined) return finalValue
  if (finalValue === undefined) return existingValue
  return payloadRichness(finalValue) > payloadRichness(existingValue) ? finalValue : existingValue
}

function chooseMergedToolName(existingValue: string, finalValue: string): string {
  return finalValue.length > existingValue.length ? finalValue : existingValue
}

function mergeToolUiMetadata(
  existingValue: Extract<BoringChatPart, { type: 'tool-call' }>['ui'],
  finalValue: Extract<BoringChatPart, { type: 'tool-call' }>['ui'],
): Extract<BoringChatPart, { type: 'tool-call' }>['ui'] {
  if (!existingValue) return finalValue
  if (!finalValue) return existingValue
  const merged: NonNullable<Extract<BoringChatPart, { type: 'tool-call' }>['ui']> = {}
  const rendererId = existingValue.rendererId ?? finalValue.rendererId
  const displayGroup = existingValue.displayGroup ?? finalValue.displayGroup
  const icon = existingValue.icon ?? finalValue.icon
  const details = mergeToolUiDetails(existingValue.details, finalValue.details)
  if (rendererId !== undefined) merged.rendererId = rendererId
  if (displayGroup !== undefined) merged.displayGroup = displayGroup
  if (icon !== undefined) merged.icon = icon
  if (details !== undefined) merged.details = details
  return Object.keys(merged).length > 0 ? merged : undefined
}

function mergeToolUiDetails(existingValue: unknown, finalValue: unknown): unknown {
  if (isRecord(existingValue) && isRecord(finalValue)) {
    const merged: Record<string, unknown> = { ...existingValue }
    for (const [key, value] of Object.entries(finalValue)) {
      merged[key] = chooseMergedToolValue(merged[key], value, false)
    }
    return merged
  }
  return chooseMergedToolValue(existingValue, finalValue, false)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function payloadRichness(value: unknown): number {
  if (value === undefined) return 0
  if (value === null) return 1
  if (typeof value === 'string') return value.length
  try {
    return JSON.stringify(value)?.length ?? 1
  } catch {
    return 1
  }
}

export function partIdentity(part: BoringChatPart): string | undefined {
  if ('id' in part) return part.id
  return undefined
}

function isTextPart(part: BoringChatPart): part is Extract<BoringChatPart, { type: 'text' }> {
  return part.type === 'text'
}

function isReasoningPart(part: BoringChatPart): part is Extract<BoringChatPart, { type: 'reasoning' }> {
  return part.type === 'reasoning'
}

export function isToolPart(part: BoringChatPart): part is Extract<BoringChatPart, { type: 'tool-call' }> {
  return part.type === 'tool-call'
}

function isFilePart(part: BoringChatPart): part is Extract<BoringChatPart, { type: 'file' }> {
  return part.type === 'file'
}

function isNoticePart(part: BoringChatPart): part is Extract<BoringChatPart, { type: 'notice' }> {
  return part.type === 'notice'
}

function finalizePreservedPart(part: BoringChatPart): BoringChatPart {
  if (part.type === 'reasoning' && part.state === 'streaming') return { ...part, state: 'done' }
  return part
}

export function isToolPending(part: Extract<BoringChatPart, { type: 'tool-call' }>): boolean {
  return part.state === 'input-streaming' || part.state === 'input-available'
}
