/**
 * Quick property controls for the two structural blocks that do not need a
 * model turn: a Divider (colour, width, thickness) and a Spacer (width,
 * height). The parent popover owns the draft property bag and the apply
 * action; this component only renders the inputs and reports changes.
 */
import type { ReactElement } from 'react'
import type { ArtifactBlockPropComponent, ArtifactBlockProps } from '../../shared/artifact-block-props.ts'
import type { Translate } from '../../shared/locales.ts'

/** Theme tokens offered on the Divider colour select. */
const COLOR_OPTIONS = ['', 'ink', 'muted', 'faint', 'border', 'info', 'success', 'warning', 'danger'] as const

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
  return { unit: 'px', value: value.endsWith('px') ? value.slice(0, -2) : value }
}

function lengthValue(draft: LengthDraft): number | string | undefined {
  if (draft.unit === '') return undefined
  if (draft.unit === 'auto') return 'auto'
  const number = Number(draft.value)
  if (!Number.isFinite(number) || draft.value.trim() === '') return draft.unit === 'px' ? 0 : '0%'
  return draft.unit === 'px' ? number : `${number}%`
}

/** A colour either names a theme token or is a custom CSS colour. */
function isTokenColor(value: string | undefined): boolean {
  return value === undefined || (COLOR_OPTIONS as readonly string[]).includes(value) || value === ''
}

interface QuickBlockPropsProps {
  readonly t: Translate
  readonly componentType: ArtifactBlockPropComponent
  readonly props: ArtifactBlockProps
  /** Apply one functional change to the latest draft (never a stale snapshot). */
  readonly onChange: (update: (current: ArtifactBlockProps) => ArtifactBlockProps) => void
}

/**
 * Render the quick-adjust fields for one Divider/Spacer block.
 * @param props - locale, component type, current draft and change callback.
 * @returns the controls, grouped as compact labelled rows.
 */
export function QuickBlockProps({ t, componentType, props, onChange }: QuickBlockPropsProps): ReactElement {
  const color = props.color ?? ''
  const customColor = !isTokenColor(props.color) ? props.color ?? '' : ''
  const width = lengthDraft(props.width)
  const height = lengthDraft(props.height)

  const setLengthUnit = (key: 'width' | 'height', unit: LengthDraft['unit']): void => {
    onChange(current => ({ ...current, [key]: lengthValue({ unit, value: lengthDraft(current[key]).value }) }))
  }
  const setLengthValue = (key: 'width' | 'height', value: string): void => {
    onChange(current => ({ ...current, [key]: lengthValue({ unit: lengthDraft(current[key]).unit, value }) }))
  }

  const lengthRow = (key: 'width' | 'height', label: string, draft: LengthDraft, allowAuto: boolean): ReactElement => (
    <div className="dsh-iui-edit-props-row" data-dsh-iui-edit-prop={key}>
      <span className="dsh-iui-edit-props-label">{label}</span>
      <select
        className="dsh-iui-edit-props-select"
        aria-label={`${label} ${t('edit.propsUnit')}`}
        value={draft.unit}
        onChange={event => setLengthUnit(key, event.target.value as LengthDraft['unit'])}
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
        onChange={event => setLengthValue(key, event.target.value)}
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
              value={customColor === '' ? color : 'custom'}
              onChange={event => {
                const next = event.target.value
                if (next === 'custom') {
                  onChange(current => ({ ...current, color: customColor === '' ? '#334155' : customColor }))
                } else {
                  onChange(current => ({ ...current, color: next === '' ? undefined : next }))
                }
              }}
            >
              {COLOR_OPTIONS.map(option => (
                <option key={option} value={option}>{option === '' ? t('edit.propsDefault') : option}</option>
              ))}
              <option value="custom">{t('edit.propsCustom')}</option>
            </select>
            {customColor === '' ? null : (
              <input
                className="dsh-iui-edit-props-input dsh-iui-edit-props-color"
                type="text"
                aria-label={t('edit.propsColor')}
                placeholder="#334155"
                value={customColor}
                onChange={event => onChange(current => ({ ...current, color: event.target.value }))}
              />
            )}
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
              value={props.thickness === undefined ? '' : String(props.thickness)}
              onChange={event => {
                const next = event.target.value.trim() === '' ? undefined : Number(event.target.value)
                onChange(current => ({ ...current, thickness: next !== undefined && Number.isFinite(next) ? next : undefined }))
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
