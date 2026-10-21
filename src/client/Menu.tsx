/**
 * Shared rows for the extension's floating menus.
 *
 * The composer scope menu and the answer export menu use the same row anatomy
 * (icon, label, hint, trailing check/chevron, selected/hover/disabled states)
 * so spacing and interaction feedback cannot drift between the two surfaces.
 */
import type { ReactNode } from 'react'

/** One selectable menu row. */
export interface MenuItemProps {
  /** Leading glyph. Omit for text-only menus such as the export frames. */
  readonly icon?: ReactNode
  /** Primary row text. */
  readonly label: string
  /** Secondary line under the label. */
  readonly hint?: string | undefined
  /** Current selection: brand tint plus a tinted trailing glyph. */
  readonly selected?: boolean
  /** Renders dimmed and ignores activation. */
  readonly disabled?: boolean
  /** Trailing check / drill-in chevron. */
  readonly trailing?: ReactNode
  /** Extra data attributes for the row (tests and callers). */
  readonly data?: Readonly<Record<`data-${string}`, string | undefined>>
  /** Activation handler. */
  readonly onSelect: () => void
}

/**
 * Render one menu row.
 * @param props - row content and state.
 * @returns a menu item button.
 */
export function MenuItem({ icon, label, hint, selected = false, disabled = false, trailing, data, onSelect }: MenuItemProps): ReactNode {
  return (
    <button
      type="button"
      role="menuitem"
      className="dsh-iui-menu-item"
      data-selected={selected ? 'true' : undefined}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      {...data}
      onClick={onSelect}
    >
      {icon === undefined ? null : <span className="dsh-iui-menu-icon" aria-hidden>{icon}</span>}
      <span className="dsh-iui-menu-copy">
        <span className="dsh-iui-menu-label">{label}</span>
        {hint === undefined ? null : <span className="dsh-iui-menu-hint">{hint}</span>}
      </span>
      {trailing === undefined ? null : <span className="dsh-iui-menu-trailing" aria-hidden>{trailing}</span>}
    </button>
  )
}

/**
 * Hairline separation between menu sections.
 * @returns a non-interactive, inset divider.
 */
export function MenuDivider(): ReactNode {
  return <div className="dsh-iui-menu-divider" role="separator" />
}
