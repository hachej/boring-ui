import assert from 'node:assert/strict'
import test from 'node:test'

import { serializeInlineJson } from './present-pr-html.mjs'

test('serializes untrusted values without allowing a script-block escape', () => {
  const hostilePath = '</script><script>alert("present-pr")</script>\u2028&tail'
  const serialized = serializeInlineJson([{ path: hostilePath }])

  assert.doesNotMatch(serialized, /<|>|&|\u2028/)
  assert.deepEqual(JSON.parse(serialized), [{ path: hostilePath }])
})
