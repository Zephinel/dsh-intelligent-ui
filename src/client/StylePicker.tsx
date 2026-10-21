/**
 * Answer-style picker shared by the Plugin detail page and the composer panel.
 *
 * Two compact previews sit above a three-stop slider. The previews are static
 * mockups: they show the shape of the compact card versus the reading article
 * without mounting a second renderer. Auto keeps both previews visible with a
 * weak highlight and an explicit badge.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ANSWER_STYLES, type AnswerStyle, type StylePreference } from '../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'

/** Copy keys for one style stop. */
const STYLE_META: Readonly<Record<AnswerStyle, { label: string; hint: string }>> = {
  auto: { label: 'style.auto.label', hint: 'style.auto.hint' },
  card: { label: 'style.card.label', hint: 'style.card.sliderHint' },
  article: { label: 'style.article.label', hint: 'style.article.sliderHint' },
}

/** One tiny card mockup. */
function CardPreview({ auto, autoLabel }: { readonly auto: boolean; readonly autoLabel: string }): ReactNode {
  return (
    <span className="dsh-iui-preview-art dsh-iui-preview-art-card" aria-hidden="true">
      <span className="dsh-iui-preview-card-image" />
      <span className="dsh-iui-preview-lines">
        <span className="dsh-iui-preview-line is-long" />
        <span className="dsh-iui-preview-line" />
        <span className="dsh-iui-preview-line is-short" />
      </span>
      <span className="dsh-iui-preview-card-footer" />
      {auto ? <span className="dsh-iui-preview-badge">{autoLabel}</span> : null}
    </span>
  )
}

/** One tiny article mockup. */
function ArticlePreview({ auto, autoLabel }: { readonly auto: boolean; readonly autoLabel: string }): ReactNode {
  return (
    <span className="dsh-iui-preview-art dsh-iui-preview-art-article" aria-hidden="true">
      <span className="dsh-iui-preview-line is-title" />
      <span className="dsh-iui-preview-line is-long" />
      <span className="dsh-iui-preview-line is-long" />
      <span className="dsh-iui-preview-line" />
      <span className="dsh-iui-preview-line" />
      <span className="dsh-iui-preview-line is-short" />
      {auto ? <span className="dsh-iui-preview-badge">{autoLabel}</span> : null}
    </span>
  )
}

/** Props for the shared style picker. */
export interface StylePickerProps {
  /** Session override (`inherit` allowed) or the global style. */
  readonly value: StylePreference
  /** Global style used when the value inherits. */
  readonly globalStyle: AnswerStyle
  /** Whether the picker can show the fourth `inherit` state. */
  readonly allowInherit?: boolean
  /** Disables every control, e.g. while the settings document is read-only. */
  readonly disabled?: boolean
  /** Extra note under the slider, e.g. session-only or global default. */
  readonly note?: string
  /** Footer copy under the note. */
  readonly footer?: string
  /** Persist one style change. */
  readonly onChange: (value: StylePreference) => void
  /** Locale seat; defaults to English outside a DSH slot. */
  readonly t?: Translate
}

/**
 * Render the preview + follow-global + slider block.
 * @param props - current value, global style, callbacks and copy.
 * @returns the picker.
 */
export function StylePicker({
  value,
  globalStyle,
  allowInherit = false,
  disabled = false,
  note,
  footer,
  onChange,
  t = fallbackT,
}: StylePickerProps): ReactNode {
  const sliderId = useId()
  const inherit = value === 'inherit'
  const effective: AnswerStyle = inherit ? globalStyle : value
  const [draft, setDraft] = useState<AnswerStyle>(effective)
  const draftRef = useRef(draft)
  const index = Math.max(0, ANSWER_STYLES.indexOf(draft))

  // Follow the settled value when it changes (projection or global style), but
  // keep a local slider draft while a multi-stop gesture is in progress.
  useEffect(() => {
    setDraft(effective)
    draftRef.current = effective
  }, [effective])

  const choose = (style: AnswerStyle): void => {
    if (disabled) return
    draftRef.current = style
    setDraft(style)
    onChange(style)
  }

  const commitDraft = (): void => {
    if (disabled || draftRef.current === effective) return
    onChange(draftRef.current)
  }

  const toggleInherit = (): void => {
    if (disabled) return
    onChange(inherit ? globalStyle : 'inherit')
  }

  return (
    <div className="dsh-iui-style" data-dsh-iui-style-picker>
      <div className="dsh-iui-style-head">
        <span className="dsh-iui-style-heading">{t('style.preview')}</span>
        <span className="dsh-iui-style-hint">{t('style.preview.hint')}</span>
      </div>
      <div className="dsh-iui-style-previews" role="group" aria-label={t('style.preview')}>
        <div
          className="dsh-iui-preview"
          data-active={effective === 'card' ? 'true' : undefined}
          data-auto={effective === 'auto' ? 'true' : undefined}
        >
          <CardPreview auto={effective === 'auto'} autoLabel={t('style.auto.badge')} />
          <span className="dsh-iui-preview-caption">
            <span className="dsh-iui-preview-title">{t('style.card.preview')}</span>
            <span className="dsh-iui-preview-hint">{t('style.card.hint')}</span>
          </span>
        </div>
        <div
          className="dsh-iui-preview"
          data-active={effective === 'article' ? 'true' : undefined}
          data-auto={effective === 'auto' ? 'true' : undefined}
        >
          <ArticlePreview auto={effective === 'auto'} autoLabel={t('style.auto.badge')} />
          <span className="dsh-iui-preview-caption">
            <span className="dsh-iui-preview-title">{t('style.article.preview')}</span>
            <span className="dsh-iui-preview-hint">{t('style.article.hint')}</span>
          </span>
        </div>
      </div>

      {allowInherit ? (
        <div className="dsh-iui-style-follow">
          <button
            type="button"
            role="switch"
            aria-checked={inherit}
            className="dsh-iui-style-follow-button"
            disabled={disabled}
            onClick={toggleInherit}
          >
            <span className="dsh-iui-style-follow-dot" aria-hidden="true" />
            <span>
              <span className="dsh-iui-style-follow-label">{t('style.follow')}</span>
              <span className="dsh-iui-style-follow-hint">
                {inherit
                  ? t('style.follow.current', { style: t(STYLE_META[globalStyle].label) })
                  : t('style.follow.description', { style: t(STYLE_META[globalStyle].label) })}
              </span>
            </span>
          </button>
        </div>
      ) : null}

      <div className="dsh-iui-style-slider-head">
        <label className="dsh-iui-style-label" htmlFor={sliderId}>{t('style.slider.label')}</label>
        <span className="dsh-iui-style-note">{note}</span>
      </div>
      <div
        className="dsh-iui-slider"
        data-disabled={disabled ? 'true' : undefined}
        style={{ '--dsh-iui-slider-progress': `${(index / Math.max(1, ANSWER_STYLES.length - 1)) * 100}%` } as CSSProperties}
      >
        <div className="dsh-iui-slider-rail" aria-hidden="true">
          <span className="dsh-iui-slider-fill" />
          {ANSWER_STYLES.map((style, stop) => (
            <span
              key={style}
              className="dsh-iui-slider-tick"
              data-active={stop === index ? 'true' : undefined}
              style={{ left: `${(stop / Math.max(1, ANSWER_STYLES.length - 1)) * 100}%` }}
            />
          ))}
          <span className="dsh-iui-slider-thumb" />
        </div>
        <input
          id={sliderId}
          className="dsh-iui-slider-input"
          type="range"
          min={0}
          max={ANSWER_STYLES.length - 1}
          step={1}
          value={index}
          disabled={disabled}
          aria-label={t('style.slider.aria', { style: t(STYLE_META[draft].label) })}
          onChange={(event) => {
            const next = ANSWER_STYLES[Number(event.currentTarget.value)]
            if (next !== undefined) {
              draftRef.current = next
              setDraft(next)
            }
          }}
          onPointerUp={commitDraft}
          onKeyUp={commitDraft}
          onBlur={commitDraft}
        />
      </div>
      <div className="dsh-iui-style-stops">
        {ANSWER_STYLES.map(style => (
          <button
            key={style}
            type="button"
            className="dsh-iui-style-stop"
            data-active={effective === style ? 'true' : undefined}
            aria-pressed={effective === style}
            disabled={disabled}
            onClick={() => choose(style)}
          >
            <span className="dsh-iui-style-stop-label">{t(STYLE_META[style].label)}</span>
            <span className="dsh-iui-style-stop-hint">{t(STYLE_META[style].hint)}</span>
          </button>
        ))}
      </div>
      {footer === undefined ? null : <p className="dsh-iui-style-footer">{footer}</p>}
    </div>
  )
}
