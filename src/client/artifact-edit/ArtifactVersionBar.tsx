/**
 * M2 "recent tasks" revision bar for the active stage card.
 *
 * Opened from the stage card's history icon, it shows the artifact's recent
 * revisions as a horizontal strip of screenshot thumbnails (revision number,
 * source, time, current and pending-draft markers). Selecting an item resolves
 * the revision program (version store, local card or an on-demand Host fetch),
 * switches the M1 stage selection and closes; the parent plays the FLIP
 * transition. Nothing is written to the Host and no revision is created.
 *
 * The detailed metadata dialog stays available through the bar's "Details"
 * button, which keeps restore/delete management in one place.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { RemixIcon } from '../../lib/components/remix-icon.tsx'
import type { ArtifactHistoryProgramResponse, ArtifactHistoryResponse } from '../../shared/artifact-edit.ts'
import type { ImageSourceResolver } from '../../shared/image-source.ts'
import type { Translate } from '../../shared/locales.ts'
import { isStyleSnapshot, type StyleSnapshot, type StyleTemplate } from '../../shared/style-templates.ts'
import { resolveCardTheme } from '../export-html-plan.ts'
import { resolveStyleThemeVars } from '../../lib/style-theme.ts'
import { ensureArtifactBase } from './artifact-base.ts'
import { fetchArtifactHistory, fetchArtifactHistoryProgram, useLocalRevisions, type LocalArtifactRevision } from './local-revisions.ts'
import { buildVersionItems, type VersionItem } from './version-items.ts'
import { formatRevisionTime } from './revision-meta.ts'
import { artifactVersionFor, registerArtifactRevision, useArtifactVersion, type ArtifactVersionRecordInput } from './artifact-version.ts'
import {
  hydrateArtifactThumbnails,
  oppositeThumbnailScheme,
  thumbnailSnapshot,
  useThumbnailVersion,
  type ThumbnailParts,
  type ThumbnailScheme,
} from './artifact-thumbnails.ts'
import { scheduleLazyThumbnail } from './artifact-thumbnail-capture.ts'
import { rectOf, type FlipRect } from './stage-flip.ts'

/** Thumbnails lazily captured when the bar opens (visible-first budget). */
const LAZY_CAPTURE_LIMIT = 8
/** Panel geometry. */
const BAR_MAX_WIDTH = 720
const BAR_MARGIN = 12
const BAR_MAX_HEIGHT = 340

/** One resolved revision program plus its presentation identity. */
interface ResolvedRevision {
  readonly input: ArtifactVersionRecordInput
  readonly style: 'card' | 'article' | 'free'
  readonly styleId?: string
  readonly temporaryStyle?: StyleSnapshot
  readonly title?: string
}

/** Locale label for one version-bar source token. */
function sourceLabel(t: Translate, source: VersionItem['source']): string {
  switch (source) {
    case 'initial': return t('edit.historyInitial')
    case 'edit': return t('edit.historyEdit')
    case 'structure': return t('edit.historyStructure')
    case 'restore': return t('edit.historyRestore')
    case 'style': return t('edit.historyStyleSwitch')
    case 'props': return t('edit.propsRevision')
  }
}

/** Narrow one untrusted temporary-style value to a style snapshot. */
function snapshotOf(value: unknown): StyleSnapshot | undefined {
  return isStyleSnapshot(value) ? value : undefined
}

/** Props of the revision bar. */
export interface ArtifactVersionBarProps {
  readonly t: Translate
  readonly sessionId: string
  readonly artifactId: string
  /** Revision currently displayed by the stage. */
  readonly currentRevisionId: string
  readonly scheme: 'light' | 'dark'
  /** Program of the currently displayed revision, registered as Host base before reads. */
  readonly program: string
  /** Visible saved templates (lazy thumbnail theme resolution). */
  readonly templates?: readonly StyleTemplate[]
  /** Session-selected template id (theme-less snapshot inheritance). */
  readonly sessionStyle?: string
  readonly resolveImage?: ImageSourceResolver
  /** Revision ids an unsent draft in this chat is editing. */
  readonly draftRevisionIds: ReadonlySet<string>
  /** Element the bar anchors to (the stage card's history button). */
  readonly anchor: HTMLElement | null
  readonly onClose: () => void
  /** Opens the detailed metadata history (restore/delete live there). */
  readonly onOpenDetails: () => void
  /** Applies the selection; the parent closes the bar and may play the FLIP transition. */
  readonly onSelectRevision: (revisionId: string, animation?: { readonly start: FlipRect; readonly imageUrl: string }) => void
}

/**
 * Render the version bar for one stage card.
 * @param props - artifact identity, current revision, theme/locale seats and callbacks.
 * @returns the portaled bar.
 */
export function ArtifactVersionBar(props: ArtifactVersionBarProps): ReactElement {
  const { t, sessionId, artifactId, currentRevisionId, scheme, program, draftRevisionIds, anchor, onClose, onOpenDetails, onSelectRevision } = props
  const hintId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const detailsRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const resolvedCache = useRef(new Map<string, ResolvedRevision>())
  const lazyStarted = useRef(false)
  const [history, setHistory] = useState<ArtifactHistoryResponse | undefined>(undefined)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const allLocalRevisions = useLocalRevisions(sessionId)
  const localRevisions = useMemo<readonly LocalArtifactRevision[]>(
    () => allLocalRevisions.filter(revision => revision.artifactId === artifactId),
    [allLocalRevisions, artifactId],
  )
  const [placement, setPlacement] = useState<{ left: number; top: number; width: number } | null>(null)
  const [focusedId, setFocusedId] = useState<string>(currentRevisionId)
  const [pendingId, setPendingId] = useState<string | undefined>()
  const pendingRef = useRef(false)
  const [error, setError] = useState<string | undefined>()
  useThumbnailVersion()
  const versionState = useArtifactVersion(sessionId, artifactId)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    void ensureArtifactBase({ artifactId, revisionId: currentRevisionId, program }).then(() => fetchArtifactHistory(artifactId)).then(result => {
      if (cancelled) return
      if (result === undefined) { setStatus('error'); return }
      setHistory(result)
      setStatus('ready')
    })
    return () => { cancelled = true }
  }, [artifactId, currentRevisionId, program])

  const built = useMemo(() => buildVersionItems({
    history: history?.revisions.map(revision => ({
      revisionId: revision.revisionId,
      revision: revision.revision,
      source: revision.source,
      createdAt: revision.createdAt,
      hasProgram: revision.hasProgram,
      ...revision.editedBlockIds === undefined ? {} : { editedBlockIds: revision.editedBlockIds },
      ...revision.title === undefined ? {} : { title: revision.title },
      style: revision.style,
      ...revision.styleId === undefined ? {} : { styleId: revision.styleId },
      ...revision.temporaryStyle === undefined ? {} : { temporaryStyle: revision.temporaryStyle },
      ...revision.baseRevisionId === undefined ? {} : { baseRevisionId: revision.baseRevisionId },
    })) ?? [],
    local: localRevisions.map(revision => ({
      revisionId: revision.revisionId,
      revision: revision.revision,
      createdAt: revision.createdAt,
      style: revision.style,
      ...revision.kind === undefined ? {} : { kind: revision.kind },
      ...revision.title === undefined ? {} : { title: revision.title },
      ...revision.styleId === undefined ? {} : { styleId: revision.styleId },
      ...revision.temporaryStyle === undefined ? {} : { temporaryStyle: revision.temporaryStyle },
      ...revision.baseRevisionId === undefined ? {} : { baseRevisionId: revision.baseRevisionId },
    })),
    known: versionState.revisions,
    selectedRevisionId: currentRevisionId,
    draftRevisionIds,
  }), [history, localRevisions, versionState.revisions, currentRevisionId, draftRevisionIds])
  const items = built.items
  const themeStyleFor = useCallback((item: VersionItem, targetScheme: ThumbnailScheme): CSSProperties | undefined => {
    const theme = resolveCardTheme(
      { temporaryStyle: snapshotOf(item.temporaryStyle), styleId: item.styleId },
      props.templates ?? [],
      props.sessionStyle,
    )
    return theme === undefined ? undefined : resolveStyleThemeVars(theme, targetScheme) as CSSProperties
  }, [props.templates, props.sessionStyle])

  // Placement under the history trigger, clamped to the viewport.
  useLayoutEffect(() => {
    const rect = anchor?.getBoundingClientRect()
    const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth
    const width = Math.min(BAR_MAX_WIDTH, viewportWidth - BAR_MARGIN * 2)
    const left = rect === undefined
      ? Math.max(BAR_MARGIN, (viewportWidth - width) / 2)
      : Math.max(BAR_MARGIN, Math.min(rect.right - width, viewportWidth - width - BAR_MARGIN))
    const top = rect === undefined ? BAR_MARGIN * 8 : Math.min(rect.bottom + 8, (typeof window === 'undefined' ? 800 : window.innerHeight) - BAR_MAX_HEIGHT - BAR_MARGIN)
    setPlacement({ left, top: Math.max(BAR_MARGIN, top), width })
    const focusTimer = window.requestAnimationFrame(() => {
      const target = itemRefs.current.get(currentRevisionId) ?? itemRefs.current.values().next().value
      target?.focus({ preventScroll: true })
    })
    return () => { window.cancelAnimationFrame(focusTimer) }
  }, [anchor, currentRevisionId, items.length === 0])

  // Persisted thumbnails first, then one lazy capture batch for revisions the
  // stage never displayed (concurrency is capped inside the capture module).
  useEffect(() => {
    if (status !== 'ready' || lazyStarted.current) return
    lazyStarted.current = true
    let cancelled = false
    void (async () => {
      await hydrateArtifactThumbnails(artifactId)
      const otherScheme = oppositeThumbnailScheme(scheme)
      for (const item of built.items.slice(0, LAZY_CAPTURE_LIMIT)) {
        if (cancelled) return
        if (!item.hasProgram) continue
        // D5: queue one capture per scheme inside the same global concurrency
        // limit; the non-current scheme must use its own theme vars.
        let resolved: ResolvedRevision | undefined
        for (const targetScheme of [scheme, otherScheme] as const) {
          const parts: ThumbnailParts = { artifactId, revisionId: item.revisionId, scheme: targetScheme }
          if (thumbnailSnapshot(parts).status === 'ready') continue
          resolved ??= await resolveRevision(item)
          if (resolved === undefined || cancelled) break
          const themeStyle = themeStyleFor(item, targetScheme)
          scheduleLazyThumbnail({
            parts,
            program: resolved.input.program,
            ...resolved.title === undefined ? {} : { title: resolved.title },
            style: resolved.style,
            ...themeStyle === undefined ? {} : { themeStyle },
            scheme: targetScheme,
            t,
            ...props.resolveImage === undefined ? {} : { resolveImage: props.resolveImage },
          })
        }
      }
    })()
    return () => { cancelled = true }
  }, [status, artifactId, sessionId, scheme])

  /** Resolve one item's revision program (cache, version store, or Host fetch). */
  const resolveRevision = useCallback(async (item: VersionItem): Promise<ResolvedRevision | undefined> => {
    const cached = resolvedCache.current.get(item.revisionId)
    if (cached !== undefined) return cached
    const known = artifactVersionFor(sessionId, artifactId).revisions.get(item.revisionId)
    const style = item.style ?? known?.style ?? 'card'
    const styleId = item.styleId ?? known?.styleId
    const temporaryStyle = snapshotOf(item.temporaryStyle) ?? known?.temporaryStyle
    const title = item.title ?? known?.title
    if (known !== undefined) {
      const resolved: ResolvedRevision = {
        input: {
          revisionId: known.revisionId,
          artifactId,
          revision: known.revision,
          program: known.program,
          style: known.style,
          ...known.title === undefined ? {} : { title: known.title },
          ...known.styleId === undefined ? {} : { styleId: known.styleId },
          ...known.temporaryStyle === undefined ? {} : { temporaryStyle: known.temporaryStyle },
          ...known.baseRevisionId === undefined ? {} : { baseRevisionId: known.baseRevisionId },
          ...known.localRevision === true ? { localRevision: true } : {},
          ...known.localRevisionKind === undefined ? {} : { localRevisionKind: known.localRevisionKind },
        },
        style: known.style,
        ...known.styleId === undefined ? {} : { styleId: known.styleId },
        ...known.temporaryStyle === undefined ? {} : { temporaryStyle: known.temporaryStyle },
        ...known.title === undefined ? {} : { title: known.title },
      }
      resolvedCache.current.set(item.revisionId, resolved)
      return resolved
    }
    if (!item.hasProgram) return undefined
    const response: ArtifactHistoryProgramResponse | undefined = await fetchArtifactHistoryProgram(artifactId, item.revisionId)
    if (response === undefined) return undefined
    const input: ArtifactVersionRecordInput = {
      revisionId: item.revisionId,
      artifactId,
      revision: response.revision ?? item.revision,
      program: response.program,
      style,
      ...title === undefined ? {} : { title },
      ...styleId === undefined ? {} : { styleId },
      ...temporaryStyle === undefined ? {} : { temporaryStyle },
      ...item.baseRevisionId === undefined ? {} : { baseRevisionId: item.baseRevisionId },
    }
    registerArtifactRevision(sessionId, artifactId, input)
    const resolved: ResolvedRevision = {
      input,
      style,
      ...styleId === undefined ? {} : { styleId },
      ...temporaryStyle === undefined ? {} : { temporaryStyle },
      ...title === undefined ? {} : { title },
    }
    resolvedCache.current.set(item.revisionId, resolved)
    return resolved
  }, [artifactId, sessionId])

  /** Select one revision: ensure its program, then hand the selection to the parent. */
  const applySelection = useCallback(async (item: VersionItem): Promise<void> => {
    if (pendingRef.current) return
    setError(undefined)
    if (item.revisionId === currentRevisionId) { onClose(); return }
    pendingRef.current = true
    setPendingId(item.revisionId)
    let resolved: ResolvedRevision | undefined
    try {
      resolved = await resolveRevision(item)
    } finally {
      pendingRef.current = false
      setPendingId(undefined)
    }
    if (resolved === undefined) { setError(t('version.programMissing')); return }
    const parts: ThumbnailParts = { artifactId, revisionId: item.revisionId, scheme }
    const fallbackScheme: ThumbnailScheme = scheme === 'light' ? 'dark' : 'light'
    const snapshot = thumbnailSnapshot(parts, fallbackScheme)
    const element = itemRefs.current.get(item.revisionId)
    const thumbElement = element?.querySelector<HTMLElement>('[data-dsh-iui-version-thumb]') ?? element
    const rect = thumbElement?.getBoundingClientRect()
    const animation = snapshot.status === 'ready' && snapshot.url !== undefined && rect !== undefined
      ? { start: rectOf(rect), imageUrl: snapshot.url }
      : undefined
    onSelectRevision(item.revisionId, animation)
  }, [artifactId, scheme, currentRevisionId, onClose, onSelectRevision, resolveRevision, t])

  // Close on outside pointerdown / Escape, and reposition on resize.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) === true) return
      if (anchor?.contains(target) === true) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    const onResize = (): void => { onClose() }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onResize)
    }
  }, [anchor, onClose])

  /** Roving focus / listbox keyboard navigation. */
  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (items.length === 0) return
    const currentIndex = Math.max(0, items.findIndex(item => item.revisionId === focusedId))
    const focusAt = (index: number): void => {
      const item = items[(index + items.length) % items.length]
      setFocusedId(item.revisionId)
      itemRefs.current.get(item.revisionId)?.focus({ preventScroll: true })
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); focusAt(currentIndex - 1); return }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); focusAt(currentIndex + 1); return }
    if (event.key === 'Home') { event.preventDefault(); focusAt(0); return }
    if (event.key === 'End') { event.preventDefault(); focusAt(items.length - 1); return }
    // Tab walks the strip and wraps into the head controls instead of leaving
    // the dialog between two options.
    if (event.key === 'Tab') {
      event.preventDefault()
      const move = event.shiftKey ? currentIndex - 1 : currentIndex + 1
      if (move >= 0 && move < items.length) {
        const item = items[move]
        setFocusedId(item.revisionId)
        itemRefs.current.get(item.revisionId)?.focus({ preventScroll: true })
      } else if (event.shiftKey) {
        closeButtonRef.current?.focus({ preventScroll: true })
      } else {
        detailsRef.current?.focus({ preventScroll: true })
      }
    }
  }

  const style: CSSProperties | undefined = placement === null
    ? { left: 0, top: 0, width: BAR_MAX_WIDTH, opacity: 0 }
    : { left: placement.left, top: placement.top, width: placement.width }

  return createPortal(
    <div
      ref={panelRef}
      className="dsh-iui-version-bar"
      data-dsh-iui-version-bar
      role="dialog"
      aria-label={t('version.barTitle')}
      aria-describedby={hintId}
      style={style}
      onClick={event => { event.stopPropagation() }}
    >
      <span id={hintId} className="dsh-iui-a11y-hint" data-dsh-iui-version-a11y-hint>{t('version.a11yHint')}</span>
      <div className="dsh-iui-version-head">
        <span className="dsh-iui-version-title">{t('version.barTitle')}</span>
        <span className="dsh-iui-version-spacer" />
        <button
          ref={detailsRef}
          type="button"
          className="dsh-iui-version-details"
          data-dsh-iui-version-details
          onClick={onOpenDetails}
        >{t('version.details')}</button>
        <button
          ref={closeButtonRef}
          type="button"
          className="dsh-iui-version-close"
          data-dsh-iui-version-close
          aria-label={t('edit.historyClose')}
          title={t('edit.historyClose')}
          onClick={onClose}
        >
          <RemixIcon name="close-line" size={15} />
        </button>
      </div>
      {status === 'loading' ? <p className="dsh-iui-version-status" data-dsh-iui-version-loading role="status">{t('version.loading')}</p> : null}
      {status === 'error' ? <p className="dsh-iui-version-status is-error" data-dsh-iui-version-error role="alert">{t('edit.historyLoadFailed')}</p> : null}
      {status === 'ready' && items.length === 0 && localRevisions.length === 0
        ? <p className="dsh-iui-version-status" data-dsh-iui-version-empty>{t('edit.historyEmpty')}</p>
        : null}
      <div
        className="dsh-iui-version-list"
        data-dsh-iui-version-list
        role="listbox"
        aria-label={t('version.barTitle')}
        onKeyDown={onListKeyDown}
      >
        {items.map(item => {
          const parts: ThumbnailParts = { artifactId, revisionId: item.revisionId, scheme }
          const fallbackScheme: ThumbnailScheme = scheme === 'light' ? 'dark' : 'light'
          const snapshot = thumbnailSnapshot(parts, fallbackScheme)
          const pending = pendingId === item.revisionId
          return (
            <button
              key={item.revisionId}
              ref={element => {
                if (element === null) itemRefs.current.delete(item.revisionId)
                else itemRefs.current.set(item.revisionId, element)
              }}
              type="button"
              role="option"
              aria-selected={item.current}
              aria-label={item.hasProgram ? t('version.select', { n: item.revision }) : t('edit.historyUnavailable')}
              title={item.hasProgram ? t('version.select', { n: item.revision }) : t('edit.historyUnavailable')}
              tabIndex={item.revisionId === focusedId ? 0 : -1}
              className={`dsh-iui-version-item${item.current ? ' is-current' : ''}${item.local ? ' is-local' : ''}${item.hasProgram ? '' : ' is-unavailable'}`}
              data-dsh-iui-version-item
              data-revision-id={item.revisionId}
              data-revision={item.revision}
              data-current={item.current ? 'true' : undefined}
              data-source={item.source}
              data-draft={item.draft ? 'true' : undefined}
              data-local={item.local ? 'true' : undefined}
              disabled={pending || !item.hasProgram}
              onFocus={() => { setFocusedId(item.revisionId) }}
              onClick={() => { void applySelection(item) }}
            >
              <span
                className="dsh-iui-version-thumb"
                data-dsh-iui-version-thumb
                data-thumb-status={snapshot.status}
                data-thumb-scheme={snapshot.crossScheme ?? 'current'}
              >
                {snapshot.status === 'ready' && snapshot.url !== undefined
                  ? <img src={snapshot.url} alt="" loading="lazy" draggable={false} />
                  : <span className="dsh-iui-version-thumb-empty" aria-hidden="true">
                      <RemixIcon name="image-line" size={16} />
                      <span>{t('version.thumbUnavailable')}</span>
                    </span>}
              </span>
              <span className="dsh-iui-version-meta">
                <span className="dsh-iui-version-meta-row">
                  <span className="dsh-iui-version-revision">{t('edit.revision', { n: item.revision })}</span>
                  {item.current ? <span className="dsh-iui-version-current" data-dsh-iui-version-current>{t('edit.historyCurrent')}</span> : null}
                  <span className="dsh-iui-version-spacer" />
                  {item.createdAt === undefined ? null : <span className="dsh-iui-version-time">{formatRevisionTime(item.createdAt)}</span>}
                </span>
                <span className="dsh-iui-version-meta-row">
                  <span className="dsh-iui-version-source">{sourceLabel(t, item.source)}</span>
                  {item.draft
                    ? <span className="dsh-iui-version-draft" data-dsh-iui-version-draft title={t('version.draftMarker')}>{t('version.draftMarker')}</span>
                    : null}
                  {pending ? <span className="dsh-iui-version-pending" data-dsh-iui-version-pending role="status">{t('edit.historyLoading')}</span> : null}
                </span>
                {item.hasProgram ? null : <span className="dsh-iui-version-unavailable">{t('edit.historyUnavailable')}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {built.total > items.length
        ? <p className="dsh-iui-version-more" data-dsh-iui-version-more>{t('version.more', { count: built.total - items.length })}</p>
        : null}
      {error === undefined ? null : <p className="dsh-iui-version-status is-error" data-dsh-iui-version-action-error role="alert">{error}</p>}
    </div>,
    document.body,
  )
}
