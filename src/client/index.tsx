/**
 * Browser half of the Intelligent UI extension.
 *
 * A completed Turn that called the host tool `render_ui` gets one interactive
 * card at its end (the Chat's turn-tail list), and the call's own Tool row
 * becomes a compact process line instead of exposing the raw program. The
 * composer's `conversation.input.activity` seat carries the per-session on/off
 * switch that gates the tool and its prompt, and the Plugin detail page carries
 * the deployment-wide free-composition preference.
 *
 * Only `import type` reaches other DSH feature packages; runtime imports are
 * this repo's own modules, React, and the shell's platform modules (the icon
 * and disclosure primitives).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pull the ui-chat `conversation.chat.turnTail` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pull the ui-conversation SlotMap / input contract merges.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pull the `remote.commands` client service merge.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pull the ui-session standard props (`sessions` service, session scope).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pull the ui-tool `tool.call.toolview` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
// Type-only: pull the client locale service (`ctx.locale`) and its dictionary types.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pull the settings `configForms` service merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pull the Plugins page `plugins.bundle.config` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { IntelligentUICards, type IntelligentUICardsInjected } from './IntelligentUICards.tsx'
import { RenderUiRow } from './RenderUiRow.tsx'
import { SettingsPage, type SettingsFormLike, type SettingsPageInjected } from './SettingsPage.tsx'
import { ToggleControl, type ToggleControlInjected } from './ToggleControl.tsx'
import { modeCommand, startModeSync } from './toggle.ts'
import { HOST_ENTRY_ID, PACKAGE_NAME, type IntelligentUIScope } from '../shared/intelligent-ui.ts'
import { NS, en, zh } from '../shared/locales.ts'
import './index.css'

/** Client plugin name shown by the shell. */
export const name = 'intelligent-ui'

/** Services this plugin reads: locale, slots, Session bindings, and command RPC. */
export const inject = ['locale', 'sessions', 'slots', 'uiConversation', 'remote', 'remote.commands']

/** Stable list id for the Turn-tail contribution. */
const CARD_ID = 'intelligent-ui'

/**
 * Register the Turn-tail cards, the compact `render_ui` Tool row, the composer
 * Intelligent UI switch, and the extension's Settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // One channel per page; keeps the chip consistent across tabs of this GUI.
  startModeSync()
  // Both dictionaries go in one registration so every slot below can translate
  // through the `t` seat. A later locale switch re-renders the mounted outlets.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'intelligent-ui: dictionaries')
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: CARD_ID,
    locale: NS,
    inject: (sessionId: SessionId): IntelligentUICardsInjected => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`intelligent-ui: unknown session "${sessionId}"`)
      const chat = ctx.uiConversation.binding(binding).target('chat')
      return {
        keyedHooks: {
          programs: (turn: string) => {
            const snapshot = chat.getSnapshot()
            if (snapshot === undefined) throw new Error('intelligent-ui: Chat target is unavailable')
            return snapshot.nodes.turnDataSource(Number(turn), 'tool-call')
          },
        },
      }
    },
  }, IntelligentUICards))
  // Replace the generic Tool row for this wire name: the program belongs in the
  // closing Turn's card, not in the collapsible process list.
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'render_ui', locale: NS },
    RenderUiRow,
  ))
  // Composer switch: one explicit on/off command per click; the host projection
  // `intelligent-ui` owns the settled state and the pending fold.
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity',
    locale: NS,
    inject: (sessionId: SessionId): ToggleControlInjected => ({
      sessionId,
      flip: async (scope: IntelligentUIScope): Promise<string | null> => {
        const command = modeCommand(scope)
        const result = await ctx.remote.commands.execute(sessionId, command, [])
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return `unknown command: ${command}`
        return null
      },
    }),
  }, ToggleControl))
  // Configuration on this bundle's Plugins detail page: one switch persisted as
  // the Host entry's volatile `freeComposition` field. Optional: a deployment
  // without the settings domain keeps the composer switch and the card.
  ctx.inject(['configForms'], (child) => {
    const form = child.configForms.get(HOST_ENTRY_ID) as unknown as SettingsFormLike
    child.slots.inject('plugins.bundle.config', () => child.slots.register({
      name: 'plugins.bundle.config',
      key: PACKAGE_NAME,
      locale: NS,
      inject: (): SettingsPageInjected => ({ settingsForm: form }),
    }, SettingsPage))
  })
}
