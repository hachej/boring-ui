import { inflateSync } from "node:zlib"
import { decode as decodeJpeg } from "jpeg-js"

export function perceptualHashImage(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const decoded = decodeJpeg(buffer, { useTArray: true, formatAsRGBA: true })
    return averageHashPixels(decoded.data, decoded.width, decoded.height, 4, false)
  }
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("UI_REVIEW_SCREENSHOT_IMAGE_INVALID")
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = -1
  const compressed: Buffer[] = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii")
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error("UI_REVIEW_SCREENSHOT_PNG_TRUNCATED")
    const data = buffer.subarray(dataStart, dataEnd)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8] ?? 0
      colorType = data[9] ?? -1
      interlace = data[12] ?? -1
    } else if (type === "IDAT") {
      compressed.push(data)
    } else if (type === "IEND") {
      break
    }
    offset = dataEnd + 4
  }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0
  if (!width || !height || bitDepth !== 8 || channels === 0 || interlace !== 0 || compressed.length === 0) {
    throw new Error("UI_REVIEW_SCREENSHOT_PNG_FORMAT_UNSUPPORTED")
  }

  const stride = width * channels
  const inflated = inflateSync(Buffer.concat(compressed))
  if (inflated.length !== (stride + 1) * height) throw new Error("UI_REVIEW_SCREENSHOT_PNG_DATA_INVALID")
  const pixels = Buffer.alloc(stride * height)
  let sourceOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++]!
    const rowOffset = y * stride
    for (let x = 0; x < stride; x += 1) {
      const encoded = inflated[sourceOffset++]!
      const left = x >= channels ? pixels[rowOffset + x - channels]! : 0
      const up = y > 0 ? pixels[rowOffset + x - stride]! : 0
      const upLeft = y > 0 && x >= channels ? pixels[rowOffset + x - stride - channels]! : 0
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : filter === 4
                ? paeth(left, up, upLeft)
                : -1
      if (predictor < 0) throw new Error("UI_REVIEW_SCREENSHOT_PNG_FILTER_INVALID")
      pixels[rowOffset + x] = (encoded + predictor) & 0xff
    }
  }
  return averageHashPixels(pixels, width, height, channels, colorType === 0 || colorType === 4)
}

export function hexadecimalHammingDistance(left: string, right: string): number {
  if (!/^[a-f0-9]{16}$/i.test(left) || !/^[a-f0-9]{16}$/i.test(right)) {
    throw new Error("UI_REVIEW_SCREENSHOT_PHASH_INVALID")
  }
  let distance = 0
  for (let index = 0; index < left.length; index += 1) {
    let xor = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16)
    while (xor > 0) {
      distance += xor & 1
      xor >>= 1
    }
  }
  return distance
}

function averageHashPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number,
  grayscale: boolean,
): string {
  if (width <= 0 || height <= 0) throw new Error("UI_REVIEW_SCREENSHOT_DIMENSIONS_INVALID")
  const stride = width * channels
  const luminance: number[] = []
  for (let sampleY = 0; sampleY < 8; sampleY += 1) {
    const y = Math.min(height - 1, Math.floor(((sampleY + 0.5) * height) / 8))
    for (let sampleX = 0; sampleX < 8; sampleX += 1) {
      const x = Math.min(width - 1, Math.floor(((sampleX + 0.5) * width) / 8))
      const pixelOffset = y * stride + x * channels
      const red = pixels[pixelOffset]!
      const green = grayscale ? red : pixels[pixelOffset + 1]!
      const blue = grayscale ? red : pixels[pixelOffset + 2]!
      luminance.push(Math.round(red * 0.299 + green * 0.587 + blue * 0.114))
    }
  }
  const average = luminance.reduce((sum, value) => sum + value, 0) / luminance.length
  let hash = ""
  for (let index = 0; index < luminance.length; index += 4) {
    let nibble = 0
    for (let bit = 0; bit < 4; bit += 1) {
      if (luminance[index + bit]! >= average) nibble |= 1 << (3 - bit)
    }
    hash += nibble.toString(16)
  }
  return hash
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  return upDistance <= upLeftDistance ? up : upLeft
}
