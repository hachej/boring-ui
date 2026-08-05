export function codedError<TExtra extends object = Record<never, never>>(
  message: string,
  code: string,
  statusCode?: number,
  extra?: TExtra,
): Error & { code: string; statusCode?: number } & TExtra {
  const error = Object.assign(new Error(message), { code })
  if (statusCode !== undefined) Object.assign(error, { statusCode })
  return Object.assign(error, extra ?? {}) as Error & { code: string; statusCode?: number } & TExtra
}
