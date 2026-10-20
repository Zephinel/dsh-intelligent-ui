/**
 * Renderer-side i18n seat.
 *
 * The renderer library is also mounted outside DSH's locale service (the
 * renderer smoke tests and standalone embeds), so the DSH `t` seat is passed in
 * as a plain prop by the client card and published through React context here.
 * Without a provider every component falls back to the English dictionary, so
 * library code stays usable on its own and existing English markup is stable.
 */
import { createContext, useContext, type ReactNode } from 'react'
import { fallbackT, type Translate } from '../shared/locales.ts'

/** Active translate function; English unless the client card provides a seat. */
const I18nContext = createContext<Translate>(fallbackT)

/**
 * Publish one translate function to the renderer subtree.
 * @param props - active translator and children.
 * @returns the provider element.
 */
export function I18nProvider({ t, children }: { t: Translate; children: ReactNode }): ReactNode {
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>
}

/**
 * Read the active translator.
 * @returns the DSH `t` seat when provided, else the English fallback.
 */
export function useT(): Translate {
  return useContext(I18nContext)
}
