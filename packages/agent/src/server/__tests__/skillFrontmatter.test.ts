import { describe, expect, test } from 'vitest'
import { parseSkillMetadataFrontmatter } from '../skillFrontmatter'

describe('parseSkillMetadataFrontmatter', () => {
  test('parses plain LF frontmatter', () => {
    const content = [
      '---',
      'name: authoring',
      'description: Authoring skill.',
      '---',
      '# Authoring',
    ].join('\n')
    expect(parseSkillMetadataFrontmatter(content)).toEqual({
      name: 'authoring',
      description: 'Authoring skill.',
    })
  })

  // Sol round-2: the workspace hand-rolled `frontmatterValue` scanner only
  // handled a bare `key: value` line split on `\n---`, so it silently
  // dropped metadata under CRLF line endings, quoted scalars, and folded
  // (multiline) YAML descriptions. This wrapper delegates to Pi's real YAML
  // parser and must get all three right.
  test('parses CRLF line endings', () => {
    const content = [
      '---',
      'name: crlf-skill',
      'description: CRLF description.',
      '---',
      '# CRLF',
    ].join('\r\n')
    expect(parseSkillMetadataFrontmatter(content)).toEqual({
      name: 'crlf-skill',
      description: 'CRLF description.',
    })
  })

  test('parses quoted scalar values', () => {
    const content = [
      '---',
      'name: "quoted: skill"',
      "description: 'Has a colon: right there.'",
      '---',
      '# Quoted',
    ].join('\n')
    expect(parseSkillMetadataFrontmatter(content)).toEqual({
      name: 'quoted: skill',
      description: 'Has a colon: right there.',
    })
  })

  test('parses folded (multiline) YAML description scalars', () => {
    const content = [
      '---',
      'name: folded-skill',
      'description: >',
      '  This description spans',
      '  multiple folded lines.',
      '---',
      '# Folded',
    ].join('\n')
    expect(parseSkillMetadataFrontmatter(content)).toEqual({
      name: 'folded-skill',
      description: 'This description spans multiple folded lines.',
    })
  })

  test('returns an empty object when there is no frontmatter or fields are missing', () => {
    expect(parseSkillMetadataFrontmatter('# No frontmatter here')).toEqual({})
    expect(parseSkillMetadataFrontmatter(['---', 'other: value', '---', 'body'].join('\n'))).toEqual({})
  })
})
