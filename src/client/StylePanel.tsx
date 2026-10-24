/**
 * Composer style panel body.
 *
 * This component is the structural boundary between the composer control's
 * transient command state and the controls inside the panel: ToggleControl's
 * `busy`/pending flags are intentionally not props here. The panel only knows
 * whether the surface is available (`disabled`) and receives callbacks; the
 * On-demand entry owns its own arming state inside StylePicker. Adding a control
 * here therefore cannot disable the panel during an unrelated style command.
 */
import type { ReactNode, RefObject } from 'react'
import { StylePicker } from './StylePicker.tsx'
import { TemplateImport } from './TemplateImport.tsx'
import type { StyleCatalog, StyleCatalogSnapshot } from './styles.ts'
import type { StyleActions } from './style-actions.ts'
import type { PopupPlacement } from './popover.ts'
import type { StylePreference } from '../shared/intelligent-ui.ts'
import type { StyleTemplate } from '../shared/style-templates.ts'
import { fallbackT, type Translate } from '../shared/locales.ts'

/** Everything the floating panel needs; deliberately no composer pending flags. */
export interface StylePanelProps {
  readonly panelRef: RefObject<HTMLDivElement | null>
  readonly placement: PopupPlacement
  readonly styles: StyleCatalog
  readonly templates: readonly StyleTemplate[]
  readonly actions?: StyleActions
  /** False only when the surface itself is unavailable or the composer is locked. */
  readonly disabled: boolean
  readonly error: string | null
  readonly value: StylePreference
  readonly globalStyle: string
  readonly catalogStatus: StyleCatalogSnapshot['status']
  readonly onBack: () => void
  readonly onChange: (value: StylePreference) => void
  readonly onDemand?: () => Promise<void> | void
  readonly onDeleted: (id: string) => Promise<void>
  readonly onImportBusy: (busy: boolean) => void
  readonly onImportStatus: (status: string | null) => void
  readonly t?: Translate
}

/** Render the panel; the caller owns the portal and placement measurement. */
export function StylePanel({
  panelRef, placement, styles, templates, actions, disabled, error, value, globalStyle,
  catalogStatus, onBack, onChange, onDemand, onDeleted, onImportBusy, onImportStatus, t = fallbackT,
}: StylePanelProps): ReactNode {
  return (
    <div
      ref={panelRef}
      className="dsh-iui-style-panel"
      role="dialog"
      aria-label={t('style.panel.title')}
      style={{
        ...placement.right !== undefined
          ? { right: placement.right, maxWidth: placement.maxWidth }
          : { left: placement.left, width: placement.width },
        bottom: placement.bottom,
        maxHeight: placement.maxHeight,
      }}
      data-dsh-iui-style-panel
    >
      <div className="dsh-iui-style-panel-header">
        <button
          type="button"
          className="dsh-iui-style-back"
          aria-label={t('style.panel.back')}
          onClick={onBack}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <span className="dsh-iui-style-panel-title">{t('style.panel.title')}</span>
        <span className="dsh-iui-style-panel-scope">{t('style.panel.scope')}</span>
      </div>
      <div className="dsh-iui-style-panel-body">
        <TemplateImport
          styles={styles}
          templates={templates}
          actions={actions}
          disabled={disabled}
          onBusyChange={onImportBusy}
          onStatusChange={onImportStatus}
          t={t}
        />
        <StylePicker
          value={value}
          globalStyle={globalStyle}
          templates={templates}
          catalogStatus={catalogStatus}
          allowInherit
          disabled={disabled}
          note={t('style.session.note')}
          footer={t('style.session.footer')}
          onChange={onChange}
          management={{ styles, actions, onDeleted }}
          onDemand={onDemand}
          t={t}
        />
        {error === null ? null : <p className="dsh-iui-style-error" role="alert">{error}</p>}
      </div>
    </div>
  )
}
