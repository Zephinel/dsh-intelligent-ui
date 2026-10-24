/**
 * Composer control for the Intelligent UI session settings.
 *
 * The chip opens the scope menu (off, this session, all sessions). Choosing
 * `on` / clicking the already-active session entry opens the answer-style panel:
 * built-in and custom tiles, and a follow-global switch. All sessions retains
 * the existing inherit semantics; it does not write the global switch. The Host
 * owns every state decision; the control forwards one explicit `/iui` command
 * and the next projection frame settles the chip.
 */
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the ui-conversation SlotMap / input seat merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pull the ui-session standard props (`useProjection`).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import {
  MODE_PROJECTION_KEY,
  type IntelligentUIModeView,
  type SessionEnable,
  type StylePreference,
} from '../shared/intelligent-ui.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'
import { MenuDivider, MenuItem } from './Menu.tsx'
import { StylePanel } from './StylePanel.tsx'
import type { StyleCatalog } from './styles.ts'
import type { StyleActions } from './style-actions.ts'
import { useAnchoredPopup, usePopupDismiss } from './popover.ts'
import { clientToken } from './client-token.ts'
import {
  effectiveView,
  publishMode,
  readSyncedMode,
  resetSyncedMode,
  runCommand,
  sameView,
  subscribeSyncedMode,
} from './commands.ts'

/** Business face injected by the plugin registration. */
export interface ToggleControlInjected {
  /** Session the control is seated in, used to match cross-tab views. */
  readonly sessionId: string
  readonly styles: StyleCatalog
  readonly styleActions?: StyleActions
  /** Execute one explicit enable-scope command for this session. */
  readonly flip: (scope: SessionEnable) => Promise<string | null>
  /** Execute one explicit answer-style command for this session. */
  readonly setStyle: (style: StylePreference) => Promise<string | null>
  readonly armOnDemand?: (clientToken: string) => Promise<string | null>
  readonly focusComposer?: () => void
}

/** Full props: standard Session kit, the composer's locked owner prop, and the injected commands. */
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
const SCOPES: Readonly<Record<SessionEnable, ScopeMeta>> = {
  off: {
    trigger: 'scope.off.label',
    menu: 'scope.off.menu',
    description: 'scope.off.description',
    aria: 'scope.off.aria',
    path: 'M8 1.8v6.4M3.9 4.4a6 6 0 1 0 8.2 0',
  },
  on: {
    trigger: 'scope.session.label',
    menu: 'scope.session.menu',
    description: 'scope.session.description',
    aria: 'scope.session.aria',
    path: 'M8 7.4a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM2.8 14c.5-2.1 2.5-3.6 5.2-3.6S12.7 11.9 13.2 14',
  },
  inherit: {
    trigger: 'scope.inherit.label',
    menu: 'scope.inherit.menu',
    description: 'scope.inherit.description',
    aria: 'scope.inherit.aria',
    path: 'M8 14.2c3 0 5.4-2.7 5.4-6.2S11 1.8 8 1.8 2.6 4.5 2.6 8s2.4 6.2 5.4 6.2ZM2.8 8h10.4M8 1.8c1.6 1.7 2.4 3.8 2.4 6.2S9.6 12.5 8 14.2M8 1.8C6.4 3.5 5.6 5.6 5.6 8s.8 4.5 2.4 6.2',
  },
}

/** One inline scope glyph; the menu renders it at 16px, the chip at 14px. */
function ScopeIcon({ scope }: { scope: SessionEnable }): ReactNode {
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

/** One row in the custom scope menu. */
interface ScopeMenuItem {
  readonly id: SessionEnable | 'style'
  readonly label: string
  /** Secondary copy for the drill-in style row. */
  readonly hint?: string
  readonly icon: ReactNode
  /** Drill-in rows show a chevron instead of a selected check. */
  readonly drillIn?: boolean
  /** Disabled rows explain a state but cannot be chosen. */
  readonly disabled?: boolean
}

/** Inline chevron, so the trigger does not depend on a shell icon skin. */
function ChevronIcon(): ReactNode {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" className="dsh-iui-chevron-svg">
      <path d="M2.5 4.25 6 7.75l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Selected-row check. */
function CheckIcon(): ReactNode {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="m2.3 6.2 2.4 2.4 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Right-pointing chevron for a drill-in row. */
function DrillIcon(): ReactNode {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="m4.25 2.5 3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Style glyph for the drill-in row. */
function StyleIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M3 4.5h10M3 8h7M3 11.5h4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="13" cy="11.5" r="1.4" fill="currentColor" />
    </svg>
  )
}


/**
 * Render the chip, scope menu, and answer-style panel.
 * @param props - projection hook, composer lock, injected commands, and locale seat.
 * @returns the control, or null on deployments without the host switch.
 */
export function ToggleControl({
  useProjection,
  locked,
  sessionId,
  styles,
  styleActions,
  flip,
  setStyle,
  armOnDemand,
  focusComposer,
  t = fallbackT,
}: ToggleControlProps): ReactNode {
  const readMode = useProjection as unknown as ModeProjectionReader
  const projected = readMode(MODE_PROJECTION_KEY)
  const synced = useSyncExternalStore(subscribeSyncedMode, readSyncedMode, readSyncedMode)
  const view = effectiveView(projected, synced, sessionId)
  const [open, setOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const focusStyleRef = useRef(false)
  const focusComposerRef = useRef(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const importBusyRef = useRef(false)
  useEffect(() => { importBusyRef.current = importBusy }, [importBusy])
  const catalog = useSyncExternalStore(styles.subscribe, styles.getSnapshot, styles.getSnapshot)
  useEffect(() => { void styles.ensure(sessionId).then(() => { if (panelOpen) return styles.refresh() }) }, [styles, sessionId, panelOpen])

  const sessionEnable = view?.sessionEnable ?? 'inherit'
  const pending = view?.pending === true || busy
  const disabled = locked || pending
  // The panel stays visually enabled while a style command is in flight; the
  // command guard above still ignores extra clicks. Marking every control
  // disabled made the whole panel flash opacity .5 on each style choice.
  const panelDisabled = locked || view === undefined || !view.enabled
  const enabled = view?.enabled === true

  // Never keep a popup over a disappearing, locked or disabled composer. A
  // pending command must not close the style panel: the controls inside it are
  // disabled until the next projection frame, then it settles in place.
  useEffect(() => {
    if (importBusyRef.current || importStatus !== null) return
    if (view === undefined || locked || (!view.enabled && !view.pending)) {
      setOpen(false)
      setPanelOpen(false)
    }
  }, [importBusy, importStatus, locked, view])

  // Once a projection frame differs from the base the sender saw, that frame is
  // authoritative; clear the optimistic cross-tab view even if the command was
  // rejected or settled differently.
  useEffect(() => {
    if (synced === undefined || synced.sessionId !== sessionId || projected === undefined) return
    if (synced.base === undefined || !sameView(projected, synced.base)) resetSyncedMode()
  }, [projected, sessionId, synced])
  const closeMenu = useCallback(() => { setOpen(false) }, [])
  const closePanel = useCallback(() => { if (importBusyRef.current) return; setImportStatus(null); setPanelOpen(false) }, [])
  const menuPlacement = useAnchoredPopup(open, triggerRef, { minWidth: 0, maxWidth: 320, alignEnd: true }, menuRef)
  const panelPlacement = useAnchoredPopup(panelOpen, triggerRef, { minWidth: 340, maxWidth: 460, maxHeight: true, alignEnd: true })
  const menuVisible = open && menuPlacement !== null
  const panelVisible = panelOpen && panelPlacement !== null && (enabled || importBusy)
  usePopupDismiss(
    menuVisible,
    triggerRef,
    menuRef,
    closeMenu,
    focusStyleRef.current ? '[data-style-entry="true"]' : '[data-selected="true"], button',
  )
  usePopupDismiss(panelVisible, triggerRef, panelRef, closePanel)
  // Popup cleanup restores the chip first; return focus through the DSH facade afterwards.
  useEffect(() => {
    if (!panelVisible && focusComposerRef.current) {
      focusComposerRef.current = false
      focusComposer?.()
    }
  })

  // Hooks stay above this return: the projection may land after the first frame.
  if (view === undefined) return null

  const current = SCOPES[sessionEnable]
  const state = pending ? 'pending' : sessionEnable

  const openPanel = (): void => {
    focusStyleRef.current = false
    setOpen(false)
    setError(null)
    setPanelOpen(true)
  }

  // The panel is a second level: its back button returns to the scope menu
  // instead of dismissing every popup.
  const backToMenu = (): void => {
    if (importBusyRef.current) return
    setImportStatus(null)
    focusStyleRef.current = true
    setPanelOpen(false)
    setOpen(true)
  }

  const opensStyle = (scope: SessionEnable): boolean =>
    scope === 'on' || (scope === 'inherit' && view.globalEnabled)

  const choose = (scope: SessionEnable): void => {
    if (disabled) return
    // Clicking the active entry opens the style panel instead of re-running a
    // no-op command. Follow-global also opens it when the global switch is on,
    // so a session style override does not require changing the enable scope.
    if (scope === sessionEnable && opensStyle(scope)) {
      openPanel()
      return
    }
    setOpen(false)
    setError(null)
    setBusy(true)
    void runCommand(flip, scope).then((failure) => {
      setBusy(false)
      setError(failure)
      if (failure === null) {
        publishMode({
          ...view,
          sessionEnable: scope,
          enabled: scope === 'on' ? true : scope === 'off' ? false : view.globalEnabled,
          pending: false,
        }, sessionId, projected)
        if (opensStyle(scope)) openPanel()
      }
    })
  }

  const chooseStyle = (style: StylePreference): void => {
    if (disabled) return
    setError(null)
    setBusy(true)
    void runCommand(setStyle, style).then((failure) => {
      setBusy(false)
      setError(failure)
      if (failure === null) {
        publishMode({
          ...view,
          sessionStyle: style,
          style: style === 'inherit' ? view.globalStyle : style,
          pending: false,
        }, sessionId, projected)
      }
    })
  }

  const arm = async (): Promise<void> => {
    if (disabled || !enabled || armOnDemand === undefined) return
    setError(null)
    setBusy(true)
    const failure = await runCommand(armOnDemand, clientToken())
    setBusy(false)
    setError(failure === null ? null : t('onDemand.armError', { error: failure }))
    if (failure === null && !importBusyRef.current) {
      focusComposerRef.current = true
      setPanelOpen(false)
      setOpen(false)
    }
  }

  const items: ScopeMenuItem[] = (['off', 'on', 'inherit'] as const).map(scope => ({
    id: scope,
    label: t(SCOPES[scope].menu),
    icon: <ScopeIcon scope={scope} />,
  }))
  // The style entry stays visible so the menu anatomy is stable; it is
  // disabled while Intelligent UI is off, and a hairline separates it from the
  // three scope rows above.
  items.push({
    id: 'style',
    label: t('style.panel.title'),
    hint: t('style.panel.scope'),
    icon: <StyleIcon />,
    drillIn: true,
    disabled: !view.enabled,
  })

  const visibleTemplates = catalog.templates.filter(template => template.scope === 'global' || template.sessionId === sessionId)
  const panel = panelVisible
    ? createPortal(
      <StylePanel
        panelRef={panelRef}
        placement={panelPlacement}
        styles={styles}
        templates={visibleTemplates}
        actions={styleActions}
        disabled={panelDisabled}
        error={error}
        value={view.sessionStyle}
        globalStyle={view.globalStyle}
        catalogStatus={catalog.status}
        onBack={backToMenu}
        onChange={chooseStyle}
        onDemand={armOnDemand === undefined ? undefined : arm}
        onDeleted={async id => {
          if (view.sessionStyle !== id) return
          const failure = await runCommand(setStyle, 'auto')
          if (failure !== null) throw new Error(failure)
          publishMode({ ...view, sessionStyle: 'auto', style: 'auto', pending: false }, sessionId, projected)
        }}
        onImportBusy={setImportBusy}
        onImportStatus={setImportStatus}
        t={t}
      />,
      document.body,
    )
    : null

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="dsh-iui-trigger"
      data-dsh-intelligent-ui="toggle"
      data-dsh-iui-toggle="true"
      data-state={state}
      data-enabled={enabled ? 'true' : 'false'}
      aria-label={t('chip.aria', { scope: t(current.aria) })}
      aria-haspopup={panelOpen ? 'dialog' : 'menu'}
      aria-expanded={open || panelOpen}
      title={t('chip.title', { description: t(current.description) })}
      disabled={disabled}
      onClick={() => {
        if (panelOpen && importBusyRef.current) return
        setImportStatus(null)
        setError(null)
        setPanelOpen(false)
        setOpen(!open)
      }}
    >
      <span className="dsh-iui-trigger-icon" aria-hidden><ScopeIcon scope={sessionEnable} /></span>
      <span className="dsh-iui-trigger-label">{t('chip.label', { scope: t(current.trigger) })}</span>
      <span className="dsh-iui-chevron" data-open={open || panelOpen ? 'true' : 'false'} aria-hidden>
        <ChevronIcon />
      </span>
    </button>
  )

  return (
    <>
      {trigger}
      {menuVisible
        ? createPortal(
          <div
            ref={menuRef}
            className="dsh-iui-menu dsh-iui-scope-menu"
            role="menu"
            aria-label={t('chip.aria', { scope: t(current.aria) })}
            style={{
              ...menuPlacement.right === undefined ? {} : { right: menuPlacement.right },
              ...menuPlacement.maxWidth === undefined ? {} : { maxWidth: menuPlacement.maxWidth },
              bottom: menuPlacement.bottom,
            }}
            data-dsh-iui-menu
          >
            {items.map(item => (
              <Fragment key={item.id}>
                {item.id === 'style' ? <MenuDivider /> : null}
                <MenuItem
                  icon={item.icon}
                  label={item.label}
                  hint={item.hint}
                  selected={item.id === sessionEnable}
                  disabled={item.disabled}
                  trailing={item.drillIn === true
                    ? <DrillIcon />
                    : item.id === sessionEnable ? <CheckIcon /> : undefined}
                  data={item.id === 'style' ? { 'data-style-entry': 'true' } : undefined}
                  onSelect={() => {
                    if (item.id === 'style') {
                      openPanel()
                      return
                    }
                    choose(item.id)
                  }}
                />
              </Fragment>
            ))}
          </div>,
          document.body,
        )
        : null}
      {error !== null && !panelOpen && (
        <span className="dsh-iui-toggle-error" role="status" title={error}>{t('chip.error')}</span>
      )}
      {panel}

    </>
  )
}
