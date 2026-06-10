import type { BoringChatMessage } from '../../../shared/chat'

export function earliestCreatedAt(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right
  if (!right) return left
  const leftMs = Date.parse(left)
  const rightMs = Date.parse(right)
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return left
  return leftMs <= rightMs ? left : right
}

export function createdAtProp(createdAt: string | undefined): Pick<BoringChatMessage, 'createdAt'> | Record<string, never> {
  return createdAt === undefined ? {} : { createdAt }
}
