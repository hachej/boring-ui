import type {
  BoringChatMessage,
  BoringChatPart,
} from '../../../shared/chat'
import type { PiChatState } from './piChatReducer'
import {
  isToolPart,
  isToolPending,
  mergeFinalMessageParts,
  partIdentity,
  preservedFinalMessageStatus,
  reasoningTextsOverlap,
} from './piChatPartMerging'
import {
  createdAtProp,
  earliestCreatedAt,
} from './piChatMessageMetadata'

export function commitFinalMessage(state: PiChatState, messageId: string, final: BoringChatMessage): PiChatState {
  const plan = buildAssistantCommitPlan(state, messageId, final)
  const finalMessage = preserveFinalMessageState(final, plan.existing, {
    replaceCoveredExistingText: Boolean(plan.sameIdOrStreamingTarget && !plan.adjacentMessage),
    preserveCoveredTextPartKeys: state.streamingMessage === plan.sameIdOrStreamingTarget ? state.streamingPreservedTextPartKeys : undefined,
  })
  const nextPending = syncPendingToolCallIds(state.pendingToolCallIds, finalMessage.parts)
  const shouldClearStreaming = shouldClearStreamingMessage(state, plan, finalMessage)

  return withCommittedMessages({
    ...state,
    streamingMessage: shouldClearStreaming ? undefined : state.streamingMessage,
    streamingPreservedTextPartKeys: shouldClearStreaming ? undefined : state.streamingPreservedTextPartKeys,
    pendingToolCallIds: nextPending,
  }, replaceOrAppendCommittedFinal(state.committedMessages, finalMessage, plan.removeCommittedIndexes, plan.preferredReplaceIndex))
}

interface AssistantCommitPlan {
  existing?: BoringChatMessage
  sameIdOrStreamingTarget?: BoringChatMessage
  adjacentMessage?: BoringChatMessage
  streamingMergeTarget?: BoringChatMessage
  sameIdStreaming?: BoringChatMessage
  removeCommittedIndexes: Set<number>
  preferredReplaceIndex?: number
}

function buildAssistantCommitPlan(state: PiChatState, messageId: string, final: BoringChatMessage): AssistantCommitPlan {
  const turnMatchedSameIdCommittedIndex = findTurnMatchedSameIdCommittedIndex(state.committedMessages, messageId, final.turnId)
  const turnMatchedSameIdCommitted = turnMatchedSameIdCommittedIndex >= 0 ? state.committedMessages[turnMatchedSameIdCommittedIndex] : undefined
  const latestSameIdCommittedIndex = findLatestSameIdCommittedIndex(state.committedMessages, messageId)
  const latestSameIdCommitted = latestSameIdCommittedIndex >= 0 ? state.committedMessages[latestSameIdCommittedIndex] : undefined
  const noTurnSameIdCommittedIndex = final.turnId
    ? -1
    : findNoTurnSameIdCommittedIndex(state.committedMessages, messageId, final, state.turnId)
  const noTurnSameIdCommitted = noTurnSameIdCommittedIndex >= 0 ? state.committedMessages[noTurnSameIdCommittedIndex] : undefined
  const sameIdStreaming = state.streamingMessage?.id === messageId && shouldUseSameIdStreamingTarget(
    state.streamingMessage,
    final,
    turnMatchedSameIdCommitted,
    latestSameIdCommitted,
  )
    ? state.streamingMessage
    : undefined
  const sameIdExisting = sameIdStreaming ?? turnMatchedSameIdCommitted ?? noTurnSameIdCommitted
  const streamingMergeTarget = sameIdExisting ? undefined : findStreamingAssistantMergeTarget(state.streamingMessage, final)
  const sameIdOrStreamingTarget = sameIdExisting ?? streamingMergeTarget
  const rawAdjacentMergeTarget = findAdjacentAssistantMergeTarget(state.committedMessages, final, sameIdOrStreamingTarget)
  const rawAdjacentIsSameCommittedTarget = rawAdjacentMergeTarget?.index === turnMatchedSameIdCommittedIndex
    || rawAdjacentMergeTarget?.index === noTurnSameIdCommittedIndex
  const adjacentMergeTarget = rawAdjacentIsSameCommittedTarget
    ? undefined
    : rawAdjacentMergeTarget
  const adjacentMessage = adjacentMergeTarget?.message
  const fallbackSameIdCommittedIndex = sameIdOrStreamingTarget || adjacentMergeTarget || shouldDisableNoTurnSameIdFallback(final, latestSameIdCommitted, state.turnId)
    ? -1
    : latestSameIdCommittedIndex
  const fallbackSameIdCommitted = fallbackSameIdCommittedIndex >= 0 ? latestSameIdCommitted : undefined
  const existing = mergeAssistantExistingTargets(
    adjacentMessage,
    sameIdOrStreamingTarget,
  ) ?? sameIdOrStreamingTarget ?? adjacentMessage ?? fallbackSameIdCommitted
  const removeCommittedIndexes = new Set<number>()
  if (turnMatchedSameIdCommitted && turnMatchedSameIdCommitted.id !== final.id) removeCommittedIndexes.add(turnMatchedSameIdCommittedIndex)
  if (adjacentMergeTarget && adjacentMergeTarget.message.id !== final.id) removeCommittedIndexes.add(adjacentMergeTarget.index)
  if (fallbackSameIdCommitted && fallbackSameIdCommitted.id !== final.id) removeCommittedIndexes.add(fallbackSameIdCommittedIndex)
  const preferredReplaceIndex = turnMatchedSameIdCommitted?.id === final.id
    ? turnMatchedSameIdCommittedIndex
    : noTurnSameIdCommitted?.id === final.id
      ? noTurnSameIdCommittedIndex
    : adjacentMergeTarget
      ? adjacentMergeTarget.index
      : fallbackSameIdCommitted?.id === final.id
        ? fallbackSameIdCommittedIndex
        : undefined

  return {
    existing,
    sameIdOrStreamingTarget,
    adjacentMessage,
    streamingMergeTarget,
    sameIdStreaming,
    removeCommittedIndexes,
    preferredReplaceIndex,
  }
}

function shouldClearStreamingMessage(
  state: PiChatState,
  plan: AssistantCommitPlan,
  finalMessage: BoringChatMessage,
): boolean {
  const removeStreamingIds = new Set(
    [plan.streamingMergeTarget?.id]
      .filter((id): id is string => Boolean(id) && id !== finalMessage.id),
  )
  const clearStreamingIds = new Set([plan.streamingMergeTarget?.id, plan.sameIdStreaming?.id].filter((id): id is string => Boolean(id)))
  return state.streamingMessage ? clearStreamingIds.has(state.streamingMessage.id) || removeStreamingIds.has(state.streamingMessage.id) : false
}

function findTurnMatchedSameIdCommittedIndex(
  messages: BoringChatMessage[],
  messageId: string,
  targetTurnId: string | undefined,
): number {
  if (!targetTurnId) return -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.id === messageId && message.turnId === targetTurnId) return index
  }
  return -1
}

function findLatestSameIdCommittedIndex(messages: BoringChatMessage[], messageId: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.id === messageId) return index
  }
  return -1
}

function findNoTurnSameIdCommittedIndex(
  messages: BoringChatMessage[],
  messageId: string,
  final: BoringChatMessage,
  activeTurnId: string | undefined,
): number {
  let latestSameIdIndex = -1
  let latestCurrentTurnIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.id !== messageId) continue
    if (latestSameIdIndex < 0) latestSameIdIndex = index
    if (activeTurnId && message.turnId === activeTurnId && latestCurrentTurnIndex < 0) latestCurrentTurnIndex = index
    if (assistantMessagesShareFinalContent(message, final)) return index
  }
  if (latestCurrentTurnIndex >= 0) return -1
  return latestSameIdIndex
}

function shouldDisableNoTurnSameIdFallback(
  final: BoringChatMessage,
  latestSameIdCommitted: BoringChatMessage | undefined,
  activeTurnId: string | undefined,
): boolean {
  return Boolean(
    !final.turnId
      && activeTurnId
      && latestSameIdCommitted?.turnId === activeTurnId
      && !assistantMessagesShareFinalContent(latestSameIdCommitted, final),
  )
}

function shouldUseSameIdStreamingTarget(
  streamingMessage: BoringChatMessage,
  final: BoringChatMessage,
  turnMatchedSameIdCommitted: BoringChatMessage | undefined,
  latestSameIdCommitted: BoringChatMessage | undefined,
): boolean {
  if (final.turnId) return !turnMatchedSameIdCommitted || isSameTurnAssistantMessage(streamingMessage, final)
  if (!latestSameIdCommitted) return true
  return assistantMessagesShareFinalContent(streamingMessage, final)
}

function assistantMessagesShareFinalContent(left: BoringChatMessage, right: BoringChatMessage): boolean {
  return right.parts.some((rightPart) => left.parts.some((leftPart) => partsShareFinalContent(leftPart, rightPart)))
}

function partsShareFinalContent(left: BoringChatPart, right: BoringChatPart): boolean {
  const leftIdentity = partIdentity(left)
  if (left.type === right.type && leftIdentity !== undefined && leftIdentity === partIdentity(right)) return true
  if (left.type === 'text' && right.type === 'text') return textFragmentsOverlap(left.text, right.text)
  if (left.type === 'reasoning' && right.type === 'reasoning') return reasoningTextsOverlap(left.text, right.text)
  return false
}

function textFragmentsOverlap(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left)
}

function replaceOrAppendCommittedFinal(
  messages: BoringChatMessage[],
  finalMessage: BoringChatMessage,
  removeIndexes: Set<number>,
  replaceIndex: number | undefined,
): BoringChatMessage[] {
  const next: BoringChatMessage[] = []
  let replaced = false

  messages.forEach((message, index) => {
    if (replaceIndex === index) {
      next.push(finalMessage)
      replaced = true
      return
    }
    if (removeIndexes.has(index)) return
    next.push(message)
  })

  return replaced ? next : [...next, finalMessage]
}

function mergeAssistantExistingTargets(
  previous: BoringChatMessage | undefined,
  current: BoringChatMessage | undefined,
): BoringChatMessage | undefined {
  if (!previous) return current
  if (!current) return previous
  if (previous.id === current.id) return current
  const parts = mergeFinalMessageParts(previous.parts, current.parts)
  return {
    ...previous,
    ...current,
    createdAt: earliestCreatedAt(previous.createdAt, current.createdAt),
    parts,
    status: preservedFinalMessageStatus(current, previous, parts),
  }
}

function isSameTurnAssistantMessage(message: BoringChatMessage, final: BoringChatMessage): boolean {
  if (message.turnId || final.turnId) return Boolean(message.turnId && final.turnId && message.turnId === final.turnId)
  return true
}

function findStreamingAssistantMergeTarget(streamingMessage: BoringChatMessage | undefined, final: BoringChatMessage): BoringChatMessage | undefined {
  if (final.role !== 'assistant' || streamingMessage?.role !== 'assistant') return undefined
  if (!final.turnId || !streamingMessage.turnId || final.turnId !== streamingMessage.turnId) return undefined
  return streamingMessage
}

function findAdjacentAssistantMergeTarget(
  messages: BoringChatMessage[],
  final: BoringChatMessage,
  sameIdOrStreamingTarget: BoringChatMessage | undefined,
): { message: BoringChatMessage; index: number } | undefined {
  if (final.role !== 'assistant') return undefined
  const index = messages.length - 1
  const previous = messages[index]
  if (previous?.role !== 'assistant') return undefined
  const targetTurnId = final.turnId ?? sameIdOrStreamingTarget?.turnId
  if (!targetTurnId && assistantMessagesShareToolIdentity(previous, final)) return { message: previous, index }
  if (!targetTurnId || !previous.turnId || previous.turnId !== targetTurnId) return undefined
  return { message: previous, index }
}

function assistantMessagesShareToolIdentity(left: BoringChatMessage, right: BoringChatMessage): boolean {
  const leftToolIds = new Set(left.parts.filter(isToolPart).map((part) => part.id))
  return right.parts.some((part) => part.type === 'tool-call' && leftToolIds.has(part.id))
}

function preserveFinalMessageState(
  final: BoringChatMessage,
  existing: BoringChatMessage | undefined,
  options: { replaceCoveredExistingText?: boolean; preserveCoveredTextPartKeys?: ReadonlySet<string> } = {},
): BoringChatMessage {
  const parts = mergeFinalMessageParts(existing?.parts ?? [], final.parts, {
    textMode: options.replaceCoveredExistingText ? 'replace-covered-existing' : 'preserve-existing',
    preserveCoveredTextPartKeys: options.preserveCoveredTextPartKeys,
  })
  return {
    ...final,
    ...(final.clientNonce === undefined && existing?.clientNonce !== undefined ? { clientNonce: existing.clientNonce } : {}),
    ...(final.clientSeq === undefined && existing?.clientSeq !== undefined ? { clientSeq: existing.clientSeq } : {}),
    ...createdAtProp(earliestCreatedAt(existing?.createdAt, final.createdAt)),
    ...(final.turnId === undefined && existing?.turnId !== undefined ? { turnId: existing.turnId } : {}),
    status: preservedFinalMessageStatus(final, existing, parts),
    parts,
  }
}

function syncPendingToolCallIds(
  pendingToolCallIds: Set<string>,
  parts: BoringChatPart[],
): Set<string> {
  const nextPending = new Set(pendingToolCallIds)
  for (const part of parts) {
    if (part.type === 'tool-call' && isToolPending(part)) nextPending.add(part.id)
    if (part.type === 'tool-call' && !isToolPending(part)) nextPending.delete(part.id)
  }
  return nextPending
}

function withCommittedMessages(state: PiChatState, committedMessages: BoringChatMessage[]): PiChatState {
  return {
    ...state,
    committedMessages,
    history: { mode: 'full', messageCount: committedMessages.length },
  }
}
