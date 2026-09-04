import assert from 'node:assert/strict'
import test from 'node:test'
import { greeting } from '../src/greeting.js'

test('greets a person', () => {
  assert.equal(greeting('Factory'), 'Hello, Factory')
})
