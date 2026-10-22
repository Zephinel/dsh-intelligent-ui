/**
 * Standalone renderer entry for the single-file HTML export.
 *
 * `scripts/build.mjs` bundles this entry into `lib/standalone.js` (plus
 * `lib/standalone.css`). The Host serves both files on same-origin routes, and
 * the browser export inlines them into one downloaded HTML document. The page
 * keeps the renderer's real interactions (maps, forms, @OpenUrl, @ToAssistant
 * fallback), so it does not depend on DSH when opened locally.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { OpenUIRenderer } from '../lib/render.tsx'
import { en, translate, zh, type Translate } from '../shared/locales.ts'
import type { ExportPageCard } from '../shared/intelligent-ui.ts'
import { hideToAssistantBlocks } from '../lib/to-assistant.ts'
import '../client/index.css'
import 'katex/dist/katex.min.css'
import './standalone.css'

/** Options the exporting page passes to the standalone entry. */
interface StandaloneOptions {
  /** UI language for the copy toast and renderer fallbacks. */
  readonly lang?: string
  /** Hide controls that would continue the conversation. */
  readonly hideToAssistant?: boolean
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
  readonly hideToAssistant: boolean
}

/**
 * Render only the answer body. The exported page deliberately drops the DSH
 * card header and its collapse control: it carries content, not chat chrome.
 */
function CardBody({ card, t, onToAssistant, hideToAssistant }: CardProps): ReactElement {
  return (
    <section className="dsh-iui-standalone-card" data-dsh-intelligent-ui="card" data-dsh-iui-style={card.style ?? 'card'}>
      <div className={card.style === 'article' ? 'dsh-iui-article' : undefined}>
        <OpenUIRenderer program={card.program} title={card.title} scopeId={card.callId} themeStyle={card.themeStyle} scheme={card.scheme} onToAssistant={hideToAssistant ? undefined : onToAssistant} t={t} />
      </div>
    </section>
  )
}

/** Render the exported cards plus the copy fallback toast. */
function Page({ cards, lang, hideToAssistant }: { readonly cards: readonly ExportPageCard[]; readonly lang: string; readonly hideToAssistant: boolean }): ReactElement {
  const t = lang.toLowerCase().startsWith('zh') ? translate(zh) : translate(en)
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  useLayoutEffect(() => {
    if (!hideToAssistant) return
    const apply = (): void => { hideToAssistantBlocks(document.body) }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [hideToAssistant])
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
          <CardBody key={card.callId ?? `${index}-${card.title ?? ''}`} card={card} t={t} onToAssistant={onToAssistant} hideToAssistant={hideToAssistant} />
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
  createRoot(element).render(<Page cards={cards} lang={options.lang ?? 'en'} hideToAssistant={options.hideToAssistant === true} />)
}
