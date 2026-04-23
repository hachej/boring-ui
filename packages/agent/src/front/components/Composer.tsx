import type { KeyboardEvent } from 'react'
import { useEffect, useState } from 'react'
import type { SendMessageInput } from '../../shared/harness'
import { ModelPicker, type ModelId, isModelId } from './ModelPicker'
import {
  ThinkingToggle,
  type ThinkingLevel,
  isThinkingLevel,
} from './ThinkingToggle'

const STORAGE_MODEL_KEY = 'boring-agent:composer:model'
const STORAGE_THINKING_KEY = 'boring-agent:composer:thinking'

const DEFAULT_MODEL: ModelId = 'sonnet'
const DEFAULT_THINKING: ThinkingLevel = 'off'
const DEFAULT_PROVIDER = 'anthropic'

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface ComposerPreferences {
  model: ModelId
  thinkingLevel: ThinkingLevel
}

export interface ComposerSendInput {
  message: string
  model: NonNullable<SendMessageInput['model']>
  thinkingLevel: NonNullable<SendMessageInput['thinkingLevel']>
}

export interface ComposerProps {
  onSend: (input: ComposerSendInput) => void | Promise<void>
  isStreaming?: boolean
  placeholder?: string
  storage?: BrowserStorage
}

export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  isComposing?: boolean
}

export function shouldSendOnEnter(event: ComposerKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing
}

function getStorageOverride(override?: BrowserStorage): BrowserStorage | undefined {
  if (override) return override
  if (typeof window === 'undefined' || !window.localStorage) return undefined
  return window.localStorage
}

export function readComposerPreferences(storage?: BrowserStorage): ComposerPreferences {
  const persistedModel = storage?.getItem(STORAGE_MODEL_KEY)
  const persistedThinking = storage?.getItem(STORAGE_THINKING_KEY)

  return {
    model: persistedModel && isModelId(persistedModel) ? persistedModel : DEFAULT_MODEL,
    thinkingLevel:
      persistedThinking && isThinkingLevel(persistedThinking)
        ? persistedThinking
        : DEFAULT_THINKING,
  }
}

export function toComposerSendInput(args: {
  message: string
  model: ModelId
  thinkingLevel: ThinkingLevel
}): ComposerSendInput {
  return {
    message: args.message,
    model: {
      provider: DEFAULT_PROVIDER,
      id: args.model,
    },
    thinkingLevel: args.thinkingLevel,
  }
}

export function Composer(props: ComposerProps) {
  const { onSend, isStreaming = false, placeholder = 'Send a message…', storage } = props
  const storageImpl = getStorageOverride(storage)
  const defaults = readComposerPreferences(storageImpl)

  const [input, setInput] = useState('')
  const [model, setModel] = useState<ModelId>(defaults.model)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(defaults.thinkingLevel)

  useEffect(() => {
    storageImpl?.setItem(STORAGE_MODEL_KEY, model)
  }, [model, storageImpl])

  useEffect(() => {
    storageImpl?.setItem(STORAGE_THINKING_KEY, thinkingLevel)
  }, [thinkingLevel, storageImpl])

  async function submitMessage(): Promise<void> {
    const message = input.trim()
    if (!message || isStreaming) return

    await onSend(
      toComposerSendInput({
        message,
        model,
        thinkingLevel,
      }),
    )
    setInput('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      !shouldSendOnEnter({
        key: event.key,
        shiftKey: event.shiftKey,
        isComposing: event.nativeEvent.isComposing,
      })
    ) {
      return
    }

    event.preventDefault()
    void submitMessage()
  }

  return (
    <div className="composer">
      <textarea
        onChange={(event) => setInput(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        value={input}
      />
      <ModelPicker disabled={isStreaming} onChange={setModel} value={model} />
      <ThinkingToggle
        disabled={isStreaming}
        onChange={setThinkingLevel}
        value={thinkingLevel}
      />
      <button
        disabled={isStreaming || input.trim().length === 0}
        onClick={() => void submitMessage()}
        type="button"
      >
        Send
      </button>
    </div>
  )
}
