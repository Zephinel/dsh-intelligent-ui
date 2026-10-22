/**
 * Configuration on the Plugins detail page for the Intelligent UI extension.
 *
 * The page owns the deployment-wide defaults: the global on/off switch, the
 * default answer style (`auto`, `card`, or `article`), the free-composition
 * preference, and the image-export background and scale. All of them are
 * volatile fields in the Host settings document (entry id `intelligent-ui`).
 * The composer's UI panel only overrides availability and style for one
 * session. When the Host serves no settings namespace (or the document is
 * read-only), the controls stay disabled and the page says why.
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the settings client `configForms` service and its wire types.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pull the Plugins page `plugins.bundle.config` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {
  ANSWER_STYLE_FIELD,
  EXPORT_BACKGROUND_FIELD,
  EXPORT_SCALES,
  EXPORT_BACKGROUND_PRESETS,
  EXPORT_SCALE_FIELD,
  EXPORT_TO_ASSISTANT_FIELD,
  FREE_COMPOSITION_FIELD,
  GLOBAL_ENABLED_FIELD,
  isExportBackground,
  isAnswerStyle,
  readImageExportSettings,
  type AnswerStyle,
  type ExportScale,
  type IntelligentUISettings,
} from '../shared/intelligent-ui.ts'
import { StylePicker } from './StylePicker.tsx'
import { fallbackT, type Translate } from '../shared/locales.ts'

/** Settings document state the page renders from. */
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

/** The writeable fields shown on this page. */
type PendingField =
  | typeof GLOBAL_ENABLED_FIELD
  | typeof ANSWER_STYLE_FIELD
  | typeof FREE_COMPOSITION_FIELD
  | typeof EXPORT_BACKGROUND_FIELD
  | typeof EXPORT_SCALE_FIELD
  | typeof EXPORT_TO_ASSISTANT_FIELD

/** One labelled switch row; the three settings in this page share this shape. */
function SwitchRow({
  label, hint, idPrefix, checked, disabled, describedBy, onToggle,
}: {
  readonly label: string
  readonly hint: string
  readonly idPrefix: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly describedBy: string
  readonly onToggle: () => void
}): ReactNode {
  return (
    <div className="dsh-iui-settings-row">
      <div className="dsh-iui-settings-copy">
        <div className="dsh-iui-settings-label">{label}</div>
        <p id={idPrefix} className="dsh-iui-settings-hint">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={describedBy}
        className="dsh-iui-switch"
        disabled={disabled}
        onClick={onToggle}
      >
        <span className="dsh-iui-switch-thumb" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Render the extension's configuration on its Plugin detail page: global
 * enablement, default answer style, free composition, and image-export defaults.
 * @param props - bundle-config owner props, the injected form, and the locale seat.
 * @returns the page content, or disabled controls with a state note.
 */
export function SettingsPage({ settingsForm, t = fallbackT }: SettingsPageProps): ReactNode {
  const subscribe = useCallback((listener: () => void): (() => void) => settingsForm.subscribe(listener), [settingsForm])
  const getSnapshot = useCallback((): SettingsFormSnapshot => settingsForm.getSnapshot(), [settingsForm])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [pending, setPending] = useState<PendingField | null>(null)
  const [failed, setFailed] = useState(false)
  const idPrefix = useId()
  const noteId = useId()

  const globalEnabled = snapshot.value?.globalEnabled === true
  const storedStyle = snapshot.value?.answerStyle
  const answerStyle: AnswerStyle = isAnswerStyle(storedStyle) ? storedStyle : 'auto'
  const free = snapshot.value?.freeComposition === true
  const exportSettings = readImageExportSettings(snapshot.value)
  // Custom background picker: a preset palette plus a hex field, no native
  // browser color dialog. It opens under the row and dismisses on outside click.
  const [colorOpen, setColorOpen] = useState(false)
  const [hexDraft, setHexDraft] = useState(exportSettings.background)
  const colorTrigger = useRef<HTMLButtonElement>(null)
  const colorPanel = useRef<HTMLDivElement>(null)
  const ready = snapshot.status === 'ready'
  const disabled = !ready || !snapshot.writable || pending !== null

  const save = async (field: PendingField, value: unknown): Promise<void> => {
    if (disabled) return
    setPending(field)
    setFailed(false)
    try {
      if (!(await settingsForm.set(field, value))) setFailed(true)
    } catch {
      setFailed(true)
    } finally {
      setPending(null)
    }
  }

  useEffect(() => {
    if (disabled) setColorOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!colorOpen) return
    const onPointer = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target !== null && (colorTrigger.current?.contains(target) || colorPanel.current?.contains(target))) return
      setColorOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setColorOpen(false)
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [colorOpen])

  const commitHex = (): void => {
    const next = hexDraft.trim().startsWith('#') ? hexDraft.trim().toLowerCase() : `#${hexDraft.trim().toLowerCase()}`
    if (isExportBackground(next)) void save(EXPORT_BACKGROUND_FIELD, next)
    setColorOpen(false)
  }

  const note = failed
    ? t('settings.error')
    : !ready
      ? snapshot.status === 'loading' ? t('settings.loading') : t('settings.unavailable')
      : !snapshot.writable
        ? t('settings.readonly')
        : pending !== null
          ? t('settings.saving')
          : null

  return (
    <section className="dsh-iui-settings" aria-labelledby={`${idPrefix}-title`}>
      <div className="dsh-iui-settings-hero">
        <span className="dsh-iui-settings-mark" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18">
            <path d="M10 2.6 11.5 7l4.4 1.5-4.4 1.5L10 14.4 8.5 10 4.1 8.5 8.5 7 10 2.6Z" fill="currentColor" />
            <circle cx="15.4" cy="4.6" r="1.15" fill="currentColor" opacity=".65" />
          </svg>
        </span>
        <div className="dsh-iui-settings-intro">
          <h2 id={`${idPrefix}-title`} className="dsh-iui-settings-title">{t('settings.title')}</h2>
          <p className="dsh-iui-settings-description">{t('settings.description')}</p>
        </div>
      </div>

      <div className="dsh-iui-settings-group" aria-labelledby={`${idPrefix}-availability`}>
        <div className="dsh-iui-settings-group-head">
          <h3 id={`${idPrefix}-availability`} className="dsh-iui-settings-group-title">
            {t('settings.group.availability')}
          </h3>
          <p className="dsh-iui-settings-group-hint">{t('settings.group.availabilityHint')}</p>
        </div>
        <SwitchRow
          label={t('settings.enable.label')}
          hint={globalEnabled ? t('settings.enable.on') : t('settings.enable.off')}
          idPrefix={`${idPrefix}-enable`}
          checked={globalEnabled}
          disabled={disabled}
          describedBy={`${idPrefix}-enable ${noteId}`}
          onToggle={() => { void save(GLOBAL_ENABLED_FIELD, !globalEnabled) }}
        />
      </div>

      <div className="dsh-iui-settings-group" aria-labelledby={`${idPrefix}-style`}>
        <div className="dsh-iui-settings-group-head">
          <h3 id={`${idPrefix}-style`} className="dsh-iui-settings-group-title">
            {t('settings.style.label')}
          </h3>
          <p className="dsh-iui-settings-group-hint">{t('settings.style.note')}</p>
        </div>
        <div className="dsh-iui-settings-style">
          <StylePicker
            value={answerStyle}
            globalStyle={answerStyle}
            disabled={disabled}
            note={t('style.global.note')}
            footer={t('style.global.footer')}
            onChange={(value) => { void save(ANSWER_STYLE_FIELD, value) }}
            t={t}
          />
        </div>
      </div>

      <div className="dsh-iui-settings-group" aria-labelledby={`${idPrefix}-composition`}>
        <div className="dsh-iui-settings-group-head">
          <h3 id={`${idPrefix}-composition`} className="dsh-iui-settings-group-title">
            {t('settings.group.composition')}
          </h3>
          <p className="dsh-iui-settings-group-hint">{t('settings.group.compositionHint')}</p>
        </div>
        <SwitchRow
          label={t('settings.switch.label')}
          hint={free ? t('settings.switch.on') : t('settings.switch.off')}
          idPrefix={`${idPrefix}-free`}
          checked={free}
          disabled={disabled}
          describedBy={`${idPrefix}-free ${noteId}`}
          onToggle={() => { void save(FREE_COMPOSITION_FIELD, !free) }}
        />
      </div>

      <div className="dsh-iui-settings-group" aria-labelledby={`${idPrefix}-export`}>
        <div className="dsh-iui-settings-group-head">
          <h3 id={`${idPrefix}-export`} className="dsh-iui-settings-group-title">
            {t('settings.group.export')}
          </h3>
          <p className="dsh-iui-settings-group-hint">{t('settings.group.exportHint')}</p>
        </div>
        <div className="dsh-iui-settings-row">
          <div className="dsh-iui-settings-copy">
            <div className="dsh-iui-settings-label">{t('settings.export.background.label')}</div>
            <p className="dsh-iui-settings-hint">{t('settings.export.background.hint')}</p>
          </div>
          <div className="dsh-iui-color-field">
            <button
              ref={colorTrigger}
              type="button"
              className="dsh-iui-color-trigger"
              data-dsh-iui-export-background
              aria-label={t('settings.export.background.label')}
              aria-haspopup="dialog"
              aria-expanded={colorOpen}
              disabled={disabled}
              onClick={() => {
                setHexDraft(exportSettings.background)
                setColorOpen(value => !value)
              }}
            >
              <span className="dsh-iui-color-swatch" style={{ background: exportSettings.background }} aria-hidden="true" />
              <span className="dsh-iui-color-hex">{exportSettings.background}</span>
            </button>
          </div>
        </div>
        {colorOpen ? (
          <div ref={colorPanel} className="dsh-iui-color-panel" role="dialog" aria-label={t('settings.export.background.label')}>
            <span className="dsh-iui-color-panel-label">{t('settings.export.background.presets')}</span>
            <div className="dsh-iui-color-swatches" role="group" aria-label={t('settings.export.background.presets')}>
              {EXPORT_BACKGROUND_PRESETS.map(color => (
                <button
                  key={color}
                  type="button"
                  className="dsh-iui-color-option"
                  style={{ background: color }}
                  aria-label={color}
                  aria-pressed={color.toLowerCase() === exportSettings.background.toLowerCase()}
                  onClick={() => {
                    setColorOpen(false)
                    void save(EXPORT_BACKGROUND_FIELD, color)
                  }}
                />
              ))}
            </div>
            <label className="dsh-iui-color-hex-row">
              <span>{t('settings.export.background.hex')}</span>
              <input
                type="text"
                className="dsh-iui-color-hex-input"
                value={hexDraft}
                maxLength={7}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => { setHexDraft(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitHex()
                  if (event.key === 'Escape') setColorOpen(false)
                }}
                onBlur={commitHex}
              />
            </label>
          </div>
        ) : null}
        <div className="dsh-iui-settings-row">
          <div className="dsh-iui-settings-copy">
            <div className="dsh-iui-settings-label">{t('settings.export.scale.label')}</div>
            <p className="dsh-iui-settings-hint">{t('settings.export.scale.hint')}</p>
          </div>
          <div className="dsh-iui-choice-group" role="group" aria-label={t('settings.export.scale.label')}>
            {EXPORT_SCALES.map((scale: ExportScale) => (
              <button
                key={scale}
                type="button"
                className="dsh-iui-choice"
                aria-pressed={exportSettings.scale === scale}
                data-selected={exportSettings.scale === scale ? 'true' : undefined}
                disabled={disabled}
                onClick={() => { void save(EXPORT_SCALE_FIELD, scale) }}
              >
                {scale}
              </button>
            ))}
          </div>
        </div>
        <SwitchRow
          label={t('settings.export.toAssistant.label')}
          hint={t('settings.export.toAssistant.hint')}
          idPrefix={`${idPrefix}-to-assistant`}
          checked={exportSettings.toAssistant}
          disabled={disabled}
          describedBy={`${idPrefix}-to-assistant ${noteId}`}
          onToggle={() => { void save(EXPORT_TO_ASSISTANT_FIELD, !exportSettings.toAssistant) }}
        />
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
