import { describe, expect, it } from 'vitest'
import { createPlateEditor } from 'platejs/react'
import { MarkdownPlugin } from '@platejs/markdown'
import {
  EMPTY_POTION_VALUE,
  potionPlugins,
} from '../../components/PotionEditor'
import { fileContents } from '../fixtures/files'
import {
  parseFrontmatter,
  reconstructContent,
} from '../../components/FrontmatterEditor'

const normalizeMarkdown = (value) => String(value || '').trim()

describe('PotionEditor smoke', () => {
  it('round-trips an example markdown document and preserves edits', () => {
    const content = fileContents.markdown.withFrontmatter
    const { body, frontmatter } = parseFrontmatter(content)

    const editor = createPlateEditor({
      plugins: potionPlugins,
      value: EMPTY_POTION_VALUE,
    })

    const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(body)
    editor.tf.replaceNodes(nodes, {
      at: [],
      children: true,
    })

    const roundTrip = editor.getApi(MarkdownPlugin).markdown.serialize()
    expect(normalizeMarkdown(roundTrip)).toBe(normalizeMarkdown(body))

    editor.tf.focus({ edge: 'endEditor' })
    editor.tf.insertText(' Updated in smoke test.')

    const editedBody = editor.getApi(MarkdownPlugin).markdown.serialize()
    expect(editedBody).toContain('This is the content. Updated in smoke test.')

    const fullDocument = reconstructContent(frontmatter, editedBody)
    expect(fullDocument).toContain('title: My Document')
    expect(fullDocument).toContain('This is the content. Updated in smoke test.')
  })
})
