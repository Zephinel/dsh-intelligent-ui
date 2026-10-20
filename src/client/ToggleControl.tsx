/**
 * Composer scope control for the Intelligent UI switch.
 *
 * Registered in the single `conversation.input.activity` seat: a permission-style
 * chip that opens the shell's native `Menu` (the same look and keyboard model as
 * the permission picker) with three mutually exclusive scopes — off, this
 * session, all sessions. The host owns every state decision; a pick forwards one
 * explicit `/iui` command and the next projection frame settles the chip.
 * `onActiveChange` is deliberately not called so the composer toolbar never
 * expands.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the ui-conversation SlotMap / input seat merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pull the ui-session standard props (`useProjection`).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import {
  MODE_PROJECTION_KEY,
  type IntelligentUIModeView,
  type IntelligentUIScope,
} from '../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import {
  effectiveMode,
  modeCommand,
  publishMode,
  readSyncedMode,
  runFlip,
  subscribeSyncedMode,
  toggleState,
} from './toggle.ts'

/** Business face injected by the plugin registration. */
export interface ToggleControlInjected {
  /** Session the control is seated in (needed for the session-only scope). */
  readonly sessionId: string
  /**
   * Execute one explicit scope command for the viewed session.
   * @param scope - requested scope.
   * @returns null when the command was admitted, else a user-visible failure line.
   */
  readonly flip: (scope: IntelligentUIScope) => Promise<string | null>
}

/** Full props: standard Session kit, the composer's locked owner prop, and the injected command. */
export type ToggleControlProps =
  & PropsRuntime<'conversation.input.activity'>
  & InjectFace<ToggleControlInjected>
  & {
    /** DSH locale seat; defaults to English when rendered outside a slot. */
    readonly t?: Translate
  }

/** Projection reader narrowed to the switch's key. */
type ModeProjectionReader = (key: string) => IntelligentUIModeView | undefined

interface ScopeMeta {
  /** Chip label key for the current scope. */
  readonly trigger: string
  /** Menu row label key. */
  readonly menu: string
  /** Accessible description and title key. */
  readonly description: string
  /** Accessible scope name key used inside the chip's aria label. */
  readonly aria: string
  /** One 16px stroke path. */
  readonly path: string
}

/** Scope order and copy keys shared by the trigger, menu rows, and tests. */
const SCOPES: Readonly<Record<IntelligentUIScope, ScopeMeta>> = {
  off: {
    trigger: 'scope.off.label',
    menu: 'scope.off.menu',
    description: 'scope.off.description',
    aria: 'scope.off.aria',
    path: 'M8 1.8v6.4M3.9 4.4a6 6 0 1 0 8.2 0',
  },
  session: {
    trigger: 'scope.session.label',
    menu: 'scope.session.menu',
    description: 'scope.session.description',
    aria: 'scope.session.aria',
    path: 'M8 7.4a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM2.8 14c.5-2.1 2.5-3.6 5.2-3.6S12.7 11.9 13.2 14',
  },
  global: {
    trigger: 'scope.all.label',
    menu: 'scope.all.menu',
    description: 'scope.all.description',
    aria: 'scope.all.aria',
    path: 'M8 14.2c3 0 5.4-2.7 5.4-6.2S11 1.8 8 1.8 2.6 4.5 2.6 8s2.4 6.2 5.4 6.2ZM2.8 8h10.4M8 1.8c1.6 1.7 2.4 3.8 2.4 6.2S9.6 12.5 8 14.2M8 1.8C6.4 3.5 5.6 5.6 5.6 8s.8 4.5 2.4 6.2',
  },
}

/** One inline scope glyph; the menu renders it at 16px, the chip at 14px. */
function ScopeIcon({ scope }: { scope: IntelligentUIScope }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d={SCOPES[scope].path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Render the chip and menu, or nothing on deployments without the host switch
 * (projection key absent).
 * @param props - projection hook, composer lock, session id, injected command, and locale seat.
 * @returns the control with an optional inline failure line, or null.
 */
export function ToggleControl({ useProjection, locked, sessionId, flip, t = fallbackT }: ToggleControlProps): ReactNode {
  const readMode = useProjection as unknown as ModeProjectionReader
  const view = readMode(MODE_PROJECTION_KEY)
  // A settled flip in another tab wins over our own last projection frame.
  const synced = useSyncExternalStore(subscribeSyncedMode, readSyncedMode, readSyncedMode)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mode = effectiveMode(view, synced, sessionId)
  const pending = view?.pending === true || busy
  const disabled = locked || pending

  // The projection can land after the first frame; never keep a popup over a
  // disappearing or locked composer.
  useEffect(() => {
    if (view === undefined || disabled) setOpen(false)
  }, [disabled, view])

  // Hooks stay above this return: the projection may land after the first frame.
  if (view === undefined) return null

  const current = SCOPES[mode]
  const state = toggleState(mode, pending)

  const items: MenuEntry[] = (Object.keys(SCOPES) as IntelligentUIScope[]).map(scope => ({
    id: scope,
    label: t(SCOPES[scope].menu),
    icon: <ScopeIcon scope={scope} />,
  }))

  const choose = (id: string): void => {
    setOpen(false)
    const scope = id as IntelligentUIScope
    if (scope === mode) return
    setError(null)
    setBusy(true)
    void runFlip(flip, scope).then((failure) => {
      setBusy(false)
      setError(failure)
      if (failure === null) publishMode(scope, scope === 'session' ? sessionId : undefined)
    })
  }

  const trigger = (
    <button
      type="button"
      className="dsh-iui-trigger"
      data-dsh-intelligent-ui="toggle"
      data-dsh-iui-toggle="true"
      data-state={state}
      aria-label={t('chip.aria', { scope: t(current.aria) })}
      aria-haspopup="menu"
      aria-expanded={open}
      title={t('chip.title', { description: t(current.description) })}
      disabled={disabled}
      onClick={() => { setOpen(!open) }}
    >
      <span className="dsh-iui-trigger-icon" aria-hidden><ScopeIcon scope={mode} /></span>
      <span className="dsh-iui-trigger-label">{t('chip.label', { scope: t(current.trigger) })}</span>
      <span className="dsh-iui-chevron" data-open={open ? 'true' : 'false'} aria-hidden>
        <IconChevronDownOutlineRegular />
      </span>
    </button>
  )

  return (
    <>
      <Menu
        open={open}
        items={items}
        selectedId={mode}
        onSelect={choose}
        onClose={() => { setOpen(false) }}
        side="top"
        portal
        anchor={trigger}
      />
      {error !== null && (
        <span className="dsh-iui-toggle-error" role="status" title={error}>{t('chip.error')}</span>
      )}
    </>
  )
}
