/**
 * Configuration on the Plugins detail page for the Intelligent UI extension.
 *
 * The page owns one switch: `freeComposition`, a volatile field in the Host
 * settings document (entry id `intelligent-ui`). The switch is the user-facing
 * control for the design-playbook policy — the Host reads the field live and
 * appends the free-composition note to the injected prompt, while the browser
 * bundle-config page only stages the write. When the Host serves no settings
 * namespace (or the document is read-only) the switch stays disabled and the
 * page says why.
 */
import { useCallback, useId, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the settings client `configForms` service and its wire types.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pull the Plugins page `plugins.bundle.config` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { FREE_COMPOSITION_FIELD, type IntelligentUISettings } from '../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'

/** Settings document state the switch renders from. */
export interface SettingsFormSnapshot {
  /** `loading` before the first Host view, `unavailable` when the namespace is absent. */
  readonly status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted Host section, undefined before the first acceptance. */
  readonly value?: IntelligentUISettings
  /** Whether the Host settings document accepts writes. */
  readonly writable: boolean
}

/** The subset of the Host config form this page needs (kept structural for slot purity). */
export interface SettingsFormLike {
  /** @returns the current snapshot; stable until the next Host change. */
  getSnapshot(): SettingsFormSnapshot
  /** @param listener - invoked after each snapshot change. @returns the disposer. */
  subscribe(listener: () => void): () => void
  /**
   * Queue one field write.
   * @param field - field name inside the namespace.
   * @param value - JSON-shaped value.
   * @returns whether the Host accepted the write.
   */
  set(field: string, value: unknown): Promise<boolean>
}

/** Business face injected by the plugin registration. */
export interface SettingsPageInjected {
  /** Shared form for the `intelligent-ui` Host settings namespace. */
  readonly settingsForm: SettingsFormLike
}

/** Full props: the Plugins-page bundle-config kit, injected form, and locale seat. */
export type SettingsPageProps =
  & PropsRuntime<'plugins.bundle.config'>
  & InjectFace<SettingsPageInjected>
  & {
    /** DSH locale seat; defaults to English when rendered outside a slot. */
    readonly t?: Translate
  }

/**
 * Render the extension's configuration on its Plugin detail page: heading,
 * explanation, and one switch.
 * @param props - bundle-config owner props, the injected form, and the locale seat.
 * @returns the page content, or a disabled switch with a state note.
 */
export function SettingsPage({ settingsForm, t = fallbackT }: SettingsPageProps): ReactNode {
  const subscribe = useCallback((listener: () => void): (() => void) => settingsForm.subscribe(listener), [settingsForm])
  const getSnapshot = useCallback((): SettingsFormSnapshot => settingsForm.getSnapshot(), [settingsForm])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const hintId = useId()
  const noteId = useId()

  const free = snapshot.value?.freeComposition === true
  const ready = snapshot.status === 'ready'
  const disabled = !ready || !snapshot.writable || pending

  const flip = async (): Promise<void> => {
    if (disabled) return
    setPending(true)
    setFailed(false)
    try {
      if (!(await settingsForm.set(FREE_COMPOSITION_FIELD, !free))) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  const note = failed
    ? t('settings.error')
    : !ready
      ? snapshot.status === 'loading' ? t('settings.loading') : t('settings.unavailable')
      : !snapshot.writable
        ? t('settings.readonly')
        : pending
          ? t('settings.saving')
          : null

  return (
    <section className="dsh-iui-settings" aria-labelledby={`${hintId}-title`}>
      <h2 id={`${hintId}-title`} className="dsh-iui-settings-title">{t('settings.title')}</h2>
      <p className="dsh-iui-settings-description">{t('settings.description')}</p>
      <div className="dsh-iui-settings-row">
        <div className="dsh-iui-settings-copy">
          <div className="dsh-iui-settings-label">{t('settings.switch.label')}</div>
          <p id={hintId} className="dsh-iui-settings-hint">{free ? t('settings.switch.on') : t('settings.switch.off')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={free}
          aria-label={t('settings.switch.label')}
          aria-describedby={`${hintId} ${noteId}`}
          className="dsh-iui-switch"
          disabled={disabled}
          onClick={() => { void flip() }}
        >
          <span className="dsh-iui-switch-thumb" aria-hidden="true" />
        </button>
      </div>
      <p id={noteId} className="dsh-iui-settings-note">{t('settings.note')}</p>
      {note === null ? null : (
        <p
          className={failed ? 'dsh-iui-settings-error' : 'dsh-iui-settings-note'}
          role={failed ? 'alert' : undefined}
        >
          {note}
        </p>
      )}
    </section>
  )
}
