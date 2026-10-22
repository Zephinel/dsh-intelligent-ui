/** Shared bounded template fields and localized mutation errors. */
import { useId, type ReactNode } from 'react'
import type { Translate } from '../shared/locales.ts'
import { StyleActionError } from './style-actions.ts'

export function styleActionMessage(error: unknown, t: Translate): string {
  const code = error instanceof StyleActionError ? error.code : 'request_failed'
  return t(['duplicate_name', 'result_missing', 'template_missing', 'limit_reached', 'invalid_input'].includes(code)
    ? `template.error.${code}` : 'template.error.request_failed')
}

export function TemplateField({ label, value, max, onChange, multiline = false, required = false, disabled = false }: {
  readonly label: string
  readonly value: string
  readonly max: number
  readonly onChange: (value: string) => void
  readonly multiline?: boolean
  readonly required?: boolean
  readonly disabled?: boolean
}): ReactNode {
  const count = useId()
  const props = { value, maxLength: max, required, disabled, 'aria-describedby': count,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value) }
  return <label className="dsh-iui-template-field">
    <span>{label}</span>
    {multiline ? <textarea {...props} rows={max > 100 ? 7 : 2} /> : <input {...props} autoComplete="off" />}
    <span id={count} className="dsh-iui-template-count">{value.length}/{max}</span>
  </label>
}
