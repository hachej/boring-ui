import { beforeAll, describe, test } from 'vitest'
beforeAll(() => { console.log('ROOT BEFORE') })
describe.skipIf(true)('skipped', () => { test('x', () => {}) })
