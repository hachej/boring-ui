import { useEffect, useState } from 'react'

/**
 * Creates and manages a blob URL for a File or Blob object.
 * Automatically revokes the URL on unmount or when the file changes,
 * preventing memory leaks from orphaned blob URLs.
 *
 * @param {File|Blob|null} file - The file to create a blob URL for
 * @returns {string|null} The blob URL, or null if no file provided
 */
export function useBlobUrl(file) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const blobUrl = URL.createObjectURL(file)
    setUrl(blobUrl)
    return () => URL.revokeObjectURL(blobUrl)
  }, [file])

  return url
}
