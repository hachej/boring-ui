export interface ChannelDescriptor {
  readonly id: string
  readonly label: string
  readonly icon: string
  readonly sessionsReadOnlyInWorkspace: boolean
  readonly dialect: string
  readonly canOriginateIdentity: boolean
}

const descriptors = [
  {
    id: 'web',
    label: 'Web',
    icon: 'globe',
    sessionsReadOnlyInWorkspace: false,
    dialect: 'passthrough',
    canOriginateIdentity: true,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: 'message-circle',
    sessionsReadOnlyInWorkspace: true,
    dialect: 'whatsapp/markdown',
    canOriginateIdentity: true,
  },
] as const satisfies readonly ChannelDescriptor[]

export type BuiltinChannelId = typeof descriptors[number]['id']
export type OriginChannel = BuiltinChannelId | (string & {})

export const CHANNEL_DESCRIPTORS: ReadonlyMap<string, ChannelDescriptor> = new Map(
  descriptors.map((descriptor) => [descriptor.id, Object.freeze(descriptor)]),
)

export function channelDescriptor(originChannel: OriginChannel = 'web'): ChannelDescriptor | undefined {
  return CHANNEL_DESCRIPTORS.get(originChannel)
}
