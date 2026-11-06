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

/** Theme tokens offered on the Divider colour select (empty = theme default). */
const COLOR_OPTIONS = ['' as const, ...ARTIFACT_BLOCK_COLOR_TOKENS]

/** One length field split into a number and a unit selection. */
interface LengthDraft {
  readonly unit: '' | 'px' | '%' | 'auto'
  readonly value: string
}

function lengthDraft(value: number | string | undefined): LengthDraft {
  if (value === undefined) return { unit: '', value: '' }
  if (typeof value === 'number') return { unit: 'px', value: String(value) }
  if (value === 'auto') return { unit: 'auto', value: '' }
  if (value.endsWith('%')) return { unit: '%', value: value.slice(0, -1) }
  if (value.endsWith('px')) return { unit: 'px', value: value.slice(0, -2) }
  return { unit: '', value: '' }
}

function lengthValue(draft: LengthDraft): number | string | undefined {
  if (draft.unit === '' || draft.unit === 'auto') return draft.unit === 'auto' ? 'auto' : undefined
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

  const lengthRow = (key: 'width' | 'height', label: string, draft: LengthDraft, allowAuto: boolean): ReactElement => (
    <div className="dsh-iui-edit-props-row" data-dsh-iui-edit-prop={key}>
      <span className="dsh-iui-edit-props-label">{label}</span>
      <select
        className="dsh-iui-edit-props-select"
        aria-label={`${label} ${t('edit.propsUnit')}`}
        value={draft.unit}
        onChange={event => {
          const nextDraft = { unit: event.target.value as LengthDraft['unit'], value: draft.value }
          if (key === 'width') setWidth(nextDraft)
          else setHeight(nextDraft)
          emit({ [key]: nextDraft })
        }}
      >
        <option value="">{t('edit.propsDefault')}</option>
        <option value="px">{t('edit.propsPx')}</option>
        <option value="%">{t('edit.propsPercent')}</option>
        {allowAuto ? <option value="auto">{t('edit.propsAuto')}</option> : null}
      </select>
      <input
        className="dsh-iui-edit-props-input"
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        aria-label={label}
        disabled={draft.unit === '' || draft.unit === 'auto'}
        value={draft.unit === '' || draft.unit === 'auto' ? '' : draft.value}
        onChange={event => {
          const nextDraft = { unit: draft.unit, value: event.target.value }
          if (key === 'width') setWidth(nextDraft)
          else setHeight(nextDraft)
          emit({ [key]: nextDraft })
        }}
      />
    </div>
  )

  return (
    <div className="dsh-iui-edit-props" data-dsh-iui-edit-props data-component={componentType}>
      <p className="dsh-iui-edit-props-hint">{t('edit.propsHint')}</p>
      {componentType === 'Divider' ? (
        <>
          <div className="dsh-iui-edit-props-row" data-dsh-iui-edit-prop="color">
            <span className="dsh-iui-edit-props-label">{t('edit.propsColor')}</span>
            <select
              className="dsh-iui-edit-props-select"
              aria-label={t('edit.propsColor')}
              value={customColor ? 'custom' : color ?? ''}
              onChange={event => {
                const next = event.target.value
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
            >
              {COLOR_OPTIONS.map(option => (
                <option key={option} value={option}>{option === '' ? t('edit.propsDefault') : option}</option>
              ))}
              <option value="custom">{t('edit.propsCustom')}</option>
            </select>
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
          {lengthRow('width', t('edit.propsWidth'), width, false)}
          <div className="dsh-iui-edit-props-row" data-dsh-iui-edit-prop="thickness">
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
        </>
      ) : (
        <>
          {lengthRow('width', t('edit.propsWidth'), width, true)}
          {lengthRow('height', t('edit.propsHeight'), height, true)}
        </>
      )}
    </div>
  )
}
