import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { StyleSnapshot } from '../shared/style-templates.ts'
import type { Translate } from '../shared/locales.ts'
import type { StyleActions } from './style-actions.ts'
import type { StyleCatalog } from './styles.ts'
import { StylePopover } from './StylePopover.tsx'
import { TemplateField, styleActionMessage } from './TemplateFields.tsx'

export function SaveResultAction({ resultId, snapshot, sessionId, actions, styles, disabled, t }: {
  readonly resultId: string
  readonly snapshot: StyleSnapshot
  readonly sessionId: string
  readonly actions: StyleActions
  readonly styles: StyleCatalog
  readonly disabled?: boolean
  readonly t: Translate
}): ReactNode {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(snapshot.suggestedName ?? t('template.defaultName'))
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<'global' | 'session'>('global')
  const [error, setError] = useState<string | null>(null)
  const close = useCallback(() => setOpen(false), [])
  const save = async (): Promise<void> => {
    if (busy || disabled || !name.trim()) return
    setBusy(true); setError(null)
    try {
      await actions.saveFromResult({ resultId, name: name.trim(), description: description.trim(), scope,
        ...scope === 'session' ? { sessionId } : {} })
      await styles.refresh()
      setSaved(true); setOpen(false)
    } catch (cause) { setError(styleActionMessage(cause, t)) }
    finally { setBusy(false) }
  }
  return <>
    <button ref={anchor} type="button" data-dsh-iui-save-result disabled={disabled || busy}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!saved) setOpen(value => !value) }}>
      {t(saved ? 'template.saved' : 'template.saveFromResult')}
    </button>
    {!open ? null : <StylePopover anchor={anchor} title={t('template.saveFromResult')} onClose={close}>
      <form onSubmit={event => { event.preventDefault(); void save() }}>
        <TemplateField label={t('template.name')} value={name} max={30} onChange={setName} required disabled={busy} />
        <TemplateField label={t('template.description')} value={description} max={100} onChange={setDescription} multiline disabled={busy} />
        <fieldset className="dsh-iui-template-scopes" disabled={busy}>
          <legend>{t('template.scope')}</legend>
          {(['session', 'global'] as const).map(value => <label key={value}>
            <input type="radio" name={`scope-${resultId}`} checked={scope === value} onChange={() => setScope(value)} />
            {t(`template.scope.${value}`)}
          </label>)}
        </fieldset>
        <p className="dsh-iui-style-note">{t('template.saveNote')}</p>
        {error === null ? null : <p className="dsh-iui-style-error" role="alert">{error}</p>}
        <div className="dsh-iui-template-buttons">
          <button type="button" onClick={close}>{t('template.cancel')}</button>
          <button type="submit" disabled={busy || !name.trim()}>{t(busy ? 'template.saving' : 'template.save')}</button>
        </div>
      </form>
    </StylePopover>}
  </>
}
