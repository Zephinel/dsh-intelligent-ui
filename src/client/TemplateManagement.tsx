/** The same compact management menu in the composer and Plugin detail page. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { StyleTemplate } from '../shared/style-templates.ts'
import type { Translate } from '../shared/locales.ts'
import { styleActions, type StyleActions } from './style-actions.ts'
import type { StyleCatalog } from './styles.ts'
import { StylePopover } from './StylePopover.tsx'
import { TemplateField, styleActionMessage } from './TemplateFields.tsx'
import { encodeStyleExport, StyleExchangeError } from '../shared/style-template-exchange.ts'
import { fileStem } from './export-image-plan.ts'

export function TemplateManagement({ template, styles, actions = styleActions, onUse, onDeleted, global = false, disabled = false, t }: {
  readonly template: StyleTemplate
  readonly styles: StyleCatalog
  readonly actions?: StyleActions
  readonly onUse: () => void
  readonly onDeleted?: (id: string) => Promise<void>
  readonly global?: boolean
  readonly disabled?: boolean
  readonly t: Translate
}): ReactNode {
  const anchor = useRef<HTMLButtonElement>(null)
  const [mode, setMode] = useState<'menu' | 'rename' | 'edit' | 'delete' | 'export' | null>(null)
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description)
  const [directives, setDirectives] = useState(template.directives)
  const [busy, setBusy] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = useCallback(() => setMode(null), [])
  useEffect(() => { if (disabled) setMode(null) }, [disabled])
  const change = (next: typeof mode): void => {
    setName(template.name); setDescription(template.description); setDirectives(template.directives)
    setError(null); setMode(next)
  }
  const submit = async (): Promise<void> => {
    if (busy || disabled) return
    setBusy(true); setError(null)
    try {
      if (mode === 'delete') {
        if (!deleted) { await actions.delete(template.id); setDeleted(true) }
        await onDeleted?.(template.id)
      } else await actions.update(template.id, mode === 'rename' ? { name: name.trim() } : { description: description.trim(), directives })
      await styles.refresh()
      setMode(null)
    } catch (cause) { setError(styleActionMessage(cause, t)) }
    finally { setBusy(false) }
  }
  const exportJson = (): void => {
    try {
      const url = URL.createObjectURL(new Blob([encodeStyleExport(template)], { type: 'application/json' }))
      const link = document.createElement('a')
      try {
        link.href = url; link.download = `${fileStem(template.name, 'style-template')}.iui-style.json`
        link.rel = 'noopener'; link.style.display = 'none'
        document.body.appendChild(link)
        link.click()
        close()
      } finally {
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      }
    } catch (cause) {
      setError(t(cause instanceof StyleExchangeError ? 'template.exportFailed' : 'template.error.request_failed'))
    }
  }
  const title = t(`template.${mode ?? 'manage'}`)
  return <>
    <button ref={anchor} type="button" className="dsh-iui-template-more" data-dsh-iui-manage={template.id}
      aria-label={t('template.manageLabel', { name: template.name })} aria-haspopup="menu" aria-expanded={mode !== null}
      disabled={disabled || busy} onClick={() => change(mode === null ? 'menu' : null)}>…</button>
    {mode === null || disabled ? null : <StylePopover key={mode} anchor={anchor} title={title} onClose={close} menu={mode === 'menu'}>
      {mode === 'menu' ? <>
        <button type="button" role="menuitem" onClick={() => { onUse(); close() }}>{t(global ? 'template.useGlobal' : 'template.use')}</button>
        <button type="button" role="menuitem" onClick={() => change('rename')}>{t('template.rename')}</button>
        <button type="button" role="menuitem" onClick={() => change('edit')}>{t('template.edit')}</button>
        <button type="button" role="menuitem" onClick={() => change('export')}>{t('template.export')}</button>
        <button type="button" role="menuitem" onClick={() => change('delete')}>{t('template.delete')}</button>
      </> : <form onSubmit={event => { event.preventDefault(); if (mode === 'export') exportJson(); else void submit() }}>
        {mode === 'rename' ? <TemplateField label={t('template.name')} value={name} max={30} onChange={setName} required disabled={busy} /> : null}
        {mode === 'edit' ? <>
          <TemplateField label={t('template.description')} value={description} max={100} onChange={setDescription} multiline disabled={busy} />
          <TemplateField label={t('template.directives')} value={directives} max={2000} onChange={setDirectives} multiline disabled={busy} />
        </> : null}
        {mode === 'delete' ? <p>{t('template.deleteNote', { name: template.name })}</p> : null}
        {mode === 'export' ? <p>{t('template.exportNote')}</p> : null}
        {error === null ? null : <p className="dsh-iui-style-error" role="alert">{error}</p>}
        <div className="dsh-iui-template-buttons">
          <button type="button" onClick={close}>{t('template.cancel')}</button>
          <button type="submit" disabled={busy || (mode === 'rename' && !name.trim())}>
            {t(busy ? 'template.saving' : mode === 'delete' ? 'template.delete' : mode === 'export' ? 'template.download' : 'template.save')}
          </button>
        </div>
      </form>}
    </StylePopover>}
  </>
}
