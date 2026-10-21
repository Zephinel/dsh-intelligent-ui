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
import { ExportAction, type ExportActionInjected } from './ExportAction.tsx'
import { RenderUiRow } from './RenderUiRow.tsx'
import { SettingsPage, type SettingsFormLike, type SettingsPageInjected } from './SettingsPage.tsx'
import { ToggleControl, type ToggleControlInjected } from './ToggleControl.tsx'
import { enableCommand, startModeSync, styleCommand } from './commands.ts'
import { programsForMessage, type ExportChatSnapshot } from './export-data.ts'
import {
  HOST_ENTRY_ID,
  PACKAGE_NAME,
  readImageExportSettings,
  type SessionEnable,
  type StylePreference,
} from '../shared/intelligent-ui.ts'
import { NS, en, zh } from '../shared/locales.ts'
import './index.css'

/** Client plugin name shown by the shell. */
export const name = 'intelligent-ui'

/** Services this plugin reads: locale, slots, Session bindings, and command RPC. */
export const inject = ['locale', 'sessions', 'slots', 'uiConversation', 'remote', 'remote.commands']

/** Stable list id for the Turn-tail contribution. */
const CARD_ID = 'intelligent-ui'

/** Stable list id for the per-message export entry. */
const EXPORT_ID = 'intelligent-ui-export'

/** Host settings form captured for the export entry; absent on minimal deployments. */
let settingsForm: SettingsFormLike | undefined

/**
 * Register the Turn-tail cards, the compact `render_ui` Tool row, the composer
 * Intelligent UI switch, the per-message export entry, and the extension's
 * Settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // One channel per page keeps the chip/style panel consistent across tabs.
  startModeSync()
  // Both dictionaries go in one registration so every slot below can translate
  // through the `t` seat. A later locale switch re-renders the mounted outlets.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'intelligent-ui: dictionaries')
  /** Resolve the Chat target for one Session binding, or fail loudly. */
  const chatFor = (sessionId: SessionId) => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`intelligent-ui: unknown session "${sessionId}"`)
    return ctx.uiConversation.binding(binding).target('chat')
  }
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: CARD_ID,
    locale: NS,
    inject: (sessionId: SessionId): IntelligentUICardsInjected => {
      const chat = chatFor(sessionId)
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
  // Per-message export entry in the standard action strip. The owner gives us
  // only the durable message id; the injected face resolves it to the Turn's
  // recorded render_ui programs and reads the image-export preferences.
  // Answers without a recorded program stay out of the row.
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: EXPORT_ID,
    order: 20,
    locale: NS,
    inject: (sessionId: SessionId): ExportActionInjected => {
      const chat = chatFor(sessionId)
      return {
        programsFor: (messageId: string) => {
          const snapshot = chat.getSnapshot()
          return snapshot === undefined ? [] : programsForMessage(snapshot as unknown as ExportChatSnapshot, messageId)
        },
        settings: () => readImageExportSettings(settingsForm?.getSnapshot().value),
      }
    },
  }, ExportAction))
  // Replace the generic Tool row for this wire name: the program belongs in the
  // closing Turn's card, not in the collapsible process list.
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'render_ui', locale: NS },
    RenderUiRow,
  ))
  // Composer controls: one explicit scope/style command per action; the host
  // projection `intelligent-ui` owns the settled state and the pending fold.
  ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
    name: 'conversation.input.activity',
    locale: NS,
    inject: (sessionId: SessionId): ToggleControlInjected => {
      const run = async (command: string): Promise<string | null> => {
        const result = await ctx.remote.commands.execute(sessionId, command, [])
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return `unknown command: ${command}`
        return null
      }
      return {
        sessionId,
        flip: (scope: SessionEnable): Promise<string | null> => run(enableCommand(scope)),
        setStyle: (style: StylePreference): Promise<string | null> => run(styleCommand(style)),
      }
    },
  }, ToggleControl))
  // Configuration on this bundle's Plugins detail page: global enablement, answer
  // style, free composition and the image-export defaults persisted as volatile
  // Host settings fields. Optional: a deployment without the settings domain
  // keeps the composer control, the card and the export entry (with defaults).
  ctx.inject(['configForms'], (child) => {
    const form = child.configForms.get(HOST_ENTRY_ID) as unknown as SettingsFormLike
    settingsForm = form
    child.slots.inject('plugins.bundle.config', () => child.slots.register({
      name: 'plugins.bundle.config',
      key: PACKAGE_NAME,
      locale: NS,
      inject: (): SettingsPageInjected => ({ settingsForm: form }),
    }, SettingsPage))
  })
}
