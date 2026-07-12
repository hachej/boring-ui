import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  assertD1IngressEcho,
  D1_CADDY_AMD64_ID,
  D1_CADDYFILE_DIGEST,
  D1_INGRESS_PROOF_CASES,
  D1_INGRESS_PROOF_HELPER_IMAGE,
  validateD1CaddyImageInspect,
  validateD1IngressContainerInspect,
} from '../../../../scripts/d1-ingress-header-proof.js'
import { D1_CADDY_IMAGE } from '../composeAdapter.js'

const source = '/repo/deploy/d1/Caddyfile'
const command = ['caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']
const caddyImage = [{
  Id: D1_CADDY_AMD64_ID, RepoDigests: [D1_CADDY_IMAGE],
  Config: { Cmd: command, Env: ['CADDY_VERSION=v2.11.4'] },
}]
const container = [{
  Config: { Image: D1_CADDY_IMAGE, Cmd: command },
  Mounts: [{ Type: 'bind', Source: source, Destination: '/etc/caddy/Caddyfile', RW: false }],
}]
const echo = {
  host: 'insurance.example.test:8443',
  distinct: { host: ['insurance.example.test:8443'], 'x-forwarded-host': ['insurance.example.test:8443'] },
  raw: ['Host', 'insurance.example.test:8443', 'X-Forwarded-Host', 'insurance.example.test:8443'],
}

describe('D1 ingress Docker proof contract', () => {
  it('pins the exact official image, selected image ID, helper, and config bytes', async () => {
    expect(D1_CADDY_IMAGE).toBe('caddy@sha256:af5fdcd76f2db5e4e974ee92f96ee8c0fc3edb55bd4ba5032547cbf3f65e486d')
    expect(D1_CADDY_AMD64_ID).toBe('sha256:af555904a0961945f16bb323a501457b13a4f7e9bde969b145b97da80b38ecbe')
    expect(D1_INGRESS_PROOF_HELPER_IMAGE).toMatch(/^node@sha256:[a-f0-9]{64}$/)
    const config = await readFile(new URL('../../../../../../deploy/d1/Caddyfile', import.meta.url))
    expect(`sha256:${createHash('sha256').update(config).digest('hex')}`).toBe(D1_CADDYFILE_DIGEST)
    expect(config.toString()).toBe(':8080 {\n\treverse_proxy core-app:3000 {\n\t\theader_up -Forwarded\n\t\theader_up Host {hostport}\n\t\theader_up X-Forwarded-Host {hostport}\n\t}\n}\n')
  })

  it('covers the exact hostile header matrix', () => {
    expect(D1_INGRESS_PROOF_CASES.map((entry) => entry.name)).toEqual([
      'forwarded-absent', 'forwarded-single', 'forwarded-empty', 'forwarded-repeated', 'forwarded-comma',
      'xfh-absent', 'xfh-hostile', 'xfh-repeated', 'xfh-comma',
    ])
  })

  it('requires one original Host/XFH value and no Forwarded value', () => {
    expect(() => assertD1IngressEcho(echo)).not.toThrow()
    for (const invalid of [
      { ...echo, host: 'evil.example' },
      { ...echo, raw: [...echo.raw, 'Forwarded', 'for=evil'] },
      { ...echo, raw: [...echo.raw, 'X-Forwarded-Host', 'evil.example'] },
      { ...echo, distinct: { ...echo.distinct, 'x-forwarded-host': ['insurance.example.test:8443', 'evil.example'] } },
      { ...echo, distinct: { ...echo.distinct, forwarded: [''] } },
    ]) expect(() => assertD1IngressEcho(invalid)).toThrow('echo')
  })

  it('rejects image, argv, repository, and mount drift', () => {
    expect(() => validateD1CaddyImageInspect(JSON.stringify(caddyImage))).not.toThrow()
    expect(() => validateD1IngressContainerInspect(JSON.stringify(container), source)).not.toThrow()
    for (const invalid of [
      [{ ...container[0], Config: { ...container[0].Config, Image: `caddy@sha256:${'0'.repeat(64)}` } }],
      [{ ...container[0], Config: { ...container[0].Config, Cmd: ['caddy', 'reverse-proxy'] } }],
      [{ ...container[0], Mounts: [{ ...container[0].Mounts[0], Source: '/other/Caddyfile' }] }],
      [{ ...container[0], Mounts: [{ ...container[0].Mounts[0], RW: true }] }],
    ]) expect(() => validateD1IngressContainerInspect(JSON.stringify(invalid), source)).toThrow('container')
    expect(() => validateD1CaddyImageInspect(JSON.stringify([{ ...caddyImage[0], RepoDigests: ['other@sha256:bad'] }]))).toThrow('image')
  })

  it('uses structured bounded Docker execution without a shell', async () => {
    const proofSource = await readFile(new URL('../../../../scripts/d1-ingress-header-proof.ts', import.meta.url), 'utf8')
    expect(proofSource).toMatch(/spawnSync\('docker'/)
    expect(proofSource).toMatch(/shell: false/)
    expect(proofSource).not.toMatch(/execSync|execFileSync|\/bin\/sh|shell: true/)
  })
})
