export interface ParsedDeck {
  title?: string
  slides: Array<{ index: number; raw: string }>
}

export function splitSlides(input: string): string[] {
  return input ? [input] : []
}

export function parseWidgetAttrs(_raw: string): Record<string, string> {
  return {}
}

export function parseDeckMarkdown(input: string): ParsedDeck {
  const slides = splitSlides(input).map((raw, index) => ({ index, raw }))
  return { slides }
}
