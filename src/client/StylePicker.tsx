/** Built-in and saved-template choices shared by settings and the composer. */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { ANSWER_STYLES, isAnswerStyle, type AnswerStyle, type StylePreference } from '../shared/intelligent-ui.ts'
import { isCustomStyleId, type StyleTemplate } from '../shared/style-templates.ts'
import { resolveStyleThemeVars } from '../lib/style-theme.ts'
import type { StyleCatalogSnapshot } from './styles.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import { TemplateManagement } from './TemplateManagement.tsx'
import type { StyleCatalog } from './styles.ts'
import type { StyleActions } from './style-actions.ts'

const STYLE_META: Readonly<Record<AnswerStyle, { label: string; hint: string }>> = {
  auto: { label: 'style.auto.label', hint: 'style.auto.hint' },
  card: { label: 'style.card.label', hint: 'style.card.sliderHint' },
  article: { label: 'style.article.label', hint: 'style.article.sliderHint' },
}

/** One tiny card mockup. */
function CardPreview(): ReactNode {
  return (
    <span className="dsh-iui-preview-art dsh-iui-preview-art-card" aria-hidden="true">
      <span className="dsh-iui-preview-card-image" />
      <span className="dsh-iui-preview-lines">
        <span className="dsh-iui-preview-line is-long" />
        <span className="dsh-iui-preview-line" />
        <span className="dsh-iui-preview-line is-short" />
      </span>
      <span className="dsh-iui-preview-card-footer" />
    </span>
  )
}

/** One tiny article mockup. */
function ArticlePreview(): ReactNode {
  return (
    <span className="dsh-iui-preview-art dsh-iui-preview-art-article" aria-hidden="true">
      <span className="dsh-iui-preview-line is-title" />
      <span className="dsh-iui-preview-line is-long" />
      <span className="dsh-iui-preview-line is-long" />
      <span className="dsh-iui-preview-line" />
      <span className="dsh-iui-preview-line" />
      <span className="dsh-iui-preview-line is-short" />
    </span>
  )
}

/** A free composition with parallel regions rather than a page shell. */
function FreePreview(): ReactNode {
  return <span className="dsh-iui-preview-art dsh-iui-preview-art-free" aria-hidden="true">
    <span className="dsh-iui-preview-line is-title" />
    <span className="dsh-iui-preview-lines">
      <span className="dsh-iui-preview-line is-long" />
      <span className="dsh-iui-preview-line is-short" />
    </span>
    <span className="dsh-iui-preview-lines">
      <span className="dsh-iui-preview-line" />
      <span className="dsh-iui-preview-line is-long" />
      <span className="dsh-iui-preview-line is-short" />
    </span>
  </span>
}

/** Props for the shared style picker. */
export interface StylePickerProps {
  /** Session override (`inherit` allowed) or the global style. */
  readonly value: StylePreference
  /** Built-in or custom style used when the selection inherits. */
  readonly globalStyle: string
  readonly templates: readonly StyleTemplate[]
  readonly catalogStatus: StyleCatalogSnapshot['status']
  readonly allowInherit?: boolean
  readonly disabled?: boolean
  readonly note?: string
  readonly footer?: string
  readonly onChange: (value: StylePreference) => void
  readonly onDemand?: () => Promise<void> | void
  readonly showBuiltins?: boolean
  readonly showTemplates?: boolean
  readonly management?: {
    readonly styles: StyleCatalog
    readonly actions?: StyleActions
    readonly global?: boolean
    readonly onDeleted?: (id: string) => Promise<void>
  }
  readonly t?: Translate
}

/** Selectable preview tiles; following global remains an explicit, separate choice. */
export function StylePicker({
  value, globalStyle, templates, catalogStatus, allowInherit = false, disabled = false,
  note, footer, onChange, onDemand, management, showBuiltins = true, showTemplates = true, t = fallbackT,
}: StylePickerProps): ReactNode {
  const inherit = value === 'inherit'
  const effective = inherit ? globalStyle : value
  const globalLabel = isAnswerStyle(globalStyle) ? t(STYLE_META[globalStyle].label)
    : templates.find(template => template.id === globalStyle)?.name ?? t('style.missing.label')
  const missing = isCustomStyleId(effective) && !templates.some(template => template.id === effective)
  const choose = (style: string): void => { if (!disabled) onChange(style) }
  // On-demand arming is local to its own entry: a style choice elsewhere in the
  // panel must never disable or dim this control.
  const [arming, setArming] = useState(false)
  const armOnDemand = (): void => {
    if (disabled || arming || onDemand === undefined) return
    setArming(true)
    void Promise.resolve(onDemand()).finally(() => setArming(false))
  }
  const check = (
    <span className="dsh-iui-style-check" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" focusable="false">
        <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM17.4571 9.45711L11 15.9142L6.79289 11.7071L8.20711 10.2929L11 13.0858L16.0429 8.04289L17.4571 9.45711Z"></path>
      </svg>
    </span>
  )

  return (
    <div className="dsh-iui-style" data-dsh-iui-style-picker>
      {allowInherit ? (
        <div className="dsh-iui-style-follow">
          <button
            type="button"
            role="switch"
            aria-checked={inherit}
            className="dsh-iui-style-follow-button"
            disabled={disabled}
            onClick={() => choose(inherit ? globalStyle : 'inherit')}
          >
            <span className="dsh-iui-style-follow-dot" aria-hidden="true" />
            <span>
              <span className="dsh-iui-style-follow-label">{t('style.follow')}</span>
              <span className="dsh-iui-style-follow-hint">
                {t(inherit ? 'style.follow.current' : 'style.follow.description', { style: globalLabel })}
              </span>
            </span>
          </button>
        </div>
      ) : null}
      {!showBuiltins ? null : <><div className="dsh-iui-style-head">
        <span className="dsh-iui-style-heading">{t('style.builtin.title')}</span>
        <span className="dsh-iui-style-hint">{t('style.builtin.hint')}</span>
      </div>
      <div className="dsh-iui-style-previews" role="group" aria-label={t('style.builtin.title')}>
        {ANSWER_STYLES.map(style => (
          <button
            key={style}
            type="button"
            className="dsh-iui-preview"
            data-style-id={style}
            data-active={effective === style ? 'true' : undefined}
            aria-pressed={effective === style}
            disabled={disabled}
            onClick={() => choose(style)}
            aria-label={t(style === 'auto' ? 'style.auto.label' : `style.${style}.preview`)}
          >
            {style === 'auto' ? (
              <span className="dsh-iui-preview-art dsh-iui-preview-art-auto" aria-hidden="true">✦</span>
            ) : style === 'card' ? <CardPreview /> : <ArticlePreview />}
            <span className="dsh-iui-preview-caption">
              <span className="dsh-iui-preview-title">{t(STYLE_META[style].label)}</span>
              <span className="dsh-iui-preview-hint">{t(STYLE_META[style].hint)}</span>
            </span>
            {effective === style ? check : null}
          </button>
        ))}
      </div></>}
      {!showTemplates ? null : <><div className="dsh-iui-style-head">
        <span className="dsh-iui-style-heading">{t('style.custom.title', { count: templates.length })}</span>
      </div>
      {templates.length > 0 ? (
        <div className="dsh-iui-custom-grid" role="group" aria-label={t('style.custom.title', { count: templates.length })}>
          {templates.map(template => (
            <div className="dsh-iui-custom-item" key={template.id}>
            <button
              type="button"
              className="dsh-iui-preview dsh-iui-custom-card"
              data-style-id={template.id}
              data-active={effective === template.id ? 'true' : undefined}
              aria-pressed={effective === template.id}
              disabled={disabled}
              onClick={() => choose(template.id)}
            >
              <span className="dsh-iui-custom-preview" style={resolveStyleThemeVars(template.theme, 'light') as CSSProperties}>
                {template.baseLayout === 'free' ? <FreePreview /> : template.baseLayout === 'article' ? <ArticlePreview /> : <CardPreview />}
              </span>
              <span className="dsh-iui-preview-caption">
                <span className="dsh-iui-preview-title">{template.name}</span>
                <span className="dsh-iui-preview-hint">{t(`style.base.${template.baseLayout}`)}</span>
              </span>
              {effective === template.id ? check : null}
            </button>
            {management === undefined ? null : <TemplateManagement template={template} styles={management.styles}
              actions={management.actions} global={management.global} onDeleted={management.onDeleted}
              disabled={disabled} onUse={() => choose(template.id)} t={t} />}
            </div>
          ))}
        </div>
      ) : (
        <p className="dsh-iui-style-note" role="status">{t(catalogStatus === 'loading' || catalogStatus === 'idle'
          ? 'style.catalog.loading' : catalogStatus === 'unavailable' ? 'style.catalog.unavailable' : 'style.custom.empty')}</p>
      )}</>}
      {missing ? <p className="dsh-iui-style-note" role="status">{t('style.missing.note')}</p> : null}
      {onDemand === undefined ? null : (
        <button type="button" className="dsh-iui-on-demand-entry" data-dsh-iui-on-demand-entry disabled={disabled || arming} onClick={armOnDemand}>
          <span aria-hidden="true">✦</span>
          <span><strong>{t('onDemand.label')}</strong><span>{t('onDemand.entryHint')}</span></span>
        </button>
      )}
      {note === undefined ? null : <p className="dsh-iui-style-note">{note}</p>}
      {footer === undefined ? null : <p className="dsh-iui-style-footer">{footer}</p>}
    </div>
  )
}
