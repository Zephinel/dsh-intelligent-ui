/**
 * Frame-wide update prompt for the `shell.overlay` list slot.
 *
 * The prompt appears only when the controller decided the user should see it:
 * on the second explicit composer enable after a newer stable version was
 * detected, or on a page start while the deployment-wide switch keeps the
 * plugin on by default. It never blocks the app (the overlay layer is
 * click-through; only the card opts into pointer events) and it carries the
 * four decisions from the update flow: update, later, details, and — from the
 * fourth prompt for one version on — do not remind. Escape or a click outside
 * the card settles it exactly like "later".
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the ui-layout `shell.overlay` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { PACKAGE_NAME } from '../shared/intelligent-ui.ts'
import type { UpdatePromptActions, UpdatePromptStore } from './update-prompt-controller.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import { useVisualViewportRevision } from './visual-viewport.ts'

/** Short package name shown in the prompt title. */
const SHORT_NAME = PACKAGE_NAME.split('/').at(-1) ?? PACKAGE_NAME

/** Business face the plugin registration injects into the overlay entry. */
export interface UpdatePromptInjected {
  /** Prompt snapshot store owned by the page controller. */
  readonly prompt: UpdatePromptStore
  readonly actions: UpdatePromptActions
}

/** Full props: the `shell.overlay` entry kit, injected face and locale seat. */
export type UpdatePromptProps = PropsRuntime<'shell.overlay'>
  & InjectFace<UpdatePromptInjected>
  & {
    /** DSH locale seat; defaults to English when rendered outside a slot. */
    readonly t?: Translate
  }

/**
 * The extension's own app icon, inlined so the prompt carries the brand mark.
 * This is the small-size cut of icon.svg (bubble + image block + action), which
 * stays legible at the prompt's 24 px. Colors are baked in like icon.svg, so it
 * reads the same on light and dark shells.
 */
function PluginMark(): ReactNode {
  const tile = 'M15.5 2h33A13.5 13.5 0 0 1 62 15.5v33A13.5 13.5 0 0 1 48.5 62h-33A13.5 13.5 0 0 1 2 48.5v-33A13.5 13.5 0 0 1 15.5 2Z'
  return (
    <svg className="dsh-iui-update-prompt-mark" width="24" height="24" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="dsh-iui-mark-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2d31" />
          <stop offset="1" stopColor="#111418" />
        </linearGradient>
        <linearGradient id="dsh-iui-mark-glyph" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8f9f7" />
          <stop offset="1" stopColor="#dddfda" />
        </linearGradient>
        <linearGradient id="dsh-iui-mark-accent" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4f35e" />
          <stop offset="1" stopColor="#b4d82c" />
        </linearGradient>
      </defs>
      <path d={tile} fill="url(#dsh-iui-mark-tile)" />
      <path d={tile} fill="none" stroke="#fff" strokeOpacity=".07" strokeWidth=".7" />
      <g transform="translate(0 2.4)">
        <path d="M21 11h22a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10H30l-6.6 5.4c-.9.7-2.4.2-2.4-1V45a10 10 0 0 1-10-10v-14a10 10 0 0 1 10-10Z" fill="url(#dsh-iui-mark-glyph)" />
        <rect x="16.5" y="16.5" width="31" height="14" rx="3" fill="#15181d" />
        <rect x="33" y="34" width="14.5" height="6" rx="3" fill="url(#dsh-iui-mark-accent)" />
      </g>
    </svg>
  )
}

export function UpdatePrompt({ prompt, actions, t = fallbackT }: UpdatePromptProps): ReactNode {
  const snapshot = useSyncExternalStore(
    prompt.subscribe,
    prompt.getSnapshot,
    prompt.getSnapshot,
  )
  const cardRef = useRef<HTMLDivElement | null>(null)
  const shown = snapshot.kind === 'shown'
  const viewportRevision = useVisualViewportRevision()
  const [frame, setFrame] = useState({ right: 20, bottom: 20, maxWidth: 360 })
  useLayoutEffect(() => {
    const vv = window.visualViewport
    const offsetLeft = vv?.offsetLeft ?? 0
    const offsetTop = vv?.offsetTop ?? 0
    const width = vv?.width ?? window.innerWidth
    const height = vv?.height ?? window.innerHeight
    setFrame({
      right: Math.max(20, window.innerWidth - (offsetLeft + width) + 20),
      bottom: Math.max(20, window.innerHeight - (offsetTop + height) + 20),
      maxWidth: Math.max(200, Math.min(360, width - 40)),
    })
  }, [viewportRevision])

  useEffect(() => {
    if (!shown) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      actions.later()
    }
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target === null || cardRef.current?.contains(target) === true) return
      actions.later()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [shown, actions])

  if (snapshot.kind !== 'shown') return null
  const title = t('update.prompt.title', { name: SHORT_NAME })
  return (
    <div
      ref={cardRef}
      className="dsh-iui-update-prompt"
      data-dsh-iui-update-prompt
      role="region"
      aria-label={title}
      style={{ right: frame.right, bottom: frame.bottom, maxWidth: frame.maxWidth }}
    >
      <div className="dsh-iui-update-prompt-head">
        <span className="dsh-iui-update-prompt-icon" aria-hidden="true"><PluginMark /></span>
        <span className="dsh-iui-update-prompt-titles">
          <strong className="dsh-iui-update-prompt-title">{title}</strong>
          <span className="dsh-iui-update-prompt-versions" data-dsh-iui-update-versions>{snapshot.current} → {snapshot.latest}</span>
        </span>
      </div>
      <div className="dsh-iui-update-prompt-actions">
        <button
          type="button"
          className="dsh-iui-update-prompt-primary"
          data-dsh-iui-update-action="update"
          onClick={actions.update}
        >{t('update.prompt.update')}</button>
        <button
          type="button"
          className="dsh-iui-update-prompt-secondary"
          data-dsh-iui-update-action="later"
          onClick={actions.later}
        >{t('update.prompt.later')}</button>
        <button
          type="button"
          className="dsh-iui-update-prompt-link"
          data-dsh-iui-update-action="details"
          aria-expanded={snapshot.expanded}
          onClick={actions.toggleDetails}
        >
          {t(snapshot.expanded ? 'update.prompt.hideDetails' : 'update.prompt.details')}
        </button>
        {snapshot.canSilence
          ? (
            <button
              type="button"
              className="dsh-iui-update-prompt-link dsh-iui-update-prompt-silence"
              data-dsh-iui-update-action="dont-remind"
              onClick={actions.silence}
            >{t('update.prompt.dontRemind')}</button>
          )
          : null}
      </div>
      {snapshot.expanded
        ? (
          <div className="dsh-iui-update-prompt-details" data-dsh-iui-update-details>
            <span className="dsh-iui-update-prompt-details-title">{t('update.highlights')}</span>
            {snapshot.highlights.length === 0
              ? <p className="dsh-iui-update-prompt-empty">{t('update.noHighlights')}</p>
              : (
                <ul className="dsh-iui-update-prompt-points">
                  {snapshot.highlights.map((point, index) => <li key={`${index}:${point}`}>{point}</li>)}
                </ul>
              )}
          </div>
        )
        : null}
    </div>
  )
}
