export {
  ChannelBindingStore,
  ChannelSessionCreateTimeoutError,
  RESERVATION_TTL_MS,
  SESSION_CREATE_TIMEOUT,
} from './channelBindingStore'
export type {
  ChannelBinding,
  ChannelBindingStatus,
  ChannelInboundStatus,
  EnqueueInboundResult,
  EnsureSessionOptions,
  InboundChannelMessage,
  ProvisionChannelBindingInput,
  QueuedChannelInbound,
} from './channelBindingStore'
export {
  CHANNEL_INBOUND_PARKED,
  CHANNEL_UNKNOWN_BINDING,
  ChannelInboundService,
} from './channelInboundService'
export type {
  ChannelAdapter,
  ChannelAgentInvocation,
  ChannelAgentInvoker,
  ChannelInboundAck,
} from './channelInboundService'

import { ErrorCode } from '../../shared/error-codes'

export const CHANNELS_ENV_FLAG = 'BORING_AGENT_CHANNELS'
export const CHANNEL_DURABLE_STREAM_REQUIRED = ErrorCode.enum.CHANNEL_DURABLE_STREAM_REQUIRED

export function areChannelsEnabled(): boolean {
  const raw = process.env[CHANNELS_ENV_FLAG]
  return raw === '1' || raw === 'true'
}

export function assertChannelDurability(durableStreamEnabled: boolean): void {
  if (!areChannelsEnabled() || durableStreamEnabled) return
  throw Object.assign(
    new Error(`${CHANNELS_ENV_FLAG} requires BORING_CHAT_DURABLE_STREAM`),
    { code: CHANNEL_DURABLE_STREAM_REQUIRED },
  )
}
