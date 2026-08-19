import assert from 'node:assert/strict'
import test from 'node:test'

import { extractBeadId, extractLinkedIssueNumber } from './present-pr-links.mjs'

test('derives the linked issue from semantic PR body references', () => {
  assert.equal(extractLinkedIssueNumber('Fixes #1206'), 1206)
  assert.equal(extractLinkedIssueNumber('GitHub issue: #1290\nPR: #1319'), 1290)
  assert.equal(extractLinkedIssueNumber('See https://github.com/hachej/boring-ui/issues/1206'), 1206)
  assert.equal(extractLinkedIssueNumber('Refs: #1206'), 1206)
  assert.equal(extractLinkedIssueNumber('PR: #1319\nHead: abc'), null)
})

test('derives the bead from the title first, then the PR body', () => {
  assert.equal(extractBeadId('[wt-391-forward-7dw1] fix viewer', 'Bead: `br-other`'), 'wt-391-forward-7dw1')
  assert.equal(extractBeadId('fix viewer', 'Bead: `br-1206`'), 'br-1206')
  assert.equal(extractBeadId('fix viewer', 'No task reference'), 'unknown bead')
})
