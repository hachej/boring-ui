import { useConfig } from '@hachej/boring-core/front'

function shortBrandName(appName: string): string {
  const trimmed = appName.trim()
  return trimmed.replace(/\s+AI$/i, '') || trimmed || 'Boring UI'
}

export function PublicHeroDescription() {
  const { appName } = useConfig()
  const brandName = shortBrandName(appName)
  return (
    <>
      Choose the AI you <em className="public-hero-trust">trust</em>.<br />
      {brandName} gives it a private remote computer where it can read files, run tasks, make changes, and show you the work for review.
    </>
  )
}
