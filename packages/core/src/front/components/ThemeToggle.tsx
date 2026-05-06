import { Button } from '@hachej/boring-ui-kit'

import { useTheme } from '../hooks/index.js'

type ThemePreference = 'light' | 'dark' | 'system'

const THEME_ORDER: ThemePreference[] = ['light', 'dark', 'system']

function nextTheme(preference: ThemePreference): ThemePreference {
  const index = THEME_ORDER.indexOf(preference)
  const nextIndex = index === -1 ? 0 : (index + 1) % THEME_ORDER.length
  return THEME_ORDER[nextIndex]
}

function labelForTheme(preference: ThemePreference): string {
  if (preference === 'light') return 'Light'
  if (preference === 'dark') return 'Dark'
  return 'System'
}

export function ThemeToggle() {
  const { preference, setTheme } = useTheme()

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => setTheme(nextTheme(preference))}
      aria-label="Theme toggle"
      data-theme-preference={preference}
    >
      Theme: {labelForTheme(preference)}
    </Button>
  )
}
