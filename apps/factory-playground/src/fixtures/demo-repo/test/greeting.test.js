import assert from 'node:assert/strict'
import test from 'node:test'
import { farewell, greeting } from '../src/greeting.js'

test('greets a person', () => {
  assert.equal(greeting('Factory'), 'Hello, Factory')
})

test('farewell says goodbye with exact punctuation', () => {
  assert.equal(farewell('Factory'), 'Goodbye, Factory.')
})
