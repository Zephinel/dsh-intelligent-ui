/**
 * Client-side reader for local image files referenced by Artifacts.
 *
 * The DSH client Remote exposes the Session's workspace file reads
 * (`remote.workspaceFiles.readBytes`); this module turns one path into a
 * same-origin blob URL the renderer can show. That reuses the exact file-read
 * authority of DSH's own file preview, keeps the image same-origin (so PNG
 * export never taints the canvas) and needs no new Host route. Failures map to
 * the renderer's localized placeholder problems instead of throwing.
 */
import {
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_PIXELS,
  describeImagePathProblem,
  isSvgImageBytes,
  readImageDimensions,
  sniffImageMime,
  type ImageResolution,
  type ImageSourceProblem,
  type ImageSourceResolver,
} from '../shared/image-source.ts'

/** One Remote result envelope, as the DSH client returns it. */
export interface WorkspaceImageRemoteResult<Value> {
  readonly ok: boolean
  readonly value?: Value
  readonly error?: { readonly code?: string; readonly message?: string }
}

/** The slice of the `workspaceFiles` client Remote this module reads. */
export interface WorkspaceImageRemote {
  stat?(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceImageRemoteResult<{ readonly bytes?: number }>>
  readBytes?(
    sessionId: string,
    path: string,
    options: { readonly range?: { readonly offset: number; readonly length: number } },
    signal?: AbortSignal,
  ): Promise<WorkspaceImageRemoteResult<{ readonly data?: Uint8Array }>>
}

/** Injectable platform pieces, so the reader is testable under Node. */
export interface WorkspaceImageReaderDeps {
  readonly remote: WorkspaceImageRemote
  /** Blob URL factory; defaults to `URL.createObjectURL`. */
  readonly createObjectUrl?: (blob: Blob) => string
  /** Blob URL releaser; defaults to `URL.revokeObjectURL`. */
  readonly revokeObjectUrl?: (url: string) => void
  /** Upper bound on one Remote round trip; defaults to 15 s. */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

/** Abort one Remote call after the reader's own deadline. */
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('image read timed out'))
    }, timeoutMs)
  })
  try {
    // Race so a Remote that ignores the abort signal cannot stall the card.
    return await Promise.race([run(controller.signal), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Map one Remote error code to the renderer's placeholder problem. */
function problemForCode(code: string | undefined): ImageSourceProblem {
  if (code !== undefined && code.includes('too-large')) return 'too-large'
  return 'unavailable'
}

/**
 * Build one Session-bound local image reader.
 * @param sessionId - Session whose workspace grants the read authority.
 * @param deps - Remote face plus platform hooks.
 * @returns a resolver returning a blob URL, or a typed problem.
 */
export function createWorkspaceImageResolver(sessionId: string, deps: WorkspaceImageReaderDeps): ImageSourceResolver {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const create = deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob))
  const revoke = deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url))
  return async (path: string): Promise<ImageResolution> => {
    // Defense in depth: callers normally classified the path already.
    const policy = describeImagePathProblem(path)
    if (policy !== undefined) return { ok: false, problem: policy }
    const readBytes = deps.remote.readBytes
    if (readBytes === undefined) return { ok: false, problem: 'unsupported-host' }
    try {
      // Size is checked before the complete read; the Remote's own complete-file
      // cap (32 MiB by default) still bounds a backend that reports no size.
      const stat = deps.remote.stat === undefined
        ? undefined
        : await bounded(signal => deps.remote.stat!(sessionId, path, signal), timeoutMs)
      if (stat !== undefined && !stat.ok) return { ok: false, problem: problemForCode(stat.error?.code) }
      const size = stat?.value?.bytes
      if (typeof size === 'number' && size > MAX_IMAGE_FILE_BYTES) return { ok: false, problem: 'too-large' }
      const result = await bounded(signal => readBytes.call(deps.remote, sessionId, path, {}, signal), timeoutMs)
      if (!result.ok) return { ok: false, problem: problemForCode(result.error?.code) }
      const data = result.value?.data
      if (!(data instanceof Uint8Array) || data.byteLength === 0) return { ok: false, problem: 'unavailable' }
      if (data.byteLength > MAX_IMAGE_FILE_BYTES) return { ok: false, problem: 'too-large' }
      // The extension cannot be trusted (the model may have written anything);
      // only bytes that really are an accepted image type get a blob URL.
      const mime = sniffImageMime(data)
      if (mime === undefined) {
        // Explain an SVG payload specifically; everything else is unsupported.
        return { ok: false, problem: isSvgImageBytes(data) ? 'svg-unsupported' : 'type-unsupported' }
      }
      // Reject an oversized image from its header before the browser decodes it;
      // the renderer keeps the on-load check as a fallback for unknown headers.
      const dimensions = readImageDimensions(data)
      if (dimensions !== undefined && dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
        return { ok: false, problem: 'too-large' }
      }
      const url = create(new Blob([data], { type: mime }))
      return { ok: true, url, revoke: () => revoke(url) }
    } catch {
      return { ok: false, problem: 'unavailable' }
    }
  }
}
