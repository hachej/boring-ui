export const D1_CADDY_IMAGE = 'caddy@sha256:af5fdcd76f2db5e4e974ee92f96ee8c0fc3edb55bd4ba5032547cbf3f65e486d'
export const D1_CADDY_AMD64_ID = 'sha256:af555904a0961945f16bb323a501457b13a4f7e9bde969b145b97da80b38ecbe'
export const D1_CADDYFILE_DIGEST = 'sha256:a391f757bc9398e0dbd279e6a503fe608e6571f29c166164ff36552afd0f72c8'

export const D1_CADDY_COMMAND = Object.freeze([
  'caddy', 'run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile',
] as const)

export const D1_CADDY_IMAGE_DEFAULTS = Object.freeze({
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  CADDY_VERSION: 'v2.11.4',
  XDG_CONFIG_HOME: '/config',
  XDG_DATA_HOME: '/data',
} as const)
