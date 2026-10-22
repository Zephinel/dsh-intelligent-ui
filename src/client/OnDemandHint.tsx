/** Session-scoped composer overlay. Only the arming tab shows the transient intent. */
import { useEffect, useState, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { MODE_PROJECTION_KEY, type IntelligentUIModeView } from '../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import { fillComposer, type ComposerAccess } from './composer.ts'

export interface OnDemandHintInjected extends ComposerAccess {
  readonly clientInstanceId: string
  readonly armOnDemand: (clientInstanceId: string, options?: { kind?: 'generate' | 'adjust'; parentResultId?: string }) => Promise<string | null>
  readonly cancelOnDemand: () => Promise<string | null>
}

export function OnDemandHint({
  useProjection, useInput, inputActions, clientInstanceId, readInput, focusComposer, armOnDemand, cancelOnDemand, t = fallbackT,
}: PropsRuntime<'conversation.input.overlay'> & InjectFace<OnDemandHintInjected> & { readonly t?: Translate }): ReactNode {
  const view = (useProjection as unknown as (key: string) => IntelligentUIModeView | undefined)(MODE_PROJECTION_KEY)
  const phase = useInput(state => state.phase)
  const operation = view?.onDemand
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  useEffect(() => { setError(null) }, [operation?.operationId, operation?.status])
  const status = operation?.status
  const active = status === 'armed' || status === 'running' || status === 'clarifying'
  const terminal = status === 'failed' || status === 'interrupted'
  if ((!active && !terminal) || (operation.clientInstanceId !== undefined && operation.clientInstanceId !== clientInstanceId)) return null
  if (terminal && dismissed === operation.operationId) return null
  const armed = status === 'armed'
  const generating = status === 'running' || status === 'clarifying'
  const disabled = busy || view?.pending === true || view?.enabled === false || phase !== 'plain'

  const fill = (text: string): void => {
    try {
      setError(fillComposer(inputActions, readInput(), text) ? null : t('onDemand.fillError'))
      focusComposer()
    } catch { setError(t('onDemand.fillError')) }
  }
  const retry = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const failure = await armOnDemand(clientInstanceId, operation.kind === 'adjust' && operation.parentResultId !== undefined
        ? { kind: 'adjust', parentResultId: operation.parentResultId }
        : undefined)
      if (failure !== null) setError(t('onDemand.armError', { error: failure }))
      else focusComposer()
    } catch (reason) { setError(t('onDemand.armError', { error: reason instanceof Error ? reason.message : String(reason) })) }
    finally { setBusy(false) }
  }
  const cancel = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const failure = await cancelOnDemand()
      if (failure !== null) setError(t('onDemand.cancelError', { error: failure }))
      else focusComposer()
    } catch (reason) { setError(t('onDemand.cancelError', { error: reason instanceof Error ? reason.message : String(reason) })) }
    finally { setBusy(false) }
  }
  return (
    <div className="dsh-iui-on-demand-hint" data-dsh-iui-on-demand-hint data-status={status} role="region" aria-label={t('onDemand.label')} aria-live={generating ? 'polite' : undefined}>
      <div className="dsh-iui-on-demand-heading">
        <span aria-hidden="true">✦</span>
        <strong>{t('onDemand.label')}</strong>
        <span className="dsh-iui-on-demand-copy">{terminal
          ? t(status === 'interrupted' ? 'onDemand.interruptedHint' : 'onDemand.failedHint')
          : generating
            ? t(status === 'clarifying' ? 'onDemand.clarifying' : 'onDemand.running')
            : t(operation.resume === true ? 'onDemand.resumeHint' : operation.kind === 'adjust' ? 'onDemand.adjustHint' : 'onDemand.hint')}</span>
        {generating ? (
          <span className="dsh-iui-on-demand-spinner" aria-hidden="true">
            <svg viewBox="0 0 16 16" focusable="false">
              <circle className="dsh-iui-on-demand-spinner-track" cx="8" cy="8" r="6.2" />
              <circle className="dsh-iui-on-demand-spinner-arc" cx="8" cy="8" r="6.2" />
            </svg>
          </span>
        ) : null}
        {terminal ? (
          <span className="dsh-iui-on-demand-actions">
            <button type="button" className="dsh-iui-on-demand-retry" disabled={busy || view?.pending === true} onClick={() => { void retry() }}>{t('onDemand.retry')}</button>
            <button type="button" className="dsh-iui-on-demand-dismiss" disabled={busy} onClick={() => { setDismissed(operation.operationId) }}>{t('onDemand.dismiss')}</button>
          </span>
        ) : armed ? <button type="button" className="dsh-iui-on-demand-cancel" disabled={busy || view?.pending === true} onClick={() => { void cancel() }}>{t('onDemand.cancel')}</button> : null}
      </div>
      {armed && operation.kind !== 'adjust' && operation.resume !== true && (
        <div className="dsh-iui-on-demand-examples" role="group" aria-label={t('onDemand.examples')}>
          {['dashboard', 'images', 'metrics', 'article'].map(key => (
            <button type="button" key={key} disabled={disabled} onClick={() => fill(t(`onDemand.example.${key}`))}>{t(`onDemand.example.${key}`)}</button>
          ))}
        </div>
      )}
      {error === null ? null : <p className="dsh-iui-style-error" role="alert">{error}</p>}
    </div>
  )
}
