import { useEffect, useState } from 'react'

export function useBlobUrl(blob: Blob | null): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!blob) {
      setBlobUrl(null)
      return
    }

    const nextUrl = URL.createObjectURL(blob)
    setBlobUrl(nextUrl)

    return () => {
      URL.revokeObjectURL(nextUrl)
    }
  }, [blob])

  return blobUrl
}
