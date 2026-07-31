import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

describe('full-app production chat composition', () => {
  it('opts into dynamic addressed-agent selection without hardcoding an agent', () => {
    const chatParamsStart = source.indexOf('const chatParams = {')
    const renderStart = source.indexOf('\n\ncreateRoot(', chatParamsStart)
    const chatParamsSource = source.slice(chatParamsStart, renderStart)
    const workspaceFrontStart = source.indexOf('<CoreWorkspaceAgentFront', renderStart)
    const publicWorkspacePropsStart = source.indexOf(
      'chatFirstPublicWorkspaceProps=',
      workspaceFrontStart,
    )
    const workspaceFrontPropsSource = source.slice(
      workspaceFrontStart,
      publicWorkspacePropsStart,
    )

    expect(chatParamsStart).toBeGreaterThanOrEqual(0)
    expect(renderStart).toBeGreaterThan(chatParamsStart)
    expect(workspaceFrontStart).toBeGreaterThan(renderStart)
    expect(publicWorkspacePropsStart).toBeGreaterThan(workspaceFrontStart)
    expect(workspaceFrontPropsSource).toMatch(/\baddressedAgentSelection\b/)
    expect(workspaceFrontPropsSource).toMatch(/\buseAddressedAgentSelection=\{useAddressedAgentSelection\}/)
    expect(workspaceFrontPropsSource).toMatch(/\bworkspaceLayout="plugin-tabs"/)
    expect(workspaceFrontPropsSource).not.toMatch(/\bagentTypeId\s*=/)
    expect(chatParamsSource).not.toMatch(/\bagentTypeId\s*:/)
    expect(source).toMatch(/\bchatParams=\{chatParams\}/)
    expect(source).toMatch(/\bchatFirstPublicWorkspaceProps=\{\{[\s\S]*\baddressedAgentSelection:\s*false\b/)
  })
})
