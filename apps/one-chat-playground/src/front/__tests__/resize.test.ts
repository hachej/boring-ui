import { describe, expect, test } from 'vitest'
import { CHAT_HEIGHT_MIN, CHAT_WIDTH_DEFAULT, CHAT_WIDTH_MIN, STAGE_MIN, STAGE_MIN_HEIGHT, clampChatHeight, clampChatWidth } from '../resize'

describe('clampChatWidth', () => {
  test('keeps a sensible width unchanged', () => {
    expect(clampChatWidth(420, 1280)).toBe(420)
  })
  test('never goes under the minimum chat width', () => {
    expect(clampChatWidth(100, 1280)).toBe(CHAT_WIDTH_MIN)
  })
  test('always leaves the app its minimum share', () => {
    expect(clampChatWidth(1200, 1280)).toBe(1280 - STAGE_MIN)
  })
  test('falls back to the default on garbage', () => {
    expect(clampChatWidth(Number.NaN, 1280)).toBe(CHAT_WIDTH_DEFAULT)
  })
  test('on a narrow viewport the chat minimum wins over the stage minimum', () => {
    expect(clampChatWidth(300, 600)).toBe(CHAT_WIDTH_MIN)
  })
})

describe('clampChatHeight', () => {
  test('defaults to a share of the viewport', () => {
    expect(clampChatHeight(Number.NaN, 800)).toBe(336)
  })
  test('never goes under the minimum sheet height', () => {
    expect(clampChatHeight(10, 800)).toBe(CHAT_HEIGHT_MIN)
  })
  test('always leaves the app its minimum height', () => {
    expect(clampChatHeight(5000, 800)).toBe(800 - STAGE_MIN_HEIGHT)
  })
})
