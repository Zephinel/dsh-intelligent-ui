/**
 * Policy for model-authored image sources in rendered cards.
 *
 * `Image` accepts three source shapes: an http(s) URL (unchanged behavior), a
 * small base64 `data:image/...` URI, or a filesystem path that the browser
 * resolves through the Session's workspace file authority. This module is the
 * shared, DOM-free half: it classifies a source, enforces the path policy and
 * size caps, and sniffs the image type from bytes so a renamed file cannot
 * smuggle a non-image. The renderer resolves and displays; the client reads the
 * bytes; tests load these functions directly under Node.
 *
 * Path policy (2026-11-09): workspace-relative paths and absolute paths are
 * both accepted because the Host read authority, not this grammar, is the real
 * boundary. The grammar rejects NUL/control characters, `..` segments and any
 * URL scheme so a program cannot smuggle a URL through the path branch.
 */
/** Largest decoded base64 image accepted inline in a program, in bytes. */
export const MAX_IMAGE_DATA_BYTES = 512 * 1024

/** Largest local image file read from the workspace, in bytes. */
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024

/** Largest decoded local/inline image accepted, in pixels (width × height). */
export const MAX_IMAGE_PIXELS = 40_000_000

/** Image types the renderer accepts from a path or a data URI. */
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Every accepted MIME type, in sniffing order. */
export const IMAGE_MIME_TYPES: readonly ImageMime[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Why one image source cannot be shown. */
export type ImageSourceProblem =
  /** A URL scheme other than http(s)/data was given. */
  | 'unsupported-scheme'
  /** SVG is rejected until it can be sanitized. */
  | 'svg-unsupported'
  /** The data URI declares a type outside the whitelist. */
  | 'type-unsupported'
  /** The base64 payload is malformed or not base64. */
  | 'data-invalid'
  /** The decoded data URI is above the inline cap. */
  | 'data-too-large'
  /** The path grammar rejected the value (NUL, control characters, empty, `~`). */
  | 'path-invalid'
  /** The path contains a `..` segment. */
  | 'path-escape'
  /** The file is missing or unreadable for this Session. */
  | 'unavailable'
  /** The file or image is above the size/pixel cap. */
  | 'too-large'
  /** The Host client has no workspace file service. */
  | 'unsupported-host'
  /** The browser could not load the resolved image (decode/network). */
  | 'load-failed'

/** One classified image source. */
export type ResolvedImageSource =
  | { readonly kind: 'remote'; readonly url: string }
  | { readonly kind: 'data'; readonly url: string; readonly mime: ImageMime }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'error'; readonly problem: ImageSourceProblem }

/** Outcome of reading one path through the workspace file authority. */
export type ImageResolution =
  | { readonly ok: true; readonly url: string; readonly revoke?: () => void }
  | { readonly ok: false; readonly problem: ImageSourceProblem }

/** Reads one local image path; supplied by the DSH client card. */
export type ImageSourceResolver = (path: string) => Promise<ImageResolution>

/**
 * Runtime value of one `Image.src`.
 *
 * `Image` is semantically explicit even when a dynamic expression reaches the
 * component as a non-string value (an unresolved state ref): that value is an
 * invalid source, never a cue to search for a substitute photo.
 * @param source - raw component prop.
 * @returns the string source, or an empty string for a non-string value.
 */
export function explicitImageSource(source: unknown): string {
  return typeof source === 'string' ? source : ''
}

/** Scheme prefix of an absolute URL, without the colon. */
const URL_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

/** Windows drive prefix: `C:\`, `C:/`, `\\server\share`, or `//server/share`. */
const WINDOWS_ABSOLUTE = /^(?:[a-zA-Z]:[\\/]|\\\\|\/\/)/

/** Base64 payload check: alphabet, optional padding; a remainder of 1 is invalid. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Normalize `image/jpg` to `image/jpeg`; other values stay as written. */
function normalizeMime(value: string): string {
  const mime = value.trim().toLowerCase()
  return mime === 'image/jpg' ? 'image/jpeg' : mime
}

/** Whether a path contains a `..` segment, checking both separators. */
function hasParentSegment(path: string): boolean {
  return path.split(/[\\/]+/).some(segment => segment === '..')
}

/** Whether a path contains NUL or another control character. */
function hasControlCharacter(path: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(path)
}

/**
 * Classify one `Image(src)` value.
 * @param source - model-authored source string.
 * @returns the source kind, or the first policy problem it violates.
 */
export function classifyImageSource(source: unknown): ResolvedImageSource {
  if (typeof source !== 'string') return { kind: 'error', problem: 'unsupported-scheme' }
  const value = source.trim()
  if (value === '') return { kind: 'error', problem: 'path-invalid' }
  if (/^data:/i.test(value)) return classifyDataUrl(value)
  if (/^https?:/i.test(value)) return { kind: 'remote', url: value }
  // A protocol-relative URL is remote only when its authority looks like a host
  // (dot or port). Otherwise `//server/share` is a POSIX/UNC-style path and must
  // not be sent to the network.
  if (value.startsWith('//')) {
    const authority = value.slice(2).split('/')[0] ?? ''
    if (authority.includes('.') || authority.includes(':')) return { kind: 'remote', url: `https:${value}` }
  }
  // A drive letter path is a path, not a one-letter URL scheme.
  if (!WINDOWS_ABSOLUTE.test(value)) {
    const scheme = URL_SCHEME.exec(value)
    if (scheme !== null) return { kind: 'error', problem: 'unsupported-scheme' }
  }
  if (hasControlCharacter(value)) return { kind: 'error', problem: 'path-invalid' }
  if (value.startsWith('~')) return { kind: 'error', problem: 'path-invalid' }
  if (hasParentSegment(value)) return { kind: 'error', problem: 'path-escape' }
  return { kind: 'path', path: value }
}

/** Parse and validate one `data:image/...;base64,...` URI. */
function classifyDataUrl(value: string): ResolvedImageSource {
  const match = /^data:([^;,]+)(;[^,]*)?,(.*)$/is.exec(value)
  if (match === null) return { kind: 'error', problem: 'data-invalid' }
  const mime = normalizeMime(match[1])
  if (mime === 'image/svg+xml') return { kind: 'error', problem: 'svg-unsupported' }
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return { kind: 'error', problem: 'type-unsupported' }
  if (!(match[2] ?? '').toLowerCase().split(';').includes('base64')) return { kind: 'error', problem: 'data-invalid' }
  const payload = match[3].replace(/\s+/g, '')
  if (payload === '' || payload.length % 4 === 1 || !BASE64.test(payload)) return { kind: 'error', problem: 'data-invalid' }
  // Padding is not decoded bytes: subtract it so an image exactly at the cap is
  // accepted instead of being rejected as one or two bytes too large.
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  const bytes = Math.floor((payload.length * 3) / 4) - padding
  if (bytes > MAX_IMAGE_DATA_BYTES) return { kind: 'error', problem: 'data-too-large' }
  return { kind: 'data', url: value, mime: mime as ImageMime }
}

/** Decode the leading bytes of one base64 data-URI payload. */
export function decodeBase64Prefix(payload: string, maxBytes = 65536): Uint8Array | undefined {
  const clean = payload.replace(/\s+/g, '')
  const charLimit = Math.ceil(maxBytes / 3) * 4
  const prefix = clean.slice(0, charLimit - (charLimit % 4))
  try {
    const binary = atob(prefix)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return undefined
  }
}

/**
 * Dimensions of one accepted base64 image data URI, read before the browser
 * decodes it. This makes the pixel cap apply to inline data images too, not
 * only to local files whose bytes the client reads itself.
 * @param url - validated `data:image/...;base64,...` URI.
 * @returns dimensions when the header is recognized, else undefined.
 */
export function imageDataUrlDimensions(url: string): ImageDimensions | undefined {
  const match = /^data:([^;,]+)(;[^,]*)?,(.*)$/is.exec(url)
  if (match === null) return undefined
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(normalizeMime(match[1]))) return undefined
  if (!(match[2] ?? '').toLowerCase().split(';').includes('base64')) return undefined
  const prefix = decodeBase64Prefix(match[3])
  return prefix === undefined ? undefined : readImageDimensions(prefix)
}

/**
 * Whether a path policy problem applies to one local path (defense in depth for
 * callers that did not go through {@link classifyImageSource}).
 * @param path - already classified path.
 * @returns a problem code, or undefined when the path is acceptable.
 */
export function describeImagePathProblem(path: string): ImageSourceProblem | undefined {
  if (path.trim() === '') return 'path-invalid'
  if (hasControlCharacter(path)) return 'path-invalid'
  if (path.startsWith('~')) return 'path-invalid'
  if (hasParentSegment(path)) return 'path-escape'
  return undefined
}

/** Compare a byte slice against one magic prefix. */
function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((value, index) => bytes[index] === value)
}

/**
 * Whether the bytes are an SVG/XML image. SVG is not accepted from a path or a
 * data URI (it would need sanitizing), so the reader uses this to explain the
 * rejection instead of a generic unsupported-type problem.
 * @param bytes - leading file bytes (a few hundred are enough).
 * @returns true for XML/SVG payloads.
 */
export function isSvgImageBytes(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024)
  let text = ''
  for (let index = 0; index < limit; index += 1) {
    const value = bytes[index]
    // Cheap ASCII projection: XML prologs and tags are ASCII.
    text += value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : ' '
  }
  const head = text.replace(/^\uFEFF/, '').trimStart().toLowerCase() // eslint-disable-line no-control-regex
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))
}

/** Dimensions read from one image header, before the browser decodes it. */
export interface ImageDimensions {
  readonly width: number
  readonly height: number
}

/** Little-endian 24-bit value at one offset. */
function le24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

/** Big-endian 16-bit value at one offset. */
function be16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

/** Read JPEG dimensions by scanning to the first SOF marker. */
function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  const limit = Math.min(bytes.length, 65536)
  let index = 2
  while (index + 3 < limit) {
    if (bytes[index] !== 0xff) { index += 1; continue }
    while (index < limit && bytes[index] === 0xff) index += 1
    if (index >= limit) return undefined
    const marker = bytes[index]
    index += 1
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9 || marker === 0xda) return undefined
    if (index + 1 >= limit) return undefined
    const length = be16(bytes, index)
    if (length < 2) return undefined
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (index + 6 >= limit) return undefined
      const height = be16(bytes, index + 3)
      const width = be16(bytes, index + 5)
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    index += length
  }
  return undefined
}

/**
 * Read one accepted image's pixel dimensions from its header, so an oversized
 * decompression bomb is rejected before the browser decodes it. Returns
 * undefined for an unknown or truncated header; the renderer still applies the
 * on-load cap as a fallback.
 * @param bytes - complete file bytes (headers are at the front).
 * @returns width/height, or undefined when the header cannot be parsed.
 */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // PNG: IHDR width/height are the first two big-endian u32 after the signature.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && bytes.length >= 24) {
    const width = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0
    const height = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0
    return width > 0 && height > 0 ? { width, height } : undefined
  }
  // GIF: logical screen width/height are little-endian u16 after "GIF8".
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && bytes.length >= 10) {
    const width = bytes[6] | (bytes[7] << 8)
    const height = bytes[8] | (bytes[9] << 8)
    return width > 0 && height > 0 ? { width, height } : undefined
  }
  // JPEG: scan segments to the first SOF marker.
  if (startsWith(bytes, [0xff, 0xd8])) return jpegDimensions(bytes)
  // WebP: RIFF container; width/height by chunk variant.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 30
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const chunk = bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38
    if (chunk && bytes[15] === 0x58) {
      // VP8X: 24-bit (width-1) and (height-1).
      const width = 1 + le24(bytes, 24)
      const height = 1 + le24(bytes, 27)
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    if (chunk && bytes[15] === 0x20 && bytes.length >= 30
      && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      // VP8 key frame: 14-bit sizes after the start code.
      const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff
      const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    if (chunk && bytes[15] === 0x4c && bytes[20] === 0x2f && bytes.length >= 25) {
      // VP8L: 14-bit width and height packed into four little-endian bytes.
      const b0 = bytes[21]
      const b1 = bytes[22]
      const b2 = bytes[23]
      const b3 = bytes[24]
      const width = 1 + (((b1 & 0x3f) << 8) | b0)
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
      return width > 0 && height > 0 ? { width, height } : undefined
    }
  }
  return undefined
}

/** Magic-byte prefixes of the accepted image types. */
const MAGIC: ReadonlyArray<{ mime: ImageMime; prefix: readonly number[] }> = [
  { mime: 'image/png', prefix: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', prefix: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', prefix: [0x47, 0x49, 0x46, 0x38] },
]

/**
 * Sniff the image MIME type from the file's leading bytes.
 * @param bytes - complete image bytes or at least the first twelve.
 * @returns the accepted MIME type, or undefined for anything else (including SVG).
 */
export function sniffImageMime(bytes: Uint8Array): ImageMime | undefined {
  for (const entry of MAGIC) {
    if (startsWith(bytes, entry.prefix)) return entry.mime
  }
  // RIFF....WEBP: the type marker sits at bytes 8-11.
  if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  return undefined
}
