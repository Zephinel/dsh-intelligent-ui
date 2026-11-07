/**
 * Quick property controls for the two structural blocks that do not need a
 * model turn: a Divider (colour, width, thickness) and a Spacer (width,
 * height). The parent popover owns the committed property bag and the apply
 * action; this component keeps the transient input state (unit selections and
 * partially typed numbers) local so a middle edit never rewrites the bag with
 * a half-valid value.
 */
import { useState, type ReactElement } from 'react'
import { ARTIFACT_BLOCK_COLOR_TOKENS, type ArtifactBlockPropComponent, type ArtifactBlockProps } from '../../shared/artifact-block-props.ts'
import type { Translate } from '../../shared/locales.ts'
import { QuickSelect } from './QuickSelect.tsx'
import { QuickSlider } from './QuickSlider.tsx'

/** Theme tokens offered on the Divider colour select (empty = theme default). */
const COLOR_OPTIONS = ['' as const, ...ARTIFACT_BLOCK_COLOR_TOKENS]

/** One length field split into a number and a unit selection. */
interface LengthDraft {
  /** Default ('') omits the value, so the renderer keeps its own layout default. */
  readonly unit: '' | 'px' | '%'
  readonly value: string
}

function lengthDraft(value: number | string | undefined): LengthDraft {
  if (value === undefined) return { unit: '', value: '' }
  if (typeof value === 'number') return { unit: 'px', value: String(value) }
  // Legacy revisions may still carry the old "auto" value; show it as Default
  // without rewriting the committed props, so Apply stays disabled until the
  // user actually edits the field.
  if (value === 'auto') return { unit: '', value: '' }
  if (value.endsWith('%')) return { unit: '%', value: value.slice(0, -1) }
  if (value.endsWith('px')) return { unit: 'px', value: value.slice(0, -2) }
  return { unit: '', value: '' }
}

function lengthValue(draft: LengthDraft): number | string | undefined {
  if (draft.unit === '') return undefined
  if (draft.value.trim() === '') return undefined
  const number = Number(draft.value)
  if (!Number.isFinite(number)) return undefined
  return draft.unit === 'px' ? number : `${number}%`
}

/** A colour either names a theme token or is a custom CSS colour. */
function isTokenColor(value: string | undefined): boolean {
  return value === undefined || value === '' || (ARTIFACT_BLOCK_COLOR_TOKENS as readonly string[]).includes(value)
}

interface QuickBlockPropsProps {
  readonly t: Translate
  readonly componentType: ArtifactBlockPropComponent
  /** Props at mount; local state owns the in-progress edits. */
  readonly props: ArtifactBlockProps
  /** Apply one complete property bag to the popover draft/preview. */
  readonly onChange: (props: ArtifactBlockProps) => void
}

/**
 * Render the quick-adjust fields for one Divider/Spacer block.
 * @param props - locale, component type, initial properties and change callback.
 * @returns the controls, grouped as compact labelled rows.
 */
export function QuickBlockProps({ t, componentType, props, onChange }: QuickBlockPropsProps): ReactElement {
  const [color, setColor] = useState<string | undefined>(props.color)
  const [customColor, setCustomColor] = useState<boolean>(!isTokenColor(props.color))
  const [width, setWidth] = useState<LengthDraft>(lengthDraft(props.width))
  const [height, setHeight] = useState<LengthDraft>(lengthDraft(props.height))
  const [thickness, setThickness] = useState<string>(props.thickness === undefined ? '' : String(props.thickness))

  const emit = (next: {
    color?: string
    customColor?: boolean
    width?: LengthDraft
    height?: LengthDraft
    thicknessText?: string
  }): void => {
    const nextColor = next.color !== undefined ? next.color : color
    const nextWidth = next.width ?? width
    const nextHeight = next.height ?? height
    const nextThickness = next.thicknessText ?? thickness
    const parsedThickness = nextThickness.trim() === '' ? undefined : Number(nextThickness)
    const bag: ArtifactBlockProps = {
      ...nextColor === undefined || nextColor === '' ? {} : { color: nextColor },
      ...lengthValue(nextWidth) === undefined ? {} : { width: lengthValue(nextWidth) },
      ...componentType === 'Spacer' && lengthValue(nextHeight) !== undefined ? { height: lengthValue(nextHeight) } : {},
      ...componentType === 'Divider' && parsedThickness !== undefined && Number.isFinite(parsedThickness) ? { thickness: parsedThickness } : {},
    }
    onChange(bag)
  }

  const unitOptions = (defaultDescription: string): { value: string; label: string; description: string }[] => [
    { value: '', label: t('edit.propsDefault'), description: defaultDescription },
    { value: 'px', label: t('edit.propsPx'), description: t('edit.propsPx.desc') },
    { value: '%', label: t('edit.propsPercent'), description: t('edit.propsPercent.desc') },
  ]

  const lengthRow = (key: 'width' | 'height', label: string, draft: LengthDraft): ReactElement => {
    // Default ('') means different things per row: a Divider width spans its
    // column, a Spacer width fills the free Row space, and a Spacer height
    // usually collapses.
    const defaultDescription = componentType === 'Divider'
      ? t('edit.propsDefault.dividerWidth.desc')
      : key === 'height'
        ? t('edit.propsDefault.spacerHeight.desc')
        : t('edit.propsDefault.desc')
    const options = unitOptions(defaultDescription)
    // The explanation follows the selected unit so the row always says what
    // the current value means (Default included).
    const description = options.find(option => option.value === draft.unit)?.description ?? ''
    const sliderValue = Number(draft.value)
    const safeSliderValue = Number.isFinite(sliderValue) ? sliderValue : 0
    const slider = draft.unit === '%'
      ? { min: 0, max: 100, step: 1, unit: '%' }
      : draft.unit === 'px'
        ? { min: 0, max: Math.max(key === 'height' ? 400 : 800, Math.ceil(safeSliderValue / 100) * 100), step: 1, unit: 'px' }
        : undefined
    return (
      <div data-dsh-iui-edit-prop={key}>
        <div className="dsh-iui-edit-props-row">
          <span className="dsh-iui-edit-props-label">{label}</span>
          <QuickSelect
            value={draft.unit}
            options={options}
            ariaLabel={`${label} ${t('edit.propsUnit')}`}
            onChange={unitValue => {
              const nextDraft = { unit: unitValue as LengthDraft['unit'], value: draft.value }
              if (key === 'width') setWidth(nextDraft)
              else setHeight(nextDraft)
              emit({ [key]: nextDraft })
            }}
          />
          <input
            className="dsh-iui-edit-props-input"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            aria-label={label}
            disabled={draft.unit === ''}
            value={draft.unit === '' ? '' : draft.value}
            onChange={event => {
              const nextDraft = { unit: draft.unit, value: event.target.value }
              if (key === 'width') setWidth(nextDraft)
              else setHeight(nextDraft)
              emit({ [key]: nextDraft })
            }}
          />
        </div>
        {slider === undefined ? null : (
          <div className="dsh-iui-edit-props-slider">
            <QuickSlider
              label={label}
              ariaLabel={`${label} (${slider.unit})`}
              value={safeSliderValue}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              unit={slider.unit}
              disabled={draft.unit === ''}
              onChange={nextValue => {
                const nextDraft = { unit: draft.unit, value: String(nextValue) }
                if (key === 'width') setWidth(nextDraft)
                else setHeight(nextDraft)
                emit({ [key]: nextDraft })
              }}
            />
          </div>
        )}
        <p className="dsh-iui-edit-props-desc" data-dsh-iui-edit-props-desc>{description}</p>
      </div>
    )
  }

  return (
    <div className="dsh-iui-edit-props" data-dsh-iui-edit-props data-component={componentType}>
      <p className="dsh-iui-edit-props-hint">{t('edit.propsHint')}</p>
      {componentType === 'Divider' ? (
        <>
          <div className="dsh-iui-edit-props-row" data-dsh-iui-edit-prop="color">
            <span className="dsh-iui-edit-props-label">{t('edit.propsColor')}</span>
            <QuickSelect
              value={customColor ? 'custom' : color ?? ''}
              options={[
                ...COLOR_OPTIONS.map(option => ({ value: option, label: option === '' ? t('edit.propsDefault') : option })),
                { value: 'custom', label: t('edit.propsCustom') },
              ]}
              ariaLabel={t('edit.propsColor')}
              onChange={next => {
                if (next === 'custom') {
                  const initial = isTokenColor(color) ? '#334155' : color ?? '#334155'
                  setCustomColor(true)
                  setColor(initial)
                  emit({ color: initial, customColor: true })
                } else {
                  setCustomColor(false)
                  setColor(next === '' ? undefined : next)
                  emit({ color: next })
                }
              }}
            />
            {customColor ? (
              <input
                className="dsh-iui-edit-props-input dsh-iui-edit-props-color"
                type="text"
                aria-label={t('edit.propsColor')}
                placeholder="#334155"
                value={color ?? ''}
                onChange={event => {
                  setColor(event.target.value)
                  emit({ color: event.target.value })
                }}
              />
            ) : null}
          </div>
          {lengthRow('width', t('edit.propsWidth'), width)}
          <div data-dsh-iui-edit-prop="thickness">
            <div className="dsh-iui-edit-props-row">
              <span className="dsh-iui-edit-props-label">{t('edit.propsThickness')}</span>
              <input
                className="dsh-iui-edit-props-input"
                type="number"
                min={0.5}
                max={12}
                step={0.5}
                inputMode="decimal"
                aria-label={t('edit.propsThickness')}
                value={thickness}
                onChange={event => {
                  setThickness(event.target.value)
                  emit({ thicknessText: event.target.value })
                }}
              />
              <span className="dsh-iui-edit-props-unit">{t('edit.propsPx')}</span>
            </div>
            <div className="dsh-iui-edit-props-slider">
              <QuickSlider
                label={t('edit.propsThickness')}
                ariaLabel={t('edit.propsThickness')}
                value={thickness.trim() === '' ? 1 : Math.min(12, Math.max(0.5, Number(thickness) || 1))}
                min={0.5}
                max={12}
                step={0.5}
                unit="px"
                onChange={nextValue => {
                  setThickness(String(nextValue))
                  emit({ thicknessText: String(nextValue) })
                }}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {lengthRow('width', t('edit.propsWidth'), width)}
          {lengthRow('height', t('edit.propsHeight'), height)}
        </>
      )}
    </div>
  )
}
