import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useMemo, useRef } from 'react'
import type { SendMessageInput } from '../../shared/harness'
import { useFileChangeStream } from './useFileChangeStream'

export type UseAgentChatOptions = Pick<
  SendMessageInput,
  'sessionId' | 'model' | 'thinkingLevel'
> & {
  onData?: (part: unknown) => void
}

export function useAgentChat(opts: UseAgentChatOptions) {
  const { sessionId } = opts
  const { onData: onFileChangeData } = useFileChangeStream()
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

  return useChat({
    id: sessionId,
    transport,
    resume: true,
    onData: (part) => {
      onFileChangeData(part)
      optsRef.current.onData?.(part)
    },
  })
}
