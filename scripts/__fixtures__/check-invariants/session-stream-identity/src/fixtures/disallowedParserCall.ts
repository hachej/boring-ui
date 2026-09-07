declare function parseSessionStreamPath(path: string): unknown

export const forbidden = parseSessionStreamPath('fixture')
