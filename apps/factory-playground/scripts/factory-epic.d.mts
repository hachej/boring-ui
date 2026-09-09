export const REPOSITORY_ROOT: string

export function cmdAdopt(
  epicKey: string,
  flags: { readonly session?: string | boolean; readonly transcript?: string | boolean },
): Promise<void>
