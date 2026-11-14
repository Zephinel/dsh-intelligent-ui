/**
 * Update-check contract shared by the Host route and the browser notice.
 *
 * The extension cannot see npm from the browser reliably, so the Host exposes
 * one cached read of the package's `latest` dist-tag. The browser renders a
 * dismissible notice only when that tag is a stable version newer than the
 * running package, and the notice's action opens this bundle's Plugins detail
 * page, where DSH itself owns the actual update.
 */

/** Same-origin Host route serving the update check. */
export const UPDATE_ROUTE_PATH = '/api/intelligent-ui/update'

/** One answer of the update check; `latest` is null when the registry read failed. */
export interface UpdateCheckView {
  /** Version of the running package, read from its `package.json`. */
  readonly current: string
  /** Newest stable published version, or null when it could not be read. */
  readonly latest: string | null
  /** Whether a newer stable version than `current` is published. */
  readonly updateAvailable: boolean
}

/** Parsed stable version components. */
export interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/** A stable version is three numeric parts; prereleases and build suffixes are not update targets. */
const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/

/** Parse one stable version, ignoring prerelease/build suffixes. */
export function parseStableVersion(value: unknown): ParsedVersion | undefined {
  if (typeof value !== 'string') return undefined
  const match = STABLE_VERSION.exec(value.trim())
  if (match === null) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** Compare two stable versions; undefined when either side is not a stable version. */
export function compareStableVersions(left: string, right: string): number | undefined {
  const a = parseStableVersion(left)
  const b = parseStableVersion(right)
  if (a === undefined || b === undefined) return undefined
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

/** Whether `latest` is a published stable version newer than `current`. */
export function isNewerStableVersion(latest: unknown, current: string): boolean {
  if (parseStableVersion(latest) === undefined) return false
  return (compareStableVersions(latest as string, current) ?? 0) > 0
}
