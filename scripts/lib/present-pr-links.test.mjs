import assert from 'node:assert/strict'
import test from 'node:test'

import { extractBeadIds, extractLinkedIssueReference, resolveLinkedIssueReference } from './present-pr-links.mjs'

test('derives semantic same-repository issue references', () => {
  assert.deepEqual(extractLinkedIssueReference('Fixes #1206'), { repo: null, number: 1206 })
  assert.deepEqual(extractLinkedIssueReference('GitHub issue: #1290\nPR: #1319'), { repo: null, number: 1290 })
  assert.deepEqual(extractLinkedIssueReference('Refs: #1206'), { repo: null, number: 1206 })
  assert.equal(extractLinkedIssueReference('PR: #1319\nHead: abc'), null)
})

test('preserves repositories for qualified issue references', () => {
  assert.deepEqual(extractLinkedIssueReference('Fixes owner/other-repo#123'), { repo: 'owner/other-repo', number: 123 })
  assert.deepEqual(
    extractLinkedIssueReference('See https://github.com/hachej/boring-ui/issues/1206'),
    { repo: 'hachej/boring-ui', number: 1206 },
  )
})

test('resolves cross-repository issues and handles PR or unavailable references honestly', () => {
  const reference = { repo: 'owner/other-repo', number: 123 }
  assert.deepEqual(
    resolveLinkedIssueReference(reference, 'current/repo', (repo, number) => ({
      number,
      title: `Issue in ${repo}`,
      html_url: `https://github.com/${repo}/issues/${number}`,
    })),
    {
      issue: { number: 123, title: 'Issue in owner/other-repo', url: 'https://github.com/owner/other-repo/issues/123' },
      notice: '',
    },
  )
  assert.deepEqual(
    resolveLinkedIssueReference({ repo: null, number: 9 }, 'current/repo', () => ({ pull_request: {} })),
    { issue: null, notice: 'no linked issue (reference current/repo#9 is a pull request)' },
  )
  assert.deepEqual(
    resolveLinkedIssueReference({ repo: null, number: 404 }, 'current/repo', () => { throw new Error('missing') }),
    { issue: null, notice: 'linked issue current/repo#404 unavailable' },
  )
  assert.deepEqual(resolveLinkedIssueReference(null, 'current/repo', () => assert.fail()), { issue: null, notice: 'no linked issue' })
})

test('derives dotted bead IDs from the title first', () => {
  assert.deepEqual(extractBeadIds('[wt-391-forward-rjkl.2] fix viewer', 'Bead: `br-other`'), ['wt-391-forward-rjkl.2'])
})

test('accepts only explicit body bead fields and preserves multiple IDs', () => {
  assert.deepEqual(
    extractBeadIds('fix viewer', 'Mentions br-unrelated in prose.\n- Bead: `br-1206.1`\nBead: wt-1206.2'),
    ['br-1206.1', 'wt-1206.2'],
  )
  assert.deepEqual(extractBeadIds('fix viewer', 'No task reference'), [])
})
