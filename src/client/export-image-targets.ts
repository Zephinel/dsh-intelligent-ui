/**
 * Resolve what the image export should capture for one assistant Turn (D8).
 *
 * Before M1 a Turn's card list contained exactly the cards to capture. After M1
 * a Turn may contain only a compact revision notice (the revision is displayed by
 * the artifact's active stage card in another Turn), or a frozen historical card
 * whose artifact's current version lives on that stage. Export therefore follows
 * the same "current screen version" rule as the canvas:
 *
 * - the list has only pre-version cards (no artifact identity): capture the list
 *   as before;
 * - otherwise every involved artifact resolves to its active stage card (looked
 *   up across the whole conversation), falling back to a full card of the same
 *   Turn when no stage is mounted; the resulting elements are captured in
 *   first-appearance order, deduplicated;
 * - a notice whose stage cannot be found is a hard error, never a silent export
 *   of stale content.
 */

/** One direct child of the exported Turn's card list. */
export interface ExportTargetEntry {
  readonly element: HTMLElement
  readonly artifactId?: string
  readonly kind: 'card' | 'notice'
}

/** What the image export should do for one Turn. */
export type ExportCaptureTargets =
  | { readonly kind: 'container' }
  | { readonly kind: 'elements'; readonly elements: readonly HTMLElement[] }
  | { readonly kind: 'error'; readonly message: string }

/** Error copy for a Turn that has only un-capturable revision notices. */
export const NO_CAPTURABLE_STAGE_MESSAGE = 'intelligent-ui export: this answer only shows revision notices and its latest revision card is not visible; open the latest revision and export it from there'

/**
 * Pure capture-plan resolution.
 * @param entries - direct children of the Turn's card list, in message order.
 * @param resolveStage - artifact id → mounted stage element (cross-Turn lookup).
 * @returns the legacy container capture, the ordered elements, or a hard error.
 */
export function planExportCapture(
  entries: readonly ExportTargetEntry[],
  resolveStage: (artifactId: string) => HTMLElement | null | undefined,
): ExportCaptureTargets {
  if (entries.length === 0) return { kind: 'container' }
  const hasVersions = entries.some(entry => entry.artifactId !== undefined)
  if (!hasVersions) return { kind: 'container' }
  const elements: HTMLElement[] = []
  const seenArtifacts = new Set<string>()
  for (const entry of entries) {
    if (entry.artifactId === undefined) {
      // A card without version identity belongs to the pre-M1 layout; keep it.
      if (!elements.includes(entry.element)) elements.push(entry.element)
      continue
    }
    if (seenArtifacts.has(entry.artifactId)) continue
    seenArtifacts.add(entry.artifactId)
    const stage = resolveStage(entry.artifactId)
    if (stage !== null && stage !== undefined) {
      if (!elements.includes(stage)) elements.push(stage)
      continue
    }
    // Without a mounted stage, a full card of this Turn may still display a
    // live revision; a notice-only artifact cannot be captured.
    const local = entries.find(candidate => candidate.artifactId === entry.artifactId && candidate.kind === 'card')
    if (local !== undefined) {
      if (!elements.includes(local.element)) elements.push(local.element)
      continue
    }
    return { kind: 'error', message: NO_CAPTURABLE_STAGE_MESSAGE }
  }
  if (elements.length === 0) return { kind: 'error', message: NO_CAPTURABLE_STAGE_MESSAGE }
  return { kind: 'elements', elements }
}
