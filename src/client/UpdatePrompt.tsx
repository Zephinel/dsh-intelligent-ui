/**
 * Frame-wide update prompt for the `shell.overlay` list slot.
 *
 * The prompt appears only when the controller decided the user should see it:
 * on the second explicit composer enable after a newer stable version was
 * detected, or on a page start while the deployment-wide switch keeps the
 * plugin on by default. It never blocks the app (the overlay layer is
 * click-through; only the card opts into pointer events) and it carries the
 * four decisions from the update flow: update, later, details, and — from the
 * fourth prompt for one version on — do not remind.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the ui-layout `shell.overlay` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { PACKAGE_NAME } from '../shared/intelligent-ui.ts'
import { LATER_CLICKS_BEFORE_SILENCE } from './update-prompt.ts'
import type { UpdatePromptActions, UpdatePromptStore } from './update-prompt-controller.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'

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

/** The extension's own app icon, inlined so the prompt carries the brand mark. */
function PluginMark(): ReactNode {
  return (
    <svg className="dsh-iui-update-prompt-mark" width="24" height="24" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="dsh-iui-update-prompt-accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5aa9ff" />
          <stop offset="1" stopColor="#38d6a4" />
        </linearGradient>
      </defs>
      <rect className="dsh-iui-update-prompt-tile" x="2" y="2" width="60" height="60" rx="16" />
      <rect className="dsh-iui-update-prompt-edge" x="2.75" y="2.75" width="58.5" height="58.5" rx="15.25" fill="none" strokeWidth="1.5" />
      <path className="dsh-iui-update-prompt-spark" d="M26 15.5c0 5.9 3.6 9.5 9.5 9.5-5.9 0-9.5 3.6-9.5 9.5 0-5.9-3.6-9.5-9.5-9.5 5.9 0 9.5-3.6 9.5-9.5Z" />
      <path d="M43.5 24c0 3.6 2.2 5.8 5.8 5.8-3.6 0-5.8 2.2-5.8 5.8 0-3.6-2.2-5.8-5.8-5.8 3.6 0 5.8-2.2 5.8-5.8Z" fill="url(#dsh-iui-update-prompt-accent)" />
      <rect className="dsh-iui-update-prompt-line-one" x="15" y="40" width="24" height="3.4" rx="1.7" />
      <rect className="dsh-iui-update-prompt-line-two" x="15" y="46.4" width="15" height="3.4" rx="1.7" />
    </svg>
  )
}

export function UpdatePrompt({ prompt, actions, t = fallbackT }: UpdatePromptProps): ReactNode {
  const snapshot = useSyncExternalStore(
    prompt.subscribe,
    prompt.getSnapshot,
    prompt.getSnapshot,
  )
  if (snapshot.kind !== 'shown') return null
  const title = t('update.prompt.title', { name: SHORT_NAME })
  return (
    <div
      className="dsh-iui-update-prompt"
      data-dsh-iui-update-prompt
      data-version={snapshot.latest}
      role="region"
      aria-label={title}
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
        {snapshot.laterClicks >= LATER_CLICKS_BEFORE_SILENCE
          ? (
            <button
              type="button"
              className="dsh-iui-update-prompt-link dsh-iui-update-prompt-silence"
              data-dsh-iui-update-action="dont-remind"
              onClick={actions.dontRemind}
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
