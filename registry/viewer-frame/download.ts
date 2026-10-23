/** Offers `data` as a file download without navigating. The temporary object URL is revoked once the browser has taken the file. */
export function downloadFile(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name for a document title: lower case words joined by hyphens, with the extension of its type. */
export function fileNameFor(title: string, extension: string): string {
  const base = title.toLowerCase().replace(/\.[a-z0-9]{1,8}$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
  return `${base}.${extension}`;
}
