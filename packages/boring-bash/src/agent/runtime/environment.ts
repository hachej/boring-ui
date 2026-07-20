export function getEnvSnapshot(): Record<string, string | undefined> {
  return { ...process.env }
}
