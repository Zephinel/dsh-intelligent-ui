/**
 * Standalone renderer entry for the single-file HTML export.
 *
 * `scripts/build.mjs` bundles this entry into `lib/standalone.js` (plus
 * `lib/standalone.css`). The Host serves both files on same-origin routes, and
 * the browser export inlines them into one downloaded HTML document. The page
 * keeps the renderer's real interactions (maps, forms, @OpenUrl, @ToAssistant
 * fallback), so it does not depend on DSH when opened locally.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from '../lib/render.tsx'
import { en, translate, zh, type Translate } from '../shared/locales.ts'
import type { ExportPageCard } from '../shared/intelligent-ui.ts'
import '../client/index.css'
import 'katex/dist/katex.min.css'
import './standalone.css'

/** Options the exporting page passes to the standalone entry. */
interface StandaloneOptions {
  /** UI language for the card chrome and the copy toast. */
  readonly lang?: string
}

/** Inline sparkle glyph for the card header. */
function SparkleIcon(): ReactElement {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M10 2.6 11.5 7l4.4 1.5-4.4 1.5L10 14.4 8.5 10 4.1 8.5 8.5 7 10 2.6Z" fill="currentColor" />
      <circle cx="15.4" cy="4.6" r="1.15" fill="currentColor" opacity=".65" />
    </svg>
  )
}

/** Inline chevron for the collapsible card header. */
function ChevronIcon(): ReactElement {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 8 4 4 4-4" />
    </svg>
  )
}

/** Copy text with a legacy fallback for file:// pages without the async API. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older or permission-restricted contexts: use the selection fallback.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let copied = false
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    }
    area.remove()
    return copied
  }
}

interface CardProps {
  readonly card: ExportPageCard
  readonly t: Translate
  readonly onToAssistant: (message: string) => void
}

/** One collapsible card matching the DSH card chrome without shell imports. */
function Card({ card, t, onToAssistant }: CardProps): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const title = card.title !== undefined && card.title.trim() !== '' ? card.title : t('card.title')
  return (
    <section className="dsh-iui-card" data-dsh-intelligent-ui="card" data-dsh-iui-style={card.style ?? 'card'}>
      <button type="button" className="dsh-iui-header" aria-expanded={!collapsed} onClick={() => { setCollapsed(value => !value) }}>
        <span className="dsh-iui-icon" aria-hidden="true"><SparkleIcon /></span>
        <span className="dsh-iui-title">{title}</span>
        <span className="dsh-iui-chevron" aria-hidden="true"><ChevronIcon /></span>
      </button>
      <div className="dsh-iui-body" hidden={collapsed}>
        <div className={card.style === 'article' ? 'dsh-iui-article' : undefined}>
          <OpenUIRenderer program={card.program} title={card.title} scopeId={card.callId} onToAssistant={onToAssistant} t={t} />
        </div>
      </div>
    </section>
  )
}

/** Render the exported cards plus the copy fallback toast. */
function Page({ cards, lang }: { readonly cards: readonly ExportPageCard[]; readonly lang: string }): ReactElement {
  const t = lang.toLowerCase().startsWith('zh') ? translate(zh) : translate(en)
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  const onToAssistant = useCallback((message: string): void => {
    void copyText(message).then(copied => {
      // On failure, keep the message visible so the reader can copy it by hand.
      const next = copied ? t('standalone.copied') : `${t('standalone.copyFailed')}\n${message}`
      setToast(next)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setToast(null)
      }, 3200)
    })
  }, [t])
  return (
    <div className="dsh-iui-standalone-page">
      <div className="dsh-iui-cards dsh-iui-standalone-cards" data-dsh-intelligent-ui-list>
        {cards.map((card, index) => (
          <Card key={card.callId ?? `${index}-${card.title ?? ''}`} card={card} t={t} onToAssistant={onToAssistant} />
        ))}
      </div>
      {toast === null ? null : <div className="dsh-iui-standalone-toast" role="status">{toast}</div>}
    </div>
  )
}

declare global {
  interface Window {
    mountIUI?: (element: HTMLElement, cards: readonly ExportPageCard[], options?: StandaloneOptions) => void
  }
}

window.mountIUI = (element, cards, options = {}) => {
  createRoot(element).render(<Page cards={cards} lang={options.lang ?? 'en'} />)
}
