import { afterEach, describe, expect, test } from 'vitest'
import {
  CHANNEL_DURABLE_STREAM_REQUIRED,
  CHANNELS_ENV_FLAG,
  areChannelsEnabled,
  assertChannelDurability,
} from '../index'

const previous = process.env[CHANNELS_ENV_FLAG]
afterEach(() => {
  if (previous === undefined) delete process.env[CHANNELS_ENV_FLAG]
  else process.env[CHANNELS_ENV_FLAG] = previous
})

describe('channel flag', () => {
  test('defaults off and leaves durable-stream policy untouched', () => {
    delete process.env[CHANNELS_ENV_FLAG]
    expect(areChannelsEnabled()).toBe(false)
    expect(() => assertChannelDurability(false)).not.toThrow()
  })

  test('fails boot with a stable code when channels lack durability', () => {
    process.env[CHANNELS_ENV_FLAG] = '1'
    expect(() => assertChannelDurability(false)).toThrow(expect.objectContaining({
      code: CHANNEL_DURABLE_STREAM_REQUIRED,
    }))
    expect(() => assertChannelDurability(true)).not.toThrow()
  })
})
