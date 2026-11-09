/**
 * Unit tests for the image source policy and the client workspace reader.
 *
 * Run: node --test test/client/image-source.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_IMAGE_DATA_BYTES,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_PIXELS,
  classifyImageSource,
  describeImagePathProblem,
  explicitImageSource,
  imageDataUrlDimensions,
  isSvgImageBytes,
  readImageDimensions,
  sniffImageMime,
} from '../../src/shared/image-source.ts'
import { createWorkspaceImageResolver } from '../../src/client/image-source.ts'

/** Valid PNG header plus filler bytes. */
function pngBytes(length = 32) {
  const bytes = new Uint8Array(length)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}

/** Base64 of a short valid PNG payload. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('classifies http(s), data and path sources', () => {
  assert.deepEqual(classifyImageSource('https://example.com/a.png'), { kind: 'remote', url: 'https://example.com/a.png' })
  assert.deepEqual(classifyImageSource('http://example.com/a.png'), { kind: 'remote', url: 'http://example.com/a.png' })
  assert.deepEqual(classifyImageSource('figures/att01.png'), { kind: 'path', path: 'figures/att01.png' })
  assert.deepEqual(classifyImageSource('/Users/me/figures/att01.png'), { kind: 'path', path: '/Users/me/figures/att01.png' })
  assert.deepEqual(classifyImageSource('C:\\figures\\att01.png'), { kind: 'path', path: 'C:\\figures\\att01.png' })
  const data = classifyImageSource(`data:image/png;base64,${PNG_BASE64}`)
  assert.equal(data.kind, 'data')
  assert.equal(data.kind === 'data' ? data.mime : undefined, 'image/png')
})

test('rejects SVG, unknown schemes and malformed data URIs', () => {
  assert.deepEqual(classifyImageSource('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), { kind: 'error', problem: 'svg-unsupported' })
  assert.deepEqual(classifyImageSource('data:image/bmp;base64,Qk0='), { kind: 'error', problem: 'type-unsupported' })
  assert.deepEqual(classifyImageSource('data:image/png,notbase64'), { kind: 'error', problem: 'data-invalid' })
  assert.deepEqual(classifyImageSource('data:image/png;base64,@@@@'), { kind: 'error', problem: 'data-invalid' })
  assert.deepEqual(classifyImageSource('data:image/png;base64,AAAAA'), { kind: 'error', problem: 'data-invalid' })
  assert.deepEqual(classifyImageSource('file:///etc/passwd'), { kind: 'error', problem: 'unsupported-scheme' })
  assert.deepEqual(classifyImageSource('javascript:alert(1)'), { kind: 'error', problem: 'unsupported-scheme' })
  assert.deepEqual(classifyImageSource('blob:https://x/y'), { kind: 'error', problem: 'unsupported-scheme' })
})

test('caps inline data URIs by decoded size', () => {
  const small = classifyImageSource(`data:image/png;base64,${'A'.repeat(8)}`)
  assert.equal(small.kind, 'data')
  // Four base64 characters per three bytes: one byte over the cap fails.
  const payload = 'A'.repeat(Math.ceil((MAX_IMAGE_DATA_BYTES + 1) / 3) * 4)
  assert.deepEqual(classifyImageSource(`data:image/png;base64,${payload}`), { kind: 'error', problem: 'data-too-large' })
})

test('normalizes protocol-relative URLs and case-insensitive data URIs', () => {
  assert.deepEqual(classifyImageSource('//upload.wikimedia.org/x.png'), {
    kind: 'remote',
    url: 'https://upload.wikimedia.org/x.png',
  })
  assert.deepEqual(classifyImageSource('//localhost:8080/x.png'), {
    kind: 'remote',
    url: 'https://localhost:8080/x.png',
  })
  assert.deepEqual(classifyImageSource('//fileserver/share/x.png'), { kind: 'path', path: '//fileserver/share/x.png' })
  const data = classifyImageSource(`DATA:image/png;base64,${PNG_BASE64}`)
  assert.equal(data.kind, 'data')
})

test('detects SVG payloads for a specific rejection', () => {
  assert.equal(isSvgImageBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), true)
  assert.equal(isSvgImageBytes(new TextEncoder().encode('  <?xml version="1.0"?><svg></svg>')), true)
  assert.equal(isSvgImageBytes(pngBytes()), false)
})

test('reads PNG, GIF, JPEG and WebP dimensions from headers', () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  png.set([0x00, 0x00, 0x02, 0x40], 16) // 576
  png.set([0x00, 0x00, 0x01, 0x20], 20) // 288
  assert.deepEqual(readImageDimensions(png), { width: 576, height: 288 })

  const gif = new Uint8Array(10)
  gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  gif.set([0x40, 0x01, 0x20, 0x00], 6) // 320 x 32
  assert.deepEqual(readImageDimensions(gif), { width: 320, height: 32 })

  const jpeg = new Uint8Array(32)
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58], 0) // 300 x 600
  assert.deepEqual(readImageDimensions(jpeg), { width: 600, height: 300 })

  const webp = new Uint8Array(30)
  webp.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], 0)
  webp.set([0x56, 0x50, 0x38, 0x58], 12)
  webp.set([0x64, 0x00, 0x00], 24) // width-1 = 100 -> width 101
  webp.set([0x32, 0x00, 0x00], 27) // height-1 = 50 -> height 51
  assert.deepEqual(readImageDimensions(webp), { width: 101, height: 51 })

  assert.equal(readImageDimensions(new TextEncoder().encode('not an image')), undefined)
})

test('Image treats a non-string dynamic source as invalid, never as a search cue', () => {
  assert.equal(explicitImageSource(undefined), '')
  assert.equal(explicitImageSource({ $ref: 'photo' }), '')
  assert.equal(explicitImageSource(42), '')
  assert.equal(explicitImageSource(' figures/a.png '), ' figures/a.png ')
  assert.deepEqual(classifyImageSource(explicitImageSource({ $ref: 'photo' })), { kind: 'error', problem: 'path-invalid' })
})

test('reads pixel dimensions from a data URI header before <img> decodes it', () => {
  const png = new Uint8Array(24)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  png.set([0x00, 0x00, 0x27, 0x10], 16) // 10000
  png.set([0x00, 0x00, 0x27, 0x10], 20) // 10000
  const base64 = Buffer.from(png).toString('base64')
  assert.deepEqual(imageDataUrlDimensions(`data:image/png;base64,${base64}`), { width: 10000, height: 10000 })
  assert.equal(imageDataUrlDimensions('data:text/plain;base64,aGk='), undefined)
  assert.equal(imageDataUrlDimensions('not a data uri'), undefined)
})

test('the inline cap accepts an image exactly at the cap regardless of base64 padding', () => {
  // A payload decoding to exactly the cap (mod 3 = 2 -> one '=') must fit.
  const exact = Buffer.alloc(MAX_IMAGE_DATA_BYTES)
  const exactData = `data:image/png;base64,${exact.toString('base64')}`
  assert.equal(classifyImageSource(exactData).kind, 'data')
  // 524287 bytes decodes with two '=' padding characters.
  const below = Buffer.alloc(MAX_IMAGE_DATA_BYTES - 1)
  assert.equal(classifyImageSource(`data:image/png;base64,${below.toString('base64')}`).kind, 'data')
  const over = Buffer.alloc(MAX_IMAGE_DATA_BYTES + 1)
  assert.deepEqual(classifyImageSource(`data:image/png;base64,${over.toString('base64')}`), { kind: 'error', problem: 'data-too-large' })
})

test('path policy rejects control characters, parent segments and home shorthand', () => {
  assert.equal(describeImagePathProblem('figures/ok.png'), undefined)
  assert.equal(describeImagePathProblem('/tmp/ok.png'), undefined)
  assert.equal(describeImagePathProblem('figures/../secret.png'), 'path-escape')
  assert.equal(describeImagePathProblem('/tmp/../etc/passwd'), 'path-escape')
  assert.equal(describeImagePathProblem('figures/bad\u0000.png'), 'path-invalid')
  assert.equal(describeImagePathProblem('~/secret.png'), 'path-invalid')
  assert.equal(describeImagePathProblem(''), 'path-invalid')
})

test('sniffs png, jpeg, gif and webp, and rejects other bytes', () => {
  assert.equal(sniffImageMime(pngBytes()), 'image/png')
  assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'image/gif')
  const webp = new Uint8Array(16)
  webp.set([0x52, 0x49, 0x46, 0x46], 0)
  webp.set([0x57, 0x45, 0x42, 0x50], 8)
  assert.equal(sniffImageMime(webp), 'image/webp')
  assert.equal(sniffImageMime(new TextEncoder().encode('<svg></svg>')), undefined)
  assert.equal(sniffImageMime(new Uint8Array([0x42, 0x4d])), undefined)
})

/** One fake workspace Remote; `readBytes` and `stat` are swapped per test. */
function fakeRemote({ bytes = pngBytes(), size, readError, statError } = {}) {
  const calls = []
  return {
    calls,
    remote: {
      async stat(_sessionId, path) {
        calls.push(['stat', path])
        if (statError !== undefined) return { ok: false, error: { code: statError } }
        return { ok: true, value: size === undefined ? {} : { bytes: size } }
      },
      async readBytes(_sessionId, path, options) {
        calls.push(['readBytes', path, options])
        if (readError !== undefined) return { ok: false, error: { code: readError } }
        return { ok: true, value: { data: bytes } }
      },
    },
  }
}

test('reads a workspace image into a blob URL and revokes it', async () => {
  const { remote, calls } = fakeRemote({ size: 128 })
  const revoked = []
  const resolver = createWorkspaceImageResolver('session-1', {
    remote,
    createObjectUrl: () => 'blob:test-image',
    revokeObjectUrl: url => revoked.push(url),
  })
  const result = await resolver('figures/att01.png')
  assert.deepEqual(result.ok, true)
  assert.equal(result.ok ? result.url : '', 'blob:test-image')
  result.ok && result.revoke?.()
  assert.deepEqual(revoked, ['blob:test-image'])
  assert.deepEqual(calls[0], ['stat', 'figures/att01.png'])
  assert.deepEqual(calls[1], ['readBytes', 'figures/att01.png', {}])
})

test('maps read failures and caps to placeholder problems', async () => {
  const over = createWorkspaceImageResolver('s', { remote: fakeRemote({ size: MAX_IMAGE_FILE_BYTES + 1 }).remote })
  assert.deepEqual(await over('a.png'), { ok: false, problem: 'too-large' })

  const missing = createWorkspaceImageResolver('s', { remote: fakeRemote({ readError: 'workspace-file/not-found' }).remote })
  assert.deepEqual(await missing('a.png'), { ok: false, problem: 'unavailable' })

  const notImage = createWorkspaceImageResolver('s', { remote: fakeRemote({ bytes: new TextEncoder().encode('hello') }).remote })
  assert.deepEqual(await notImage('a.txt'), { ok: false, problem: 'type-unsupported' })

  const hostLimit = createWorkspaceImageResolver('s', { remote: fakeRemote({ readError: 'workspace-file/too-large' }).remote })
  assert.deepEqual(await hostLimit('a.png'), { ok: false, problem: 'too-large' })

  const oversizedBytes = pngBytes(MAX_IMAGE_FILE_BYTES + 1)
  const postRead = createWorkspaceImageResolver('s', {
    remote: fakeRemote({ bytes: oversizedBytes }).remote,
    createObjectUrl: () => 'blob:too-big',
  })
  assert.deepEqual(await postRead('big.png'), { ok: false, problem: 'too-large' })
})

test('maps SVG bytes and header-oversized images to typed problems', async () => {
  const svg = createWorkspaceImageResolver('s', {
    remote: fakeRemote({ bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }).remote,
  })
  assert.deepEqual(await svg('diagram.svg'), { ok: false, problem: 'svg-unsupported' })

  const huge = new Uint8Array(24)
  huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  huge.set([0x00, 0x01, 0x00, 0x00], 16) // 65536
  huge.set([0x00, 0x01, 0x00, 0x00], 20) // 65536 -> 4.3 G-pixel bomb
  const resolver = createWorkspaceImageResolver('s', {
    remote: fakeRemote({ bytes: huge }).remote,
    createObjectUrl: () => 'blob:bomb',
  })
  assert.deepEqual(await resolver('bomb.png'), { ok: false, problem: 'too-large' })
})

test('rejects paths that violate the shared policy before any read', async () => {
  const { remote, calls } = fakeRemote()
  const resolver = createWorkspaceImageResolver('s', { remote })
  assert.deepEqual(await resolver('figures/../x.png'), { ok: false, problem: 'path-escape' })
  assert.deepEqual(await resolver('figures/\u0000.png'), { ok: false, problem: 'path-invalid' })
  assert.equal(calls.length, 0)
})

test('a Remote without readBytes degrades to the unsupported-host problem', async () => {
  const resolver = createWorkspaceImageResolver('s', { remote: { stat: async () => ({ ok: true, value: {} }) } })
  assert.deepEqual(await resolver('a.png'), { ok: false, problem: 'unsupported-host' })
})

test('image caps stay in a sane range', () => {
  assert.ok(MAX_IMAGE_DATA_BYTES <= 1024 * 1024)
  assert.ok(MAX_IMAGE_FILE_BYTES >= MAX_IMAGE_DATA_BYTES)
  assert.ok(MAX_IMAGE_PIXELS >= 10_000_000)
})
