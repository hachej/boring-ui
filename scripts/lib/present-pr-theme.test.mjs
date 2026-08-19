import assert from 'node:assert/strict'
import test from 'node:test'

import { DARK_BADGE_THEME, DARK_CODE_THEME, LIGHT_BADGE_THEME, LIGHT_CODE_THEME } from './present-pr-theme.mjs'

const channel = (hex) => {
  const value = Number.parseInt(hex, 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}
const luminance = (hex) => 0.2126 * channel(hex.slice(1, 3)) + 0.7152 * channel(hex.slice(3, 5)) + 0.0722 * channel(hex.slice(5, 7))
const contrast = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

test('every small badge label meets WCAG AA contrast in light and dark themes', () => {
  for (const [themeName, theme] of [['light', LIGHT_BADGE_THEME], ['dark', DARK_BADGE_THEME]]) {
    for (const [token, [background, foreground]] of Object.entries(theme)) {
      assert.ok(contrast(background, foreground) >= 4.5, `${themeName} ${token} contrast is ${contrast(background, foreground).toFixed(2)}:1`)
    }
  }
})

test('every syntax ink meets WCAG AA contrast on every diff surface', () => {
  for (const [themeName, theme] of [['light', LIGHT_CODE_THEME], ['dark', DARK_CODE_THEME]]) {
    for (const [inkName, ink] of Object.entries(theme.inks)) {
      for (const [surfaceName, surface] of Object.entries(theme.surfaces)) {
        assert.ok(contrast(ink, surface) >= 4.5, `${themeName} ${inkName} on ${surfaceName} is ${contrast(ink, surface).toFixed(2)}:1`)
      }
    }
  }
})
