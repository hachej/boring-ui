import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useMemo, useRef } from 'react'
import type { SendMessageInput } from '../../shared/harness'

export type UseAgentChatOptions = Pick<
  SendMessageInput,
  'sessionId' | 'model' | 'thinkingLevel'
>

export function useAgentChat(opts: UseAgentChatOptions) {
  const { sessionId } = opts
  const optsRef = useRef(opts)
  optsRef.current = opts

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/v1/agent/chat',
        body: () => ({
          sessionId: optsRef.current.sessionId,
          model: optsRef.current.model,
          thinkingLevel: optsRef.current.thinkingLevel,
        }),
      }),
    [sessionId],
  )

  return useChat({ id: sessionId, transport, resume: true })
}
