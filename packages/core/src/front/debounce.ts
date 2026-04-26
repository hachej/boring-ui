export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number,
): T {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
  return debounced as unknown as T
}
