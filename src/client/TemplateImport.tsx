/** Settings-only portable template import: local preview, review, then authenticated save. */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  parseStyleExport, toPortableStyle, truncateTemplateLabel, StyleExchangeError, STYLE_EXCHANGE_MAX_BYTES, type PortableStyleTemplate,
} from '../shared/style-template-exchange.ts'
import { MAX_GLOBAL_STYLE_TEMPLATES, type StyleTemplate } from '../shared/style-templates.ts'
import type { Translate } from '../shared/locales.ts'
import { resolveStyleThemeVars } from '../lib/style-theme.ts'
import { styleActions, type StyleActions } from './style-actions.ts'
import type { StyleCatalog } from './styles.ts'
import { TemplateField, styleActionMessage } from './TemplateFields.tsx'
import { StylePopover } from './StylePopover.tsx'

function exchangeMessage(cause: unknown, t: Translate): string {
  return cause instanceof StyleExchangeError ? t(`template.import.error.${cause.code}`) : t('template.error.request_failed')
}

export function TemplateImport({ styles, templates, actions = styleActions, disabled = false, onBusyChange, onStatusChange, t }: {
  readonly styles: StyleCatalog
  readonly templates: readonly StyleTemplate[]
  readonly actions?: StyleActions
  readonly disabled?: boolean
  readonly onBusyChange?: (busy: boolean) => void
  readonly onStatusChange?: (status: string | null) => void
  readonly t: Translate
}): ReactNode {
  const anchor = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const flight = useRef(false)
  const generation = useRef(0)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<PortableStyleTemplate | null>(null)
  const [suggested, setSuggested] = useState(false)
  const [editing, setEditing] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const globals = templates.filter(template => template.scope === 'global')
  const full = globals.length >= MAX_GLOBAL_STYLE_TEMPLATES
  const taken = (name: string): boolean => templates.some(template => template.name.toLowerCase() === name.trim().toLowerCase())
  const duplicate = preview !== null && taken(preview.name)
  const locked = busy || reading || disabled
  const popoverHidden = !open || (disabled && !busy)
  const busyRef = useRef(false)
  useEffect(() => () => { onBusyChange?.(false); onStatusChange?.(null) }, [onBusyChange, onStatusChange])
  useEffect(() => { onStatusChange?.(error ?? success) }, [error, onStatusChange, success])
  useEffect(() => { if (busy || error !== null) cancelRef.current?.focus() }, [busy, error])
  const close = useCallback(() => { generation.current += 1; setReading(false); setOpen(false) }, [])
  const dismiss = useCallback(() => { if (flight.current || busyRef.current) return; close() }, [close])
  useEffect(() => { busyRef.current = busy; onBusyChange?.(busy) }, [busy, onBusyChange])
  useEffect(() => { if (disabled && !busy && !flight.current) close() }, [busy, close, disabled])
  useEffect(() => () => { generation.current += 1 }, [])

  const chooseFile = async (file: File | undefined): Promise<void> => {
    if (!file || locked) return
    const current = ++generation.current
    setFileName(file.name.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ').trim()); setText(''); setPreview(null); setError(null); setAcknowledged(false)
    if (file.size > STYLE_EXCHANGE_MAX_BYTES) { setError(t('template.import.error.too_large')); return }
    setReading(true)
    try {
      const content = await file.text()
      if (current === generation.current) setText(content)
    } catch { if (current === generation.current) setError(t('template.import.error.read_failed')) }
    finally { if (current === generation.current) setReading(false) }
  }
  const showPreview = (): void => {
    if (locked) return
    setError(null)
    try {
      const parsed = parseStyleExport(text)
      const collision = taken(parsed.name)
      const suffix = ' (Imported)'
      const name = collision ? `${truncateTemplateLabel(parsed.name, 30 - suffix.length)}${suffix}` : parsed.name
      setPreview({ ...parsed, name }); setSuggested(collision)
      setEditing(false); setAcknowledged(false)
    } catch (cause) { setPreview(null); setError(exchangeMessage(cause, t)) }
  }
  const submit = async (): Promise<void> => {
    if (flight.current || locked || !preview || full || duplicate || !acknowledged) return
    flight.current = true
    setBusy(true); setError(null)
    try {
      const saved = await actions.createTemplate(toPortableStyle(preview))
      await styles.refresh()
      setSuccess(t('template.import.success', { name: saved.name }))
      close()
    } catch (cause) { setError(cause instanceof StyleExchangeError ? exchangeMessage(cause, t) : styleActionMessage(cause, t)) }
    finally { flight.current = false; setBusy(false) }
  }
  const change = (patch: Partial<PortableStyleTemplate>): void => {
    if (!preview) return
    setPreview({ ...preview, ...patch }); setError(null); setAcknowledged(false)
  }

  return <>
    <div className="dsh-iui-template-import-entry">
      <input ref={fileInput} type="file" hidden data-dsh-iui-import-file accept=".json,.iui-style.json,application/json" aria-label={t('template.import.file')}
        disabled={locked} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void chooseFile(file)
        }} />
      <button ref={anchor} type="button" className="dsh-iui-template-import-trigger" data-dsh-iui-import
        aria-haspopup="dialog" aria-expanded={open} disabled={locked} onClick={() => {
          if (open) { close(); return }
          generation.current += 1
          setText(''); setFileName(''); setPreview(null); setError(null); setSuccess(null); setOpen(true)
        }}>{t('template.import')}</button>
      {success ? <p className="dsh-iui-style-note" role="status">{success}</p> : null}
      {error !== null && popoverHidden ? <p className="dsh-iui-style-error" role="alert">{error}</p> : null}
    </div>
    {popoverHidden ? null : <StylePopover key={preview === null ? 'input' : 'preview'} anchor={anchor} title={t('template.import')} onClose={dismiss}>
      {preview === null ? <>
        <p className="dsh-iui-style-note">{t('template.import.inputNote')}</p>
        <div className="dsh-iui-template-buttons">
          <button type="button" disabled={locked} onClick={() => fileInput.current?.click()}>{t('template.import.file')}</button>
        </div>
        {fileName ? <p className="dsh-iui-style-note">{t('template.import.selectedFile', { name: fileName })}</p> : null}
        <label className="dsh-iui-template-field">
          <span>{t('template.import.paste')}</span>
          <textarea rows={7} value={text} disabled={locked} spellCheck={false} onChange={event => {
            setText(event.target.value); setFileName(''); setError(null)
          }} />
        </label>
      </> : <>
        {fileName ? <p className="dsh-iui-style-note">{t('template.import.selectedFile', { name: fileName })}</p> : null}
        <TemplateField label={t('template.name')} value={preview.name} max={30} required disabled={locked} onChange={name => change({ name })} />
        {suggested ? <p className="dsh-iui-style-note">{t('template.import.suggested')}</p> : null}
        <TemplateField label={t('template.description')} value={preview.description} max={100} disabled={locked} onChange={description => change({ description })} />
        <p>{t('template.import.layout')}: <strong>{t(`style.base.${preview.baseLayout}`)}</strong></p>
        <div className="dsh-iui-template-palettes">
          {(['light', 'dark'] as const).map(scheme => <div key={scheme} className="dsh-iui-template-palette"
            style={resolveStyleThemeVars(preview.theme, scheme) as CSSProperties} role="group" aria-label={t(`template.import.${scheme}`)}>
            <strong>{t(`template.import.${scheme}`)}</strong>
            <div>{(['canvas', 'ink', 'accent'] as const).map(token => <span key={token} className="dsh-iui-template-swatch"
              style={{ background: preview.theme[scheme][token] }} role="img" aria-label={`${t(`template.import.${token}`)} ${preview.theme[scheme][token]}`}
              title={`${t(`template.import.${token}`)} ${preview.theme[scheme][token]}`} />)}</div>
          </div>)}
        </div>
        <p className="dsh-iui-template-warning">{t('template.import.warning')}</p>
        <strong>{t('template.directives')}</strong>
        {editing ? <TemplateField label={t('template.import.editDirectives')} value={preview.directives} max={2000} multiline disabled={locked}
          onChange={directives => change({ directives })} /> : <pre className="dsh-iui-template-directives">{preview.directives || t('template.import.emptyDirectives')}</pre>}
        <div className="dsh-iui-template-buttons">
          <button type="button" disabled={locked} onClick={() => { setEditing(value => !value); setAcknowledged(false) }}>{t(editing ? 'template.import.finishEditing' : 'template.import.editDirectives')}</button>
          <button type="button" disabled={locked || preview.directives === ''} onClick={() => change({ directives: '' })}>{t('template.import.clearDirectives')}</button>
        </div>
        <label className="dsh-iui-template-acknowledge">
          <input type="checkbox" checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} />
          <span>{t('template.import.acknowledge')}</span>
        </label>
        {duplicate ? <p className="dsh-iui-style-error" role="alert">{t('template.error.duplicate_name')}</p> : null}
      </>}
      {full ? <p className="dsh-iui-style-error" role="alert">{t('template.import.full')}</p> : null}
      {error !== null && !popoverHidden ? <p className="dsh-iui-style-error" role="alert">{error}</p> : null}
      {busy ? <p className="dsh-iui-style-note" role="status">{t('template.saving')}</p> : null}
      <div className="dsh-iui-template-buttons">
        <button ref={cancelRef} type="button" aria-disabled={busy} onClick={dismiss}>{t('template.cancel')}</button>
        {preview ? <button type="button" disabled={locked} onClick={() => { setPreview(null); setError(null) }}>{t('template.import.back')}</button> : null}
        <button type="button" disabled={locked || (preview !== null && (full || duplicate || !preview.name.trim() || !acknowledged))}
          onClick={() => { if (preview) void submit(); else showPreview() }}>
          {t(busy ? 'template.saving' : reading ? 'template.import.reading' : preview ? 'template.import' : 'template.import.preview')}
        </button>
      </div>
    </StylePopover>}
  </>
}
