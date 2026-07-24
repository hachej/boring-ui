import { timingSafeEqual } from 'node:crypto'

const CANONICAL_ENCODING_VERSION_V1 = 1
const MAX_CANONICAL_COMPONENT_BYTES_V1 = 65_536

export type CanonicalTupleComponentV1 = string | number

/** Server-only typed, length-prefixed tuple encoding. */
export function encodeCanonicalTupleV1(
  domainTag: number,
  components: readonly CanonicalTupleComponentV1[],
): Buffer {
  if (!Number.isInteger(domainTag) || domainTag < 1 || domainTag > 255) {
    throw new TypeError('Invalid canonical encoding domain')
  }
  if (components.length === 0 || components.length > 255) {
    throw new TypeError('Invalid canonical encoding component count')
  }

  const encoded = components.map((component) => {
    if (typeof component === 'string') {
      if (
        component.length === 0
        || /[\u0000-\u001f\u007f]/.test(component)
      ) {
        throw new TypeError('Invalid canonical string component')
      }
      const bytes = Buffer.from(component, 'utf8')
      if (
        bytes.byteLength === 0
        || bytes.byteLength > MAX_CANONICAL_COMPONENT_BYTES_V1
      ) {
        throw new TypeError('Invalid canonical string component length')
      }
      return { type: 1, bytes }
    }
    if (!Number.isSafeInteger(component) || component <= 0) {
      throw new TypeError('Invalid canonical integer component')
    }
    const bytes = Buffer.alloc(8)
    bytes.writeBigUInt64BE(BigInt(component))
    return { type: 2, bytes }
  })

  const output = Buffer.alloc(
    3 + encoded.reduce((length, component) => (
      length + 1 + 4 + component.bytes.byteLength
    ), 0),
  )
  output[0] = CANONICAL_ENCODING_VERSION_V1
  output[1] = domainTag
  output[2] = encoded.length
  let offset = 3
  for (const component of encoded) {
    output[offset] = component.type
    output.writeUInt32BE(component.bytes.byteLength, offset + 1)
    component.bytes.copy(output, offset + 5)
    offset += 5 + component.bytes.byteLength
  }
  return output
}

export function constantTimeBytesEqualV1(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.byteLength === rightBuffer.byteLength
    && timingSafeEqual(leftBuffer, rightBuffer)
}

export function constantTimeTextEqualV1(left: string, right: string): boolean {
  return constantTimeBytesEqualV1(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}
